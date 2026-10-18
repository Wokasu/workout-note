// AKB48劇場の公演情報を公式サイトのHTMLから取り出し、推しメンごとのiCalendar(.ics)を作る。
//
// 公式サイトで読める情報は3種類:
//  - トップページの「劇場スケジュール」一覧 … 日付・開演時刻・公演名
//      ページの後ろの方に、一覧と同じ順番で各公演の詳細（出演メンバー）が日付なしで並んでいる
//  - 「AKB48劇場 公演スケジュール更新のお知らせ」 … 1か月分の日付・公演名・開演時刻・出演メンバー
//      例) 11/1(日) 「ＲＥＳＥＴ」公演 13:00開演/17:30開演
//          【出演メンバー】
//          太田有紀・工藤華純・…
//  - 「10月26日 「ＲＥＳＥＴ」公演のご案内」 … 1公演ぶんの最新の出演メンバー（開演時刻がないこともある）
// 出演メンバーは トップページ（劇場の最新データ）＞「ご案内」＞「スケジュール更新」の順に優先し、
// 開演時刻が書かれていなければ一覧から補う。

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ' };

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
    .map((l) => normalizeWidth(l).replace(/[ \t　]+/g, ' ').trim())
    .filter(Boolean);
}

// 全角英数字・記号（「ＲＥＳＥＴ」「１８：３０」「～」など）を半角に寄せる
export function normalizeWidth(s) {
  return s.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

// 年が書かれていない日付は、基準日に一番近くなる年を選ぶ（12月に翌1月の予定が出ても大丈夫なように）
export function resolveYear(month, day, today) {
  const base = today.getUTCFullYear();
  let best = null;
  for (const y of [base - 1, base, base + 1]) {
    const diff = Math.abs(Date.UTC(y, month - 1, day) - today.getTime());
    if (!best || diff < best.diff) best = { y, diff };
  }
  return best.y;
}

function parseTimes(s) {
  return [...s.matchAll(/(\d{1,2}):(\d{2})/g)].map((m) => ({ hour: Number(m[1]), minute: Number(m[2]) }));
}

// 「「ＲＥＳＥＴ」公演 初日」→「「RESET」公演」のように、照合用の公演名にそろえる
export function normalizeTitle(s) {
  const m = s.match(/「[^」]+」公演/);
  return (m ? m[0] : s).replace(/\s+/g, ' ').trim();
}

const SCHEDULE_RE = /^(20\d{2}) ?年 ?(\d{1,2}) ?月 ?(\d{1,2}) ?日 ?\S* (\d{1,2}):(\d{2}) ?[~～]$/;
const MONTHLY_RE = /^(\d{1,2})\/(\d{1,2}) ?\(.\) ?(.+?) ((?:\d{1,2}:\d{2}開演 ?\/? ?)+)$/;
const SINGLE_DATE_RE = /^(20\d{2})年(\d{1,2})月(\d{1,2})日 ?\(.\)$/;
const CAST_HEAD_RE = /^【(?:(\d{1,2}:\d{2})公演 ?)?出演メンバー】$/;

const SCHEDULE_DAY_RE = /^(20\d{2}) ?年 ?(\d{1,2}) ?月 ?(\d{1,2}) ?日 ?\S*(?: (\d{1,2}):(\d{2}) ?[~～])?$/;

/**
 * トップページの出演メンバー。
 * 劇場スケジュール一覧（休館日も含む）と、その後ろに日付なしで並ぶ詳細を順番に対応させる。
 * 公演名・開演時刻・休館日が1つでも食い違ったら、対応がずれているので何も返さない。
 */
export function extractTopCasts(lines, { sourceUrl = '' } = {}) {
  const entries = [];
  let last = -1;
  lines.forEach((line, i) => {
    const m = line.match(SCHEDULE_DAY_RE);
    if (!m || !lines[i + 1]) return;
    entries.push({
      year: Number(m[1]), month: Number(m[2]), day: Number(m[3]),
      hour: m[4] ? Number(m[4]) : null, minute: m[5] ? Number(m[5]) : null,
      title: m[4] ? normalizeTitle(lines[i + 1]) : null, // 時刻がない日は休館日
    });
    last = i + 1;
  });
  const details = [];
  for (let i = last + 1; i < lines.length; i++) {
    const l = lines[i];
    const t = l.match(/^(\d{1,2}):(\d{2})開演$/);
    if (t && /公演|イベント/.test(lines[i - 1])) {
      details.push({ title: normalizeTitle(lines[i - 1]), hour: Number(t[1]), minute: Number(t[2]), names: [] });
    } else if (l === '休館日') {
      details.push({ title: null, names: [] });
    } else if (l === '【出演メンバー】' && details.length && !details.at(-1).names.length) {
      details.at(-1).names = readMembers(lines, i + 1);
    }
  }
  if (!entries.length || entries.length !== details.length) return [];
  const same = entries.every((e, i) => {
    const d = details[i];
    return e.title === null ? d.title === null : e.title === d.title && e.hour === d.hour && e.minute === d.minute;
  });
  if (!same) return [];
  return entries
    .map((e, i) => ({ ...e, names: details[i].names, kind: 'top', sourceUrl }))
    .filter((c) => c.title !== null && c.names.length);
}

/** トップページの劇場スケジュール一覧: 日付・時刻・公演名 */
export function extractSchedule(lines) {
  const out = [];
  lines.forEach((line, i) => {
    const m = line.match(SCHEDULE_RE);
    if (!m || !lines[i + 1]) return;
    out.push({
      year: Number(m[1]), month: Number(m[2]), day: Number(m[3]),
      hour: Number(m[4]), minute: Number(m[5]),
      title: normalizeTitle(lines[i + 1]),
    });
  });
  return out;
}

// 【出演メンバー】の次の行から、メンバーの並び（「・」区切り）を読む
function readMembers(lines, start) {
  const names = [];
  for (let i = start; i < lines.length; i++) {
    const l = lines[i];
    if (/^[【※]/.test(l) || MONTHLY_RE.test(l) || SINGLE_DATE_RE.test(l) || !l.includes('・') && names.length) break;
    names.push(...l.split('・').map((n) => n.trim()).filter(Boolean));
    if (!l.includes('・')) break;
  }
  return names;
}

/**
 * お知らせ記事から出演メンバーを読む。
 * 返り値は1公演（1開演時刻）ごと。開演時刻が分からないものは hour: null。
 */
export function extractCasts(lines, { today = new Date(), sourceUrl = '' } = {}) {
  const out = [];
  let cur = null; // { year, month, day, title, times, kind }
  const push = (times, names) => {
    for (const t of times.length ? times : [{ hour: null, minute: null }]) {
      out.push({ year: cur.year, month: cur.month, day: cur.day, title: cur.title, ...t, names, kind: cur.kind, sourceUrl });
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;
    if ((m = line.match(MONTHLY_RE))) {
      const month = Number(m[1]);
      const day = Number(m[2]);
      cur = { year: resolveYear(month, day, today), month, day, title: normalizeTitle(m[3]), times: parseTimes(m[4]), kind: 'monthly' };
    } else if ((m = line.match(SINGLE_DATE_RE)) && lines[i + 1]) {
      const next = lines[i + 1];
      cur = {
        year: Number(m[1]), month: Number(m[2]), day: Number(m[3]),
        title: normalizeTitle(next.replace(/\d{1,2}:\d{2}.*$/, '')),
        times: parseTimes(next), kind: 'single',
      };
      i++;
    } else if (cur && (m = line.match(CAST_HEAD_RE))) {
      const names = readMembers(lines, i + 1);
      if (!names.length) continue;
      if (m[1]) {
        // 【14:00公演 出演メンバー】のように、時刻ごとにメンバーが違う場合
        push(parseTimes(m[1]), names);
      } else {
        push(cur.times, names);
      }
    } else if (/^\d{1,2}\/\d{1,2} ?\(.\)/.test(line)) {
      cur = null; // 休館日など
    }
  }
  return out;
}

const dateKey = (s) => `${s.year}-${s.month}-${s.day}`;
export const performanceKey = (s) => `${dateKey(s)}|${s.title}`;
const compact = (s) => s.replace(/[\s　]/g, '');

/**
 * 出演情報と一覧を突き合わせて公演の一覧を作る。
 * 同じ日・同じ公演の情報が複数あれば トップページ(top)＞「ご案内」(single)＞「スケジュール更新」(monthly) の順に優先する。
 * 返り値: { shows: 推しメンが出る公演, covered: 出演情報が見つかった「日付|公演名」 }
 */
export function buildShows(casts, schedule, members) {
  const groups = new Map();
  for (const c of casts) {
    const key = performanceKey(c);
    const g = groups.get(key) ?? { top: [], single: [], monthly: [] };
    g[c.kind].push(c);
    groups.set(key, g);
  }
  const shows = [];
  for (const g of groups.values()) {
    for (const c of [g.top, g.single, g.monthly].find((list) => list.length)) {
      const hits = members
        .filter((m) => [m.name, ...(m.aliases ?? [])].some((n) => c.names.some((x) => compact(x) === compact(n))))
        .map((m) => m.name);
      if (!hits.length) continue;
      const times = c.hour != null
        ? [{ hour: c.hour, minute: c.minute }]
        : schedule.filter((s) => performanceKey(s) === performanceKey(c)).map(({ hour, minute }) => ({ hour, minute }));
      for (const t of times.length ? times : [{ hour: null, minute: null }]) {
        shows.push({ year: c.year, month: c.month, day: c.day, ...t, title: c.title, members: hits, sourceUrl: c.sourceUrl });
      }
    }
  }
  return { shows: mergeShows(shows), covered: new Set(groups.keys()) };
}

export function showKey(s) {
  const pad = (n) => String(n).padStart(2, '0');
  const time = s.hour == null ? 'xxxx' : `${pad(s.hour)}${pad(s.minute)}`;
  return `${s.year}${pad(s.month)}${pad(s.day)}-${time}-${s.title}`;
}

/** 同じ公演（同じ開演時刻）が重なったら1つにまとめる */
export function mergeShows(list) {
  const map = new Map();
  for (const s of list) {
    const key = showKey(s);
    const prev = map.get(key);
    if (!prev) map.set(key, { ...s, members: [...new Set(s.members)] });
    else prev.members = [...new Set([...prev.members, ...s.members])];
  }
  return [...map.values()].sort((a, b) => showKey(a).localeCompare(showKey(b)));
}

/**
 * AKB48チケットセンター（ZAIKO）の申込ページURLを作る。
 * 公演ごとのURLの形（テンプレート）の {yyyy} {MMDD} {HHMM} を日付・開演時刻で置き換える。
 * 例) "{yyyy}-reset-{MMDD}-{HHMM}" → https://akb48.zaiko.io/ja/e/2026-reset-1023-1830
 * テンプレートが設定にない公演は null
 */
export function applyUrl(s, templates) {
  const template = templates[s.title];
  if (!template || (s.hour == null && template.includes('{HHMM}'))) return null;
  const pad = (n) => String(n).padStart(2, '0');
  const path = template
    .replace('{yyyy}', s.year)
    .replace('{MMDD}', `${pad(s.month)}${pad(s.day)}`)
    .replace('{HHMM}', `${pad(s.hour)}${pad(s.minute)}`);
  return `https://akb48.zaiko.io/ja/e/${path}`;
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
    const desc = [
      `出演: ${s.members.join('、')}`,
      s.applyUrl ? `申込: ${s.applyUrl}` : '',
      s.sourceUrl ? `出典: ${s.sourceUrl}` : '',
      '※出演メンバーは変更になる場合があります',
    ]
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
    if (s.applyUrl || s.sourceUrl) lines.push(`URL:${s.applyUrl || s.sourceUrl}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
