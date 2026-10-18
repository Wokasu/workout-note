// AKB48劇場の公演情報をHTMLから取り出し、推しメンごとのiCalendar(.ics)を作る。
// 公式サイトのHTML構造に依存しすぎないよう、テキストに直してから
// 「日付 → 公演タイトル(「…」公演) → 開演時刻 → 出演メンバー」の並びを拾う。

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function htmlToLines(html) {
  const text = html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|li|ul|ol|tr|td|th|dt|dd|dl|h[1-6]|section|article|table|time)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return String.fromCodePoint(code);
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    });
  return text
    .split('\n')
    .map((l) => normalizeWidth(l).replace(/[ \t\u3000]+/g, ' ').trim())
    .filter(Boolean);
}

// 全角数字・記号を半角に寄せる（日付や時刻の判定用）
export function normalizeWidth(s) {
  return s
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/：/g, ':')
    .replace(/／/g, '/')
    .replace(/．/g, '.')
    .replace(/（/g, '(')
    .replace(/）/g, ')');
}

const DATE_PATTERNS = [
  // 2026年10月18日 / 2026.10.18 / 2026/10/18 / 2026-10-18
  { re: /(20\d{2})\s*[年./-]\s*(\d{1,2})\s*[月./-]\s*(\d{1,2})/, y: 1, m: 2, d: 3 },
  // 10月18日
  { re: /(\d{1,2})月\s*(\d{1,2})日/, m: 1, d: 2 },
  // 10/18(土) 10.18(土) — 年がなく区切りが「/」「.」のときは曜日つきに限る
  { re: /(\d{1,2})[/.](\d{1,2})\s*[(（]\s*[月火水木金土日]/, m: 1, d: 2 },
];

// 年が書かれていない日付は、基準日に一番近くなる年を選ぶ（12月に翌1月の予定が出ても大丈夫なように）
function resolveYear(month, day, today) {
  const base = today.getUTCFullYear();
  let best = null;
  for (const y of [base - 1, base, base + 1]) {
    const t = Date.UTC(y, month - 1, day);
    const diff = Math.abs(t - today.getTime());
    if (!best || diff < best.diff) best = { y, diff };
  }
  return best.y;
}

export function findDate(line, today) {
  for (const p of DATE_PATTERNS) {
    const m = line.match(p.re);
    if (!m) continue;
    const month = Number(m[p.m]);
    const day = Number(m[p.d]);
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    const year = p.y ? Number(m[p.y]) : resolveYear(month, day, today);
    return { year, month, day, index: m.index };
  }
  return null;
}

export function findTime(text) {
  const open = text.match(/開演\s*[:]?\s*(\d{1,2}):(\d{2})/) || text.match(/(\d{1,2}):(\d{2})\s*開演/);
  const any = open || text.match(/(?<![\d:])(\d{1,2}):(\d{2})(?![\d:])/);
  if (!any) return null;
  const h = Number(any[1]);
  const min = Number(any[2]);
  if (h > 23 || min > 59) return null;
  return { hour: h, minute: min };
}

const TITLE_RE = /[「『]([^」』]{1,40})[」』]\s*公演/;

/**
 * テキスト行から公演の候補を取り出す。
 * 日付が現れたらそこから次の日付までを「その日のブロック」とし、
 * ブロック内は公演タイトル(「…」公演)ごとにさらに分ける（昼夜2公演など）。
 */
export function extractShows(lines, { today = new Date(), sourceUrl = '' } = {}) {
  const blocks = [];
  let cur = null;
  for (const line of lines) {
    const date = findDate(line, today);
    if (date) {
      cur = { date, lines: [] };
      blocks.push(cur);
    }
    if (cur) cur.lines.push(line);
  }

  const shows = [];
  for (const block of blocks) {
    const segments = [];
    let seg = { lines: [], carriedTime: null };
    let lastTime = null;
    for (const line of block.lines) {
      if (TITLE_RE.test(line) && seg.lines.some((l) => TITLE_RE.test(l))) {
        segments.push(seg);
        // タイトルより前の行に書かれた時刻を次の公演に引き継げるよう覚えておく
        seg = { lines: [], carriedTime: lastTime };
      }
      seg.lines.push(line);
      const t = findTime(line);
      if (t) lastTime = t;
    }
    segments.push(seg);

    for (const s of segments) {
      const text = s.lines.join('\n');
      const titleMatch = text.match(TITLE_RE);
      if (!titleMatch && !/公演/.test(text)) continue;
      const time = findTime(text) || s.carriedTime;
      shows.push({
        year: block.date.year,
        month: block.date.month,
        day: block.date.day,
        hour: time?.hour ?? null,
        minute: time?.minute ?? null,
        title: titleMatch ? `「${titleMatch[1]}」公演` : '劇場公演',
        text,
        sourceUrl,
      });
    }
  }
  return shows;
}

const compact = (s) => s.replace(/[\s\u3000・･]/g, '');

// ブロック内に名前が出てくる推しメンを返す（「伊藤 百花」のような空白入りも拾う）
export function matchMembers(text, members) {
  const hay = compact(text);
  return members
    .filter((m) => [m.name, ...(m.aliases ?? [])].some((n) => hay.includes(compact(n))))
    .map((m) => m.name);
}

export function showKey(s) {
  const pad = (n) => String(n).padStart(2, '0');
  const time = s.hour == null ? 'xxxx' : `${pad(s.hour)}${pad(s.minute)}`;
  return `${s.year}${pad(s.month)}${pad(s.day)}-${time}-${s.title}`;
}

/** 同じ公演が複数ページに載っていたら1つにまとめ、出演した推しメンは合わせる */
export function mergeShows(list) {
  const map = new Map();
  for (const s of list) {
    const key = showKey(s);
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...s, members: [...new Set(s.members)] });
    } else {
      prev.members = [...new Set([...prev.members, ...s.members])];
    }
  }
  return [...map.values()].sort((a, b) => showKey(a).localeCompare(showKey(b)));
}

// ---- iCalendar ----

function escapeText(s) {
  return s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
}

// RFC 5545: 1行75オクテットまで。UTF-8の文字を途中で切らないよう折り返す
function fold(line) {
  const out = [];
  let buf = '';
  let bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > (out.length ? 74 : 75)) {
      out.push(buf);
      buf = '';
      bytes = 0;
    }
    buf += ch;
    bytes += b;
  }
  out.push(buf);
  return out.join('\r\n ');
}

function utcStamp(d) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

// 劇場の時刻は日本時間(UTC+9, サマータイムなし)
function jstToUtc(y, mo, d, h, mi) {
  return new Date(Date.UTC(y, mo - 1, d, h - 9, mi));
}

export function buildIcs(calendar, shows, { durationMinutes = 120, location = '', now = new Date() } = {}) {
  const pad = (n) => String(n).padStart(2, '0');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//workout-note//akb48-calendar//JA',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(calendar.name)}`,
    'X-WR-TIMEZONE:Asia/Tokyo',
    `X-APPLE-CALENDAR-COLOR:${calendar.color}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
    'X-PUBLISHED-TTL:PT6H',
  ];
  for (const s of shows) {
    const uid = `${showKey(s).replace(/[^\w-]/g, '')}-${Buffer.from(s.title).toString('hex').slice(0, 24)}@akb48-calendar`;
    const desc = [`出演: ${s.members.join('、')}`, s.sourceUrl ? `出典: ${s.sourceUrl}` : '', '※出演メンバーは変更になる場合があります']
      .filter(Boolean)
      .join('\n');
    lines.push('BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${utcStamp(now)}`);
    if (s.hour == null) {
      const next = new Date(Date.UTC(s.year, s.month - 1, s.day + 1));
      lines.push(
        `DTSTART;VALUE=DATE:${s.year}${pad(s.month)}${pad(s.day)}`,
        `DTEND;VALUE=DATE:${next.getUTCFullYear()}${pad(next.getUTCMonth() + 1)}${pad(next.getUTCDate())}`,
      );
    } else {
      const start = jstToUtc(s.year, s.month, s.day, s.hour, s.minute);
      const end = new Date(start.getTime() + durationMinutes * 60_000);
      lines.push(`DTSTART:${utcStamp(start)}`, `DTEND:${utcStamp(end)}`);
    }
    lines.push(
      `SUMMARY:${escapeText(`${s.title}（${s.members.join('・')}）`)}`,
      `DESCRIPTION:${escapeText(desc)}`,
    );
    if (location) lines.push(`LOCATION:${escapeText(location)}`);
    if (s.sourceUrl) lines.push(`URL:${s.sourceUrl}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
