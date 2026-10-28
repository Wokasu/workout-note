#!/usr/bin/env node
// 使い方: node akb48-calendar/unapplied.mjs --dir <feed フォルダ> --applied "11/3 13:00, 11/9 18:30" [--dry-run]
// 申込済みの公演（Gmail の ZAIKO「応募ありがとうございました」から Claude が拾った開演日時）と突き合わせ、
// 推しが出る公演で、座席の応募がまだ受付中なのに申込していないものがあれば ntfy で知らせる。
// 送り先は環境変数 NTFY_TOPIC_UNAPPLIED（申込開始・締切の通知とは別のトピック）
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseApplied, unappliedMessage, unappliedShows } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]?.startsWith('--') ? true : all[i + 1] ?? true]] : acc), []),
);
const config = JSON.parse(await readFile(join(here, args.config ?? 'config.json'), 'utf8'));
const now = args.now ? new Date(args.now) : new Date();
const { events } = JSON.parse(await readFile(join(args.dir ?? 'feed', 'events.json'), 'utf8'));
const applied = parseApplied(args.applied, now);
console.log(`申込済み: ${applied.join(', ') || 'なし'}`);

const list = unappliedShows(events, applied, now, {
  exclude: config.launcherExclude ?? [],
  fallback: config.generalDeadline,
  frameNames: { '(1)〜(3)枠': config.targetFrame?.name ?? '会員枠', '(4)〜(6)枠': '一般枠' },
});
if (!list.length) {
  console.log('申込していない公演はありません');
  process.exit(0);
}
const body = unappliedMessage(list);
console.log(`申込していない公演: ${list.length} 件\n${body}`);
if (args['dry-run']) process.exit(0);
const topic = process.env.NTFY_TOPIC_UNAPPLIED;
if (!topic) {
  console.log('NTFY_TOPIC_UNAPPLIED が設定されていないので送りません');
  process.exit(0);
}
const params = new URLSearchParams({ title: `📝 申込していない推しの公演が${list.length}件あります`, click: 'https://akb48.zaiko.io/' });
const res = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}?${params}`, { method: 'POST', body });
if (!res.ok) throw new Error(`ntfy: HTTP ${res.status}`);
console.log('ntfy に送りました');
