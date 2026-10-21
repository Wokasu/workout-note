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
    // チケットセンター（ZAIKO）へのリンクは、リンク先を「⟨URL⟩」として本文に残す
    .replace(/<a\b[^>]*href=["']([^"']*zaiko\.io[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, '$2 ⟨$1⟩')
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

const weekdayOf = (y, m, d) => '日月火水木金土'[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];

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
const SINGLE_DATE_RE = /^(20\d{2})年(\d{1,2})月(\d{1,2})日 ?\((.)\)$/;
const CAST_HEAD_RE = /^【(?:(\d{1,2}:\d{2})公演 ?)?出演メンバー】$/;

// 公演ごとの申込ページへのリンク（htmlToLines が残した ⟨URL⟩）。チケットセンターのトップへのリンクは除く
const APPLY_LINK_RE = /⟨(https:\/\/akb48\.zaiko\.io\/(?:[a-z]{2}\/)?e\/[^⟩\s]+)⟩/;

// 「【(1)～(3)枠の販売スケジュール】」の次の「＜受付期間＞2026年10月18日(日)16:00まで」を締切として読む（ロビー観覧チケットは除く）
const SALE_LABEL_RE = /^【(.+)の販売スケジュール】$/;
const DEADLINE_RE = /^[<＜]受付期間[>＞]\s*(20\d{2})年(\d{1,2})月(\d{1,2})日\s*\(.\)\s*(\d{1,2}):(\d{2})まで/;
function readDeadline(line, label) {
  const m = line.match(DEADLINE_RE);
  if (!m || !label || /ロビー/.test(label)) return null;
  return {
    label: label.replace(/[~～]/g, '〜'),
    year: Number(m[1]), month: Number(m[2]), day: Number(m[3]), hour: Number(m[4]), minute: Number(m[5]),
  };
}

const SCHEDULE_DAY_RE = /^(20\d{2}) ?年 ?(\d{1,2}) ?月 ?(\d{1,2}) ?日 ?\S*(?: (\d{1,2}):(\d{2}) ?[~～])?$/;

/**
 * トップページの出演メンバー。
 * 劇場スケジュール一覧（休館日も含む）と、その後ろに日付なしで並ぶ詳細を順番に対応させる。
 * 申込が始まっている公演は、詳細に書かれた申込ページのリンク（applyUrl）も返す。
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
      details.push({ title: normalizeTitle(lines[i - 1]), hour: Number(t[1]), minute: Number(t[2]), names: [], applyUrl: null, deadlines: [], label: null });
    } else if (l === '休館日') {
      details.push({ title: null, names: [], applyUrl: null, deadlines: [], label: null });
    } else if (l === '【出演メンバー】' && details.length && !details.at(-1).names.length) {
      details.at(-1).names = readMembers(lines, i + 1);
    } else if (APPLY_LINK_RE.test(l) && details.length && !details.at(-1).applyUrl) {
      // 申込が始まった公演には「★お申し込みはコチラ」などのリンクが付く
      details.at(-1).applyUrl = l.match(APPLY_LINK_RE)[1];
    } else if (details.length && SALE_LABEL_RE.test(l)) {
      details.at(-1).label = l.match(SALE_LABEL_RE)[1];
    } else if (details.length && DEADLINE_RE.test(l)) {
      const d = readDeadline(l, details.at(-1).label);
      if (d) details.at(-1).deadlines.push(d);
    }
  }
  if (!entries.length || entries.length !== details.length) return [];
  const same = entries.every((e, i) => {
    const d = details[i];
    return e.title === null ? d.title === null : e.title === d.title && e.hour === d.hour && e.minute === d.minute;
  });
  if (!same) return [];
  return entries
    .map((e, i) => ({ ...e, names: details[i].names, applyUrl: details[i].applyUrl, deadlines: details[i].deadlines, kind: 'top', sourceUrl }))
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
      const cast = { year: cur.year, month: cur.month, day: cur.day, title: cur.title, ...t, names, applyUrl: null, deadlines: cur.deadlines, kind: cur.kind, sourceUrl };
      out.push(cast);
      cur.casts.push(cast);
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;
    if ((m = line.match(MONTHLY_RE))) {
      const month = Number(m[1]);
      const day = Number(m[2]);
      cur = { year: resolveYear(month, day, today), month, day, title: normalizeTitle(m[3]), times: parseTimes(m[4]), kind: 'monthly', casts: [], deadlines: [], label: null };
    } else if ((m = line.match(SINGLE_DATE_RE)) && lines[i + 1]) {
      const next = lines[i + 1];
      const year = Number(m[1]);
      let [month, day] = [Number(m[2]), Number(m[3])];
      // 公式の記事には日付の書き間違いがある（例: 10月27日の公演の記事に「2026年10月28日(火)」）。
      // 曜日が日付と合わないときは、記事の見出しや本文にある「10月27日」のうち曜日が合う日付を使う
      if (weekdayOf(year, month, day) !== m[4]) {
        const fixed = lines
          .slice(0, i)
          .flatMap((l) => [...l.matchAll(/(\d{1,2})月(\d{1,2})日/g)])
          .map((x) => [Number(x[1]), Number(x[2])])
          .find(([mo, d]) => weekdayOf(year, mo, d) === m[4]);
        if (!fixed) {
          cur = null;
          continue;
        }
        [month, day] = fixed;
      }
      cur = {
        year, month, day,
        title: normalizeTitle(next.replace(/\d{1,2}:\d{2}.*$/, '')),
        times: parseTimes(next), kind: 'single', casts: [], deadlines: [], label: null,
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
    } else if (cur && SALE_LABEL_RE.test(line)) {
      cur.label = line.match(SALE_LABEL_RE)[1];
    } else if (cur && DEADLINE_RE.test(line)) {
      // 締切はその日の公演（昼夜とも）に共通。cur.deadlines は cast と同じ配列なので、後から読んだ分も反映される
      const d = readDeadline(line, cur.label);
      if (d) cur.deadlines.push(d);
    } else if (cur && APPLY_LINK_RE.test(line)) {
      // 申込ページへのリンクは、まだリンクのない公演に書かれた順に付ける
      const cast = cur.casts.find((c) => !c.applyUrl);
      if (cast) cast.applyUrl = line.match(APPLY_LINK_RE)[1];
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
  // 申込ページのリンクは、どの記事に書かれていたものでも使う（日付・公演名・開演時刻で対応させる）
  const timeKey = (s) => `${performanceKey(s)}|${s.hour}:${s.minute}`;
  const urls = new Map(casts.filter((c) => c.applyUrl && c.hour != null).map((c) => [timeKey(c), c.applyUrl]));
  // 申込締切は日付・公演名ごと（昼夜の公演で共通）
  const deadlines = new Map();
  for (const c of casts) if (c.deadlines?.length && !deadlines.has(performanceKey(c))) deadlines.set(performanceKey(c), c.deadlines);
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
        const show = { year: c.year, month: c.month, day: c.day, ...t, title: c.title, members: hits, sourceUrl: c.sourceUrl };
        shows.push({ ...show, applyUrl: urls.get(timeKey(show)) ?? null, deadlines: deadlines.get(performanceKey(show)) ?? [] });
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
    else {
      prev.members = [...new Set([...prev.members, ...s.members])];
      prev.applyUrl ??= s.applyUrl;
      if (!prev.deadlines?.length) prev.deadlines = s.deadlines;
    }
  }
  return [...map.values()].sort((a, b) => showKey(a).localeCompare(showKey(b)));
}

// ---- SNS告知文 ----
// 例)
//   11月出演公演🧤🤍
//
//   「ここからだ」
//   3日㈫ 13:00／17:30
//
//   ○柱の会限定イベント
//   15日㈰ 14:00
const ENCLOSED_WEEKDAYS = ['㈰', '㈪', '㈫', '㈬', '㈭', '㈮', '㈯'];

/**
 * 1人ぶん・1か月ぶんの出演告知文を作る。shows は劇場の公演（kind が 'event' でないもの）。
 * 「」の付く公演は初めて出る日の順に、それ以外（柱の会限定イベントなど）は「○」を付けて後ろに並べる。
 */
export function buildAnnouncement(name, shows, year, month, emoji = '') {
  const pad = (n) => String(n).padStart(2, '0');
  const mine = shows
    .filter((s) => s.kind !== 'event' && s.year === year && s.month === month && s.members.includes(name))
    .sort((a, b) => a.day - b.day || (a.hour ?? 0) - (b.hour ?? 0) || (a.minute ?? 0) - (b.minute ?? 0));
  if (!mine.length) return null;
  const groups = new Map();
  for (const s of mine) {
    const m = s.title.match(/^「(.+)」公演$/);
    const key = m ? `「${m[1]}」` : `○${s.title}`;
    if (!groups.has(key)) groups.set(key, new Map());
    const days = groups.get(key);
    if (!days.has(s.day)) days.set(s.day, []);
    if (s.hour != null) days.get(s.day).push(`${s.hour}:${pad(s.minute)}`);
  }
  const keys = [...groups.keys()].sort((a, b) => (a[0] === '○') - (b[0] === '○'));
  const blocks = keys.map((key) => {
    const lines = [...groups.get(key)].map(([day, times]) => {
      const wd = ENCLOSED_WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
      return `${day}日${wd}${times.length ? ` ${times.join('／')}` : ''}`;
    });
    return [key, ...lines].join('\n');
  });
  return [`${month}月出演公演${emoji}`, ...blocks].join('\n\n') + '\n';
}

// ---- 公式スケジュール（握手会・ライブ・イベントなど）----
// 公式サイトの「スケジュール」ページが読んでいるデータ（/public/api/schedule/calendar/）。
// 1件ごとに日時・カテゴリ・出演メンバーID・本文がある。parent_category は
// 1=劇場公演（別に読む） 2=メディア（テレビ・ラジオ・雑誌など） 3=イベント・ライブ 7=握手会・写真会。

const ONLINE_RE = /オンライン|配信|リモート/;
const PUBLIC_RECORDING_RE = /公開(?:収録|録音|生放送|放送)|観覧/;
const VENUE_RE = /【会場】|会場[＞>:：]/;

function bodyText(body) {
  return htmlToLines(body.replace(/\\\//g, '/')).join('\n');
}

// 本文から詳細ページのURLを選ぶ（＜詳細＞ ＞ 【公式サイト】 ＞ 最初のURL）
function pickDetailUrl(text) {
  const urls = (label) => text.match(new RegExp(`${label}[^\\n]*\\n?\\s*(https?:\\/\\/[^\\s⟨⟩]+)`));
  const any = text.match(/https?:\/\/[^\s⟨⟩]+/);
  return (urls('＜詳細＞') || urls('【公式サイト】') || urls('＜申込ページはこちら＞'))?.[1] ?? any?.[0] ?? null;
}

/**
 * カレンダーに入れる現場かどうか。
 * 握手会・写真会・お話し会（オンラインも含む）、イベント・ライブ（オンライン・配信を除く）、
 * 会場が書かれた予定、テレビ・ラジオの公開収録を入れる。
 */
export function isInPerson(item, text) {
  const pc = String(item.parent_category);
  if (pc === '1' || pc === '999') return false;
  if (pc === '7') return true;
  const title = bodyText(item.title);
  if (ONLINE_RE.test(title)) return false;
  if (pc === '3') return true;
  return PUBLIC_RECORDING_RE.test(`${title}\n${text}`) || (pc !== '2' && VENUE_RE.test(text));
}

/**
 * スケジュールのデータから、推しメンが出る現場を取り出す。
 * members: [{ name, mid }]。出演メンバーが空の予定（グループ全体の出演など）は memberUnknown: true で返す
 */
export function eventsFromApi(json, members) {
  const out = [];
  const days = json?.data?.thismonth;
  if (!days || Array.isArray(days)) return out;
  for (const item of Object.values(days).flat()) {
    const text = bodyText(item.body ?? '');
    if (!isInPerson(item, text)) continue;
    const ids = String(item.member ?? '').split(',').filter(Boolean);
    const hits = members.filter((m) => ids.includes(String(m.mid))).map((m) => m.name);
    if (ids.length && !hits.length) continue;
    const [d, t] = item.date.split(' ');
    const [year, month, day] = d.split('-').map(Number);
    const [hour, minute] = t.split(':').map(Number);
    const [, et] = (item.end_date ?? '').split(' ');
    const [endHour, endMinute] = (et ?? '00:00').split(':').map(Number);
    const allDay = hour === 0 && minute === 0;
    const hasEnd = !allDay && endHour * 60 + endMinute > hour * 60 + minute;
    out.push({
      year, month, day,
      hour: allDay ? null : hour,
      minute: allDay ? null : minute,
      endHour: hasEnd ? endHour : null,
      endMinute: hasEnd ? endMinute : null,
      title: bodyText(item.title).replace(/\s+/g, ' ').trim(),
      members: hits,
      memberUnknown: !ids.length,
      detailUrl: pickDetailUrl(text),
      location: text.match(/(?:【会場】|会場[：:])\s*\n?\s*([^\n]+)/)?.[1]?.trim() ?? null,
      note: text.slice(0, 600),
      kind: 'event',
      sourceUrl: 'https://www.akb48.co.jp/about/schedule',
    });
  }
  return out;
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
      s.memberUnknown ? '出演: 出演メンバー未発表' : `出演: ${s.members.join('、')}`,
      s.applyUrl ? `申込: ${s.applyUrl}` : '',
      s.detailUrl ? `詳細: ${s.detailUrl}` : '',
      s.sourceUrl ? `出典: ${s.sourceUrl}` : '',
      s.note ? `\n${s.note}` : '',
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
      const end = s.endHour != null
        ? jstToUtc(s.year, s.month, s.day, s.endHour, s.endMinute)
        : new Date(start.getTime() + durationMinutes * 60_000);
      lines.push(`DTSTART:${utcStamp(start)}`, `DTEND:${utcStamp(end)}`);
    }
    lines.push(
      `SUMMARY:${escapeText(`${s.title}（${s.memberUnknown ? '出演メンバー未発表' : s.members.join('・')}）`)}`,
      `DESCRIPTION:${escapeText(desc)}`,
    );
    const place = s.kind === 'event' ? s.location : location;
    if (place) lines.push(`LOCATION:${escapeText(place)}`);
    const url = s.applyUrl || s.detailUrl || s.sourceUrl;
    if (url) lines.push(`URL:${url}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

// ---- 申込締切カレンダー ----
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const md = (y, m, d) => `${m}/${d}(${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]})`;

/**
 * 推しが出る公演の申込締切を、締切日時と応募枠ごとに1つの予定にまとめる（締切の1日前に通知）。
 * 予定は締切の30分前から締切まで。
 */
export function buildDeadlineIcs(calendar, shows, { now = new Date() } = {}) {
  const pad = (n) => String(n).padStart(2, '0');
  const groups = new Map();
  for (const s of shows) {
    if (s.kind === 'event') continue;
    for (const d of s.deadlines ?? []) {
      const end = jstToUtc(d.year, d.month, d.day, d.hour, d.minute);
      if (end <= now) continue;
      const key = `${end.toISOString()}|${d.label}`;
      if (!groups.has(key)) groups.set(key, { end, d, shows: [] });
      groups.get(key).shows.push(s);
    }
  }
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
  const sorted = [...groups.values()].sort((a, b) => a.end - b.end || a.d.label.localeCompare(b.d.label));
  for (const { end, d, shows: list } of sorted) {
    list.sort((a, b) => showKey(a).localeCompare(showKey(b)));
    const first = list[0];
    const summary = `📝申込締切 ${d.label} ${md(first.year, first.month, first.day)}${first.title}${list.length > 1 ? ` ほか${list.length - 1}公演` : ''}`;
    const desc = [
      `${d.label}の受付は ${md(d.year, d.month, d.day)} ${d.hour}:${pad(d.minute)} までです。`,
      '',
      ...list.flatMap((s) => [
        `${md(s.year, s.month, s.day)} ${s.hour == null ? '' : `${s.hour}:${pad(s.minute)} `}${s.title}（${s.members.join('・')}）`,
        s.applyUrl ? `申込: ${s.applyUrl}` : '',
      ]).filter(Boolean),
    ].join('\n');
    const start = new Date(end.getTime() - 30 * 60_000);
    lines.push(
      'BEGIN:VEVENT',
      `UID:deadline-${utcStamp(end)}-${Buffer.from(d.label).toString('hex').slice(0, 16)}@akb48-calendar`,
      `DTSTAMP:${utcStamp(now)}`,
      `DTSTART:${utcStamp(start)}`,
      `DTEND:${utcStamp(end)}`,
      `SUMMARY:${escapeText(summary)}`,
      `DESCRIPTION:${escapeText(desc)}`,
      ...(first.applyUrl ? [`URL:${first.applyUrl}`] : []),
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeText(`明日締切: ${summary}`)}`,
      'TRIGGER:-PT23H30M',
      'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

/** 前回は申込リンクがなく、今回ついた推しの公演（＝申込が始まった公演） */
export function newlyOpened(previous, current) {
  const before = new Map(previous.map((s) => [showKey(s), s]));
  return current.filter((s) => s.kind !== 'event' && s.applyUrl && !before.get(showKey(s))?.applyUrl);
}

/** 申込開始のプッシュ通知（ntfy）用の短い文: 1公演1行（日付・開演・公演名・推し）。申込ページは通知をタップすると開く */
export function openedPlain(list) {
  const pad = (n) => String(n).padStart(2, '0');
  return list
    .map((s) => `${md(s.year, s.month, s.day)} ${s.hour == null ? '' : `${s.hour}:${pad(s.minute)} `}${s.title}（${s.members.join('・')}）`)
    .join('\n');
}

/** 申込開始の通知文（GitHub Issue 用の Markdown） */
export function openedMessage(list) {
  const pad = (n) => String(n).padStart(2, '0');
  return [
    '推しが出る劇場公演の申込が始まりました。',
    '',
    ...list.flatMap((s) => {
      const dl = (s.deadlines ?? []).map((d) => `${d.label} ${md(d.year, d.month, d.day)} ${d.hour}:${pad(d.minute)}まで`).join(' ／ ');
      return [
        `- **${md(s.year, s.month, s.day)} ${s.hour == null ? '' : `${s.hour}:${pad(s.minute)} `}${s.title}**（${s.members.join('・')}）`,
        `  - 申込: ${s.applyUrl}`,
        ...(dl ? [`  - 締切: ${dl}`] : []),
      ];
    }),
  ].join('\n') + '\n';
}
