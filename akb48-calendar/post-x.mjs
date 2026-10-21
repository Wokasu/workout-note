#!/usr/bin/env node
// 使い方: node akb48-calendar/post-x.mjs --dir <feed フォルダ> --month 2026-11 [--dry-run]
// sns/<月>/<名前>.txt を、推しメンごとに X へ投稿する（長ければスレッドに分ける）。
// 投稿済みの月・メンバーは sns/posted.json に記録し、二度は投稿しない。
// 認証情報は環境変数 X_API_KEY / X_API_SECRET / X_ACCESS_TOKEN / X_ACCESS_TOKEN_SECRET。
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { postThread, splitForX } from './x.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]?.startsWith('--') ? true : all[i + 1] ?? true]] : acc), []),
);
const config = JSON.parse(await readFile(join(here, 'config.json'), 'utf8'));
const dir = args.dir ?? 'feed';
const month = args.month;
const dryRun = Boolean(args['dry-run']);
if (!/^\d{4}-\d{2}$/.test(month ?? '')) throw new Error('--month 2026-11 のように月を指定してください');

const creds = {
  apiKey: process.env.X_API_KEY,
  apiSecret: process.env.X_API_SECRET,
  accessToken: process.env.X_ACCESS_TOKEN,
  accessTokenSecret: process.env.X_ACCESS_TOKEN_SECRET,
};
if (!dryRun && Object.values(creds).some((v) => !v)) {
  console.log('X の認証情報が設定されていないので投稿しません');
  process.exit(0);
}

const postedPath = join(dir, 'sns', 'posted.json');
let posted = {};
try {
  posted = JSON.parse(await readFile(postedPath, 'utf8'));
} catch {}

for (const m of config.calendars.flatMap((c) => c.members)) {
  if (posted[month]?.[m.name]) {
    console.log(`${month} ${m.name}: 投稿済みなので飛ばします`);
    continue;
  }
  let text;
  try {
    text = await readFile(join(dir, 'sns', month, `${m.name}.txt`), 'utf8');
  } catch {
    continue; // その月に出演がない
  }
  const heading = (config.xHeading ?? '【{name}】').replace('{name}', m.name);
  const posts = splitForX(text, heading);
  if (dryRun) {
    console.log(`--- ${month} ${m.name}（${posts.length} 投稿）\n${posts.join('\n--- 返信 ---\n')}`);
    continue;
  }
  const ids = await postThread(posts, creds);
  posted[month] = { ...posted[month], [m.name]: ids };
  await writeFile(postedPath, JSON.stringify(posted, null, 2) + '\n');
  console.log(`${month} ${m.name}: ${ids.length} 件投稿しました https://x.com/i/status/${ids[0]}`);
}
