import type { Food, Macros } from '../types';
import { PRESET_FOODS } from './foods';
import { kcalOf, scaleMacros } from './macros';

/**
 * 「鶏胸肉一枚」「ご飯大盛り、卵2個」のような文章から食事を読み取る。
 * よく使う食品はアプリ内で判定し、判定できないもの（外食など）は Claude に推定してもらう。
 */

export interface ParsedItem extends Macros {
  name: string;
  amount: string;
  /** 重さがわかるときの g（量を変えたときの換算に使う） */
  grams: number | null;
  /** 判定の前提（「1枚=300gとして計算」など） */
  note: string;
  source: 'local' | 'claude';
}

/** 登録済みの食品の別名と、「1枚」などを重さに直す表 */
const ALIASES: Record<string, { aliases: string[]; pieces?: Record<string, number> }> = {
  'p-chicken-breast': { aliases: ['鶏むね肉', '鶏胸肉', '鶏ムネ肉', 'とりむね肉', '鶏むね', '鶏胸', 'むね肉', '胸肉', 'ムネ肉', 'とりむね'], pieces: { 枚: 300 } },
  'p-sasami': { aliases: ['ささみ', 'ササミ', '笹身'], pieces: { 本: 50 } },
  'p-chicken-thigh': { aliases: ['鶏もも肉', '鶏モモ肉', '鶏もも', '鶏モモ', 'もも肉', 'モモ肉'], pieces: { 枚: 250 } },
  'p-beef-round': { aliases: ['牛もも', '牛赤身', '牛モモ'] },
  'p-pork-fillet': { aliases: ['豚ヒレ', 'ヒレ肉', '豚ひれ'] },
  'p-salmon': { aliases: ['鮭', 'さけ', 'サケ', 'しゃけ', 'サーモン'], pieces: { 切れ: 80 } },
  'p-tuna': { aliases: ['まぐろ', 'マグロ', '鮪'] },
  'p-cod': { aliases: ['たら', 'タラ', '鱈'], pieces: { 切れ: 80 } },
  'p-tuna-can': { aliases: ['ツナ缶', 'ツナ'], pieces: { 缶: 70 } },
  'p-mackerel-can': { aliases: ['サバ缶', 'さば缶', '鯖缶'], pieces: { 缶: 190 } },
  'p-egg': { aliases: ['ゆで卵', '茹で卵', 'ゆでたまご', '全卵', '卵', 'たまご', '玉子', 'タマゴ'] },
  'p-egg-white': { aliases: ['卵白'], pieces: { 個: 35 } },
  'p-greek-yogurt': { aliases: ['ギリシャヨーグルト', 'オイコス'], pieces: { 個: 113 } },
  'p-natto': { aliases: ['納豆'] },
  'p-tofu': { aliases: ['豆腐'], pieces: { 丁: 300, パック: 150 } },
  'p-whey': { aliases: ['プロテイン', 'ホエイ'] },
  'p-rice': { aliases: ['白米', 'ご飯', 'ごはん', 'ゴハン', 'ライス', '米'], pieces: { 杯: 150 } },
  'p-brown-rice': { aliases: ['玄米'], pieces: { 杯: 150 } },
  'p-oatmeal': { aliases: ['オートミール', 'オーツ'] },
  'p-sweet-potato': { aliases: ['さつまいも', 'サツマイモ', '薩摩芋'], pieces: { 本: 250 } },
  'p-mochi': { aliases: ['切り餅', '餅', 'もち'] },
  'p-bagel': { aliases: ['ベーグル'] },
  'p-banana': { aliases: ['バナナ'] },
  'p-broccoli': { aliases: ['ブロッコリー'], pieces: { 房: 15, 株: 200 } },
  'p-avocado': { aliases: ['アボカド'], pieces: { 個: 140 } },
  'p-almond': { aliases: ['アーモンド'] },
  'p-olive-oil': { aliases: ['オリーブオイル', 'オリーブ油'], pieces: { 小さじ: 1 / 3 } },
  'p-mct': { aliases: ['MCTオイル', 'MCT'], pieces: { 小さじ: 1 / 3 } },
};

/** 単位の言い方をそろえる */
const UNIT_WORDS: [RegExp, string][] = [
  [/^(g|ｇ|グラム)$/, 'g'],
  [/^(kg|キロ)$/, 'kg'],
  [/^(個|つ|コ)$/, '個'],
  [/^(杯|膳|はい)$/, '杯'],
  [/^(枚|本|パック|缶|切れ|切|丁|粒|大さじ|小さじ|房|株)$/, ''],
];
const UNIT_PATTERN = 'g|ｇ|グラム|kg|キロ|個|つ|コ|杯|膳|枚|本|パック|缶|切れ|切|丁|粒|大さじ|小さじ|房|株';

function canonUnit(u: string): string {
  for (const [re, to] of UNIT_WORDS) if (re.test(u)) return to || (u === '切' ? '切れ' : u);
  return u;
}

const KANJI_DIGITS: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

function kanjiToNumber(s: string): number {
  if (s === '十') return 10;
  const [tens, ones] = s.includes('十') ? s.split('十') : ['', s];
  return (tens ? (KANJI_DIGITS[tens] ?? 1) : s.includes('十') ? 1 : 0) * 10 + (ones ? (KANJI_DIGITS[ones] ?? 0) : 0);
}

/** 全角を半角に、量の前の漢数字を数字にする */
export function normalize(text: string): string {
  return text
    .replace(/[０-９．]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[Ａ-Ｚａ-ｚ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(new RegExp(`([一二三四五六七八九十]+)(?=(${UNIT_PATTERN}))`, 'g'), (m) => String(kanjiToNumber(m)))
    .replace(/\s+/g, ' ')
    .trim();
}

/** 量の書き方で、食品の判定に関係しない言葉 */
const FILLER = /(茶碗|お茶碗|お椀|皮なし|皮無し|皮無|生|ゆで|茹で|蒸し|焼き|炊いた|炊飯後|炊飯|約|くらい|ぐらい|程度|ほど|分|の|を|肉|\s|[()（）・])/g;

const SIZE_WORDS: [RegExp, number, string][] = [
  [/特盛り?/, 2, '特盛り（2倍）'],
  [/大盛り?|おおもり/, 1.5, '大盛り（1.5倍）'],
  [/小盛り?|少なめ|少な目/, 0.7, '少なめ（0.7倍）'],
  [/半分|半/, 0.5, '半分'],
];

function compact(s: string): string {
  return s.replace(/[\s、,，・。（）()]/g, '').toLowerCase();
}

interface Candidate {
  food: Food;
  matched: string;
  pieces?: Record<string, number>;
}

/** 一番長く一致する食品（マイ食品を優先） */
function findFood(text: string, myFoods: Food[]): Candidate | null {
  const c = compact(text);
  let best: Candidate | null = null;
  for (const food of myFoods) {
    const name = compact(food.name);
    if (name.length >= 2 && c.includes(name) && (!best || name.length > best.matched.length)) best = { food, matched: name };
  }
  if (best) return best;
  for (const food of PRESET_FOODS) {
    const entry = ALIASES[food.id];
    for (const alias of entry?.aliases ?? []) {
      const a = compact(alias);
      if (c.includes(a) && (!best || a.length > best.matched.length)) best = { food, matched: a, pieces: entry.pieces };
    }
  }
  return best;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** 1品ぶんを判定する。判定できなければ null */
export function parseSegment(segment: string, myFoods: Food[]): ParsedItem | null {
  const text = normalize(segment);
  const hit = findFood(text, myFoods);
  if (!hit) return null;
  const { food, pieces } = hit;
  let rest = compact(text).replace(hit.matched, '');

  // 量
  let count: number | null = null;
  let unit: string | null = null;
  const unitFirst = rest.match(/(大さじ|小さじ)(\d+(?:\.\d+)?)/);
  const numFirst = rest.match(new RegExp(`(\\d+(?:\\.\\d+)?)(${UNIT_PATTERN})?`));
  if (unitFirst) {
    unit = unitFirst[1];
    count = Number(unitFirst[2]);
    rest = rest.replace(unitFirst[0], '');
  } else if (numFirst) {
    count = Number(numFirst[1]);
    unit = numFirst[2] ? canonUnit(numFirst[2]) : null;
    rest = rest.replace(numFirst[0], '');
  } else {
    const bare = rest.match(new RegExp(`(${UNIT_PATTERN})`));
    if (bare) {
      unit = canonUnit(bare[1]);
      rest = rest.replace(bare[0], '');
    }
  }

  // 大盛り・半分など
  let factor = 1;
  const notes: string[] = [];
  for (const [re, k, label] of SIZE_WORDS) {
    if (re.test(rest)) {
      factor *= k;
      notes.push(label);
      rest = rest.replace(re, '');
    }
  }
  // 食品名と量以外の言葉が残る（「唐揚げ」「皮付き」など）なら別の料理なので、ここでは判定しない
  if (rest.replace(FILLER, '').length > 0) return null;

  const isGram = food.unit === 'g';
  if (unit === 'kg') {
    unit = 'g';
    count = (count ?? 1) * 1000;
  }
  let grams: number | null = null;
  let units: number | null = null;
  /** 個数で記録する食品を別の単位（小さじなど）で書いたときの表示 */
  let shown: string | null = null;
  if (unit === 'g') {
    if (!isGram) return null;
    grams = count ?? food.base;
  } else if (unit && unit === food.unit) {
    units = count ?? food.base;
  } else if (unit && pieces?.[unit] !== undefined) {
    const n = count ?? 1;
    if (isGram) {
      grams = n * pieces[unit];
      notes.unshift(`1${unit}=${pieces[unit]}gとして計算`);
    } else {
      units = n * pieces[unit];
      shown = `${unit}${r1(n * factor)}`;
    }
  } else if (unit) {
    return null;
  } else if (count !== null) {
    // 単位なしの数字：重さの食品なら10以上は g、それ未満は1個・1枚などの数
    if (isGram && count >= 10) grams = count;
    else if (isGram && pieces) {
      const [u, g] = Object.entries(pieces)[0];
      grams = count * g;
      notes.unshift(`1${u}=${g}gとして計算`);
    } else if (!isGram) units = count;
    else return null;
  } else if (isGram && pieces && Object.values(pieces)[0] >= 50) {
    // 量を書いていなければ「1枚」「1杯」など、ふつう1回に食べる単位で数える
    const [u, g] = Object.entries(pieces)[0];
    grams = g;
    notes.unshift(`1${u}=${g}gとして計算`);
  } else if (isGram) {
    grams = food.base;
    notes.unshift(`量の指定がないため${food.base}gとして計算`);
  } else {
    units = food.base;
  }

  if (grams !== null) grams = Math.round(grams * factor);
  if (units !== null) units *= factor;
  const macros = grams !== null ? scaleMacros(food, food.base, grams) : scaleMacros(food, food.base, units!);
  if (/皮なし/.test(food.name) && !/皮/.test(segment)) notes.push('皮なしとして計算');
  return {
    name: food.name,
    amount: grams !== null ? `${grams}g` : (shown ?? `${r1(units!)}${food.unit}`),
    grams,
    note: notes.join('・'),
    source: 'local',
    ...macros,
  };
}

/** 文章を品目に分ける */
export function splitItems(text: string): string[] {
  return text
    .split(/[、,，\n＋+]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 「ささみとブロッコリー」のように「と」でつながった2品（どちらも判定できたときだけ） */
function splitAtTo(seg: string, myFoods: Food[]): ParsedItem[] | null {
  for (let i = seg.indexOf('と', 1); i > 0; i = seg.indexOf('と', i + 1)) {
    const a = parseSegment(seg.slice(0, i), myFoods);
    const b = a && (parseSegment(seg.slice(i + 1), myFoods) ?? splitAtTo(seg.slice(i + 1), myFoods));
    if (a && b) return [a, ...(Array.isArray(b) ? b : [b])];
  }
  return null;
}

/** アプリ内で判定する。1品でも判定できなければ null（Claude に任せる） */
export function parseLocally(text: string, myFoods: Food[]): ParsedItem[] | null {
  // マイ食品は読点を含む名前（「なか卯、親子丼」など）でも全体で一致させる
  const whole = parseSegment(text, myFoods);
  if (whole && myFoods.some((f) => f.name === whole.name)) return [whole];
  const items: ParsedItem[] = [];
  for (const seg of splitItems(text)) {
    const item = parseSegment(seg, myFoods) ?? splitAtTo(seg, myFoods);
    if (!item) return null;
    items.push(...(Array.isArray(item) ? item : [item]));
  }
  return items.length ? items : null;
}

function describeFood(f: Food): string {
  return `${f.name}: ${f.base}${f.unit}あたり P${f.p} F${f.f} C${f.c}`;
}

/** Claude への依頼文 */
export function buildPrompt(text: string, myFoods: Food[]): string {
  const refs = [...myFoods, ...PRESET_FOODS].slice(0, 80).map(describeFood).join('\n');
  return `あなたは日本の食品とチェーン店のメニューの栄養成分に詳しい管理栄養士です。ボディビル競技者が食べたものを文章で書いたので、品目ごとにたんぱく質(P)・脂質(F)・炭水化物(C)のグラム数を推定してください。

ルール:
- 「なか卯、親子丼 大盛り」のように店名とメニューが読点で分かれていることがあります。店名とメニューは1品にまとめ、名前は「なか卯 親子丼（大盛り）」のようにしてください。
- チェーン店や市販品は、公表されている栄養成分を知っていればその値を使い、サイズ（並・大盛りなど）も反映してください。
- 「1枚」「茶碗1杯」「大盛り」などの量は一般的な重さに換算し、amount に「300g」「1杯」のように書いてください。重さがわかれば grams に数値、わからなければ null。
- 肉や魚は、特に書かれていなければ生の重さとして計算してください。鶏むね肉・鶏もも肉は特に書かれていなければ皮なしとし、名前にも「皮なし」と書いてください。鶏むね肉1枚は300gとします。
- 下の「よく使う食品」に当てはまるものは、その値を量に合わせて計算し、名前もそのまま使ってください。
- 推定の前提（重さの仮定、皮なしとしたこと、公表値か一般的な値からの推定か）を note に短く書いてください。
- 数値は小数第1位まで。

よく使う食品:
${refs}

食べたもの:
"""
${text.slice(0, 2000)}
"""

次の形の JSON だけを返してください:
{"items":[{"name":"なか卯 親子丼（大盛り）","amount":"1杯","grams":null,"p":30.5,"f":20.1,"c":120.3,"note":"公表値をもとに大盛りで推定"}]}`;
}

/** Claude の返事を確かめて品目にする */
export function itemsFromReply(reply: unknown): ParsedItem[] {
  const list = (reply as { items?: unknown })?.items;
  if (!Array.isArray(list)) return [];
  const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? r1(n) : 0;
  };
  return list
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && typeof (x as { name?: unknown }).name === 'string')
    .map((x) => ({
      name: String(x.name).slice(0, 80),
      amount: typeof x.amount === 'string' ? x.amount.slice(0, 30) : '',
      grams: typeof x.grams === 'number' && x.grams > 0 ? Math.round(x.grams) : null,
      p: num(x.p),
      f: num(x.f),
      c: num(x.c),
      note: typeof x.note === 'string' ? x.note.slice(0, 120) : '',
      source: 'claude' as const,
    }))
    .filter((x) => kcalOf(x) > 0);
}
