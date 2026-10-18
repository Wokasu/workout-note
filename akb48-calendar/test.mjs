// node --test akb48-calendar/test.mjs で実行
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildIcs, extractShows, htmlToLines, matchMembers, mergeShows } from './lib.mjs';

const today = new Date('2026-10-18T00:00:00Z');
const members = [
  { name: '伊藤百花', aliases: [] },
  { name: '奥本カイリ', aliases: [] },
  { name: '渡邊きこ', aliases: ['渡辺きこ'] },
];

test('日付ごと・公演ごとに分けて出演メンバーを拾う', () => {
  const html = `
    <ul>
      <li><time>10月25日(土)</time></li>
      <li>13:00開演 「ここからだ」公演</li>
      <li>【出演メンバー】伊藤 百花、佐藤綺星、山内瑞葵</li>
      <li>18:30開演 「RESET」公演</li>
      <li>【出演メンバー】奥本カイリ・渡邊きこ・坂川陽香</li>
      <li><time>10月26日(日)</time></li>
      <li>「夢のポップスター」公演</li>
      <li>開場 17:45 / 開演 18:30</li>
      <li>出演：渡辺きこ、下尾みう</li>
    </ul>`;
  const shows = extractShows(htmlToLines(html), { today });
  const hits = shows.map((s) => ({ ...s, members: matchMembers(s.text, members) })).filter((s) => s.members.length);
  assert.deepEqual(
    hits.map((s) => [s.month, s.day, s.hour, s.minute, s.title, s.members]),
    [
      [10, 25, 13, 0, '「ここからだ」公演', ['伊藤百花']],
      [10, 25, 18, 30, '「RESET」公演', ['奥本カイリ', '渡邊きこ']],
      [10, 26, 18, 30, '「夢のポップスター」公演', ['渡邊きこ']],
    ],
  );
});

test('年が書かれていない1月の予定は翌年として扱う', () => {
  const shows = extractShows(['1月5日(月)', '18:30開演 「ここからだ」公演', '伊藤百花'], {
    today: new Date('2026-12-20T00:00:00Z'),
  });
  assert.equal(shows[0].year, 2027);
});

test('全角数字・年つき日付も読める', () => {
  const shows = extractShows(htmlToLines('<p>２０２６．１１．０３（火）</p><p>１８：３０開演 「RESET」公演 伊藤百花</p>'), {
    today,
  });
  assert.deepEqual([shows[0].year, shows[0].month, shows[0].day, shows[0].hour], [2026, 11, 3, 18]);
});

test('同じ公演は1つにまとめる', () => {
  const base = { year: 2026, month: 10, day: 25, hour: 18, minute: 30, title: '「RESET」公演' };
  const merged = mergeShows([
    { ...base, members: ['奥本カイリ'] },
    { ...base, members: ['渡邊きこ'] },
  ]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].members, ['奥本カイリ', '渡邊きこ']);
});

test('ICSは日本時間をUTCに直し、色とカレンダー名を入れる', () => {
  const ics = buildIcs(
    { name: 'AKB48 伊藤百花', color: '#AF52DE' },
    [{ year: 2026, month: 10, day: 25, hour: 18, minute: 30, title: '「ここからだ」公演', members: ['伊藤百花'] }],
    { now: today },
  );
  assert.match(ics, /X-WR-CALNAME:AKB48 伊藤百花/);
  assert.match(ics, /X-APPLE-CALENDAR-COLOR:#AF52DE/);
  assert.match(ics, /DTSTART:20261025T093000Z/);
  assert.match(ics, /DTEND:20261025T113000Z/);
  assert.ok(ics.split('\r\n').every((l) => Buffer.byteLength(l) <= 75));
});
