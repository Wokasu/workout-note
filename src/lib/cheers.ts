import type { Profile } from '../types';

export type CheerMood = 'start' | 'good' | 'over' | 'eventSoon' | 'eventDay' | 'after';

const MESSAGES: Record<CheerMood, string[]> = {
  start: [
    '今日の一食目、記録してみよう！{oshi}に会う日まで一緒にがんばろ📸',
    '{days}日後には{oshi}とツーショット。今日の積み重ねがその1枚になるよ✨',
    '記録するだけで意識が変わる！まずは朝ごはんから🍙',
  ],
  good: [
    'いいペース！この調子なら{oshi}の隣で最高の笑顔が撮れるね💕',
    '今日もえらい！がんばってる{name}さん、絶対かわいく写るよ',
    '目標内キープ中🎉 チェキ代はダイエット成功のごほうびに！',
    '{streak}日連続達成！推しへの愛が数字に出てる🔥',
  ],
  over: [
    '今日はちょっとオーバー。でも大丈夫、明日リセットすれば問題なし🙆',
    '食べすぎた日は水分多め＆早めに寝よう。{oshi}も寝不足は心配するよ',
    '1日で太ることはないよ！明日の朝ごはんを軽めにすればOK',
  ],
  eventSoon: [
    'あと{days}日！むくみ対策に塩分ひかえめ＆水をたくさん飲もう💧',
    'ラストスパート！でも無理な絶食はNG。肌ツヤも大事だよ✨',
    '前日はしっかり寝てね。{oshi}に会える顔、最高のコンディションで！',
  ],
  eventDay: [
    '今日は{event}当日！ここまで本当にお疲れさま🎉 全力で楽しんで！',
    'がんばった{name}さんは今日いちばん輝いてる。{oshi}との1枚、楽しんでね📸',
  ],
  after: [
    '{event}おつかれさま！次の現場に向けて、ゆるっと続けていこう🌸',
    '最高の1枚は撮れた？次の推し活に向けて健康キープしよ！',
  ],
};

function fill(template: string, p: Profile, vars: { days: number; streak: number }): string {
  return template
    .replaceAll('{oshi}', p.oshiName || '推し')
    .replaceAll('{name}', p.nickname || 'あなた')
    .replaceAll('{event}', p.eventName || '写真会')
    .replaceAll('{days}', String(vars.days))
    .replaceAll('{streak}', String(vars.streak));
}

export function pickCheer(
  mood: CheerMood,
  profile: Profile,
  vars: { days: number; streak: number },
  seed: number,
): string {
  const list = MESSAGES[mood];
  return fill(list[Math.abs(seed) % list.length], profile, vars);
}

export function decideMood(opts: {
  daysLeft: number;
  eventPassed: boolean;
  todayKcal: number;
  targetKcal: number;
}): CheerMood {
  if (opts.eventPassed) return 'after';
  if (opts.daysLeft === 0) return 'eventDay';
  if (opts.todayKcal > opts.targetKcal) return 'over';
  if (opts.daysLeft <= 3) return 'eventSoon';
  if (opts.todayKcal === 0) return 'start';
  return 'good';
}
