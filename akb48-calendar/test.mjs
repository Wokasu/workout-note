// node --test akb48-calendar/test.mjs で実行
// fixtures/ は公式サイト（2026年10月18日時点）から読み取ったテキスト
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildIcs, buildShows, extractCasts, extractSchedule, htmlToLines, normalizeWidth } from './lib.mjs';

const today = new Date('2026-10-18T09:00:00Z');
const config = JSON.parse(readFileSync(new URL('./config.json', import.meta.url), 'utf8'));
const members = config.calendars.flatMap((c) => c.members);
const fixture = (name) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8').split('\n').map(normalizeWidth).filter(Boolean);
const fmt = (s) => `${s.month}/${s.day} ${s.hour ?? '--'}:${String(s.minute ?? '--').padStart(2, '0')} ${s.title} ${s.members.join(',')}`;

test('トップページの劇場スケジュール一覧から日付・時刻・公演名を読む', () => {
  const schedule = extractSchedule(fixture('top-schedule.txt'));
  assert.deepEqual(schedule[0], { year: 2026, month: 10, day: 18, hour: 13, minute: 0, title: '「RESET」公演' });
  assert.ok(schedule.some((s) => s.month === 10 && s.day === 25 && s.hour === 17 && s.minute === 30));
});

test('スケジュール更新のお知らせ: 1日2公演と、時刻ごとに違うメンバー表', () => {
  const casts = extractCasts(fixture('schedule-notice.txt'), { today });
  const { shows } = buildShows(casts, [], members);
  assert.deepEqual(shows.map(fmt), [
    '11/2 18:30 「ここからだ」公演 奥本カイリ',
    '11/3 13:00 「ここからだ」公演 渡邉葵心',
    '11/3 17:30 「ここからだ」公演 渡邉葵心',
    '11/5 18:30 「ここからだ」公演 奥本カイリ,渡邉葵心',
    '11/6 18:30 「手をつなぎながら」公演 奥本カイリ,渡邉葵心',
    '11/8 13:00 「ここからだ」公演 奥本カイリ',
    '11/8 17:30 「ここからだ」公演 奥本カイリ',
    '11/9 18:30 「ここからだ」公演 伊藤百花',
    '11/13 18:30 「夢のポップスター」公演 伊藤百花,奥本カイリ',
    '11/15 14:00 柱の会限定イベント 渡邉葵心',
    '11/15 19:00 柱の会限定イベント 伊藤百花,奥本カイリ',
    '11/23 13:00 「手をつなぎながら」公演 奥本カイリ,渡邉葵心',
    '11/23 17:30 「手をつなぎながら」公演 奥本カイリ,渡邉葵心',
    '11/26 18:30 「手をつなぎながら」公演 奥本カイリ,渡邉葵心',
    '11/29 18:30 「M.T.に捧ぐ」公演 伊藤百花',
    '11/30 18:30 「手をつなぎながら」公演 奥本カイリ',
  ]);
});

test('公演のご案内: 開演時刻がなければ一覧から補い、推しが出ない公演は入れない', () => {
  const schedule = extractSchedule(fixture('top-schedule.txt'));
  const casts = [
    ...extractCasts(fixture('single-notice-1025.txt'), { today }),
    ...extractCasts(fixture('single-notice-1026.txt'), { today }),
  ];
  const { shows, covered } = buildShows(casts, schedule, members);
  assert.deepEqual(shows.map(fmt), [
    '10/25 13:00 「手をつなぎながら」公演 奥本カイリ,渡邉葵心',
    '10/25 17:30 「手をつなぎながら」公演 奥本カイリ,渡邉葵心',
  ]);
  assert.ok(covered.has('2026-10-26|「RESET」公演'));
});

test('同じ公演は「ご案内」の出演メンバーを優先する（メンバー変更）', () => {
  const monthly = ['11/5(木) 「ここからだ」公演 18:30開演', '【出演メンバー】', '伊藤百花・佐藤綺星'];
  const single = ['2026年11月5日(木)', '「ここからだ」公演 18:30開演', '【出演メンバー】', '佐藤綺星・渡邉葵心'];
  const casts = [
    ...extractCasts(monthly, { today, sourceUrl: 'monthly' }),
    ...extractCasts(single, { today, sourceUrl: 'single' }),
  ];
  const { shows } = buildShows(casts, [], members);
  assert.deepEqual(shows.map(fmt), ['11/5 18:30 「ここからだ」公演 渡邉葵心']);
});

test('年が書かれていない1月の予定は翌年として扱う', () => {
  const casts = extractCasts(['1/5(月) 「RESET」公演 18:30開演', '【出演メンバー】', '伊藤百花・佐藤綺星'], {
    today: new Date('2026-12-20T00:00:00Z'),
  });
  assert.equal(casts[0].year, 2027);
});

test('HTMLをテキスト行にし、全角英数字を半角にする', () => {
  assert.deepEqual(htmlToLines('<p>「ＲＥＳＥＴ」公演&nbsp;１８：３０開演</p><br>【出演メンバー】'), [
    '「RESET」公演 18:30開演',
    '【出演メンバー】',
  ]);
});

test('ICSは日本時間をUTCに直し、色とカレンダー名を入れる', () => {
  const ics = buildIcs(
    { name: 'AKB48 伊藤百花', color: '#AF52DE' },
    [{ year: 2026, month: 11, day: 9, hour: 18, minute: 30, title: '「ここからだ」公演', members: ['伊藤百花'] }],
    { now: today },
  );
  assert.match(ics, /X-WR-CALNAME:AKB48 伊藤百花/);
  assert.match(ics, /X-APPLE-CALENDAR-COLOR:#AF52DE/);
  assert.match(ics, /DTSTART:20261109T093000Z/);
  assert.match(ics, /DTEND:20261109T113000Z/);
  assert.ok(ics.split('\r\n').every((l) => Buffer.byteLength(l) <= 75));
});
