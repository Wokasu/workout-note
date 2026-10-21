#!/usr/bin/env node
// 使い方: node akb48-calendar/update.mjs --out <出力フォルダ> [--dump <デバッグ用フォルダ>]
// 出力フォルダに <calendar.id>.ics と events.json（前回までの記録）を書き出す。
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAnnouncement, buildDeadlineIcs, buildIcs, newlyOpened, openedMessage, buildShows, eventsFromApi, extractCasts, extractSchedule, extractTopCasts, htmlToLines, mergeShows, performanceKey } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const outDir = args.out ?? join(here, 'feed');
const dumpDir = args.dump;
const config = JSON.parse(await readFile(join(here, 'config.json'), 'utf8'));
const allMembers = config.calendars.flatMap((c) => c.members);
const today = args.today ? new Date(args.today) : new Date(); // --today は動作確認用

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (akb48-calendar; personal use)', 'Accept-Language': 'ja' },
  });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

function collectLinks(html, baseUrl) {
  const links = [];
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = new URL(m[1], baseUrl).href;
    const text = m[2].replace(/<[^>]+>/g, '');
    if (
      href.includes(config.followLinkPattern) &&
      new RegExp(config.followLinkTextPattern).test(text) &&
      !new RegExp(config.followLinkExcludePattern).test(text)
    ) {
      links.push(href);
    }
  }
  return links;
}

// 調査用: --probe で、指定したページの本文とリンク一覧を dump に書き出すだけ
if (dumpDir && args.probe) {
  await mkdir(dumpDir, { recursive: true });
  let n = 0;
  for (const spec of args.probe.split(',')) {
    n++;
    try {
      // raw:URL → 加工せずに出す / post:URL|本文 → POSTして結果をそのまま出す
      if (/^(raw|post|form):/.test(spec)) {
        const [url, body] = spec.replace(/^(raw|post|form):/, '').split('|');
        let init = {};
        if (spec.startsWith('post:')) {
          init = { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } };
        } else if (spec.startsWith('form:')) {
          const form = new FormData();
          for (const [k, v] of new URLSearchParams(body ?? '')) form.append(k, v);
          init = { method: 'POST', body: form };
        }
        const res = await fetch(url, init);
        const text = await res.text();
        await writeFile(join(dumpDir, `probe-${n}.txt`), `${spec}\nHTTP ${res.status}\n\n${text.slice(0, 600000)}\n`);
        console.log(`probe ${spec}: HTTP ${res.status} ${text.length} bytes`);
        continue;
      }
      const url = spec;
      const html = await fetchHtml(url);
      const anchors = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
        .map((m) => `${new URL(m[1], url).href}\t${m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}`);
      const scripts = [...html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|json)[^"']*)["']|["'](\/[\w\/.-]*api[\w\/.?=&-]*)["']/gi)].map((m) => m[1] || m[2]);
      await writeFile(join(dumpDir, `probe-${n}.txt`), `${url}\n\n=== links ===\n${anchors.join('\n')}\n\n=== scripts/api ===\n${scripts.join('\n')}\n\n=== text ===\n${htmlToLines(html).join('\n')}\n`);
      console.log(`probe ${url}: ${html.length} bytes`);
    } catch (e) {
      console.warn(`probe 失敗 ${spec}: ${e.message}`);
    }
  }
  process.exit(0);
}

const schedule = [];
const casts = [];
let fetchedPages = 0;
const queue = [...config.sources];
const seen = new Set();
let followed = 0;
while (queue.length) {
  const url = queue.shift();
  if (seen.has(url)) continue;
  seen.add(url);
  let html;
  try {
    html = await fetchHtml(url);
  } catch (e) {
    console.warn(`取得失敗: ${e.message}`);
    continue;
  }
  fetchedPages++;
  const lines = htmlToLines(html);
  if (dumpDir) {
    await mkdir(dumpDir, { recursive: true });
    await writeFile(join(dumpDir, `${seen.size}.txt`), `${url}\n\n${lines.join('\n')}\n`);
  }
  const sch = extractSchedule(lines);
  schedule.push(...sch);
  if (config.sources.includes(url)) {
    const top = extractTopCasts(lines, { sourceUrl: url });
    casts.push(...top);
    console.log(`${url}: 劇場スケジュール ${sch.length} 件、出演情報 ${top.length} 件`);
    for (const link of collectLinks(html, url)) {
      if (followed >= config.maxFollowLinks) break;
      if (!seen.has(link) && !queue.includes(link)) {
        queue.push(link);
        followed++;
      }
    }
  } else {
    // 出演メンバーはお知らせ記事からだけ読む（トップページには日付のないメンバー表もあって紛らわしいため）
    const c = extractCasts(lines, { today, sourceUrl: url });
    casts.push(...c);
    console.log(`${url}: 出演情報 ${c.length} 件 (${lines.find((l) => /公演|お知らせ/.test(l) && !/^AKB48公式/.test(l)) ?? ''})`);
  }
}

const { shows: found, covered } = buildShows(casts, schedule, allMembers);

// 公式スケジュールから、推しメンが出る握手会・ライブ・イベントなどを読む（今月から scheduleMonthsAhead か月先まで）
const apiEvents = [];
const fetchedMonths = new Set();
for (let i = 0; i <= (config.scheduleMonthsAhead ?? 3); i++) {
  const jst = new Date(today.getTime() + 9 * 3600_000);
  const d = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth() + i, 1));
  const [year, month] = [d.getUTCFullYear(), d.getUTCMonth() + 1];
  try {
    const form = new FormData();
    form.append('month', String(month));
    form.append('year', String(year));
    form.append('category', '0');
    const res = await fetch(config.scheduleApi, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.result !== 'ok') throw new Error(`result=${json.result}`);
    const got = eventsFromApi(json, allMembers);
    apiEvents.push(...got);
    fetchedMonths.add(`${year}-${month}`);
    console.log(`スケジュール ${year}/${month}: 現場 ${got.length} 件`);
  } catch (e) {
    console.warn(`スケジュール ${year}/${month} 取得失敗: ${e.message}`);
  }
}

// 前回の記録: 今回の記事に出演情報がなかった公演（過去の公演や、一覧から消えたお知らせの分）は前回のまま残す。
// 出演情報がある公演は今回の内容で置き換える（メンバー変更で推しが外れたら消える）
// 現場（kind: 'event'）は、今回読めた月の分を置き換え、読めなかった月の分は前回のまま残す
// 読み取り方を変えたら STATE_VERSION を上げて、古い読み取り結果を捨てる
const STATE_VERSION = 5;
let previous = [];
let stateReset = true; // 前回の記録が使えないとき（初回・読み取り方の変更）は、申込開始の通知を出さない
try {
  const state = JSON.parse(await readFile(join(outDir, 'events.json'), 'utf8'));
  if (state.version === STATE_VERSION) [previous, stateReset] = [state.events, false];
} catch {}
// startDate より前の公演は入れない（それまでの分は手動で登録済みのため）
const [sy, sm, sd] = (config.startDate ?? '2000-01-01').split('-').map(Number);
const afterStart = (s) => s.year * 10000 + s.month * 100 + s.day >= sy * 10000 + sm * 100 + sd;
const keptTheater = previous.filter((s) => s.kind !== 'event' && !covered.has(performanceKey(s)));
const keptEvents = previous.filter((s) => s.kind === 'event' && !fetchedMonths.has(`${s.year}-${s.month}`));
// 公式に出演メンバーが載っていない予定に、自分で分かっている出演者を補う（config.json の knownMembers）。
// 公式にメンバーが載ったら、そちらを使う
const withKnownMembers = (s) => {
  if (!s.memberUnknown) return s;
  const known = (config.knownMembers ?? []).find((k) => s.title.includes(k.titleIncludes) && (!k.date || k.date === `${s.year}-${String(s.month).padStart(2, '0')}-${String(s.day).padStart(2, '0')}`));
  return known ? { ...s, members: known.members, memberUnknown: false } : s;
};
const events = mergeShows([...keptTheater, ...found, ...keptEvents, ...apiEvents].map(withKnownMembers)).filter(afterStart);

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, 'events.json'), JSON.stringify({ version: STATE_VERSION, events }, null, 2) + '\n');
// 複数の推しが出る予定は、config.json で先に書かれたカレンダー（伊藤百花）にだけ入れ、
// 予定のタイトルには出演する推しを全員書く
const ownerOf = (s) => config.calendars.find((c) => c.members.some((m) => s.members.includes(m.name)))?.id;
for (const cal of config.calendars) {
  const shows = events.filter((s) => s.memberUnknown || ownerOf(s) === cal.id);
  const ics = buildIcs(cal, shows, { durationMinutes: config.durationMinutes, location: config.location, now: today });
  await writeFile(join(outDir, `${cal.id}.ics`), ics);
  console.log(`${cal.id}.ics: ${shows.length} 件`);
}

// 申込締切カレンダー（締切の1日前に通知）
if (config.deadlineCalendar) {
  const ics = buildDeadlineIcs(config.deadlineCalendar, events, { now: today });
  await writeFile(join(outDir, `${config.deadlineCalendar.id}.ics`), ics);
  console.log(`${config.deadlineCalendar.id}.ics: ${(ics.match(/BEGIN:VEVENT/g) ?? []).length} 件`);
}

// 申込開始の通知: 前回は申込リンクがなく、今回ついた推しの公演があれば --notify のファイルに書く
{
  const opened = newlyOpened(previous, events);
  if (opened.length && args.notify && !stateReset) {
    await writeFile(args.notify, openedMessage(opened));
    console.log(`申込開始: ${opened.length} 公演`);
  }
}

// SNS告知文: 来月以降の月ごと・推しメンごとに sns/YYYY-MM/<名前>.txt と、3人ぶんをまとめた sns/YYYY-MM.txt を作る
{
  const jst = new Date(today.getTime() + 9 * 3600_000);
  const thisMonth = jst.getUTCFullYear() * 12 + jst.getUTCMonth();
  const months = [...new Set(events.filter((s) => s.kind !== 'event' && s.year * 12 + s.month - 1 > thisMonth).map((s) => `${s.year}-${s.month}`))];
  for (const ym of months) {
    const [year, month] = ym.split('-').map(Number);
    const dir = join(outDir, 'sns', `${year}-${String(month).padStart(2, '0')}`);
    const parts = [];
    for (const m of config.calendars.flatMap((c) => c.members)) {
      const text = buildAnnouncement(m.name, events, year, month, m.snsEmoji ?? '');
      if (!text) continue;
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${m.name}.txt`), text);
      parts.push(`■${m.name}\n\n${text}`);
    }
    if (parts.length) {
      await writeFile(`${dir}.txt`, parts.join('\n'));
      console.log(`SNS告知文 ${year}/${month}: ${parts.length} 人`);
    }
  }
}

// 申込ランチャー（Windows）が読む一覧: 今日以降の公演（launcherExclude の公演は除く）
const todayKey = Number(today.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }).replace(/-/g, ''));
const pad = (n) => String(n).padStart(2, '0');
const links = events
  .filter((s) => s.year * 10000 + s.month * 100 + s.day >= todayKey)
  .filter((s) => s.kind !== 'event' && !(config.launcherExclude ?? []).includes(s.title))
  .map((s) => ({
    date: `${s.year}-${pad(s.month)}-${pad(s.day)}`,
    time: s.hour == null ? null : `${pad(s.hour)}:${pad(s.minute)}`,
    title: s.title,
    members: s.members,
    url: s.applyUrl,
  }));
await writeFile(join(outDir, 'links.json'), JSON.stringify(links, null, 2) + '\n');
console.log(`links.json: ${links.length} 件（URLあり ${links.filter((l) => l.url).length} 件）`);
if (fetchedPages === 0) {
  console.error('公式サイトから1ページも取得できませんでした（前回の予定をそのまま残しています）');
  process.exitCode = 1;
}
