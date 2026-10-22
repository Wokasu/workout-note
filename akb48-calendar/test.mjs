// node --test akb48-calendar/test.mjs で実行
// fixtures/ は公式サイト（2026年10月18日時点）から読み取ったテキスト
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildAnnouncement, buildDeadlineIcs, buildIcs, dueDeadlineReminders, onlyFrame, newlyOpened, openedMessage, buildShows, eventsFromApi, extractCasts, extractSchedule, extractTopCasts, htmlToLines, normalizeWidth } from './lib.mjs';

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

test('X: 日本語は2文字、半角は1文字として数え、280を超えたら演目ごとにスレッドへ分ける', async () => {
  const { weightedLength, splitForX } = await import('./x.mjs');
  assert.equal(weightedLength('ab12'), 4);
  assert.equal(weightedLength('「ここからだ」'), 14);
  assert.equal(weightedLength('🧤🤍'), 4);
  const casts = extractCasts(fixture('schedule-notice.txt'), { today });
  const { shows } = buildShows(casts, [], members);
  for (const name of ['伊藤百花', '奥本カイリ', '渡邉葵心']) {
    const posts = splitForX(buildAnnouncement(name, shows, 2026, 11), `【${name}】`);
    assert.ok(posts[0].startsWith(`【${name}】\n11月出演公演`));
    assert.ok(posts.every((p) => weightedLength(p) <= 280));
    // 分けても内容は欠けない
    assert.equal(posts.join('\n\n').replace(`【${name}】\n`, ''), buildAnnouncement(name, shows, 2026, 11).trim());
  }
});

test('X: OAuth 1.0a の署名（X の公式ドキュメントの例と同じ値になる）', async () => {
  const { oauthHeader } = await import('./x.mjs');
  const header = oauthHeader(
    'POST',
    'https://api.twitter.com/1.1/statuses/update.json',
    {
      apiKey: 'xvz1evFS4wEEPTGEFPHBog',
      apiSecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw',
      accessToken: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb',
      accessTokenSecret: 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE',
    },
    { include_entities: 'true', status: 'Hello Ladies + Gentlemen, a signed OAuth request!' },
    'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg',
    1318622958,
  );
  assert.match(header, /oauth_signature="hCtSmYh%2BiHYCEqBWrE7C7hYmtUk%3D"/);
});

test('申込締切: トップページと公演のご案内から応募枠ごとの締切を読む（ロビー観覧は除く）', () => {
  const top = extractTopCasts(fixture('top-page.txt'));
  const c1019 = top.find((c) => c.month === 10 && c.day === 19);
  assert.deepEqual(c1019.deadlines.map((d) => `${d.label} ${d.month}/${d.day} ${d.hour}:${d.minute}`), [
    '(1)〜(3)枠 10/12 16:0',
    '(4)〜(6)枠 10/14 16:0',
  ]);
  const casts = extractCasts(fixture('single-notice-1025.txt'), { today });
  const { shows } = buildShows(casts, extractSchedule(fixture('top-schedule.txt')), members);
  // 昼夜2公演とも同じ締切
  assert.equal(shows.length, 2);
  for (const s of shows) assert.deepEqual(s.deadlines.map((d) => `${d.month}/${d.day}`), ['10/18', '10/20']);
});

test('申込締切カレンダー: 同じ締切の公演を1つにまとめ、1日前に通知する', () => {
  const base = { year: 2026, month: 11, hour: 18, minute: 30, members: ['奥本カイリ'], applyUrl: 'https://akb48.zaiko.io/ja/e/x' };
  const dl = (day) => [{ label: '(1)〜(3)枠', year: 2026, month: 10, day, hour: 16, minute: 0 }];
  const ics = buildDeadlineIcs(
    { name: 'AKB48 申込締切', color: '#FF9500' },
    [
      { ...base, day: 2, title: '「ここからだ」公演', deadlines: dl(25) },
      { ...base, day: 3, title: '「ここからだ」公演', deadlines: dl(25) },
      { ...base, day: 30, title: '「RESET」公演', deadlines: dl(10) }, // 締切が過ぎている
    ],
    { now: today },
  );
  assert.equal(ics.match(/BEGIN:VEVENT/g).length, 1);
  assert.match(ics, /DTEND:20261025T070000Z/);
  assert.match(ics, /TRIGGER:-PT23H30M/);
  assert.match(ics.replace(/\r\n /g, ''), /SUMMARY:📝申込締切 \(1\)〜\(3\)枠 11\/2\(月\)「ここからだ」公演 ほか1公演/);
});

test('申込開始: 前回リンクがなく今回ついた公演だけを知らせる', () => {
  const s = { year: 2026, month: 11, day: 2, hour: 18, minute: 30, title: '「ここからだ」公演', members: ['奥本カイリ'], deadlines: [] };
  const opened = newlyOpened([{ ...s, applyUrl: null }, { ...s, day: 3, applyUrl: 'u3' }], [{ ...s, applyUrl: 'u2' }, { ...s, day: 3, applyUrl: 'u3' }]);
  assert.deepEqual(opened.map((x) => x.day), [2]);
  assert.match(openedMessage(opened), /11\/2\(月\) 18:30 「ここからだ」公演\*\*（奥本カイリ）\n  - 申込: u2/);
});

test('公演のご案内: 日付の書き間違い（曜日が合わない）は、見出しの曜日が合う日付に直す', () => {
  const lines = [
    '10月27日 「ここからだ」公演のご案内',
    '10月27日(火)にAKB48劇場にて実施いたします「ここからだ」公演についてご案内いたします。',
    '2026年10月28日(火)',
    '「ここからだ」公演 18:30開演',
    '【出演メンバー】',
    '秋山由奈・渡邉葵心',
  ];
  assert.deepEqual(extractCasts(lines, { today }).map((c) => `${c.month}/${c.day}`), ['10/27']);
  // 直せないときは読まない
  assert.deepEqual(extractCasts(lines.slice(2), { today }), []);
});

test('申込開始のプッシュ通知文（ntfy）', async () => {
  const { openedPlain } = await import('./lib.mjs');
  const s = {
    year: 2026, month: 10, day: 27, hour: 18, minute: 30, title: '「ここからだ」公演', members: ['渡邉葵心'], applyUrl: 'https://akb48.zaiko.io/ja/e/ko2026-1027-1830',
    deadlines: [{ label: '(1)〜(3)枠', year: 2026, month: 10, day: 20, hour: 16, minute: 0 }],
  };
  assert.equal(openedPlain([{ ...s, month: 11, day: 9 }, s, { ...s, day: 29 }]), '10/27(火)〜11/9(月) の推しの公演 3件');
  assert.equal(openedPlain([s]), '10/27(火) の推しの公演 1件');
});

test('締切1日前のプッシュ通知: 4時間以内に24時間前を迎える分だけ、1公演・1応募枠ごとに', () => {
  const s = {
    year: 2026, month: 10, day: 27, hour: 18, minute: 30, title: '「ここからだ」公演', members: ['渡邉葵心'], applyUrl: 'https://akb48.zaiko.io/ja/e/ko2026-1027-1830',
    deadlines: [
      { label: '(1)〜(3)枠', year: 2026, month: 10, day: 20, hour: 16, minute: 0 },
      { label: '(4)〜(6)枠', year: 2026, month: 10, day: 22, hour: 16, minute: 0 },
    ],
  };
  // 10/19 14:00 JST: (1)〜(3)枠の24時間前（10/19 16:00）が2時間後
  const now = new Date('2026-10-19T05:00:00Z');
  const due = dueDeadlineReminders([s], {}, now);
  assert.equal(due.length, 1);
  assert.equal(due[0].at.toISOString(), '2026-10-19T07:00:00.000Z');
  assert.equal(due[0].body, '10/27(火) 18:30 「ここからだ」公演（渡邉葵心）\n(1)〜(3)枠 10/20(火) 16:00締切');
  assert.equal(due[0].click, 'https://akb48.zaiko.io/ja/e/ko2026-1027-1830');
  // 送った記録があれば送らない
  assert.equal(dueDeadlineReminders([s], { [due[0].key]: 'x' }, now).length, 0);
  // チェックが遅れて24時間前を過ぎていても、締切前ならすぐ送る（at なし）
  const late = dueDeadlineReminders([s], {}, new Date('2026-10-20T01:00:00Z'));
  assert.deepEqual(late.map((r) => r.at), [null]);
  // 締切を過ぎたら送らない
  assert.equal(dueDeadlineReminders([s], {}, new Date('2026-10-23T00:00:00Z')).length, 0);
});

test('申込締切: 柱の会会員枠（(2)）を含む「(1)〜(3)枠」の締切だけを、枠の名前で扱う', () => {
  const s = {
    year: 2026, month: 10, day: 27, title: '「ここからだ」公演', members: ['渡邉葵心'],
    deadlines: [
      { label: '(1)〜(3)枠', year: 2026, month: 10, day: 20, hour: 16, minute: 0 },
      { label: '(4)〜(6)枠', year: 2026, month: 10, day: 22, hour: 16, minute: 0 },
    ],
  };
  const [only] = onlyFrame([s], { number: 2, name: '柱の会会員枠' });
  assert.deepEqual(only.deadlines.map((d) => `${d.label} ${d.month}/${d.day}`), ['柱の会会員枠 10/20']);
  assert.equal(onlyFrame([s], null)[0].deadlines.length, 2);
});

test('生誕祭・女性限定公演の但し書きを読む（時刻付きはその回だけ）', () => {
  const top = extractTopCasts(fixture('top-page.txt'));
  assert.equal(top.find((c) => c.month === 10 && c.day === 19).tag, '坂川陽香 生誕祭');
  assert.equal(top.find((c) => c.month === 10 && c.day === 11 && c.hour === 17).tag, '女性限定公演');
  assert.equal(top.find((c) => c.month === 10 && c.day === 18 && c.hour === 13).tag, null);
  const casts = extractCasts(fixture('schedule-notice.txt'), { today });
  const nov8 = casts.filter((c) => c.month === 11 && c.day === 8).map((c) => [c.hour, c.tag]);
  assert.deepEqual(nov8, [[13, null], [17, '女性限定公演']]);
  const { shows } = buildShows(casts, [], members);
  assert.equal(shows.find((s) => s.month === 11 && s.day === 8 && s.hour === 17).tag, '女性限定公演');
  assert.equal(shows.find((s) => s.month === 11 && s.day === 2).tag, '長友彩海 生誕祭');
});

test('カレンダーの予定名にも生誕祭・女性限定公演を付ける', () => {
  const show = { year: 2026, month: 11, day: 8, hour: 17, minute: 30, title: '「ここからだ」公演', members: ['奥本カイリ'], tag: '女性限定公演' };
  const ics = buildIcs({ name: 'x', color: '#000000' }, [show, { ...show, hour: 13, minute: 0, tag: null }], { durationMinutes: 120, location: '', now: today }).replace(/\r\n /g, '');
  assert.match(ics, /SUMMARY:「ここからだ」公演【女性限定公演】（奥本カイリ）/);
  assert.match(ics, /SUMMARY:「ここからだ」公演（奥本カイリ）/);
});

test('現場の予定の説明文（note）は予定名に付けない', () => {
  const ev = { year: 2026, month: 11, day: 21, hour: 10, minute: 0, title: '2ショット写真会', members: ['伊藤百花'], kind: 'event', note: '<詳細> https://example.com\n長い説明' };
  const ics = buildIcs({ name: 'x', color: '#000000' }, [ev], { durationMinutes: 120, location: '', now: today }).replace(/\r\n /g, '');
  assert.match(ics, /SUMMARY:2ショット写真会（伊藤百花）\r\n/);
});

test('カレンダーの説明に推しメン以外も含む出演メンバー全員を書く', () => {
  const { shows } = buildShows(extractCasts(fixture('schedule-notice.txt'), { today }), [], members);
  const s = shows.find((x) => x.month === 11 && x.day === 6);
  assert.deepEqual(s.cast, ['岩立沙穂', '奥本カイリ', '大賀彩姫', '近藤沙樹', '丸山ひなた', '田中沙友利', '牧戸愛茉', '渡邉葵心']);
  const ics = buildIcs({ name: 'x', color: '#000000' }, [s], { durationMinutes: 120, location: '', now: today }).replace(/\r\n /g, '');
  assert.match(ics, /DESCRIPTION:出演: 奥本カイリ、渡邉葵心\\n出演メンバー: 岩立沙穂・奥本カイリ・大賀彩姫・近藤沙樹・丸山ひなた・田中沙友利・牧戸愛茉・渡邉葵心\\n/);
});
