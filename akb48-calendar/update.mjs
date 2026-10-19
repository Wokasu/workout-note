#!/usr/bin/env node
// 使い方: node akb48-calendar/update.mjs --out <出力フォルダ> [--dump <デバッグ用フォルダ>]
// 出力フォルダに <calendar.id>.ics と events.json（前回までの記録）を書き出す。
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIcs, buildShows, extractCasts, extractSchedule, extractTopCasts, htmlToLines, mergeShows, performanceKey } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const outDir = args.out ?? join(here, 'feed');
const dumpDir = args.dump;
const config = JSON.parse(await readFile(join(here, 'config.json'), 'utf8'));
const allMembers = config.calendars.flatMap((c) => c.members);
const today = new Date();

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
        await writeFile(join(dumpDir, `probe-${n}.txt`), `${spec}\nHTTP ${res.status}\n\n${text.slice(0, 30000)}\n`);
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

// 前回の記録: 今回の記事に出演情報がなかった公演（過去の公演や、一覧から消えたお知らせの分）は前回のまま残す。
// 出演情報がある公演は今回の内容で置き換える（メンバー変更で推しが外れたら消える）
// 読み取り方を変えたら STATE_VERSION を上げて、古い読み取り結果を捨てる
const STATE_VERSION = 4;
let previous = [];
try {
  const state = JSON.parse(await readFile(join(outDir, 'events.json'), 'utf8'));
  if (state.version === STATE_VERSION) previous = state.events;
} catch {}
// startDate より前の公演は入れない（それまでの分は手動で登録済みのため）
const [sy, sm, sd] = (config.startDate ?? '2000-01-01').split('-').map(Number);
const afterStart = (s) => s.year * 10000 + s.month * 100 + s.day >= sy * 10000 + sm * 100 + sd;
const events = mergeShows([...previous.filter((s) => !covered.has(performanceKey(s))), ...found]).filter(afterStart);

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, 'events.json'), JSON.stringify({ version: STATE_VERSION, events }, null, 2) + '\n');
for (const cal of config.calendars) {
  const names = cal.members.map((m) => m.name);
  const shows = events
    .filter((s) => s.members.some((m) => names.includes(m)))
    .map((s) => ({ ...s, members: s.members.filter((m) => names.includes(m)) }));
  const ics = buildIcs(cal, shows, { durationMinutes: config.durationMinutes, location: config.location, now: today });
  await writeFile(join(outDir, `${cal.id}.ics`), ics);
  console.log(`${cal.id}.ics: ${shows.length} 件`);
}

// 申込ランチャー（Windows）が読む一覧: 今日以降の公演（launcherExclude の公演は除く）
const todayKey = Number(today.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }).replace(/-/g, ''));
const pad = (n) => String(n).padStart(2, '0');
const links = events
  .filter((s) => s.year * 10000 + s.month * 100 + s.day >= todayKey)
  .filter((s) => !(config.launcherExclude ?? []).includes(s.title))
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
