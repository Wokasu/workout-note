// node --test akb48-calendar/test.mjs で実行
// fixtures/ は公式サイト（2026年10月18日時点）から読み取ったテキスト
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildAnnouncement, buildIcs, buildShows, eventsFromApi, extractCasts, extractSchedule, extractTopCasts, htmlToLines, normalizeWidth } from './lib.mjs';

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

test('トップページ: 一覧と同じ順番に並ぶ詳細から、日付ごとの出演メンバーを読む', () => {
  const lines = fixture('top-page.txt');
  const casts = extractTopCasts(lines);
  assert.equal(casts.length, 36); // 39件のうち休館日3件を除く
  const { shows } = buildShows(casts, extractSchedule(lines), members);
  assert.deepEqual(shows.filter((s) => s.month === 10 && s.day >= 18).map(fmt), [
    '10/19 18:30 「ここからだ」公演 奥本カイリ',
    '10/21 18:30 「手をつなぎながら」公演 奥本カイリ,渡邉葵心',
    '10/25 13:00 「手をつなぎながら」公演 奥本カイリ,渡邉葵心',
    '10/25 17:30 「手をつなぎながら」公演 奥本カイリ,渡邉葵心',
    '10/27 18:30 「ここからだ」公演 渡邉葵心',
    '10/29 18:30 「ここからだ」公演 奥本カイリ',
    '10/31 17:30 「夢のポップスター」公演 伊藤百花',
  ]);
  // 申込ページのリンクは公式に書かれたものだけ。URLの形は公演ごとにばらばら
  assert.deepEqual(
    shows.filter((s) => s.month === 10 && s.day >= 18).map((s) => s.applyUrl),
    [
      'https://akb48.zaiko.io/ja/e/s2026-1019-1830',
      'https://akb48.zaiko.io/ja/e/2026w-1021-1830',
      'https://akb48.zaiko.io/ja/e/te2026-1025-1300',
      'https://akb48.zaiko.io/ja/e/te2026-1025-1730',
      'https://akb48.zaiko.io/ja/e/ko2026-1027-1830',
      'https://akb48.zaiko.io/ja/e/k2026-1029-1830',
      'https://akb48.zaiko.io/ja/e/p2026-1031',
    ],
  );
  // まだ申込が始まっていない公演（「お申し込み等は改めてお知らせ致します」）にはリンクがない
  assert.ok(casts.filter((c) => c.month === 11).every((c) => c.applyUrl === null));
});

test('お知らせ記事: 公演ごとの申込リンクを拾い、チケットセンターのトップへのリンクは無視する', () => {
  const casts = extractCasts(
    [
      '2026年11月2日(月)',
      '「ここからだ」公演 18:30開演',
      '【出演メンバー】',
      '奥本カイリ・小栗有以',
      '【お申し込みについて】',
      'AKB48チケットセンター ⟨https://akb48.zaiko.io/⟩にて現在受け付け中です。',
      '★お申し込みはコチラ ⟨https://akb48.zaiko.io/ja/e/x2026-1102-1830⟩',
    ],
    { today },
  );
  assert.equal(casts[0].applyUrl, 'https://akb48.zaiko.io/ja/e/x2026-1102-1830');
});

test('トップページ: 一覧と詳細の対応がずれていたら使わない', () => {
  const lines = fixture('top-page.txt');
  const i = lines.indexOf('休館日', lines.indexOf('一覧を見る'));
  assert.deepEqual(extractTopCasts([...lines.slice(0, i), ...lines.slice(i + 1)]), []);
});

test('公式スケジュール: 推しが出る握手会・お話し会（オンラインも）・イベントを拾い、テレビ・ラジオは入れない', () => {
  const api = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
  const events = [...eventsFromApi(api('api-2026-10.json'), members), ...eventsFromApi(api('api-2026-12.json'), members)];
  assert.deepEqual(
    events.map((e) => `${e.month}/${e.day} ${e.hour ?? '終日'} ${e.title} ${e.members.join(',')}`),
    [
      '10/4 終日 68thSG『好きish』初回限定盤 発売記念「東京握手会」 伊藤百花,奥本カイリ,渡邉葵心',
      '10/11 終日 【AKB48】福島応援イベント「どうしても福島が好きだ」 渡邉葵心',
      '10/17 11 ロナルド・マクドナルド・ハウス 支援募金活動 渡邉葵心',
      '10/17 14 ロナルド・マクドナルド・ハウス 支援募金活動 渡邉葵心',
      '10/18 11 ロナルド・マクドナルド・ハウス 支援募金活動(青いマックの日・名古屋まつり) 渡邉葵心',
      '12/19 終日 【2ショット写真会】AKB48~studio recordings コレクション~Team A 7th Stage 「M.T.に捧ぐ」(Standard Edition) 伊藤百花,奥本カイリ,渡邉葵心',
      '12/26 終日 AKB48 69thシングル OS盤 【オンラインお話し会】 伊藤百花,奥本カイリ,渡邉葵心',
      '12/27 終日 AKB48 69thシングル OS盤 【オンラインお話し会】 伊藤百花,奥本カイリ,渡邉葵心',
    ],
  );
  // 詳細ページのURLと会場
  assert.equal(events[0].detailUrl, 'https://ameblo.jp/akihabara48/entry-12969991436.html');
  assert.equal(events[0].location, '幕張メッセ');
  assert.equal(events[1].detailUrl, 'https://dousitemosukida.com');
});

test('ICS: 現場の予定は会場と詳細ページのURLを入れる（劇場の住所は入れない）', () => {
  const ics = buildIcs(
    { name: 'AKB48 奥本カイリ・渡邉葵心', color: '#5AC8FA' },
    [{ year: 2026, month: 10, day: 17, hour: 11, minute: 10, endHour: 11, endMinute: 40, title: '支援募金活動', members: ['渡邉葵心'], kind: 'event', location: 'セブンパーク天美', detailUrl: 'https://example.com/a' }],
    { now: today, location: 'AKB48劇場' },
  );
  assert.match(ics, /DTSTART:20261017T021000Z/);
  assert.match(ics, /DTEND:20261017T024000Z/);
  assert.match(ics, /LOCATION:セブンパーク天美/);
  assert.match(ics, /URL:https:\/\/example.com\/a/);
  assert.doesNotMatch(ics, /AKB48劇場/);
});

test('公式スケジュール: 握手会以外のオンライン・配信の予定は入れない', () => {
  const json = { data: { thismonth: { '2026_11_1': [
    { parent_category: '3', title: '配信イベント', body: '', member: '1093', date: '2026-11-01 20:00:00', end_date: '2026-11-01 21:00:00' },
    { parent_category: '2', title: 'ラジオ', body: '', member: '1093', date: '2026-11-01 25:00:00', end_date: '2026-11-01 25:30:00' },
    { parent_category: '2', title: 'ラジオ公開収録', body: '【会場】渋谷', member: '1093', date: '2026-11-01 13:00:00', end_date: '2026-11-01 14:00:00' },
  ] } } };
  assert.deepEqual(eventsFromApi(json, members).map((e) => e.title), ['ラジオ公開収録']);
});

test('SNS告知文: 演目ごとに出演日と開演時刻を並べ、柱の会限定イベントは後ろに○付きで', () => {
  const casts = extractCasts(fixture('schedule-notice.txt'), { today });
  const { shows } = buildShows(casts, [], members);
  assert.equal(
    buildAnnouncement('渡邉葵心', shows, 2026, 11, '🧤🤍'),
    [
      '11月出演公演🧤🤍',
      '',
      '「ここからだ」',
      '3日㈫ 13:00／17:30',
      '5日㈭ 18:30',
      '',
      '「手をつなぎながら」',
      '6日㈮ 18:30',
      '23日㈪ 13:00／17:30',
      '26日㈭ 18:30',
      '',
      '○柱の会限定イベント',
      '15日㈰ 14:00',
      '',
    ].join('\n'),
  );
  assert.equal(buildAnnouncement('渡邉葵心', shows, 2026, 12), null);
});
