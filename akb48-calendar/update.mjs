#!/usr/bin/env node
// 使い方: node akb48-calendar/update.mjs --out <出力フォルダ> [--dump <デバッグ用フォルダ>]
// 出力フォルダに <calendar.id>.ics と events.json（前回までの記録）を書き出す。
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIcs, extractShows, htmlToLines, matchMembers, mergeShows } from './lib.mjs';

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
    if (href.includes(config.followLinkPattern) && new RegExp(config.followLinkTextPattern).test(text)) links.push(href);
  }
  return links;
}

const found = [];
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
  const shows = extractShows(lines, { today, sourceUrl: url });
  for (const s of shows) {
    const members = matchMembers(s.text, allMembers);
    if (members.length) found.push({ ...s, members, text: undefined });
  }
  console.log(`${url}: 公演候補 ${shows.length} 件`);
  if (config.sources.includes(url)) {
    for (const link of collectLinks(html, url)) {
      if (followed >= config.maxFollowLinks) break;
      if (!seen.has(link) && !queue.includes(link)) {
        queue.push(link);
        followed++;
      }
    }
  }
}

// 前回の記録: 過去の公演は消さずに残す。今回1ページも取れなかったときは未来の分も残す
let previous = [];
try {
  previous = JSON.parse(await readFile(join(outDir, 'events.json'), 'utf8'));
} catch {}
const todayKey = Number(today.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }).replace(/-/g, ''));
const dayKey = (s) => s.year * 10000 + s.month * 100 + s.day;
const kept = fetchedPages === 0 ? previous : previous.filter((s) => dayKey(s) < todayKey);
const fresh = found.filter((s) => fetchedPages === 0 || dayKey(s) >= todayKey);
const events = mergeShows([...kept, ...fresh]);

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, 'events.json'), JSON.stringify(events, null, 2) + '\n');
for (const cal of config.calendars) {
  const names = cal.members.map((m) => m.name);
  const shows = events
    .filter((s) => s.members.some((m) => names.includes(m)))
    .map((s) => ({ ...s, members: s.members.filter((m) => names.includes(m)) }));
  const ics = buildIcs(cal, shows, { durationMinutes: config.durationMinutes, location: config.location, now: today });
  await writeFile(join(outDir, `${cal.id}.ics`), ics);
  console.log(`${cal.id}.ics: ${shows.length} 件`);
}
if (fetchedPages === 0) {
  console.error('公式サイトから1ページも取得できませんでした（前回の予定をそのまま残しています）');
  process.exitCode = 1;
}
