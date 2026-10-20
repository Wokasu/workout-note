import type { Food, Macros } from '../types';

/** 食品の大きな分類：炭水化物（主食）・タンパク質・脂質・その他 */
export type FoodGroup = 'carb' | 'protein' | 'fat' | 'other';

export const FOOD_GROUPS: { id: FoodGroup; label: string }[] = [
  { id: 'carb', label: '炭水化物' },
  { id: 'protein', label: 'タンパク質' },
  { id: 'fat', label: '脂質' },
  { id: 'other', label: 'その他' },
];

export type PresetFood = Food & { group: FoodGroup; category: string };

/**
 * 減量・増量中によく食べる食品の PFC（日本食品標準成分表 2020年版（八訂）などをもとにした目安）。
 * 商品やメーカーで差があるので、よく使うものはマイ食品として登録し直すのがおすすめ。
 */
export const PRESET_FOODS: PresetFood[] = [
  // 炭水化物（主食）
  { group: 'carb', category: 'ご飯', id: 'p-rice', name: '白米（炊飯後）', base: 100, unit: 'g', p: 2.5, f: 0.3, c: 37.1 },
  { group: 'carb', category: 'ご飯', id: 'p-brown-rice', name: '玄米（炊飯後）', base: 100, unit: 'g', p: 2.8, f: 1.0, c: 35.6 },
  { group: 'carb', category: 'ご飯', id: 'p-mochi', name: '切り餅（1個50g）', base: 1, unit: '個', p: 2.0, f: 0.3, c: 25.2 },
  { group: 'carb', category: 'パン・シリアル', id: 'p-bread', name: '食パン（6枚切り1枚）', base: 1, unit: '枚', p: 5.3, f: 2.5, c: 27.8 },
  { group: 'carb', category: 'パン・シリアル', id: 'p-bagel', name: 'ベーグル（1個90g）', base: 1, unit: '個', p: 8.6, f: 1.8, c: 49.4 },
  { group: 'carb', category: 'パン・シリアル', id: 'p-oatmeal', name: 'オートミール', base: 100, unit: 'g', p: 13.7, f: 5.7, c: 69.1 },
  { group: 'carb', category: '麺', id: 'p-pasta', name: 'パスタ（ゆで）', base: 100, unit: 'g', p: 5.8, f: 0.9, c: 32.2 },
  { group: 'carb', category: '麺', id: 'p-pasta-dry', name: 'パスタ（乾麺）', base: 100, unit: 'g', p: 12.9, f: 1.8, c: 73.1 },
  { group: 'carb', category: '麺', id: 'p-udon', name: 'うどん（ゆで）', base: 100, unit: 'g', p: 2.6, f: 0.4, c: 21.6 },
  { group: 'carb', category: '麺', id: 'p-soba', name: 'そば（ゆで）', base: 100, unit: 'g', p: 4.8, f: 1.0, c: 26.0 },
  { group: 'carb', category: 'いも・果物', id: 'p-sweet-potato', name: 'さつまいも（蒸し）', base: 100, unit: 'g', p: 1.2, f: 0.2, c: 31.9 },
  { group: 'carb', category: 'いも・果物', id: 'p-banana', name: 'バナナ（1本・可食部100g）', base: 1, unit: '本', p: 1.1, f: 0.2, c: 22.5 },

  // タンパク質
  { group: 'protein', category: '肉', id: 'p-chicken-breast', name: '鶏むね肉（皮なし・生）', base: 100, unit: 'g', p: 23.3, f: 1.9, c: 0.1 },
  { group: 'protein', category: '肉', id: 'p-sasami', name: '鶏ささみ（生）', base: 100, unit: 'g', p: 23.9, f: 0.8, c: 0.1 },
  { group: 'protein', category: '肉', id: 'p-chicken-thigh', name: '鶏もも肉（皮なし・生）', base: 100, unit: 'g', p: 19.0, f: 5.0, c: 0 },
  { group: 'protein', category: '肉', id: 'p-beef-round', name: '牛もも赤身（生）', base: 100, unit: 'g', p: 21.2, f: 4.3, c: 0.4 },
  { group: 'protein', category: '肉', id: 'p-pork-fillet', name: '豚ヒレ（生）', base: 100, unit: 'g', p: 22.2, f: 3.7, c: 0.3 },
  { group: 'protein', category: '魚', id: 'p-salmon', name: '鮭（白鮭・生）', base: 100, unit: 'g', p: 22.3, f: 4.1, c: 0.1 },
  { group: 'protein', category: '魚', id: 'p-tuna', name: 'まぐろ赤身（生）', base: 100, unit: 'g', p: 26.4, f: 1.4, c: 0.1 },
  { group: 'protein', category: '魚', id: 'p-cod', name: 'まだら（生）', base: 100, unit: 'g', p: 17.6, f: 0.2, c: 0.1 },
  { group: 'protein', category: '魚', id: 'p-tuna-can', name: 'ツナ缶（水煮・ノンオイル）', base: 70, unit: 'g', p: 11.2, f: 0.5, c: 0.1 },
  { group: 'protein', category: '魚', id: 'p-mackerel-can', name: 'サバ缶（水煮）', base: 100, unit: 'g', p: 20.9, f: 10.7, c: 0.2 },
  { group: 'protein', category: 'プロテイン', id: 'p-whey', name: 'ホエイプロテイン（1杯30g）', base: 1, unit: '杯', p: 22.0, f: 1.5, c: 3.0 },
  { group: 'protein', category: '卵・乳・大豆', id: 'p-egg', name: '全卵（M玉）', base: 1, unit: '個', p: 6.1, f: 5.1, c: 0.2 },
  { group: 'protein', category: '卵・乳・大豆', id: 'p-egg-white', name: '卵白', base: 100, unit: 'g', p: 10.1, f: 0, c: 0.5 },
  { group: 'protein', category: '卵・乳・大豆', id: 'p-greek-yogurt', name: 'ギリシャヨーグルト（無脂肪・無糖）', base: 100, unit: 'g', p: 10.0, f: 0, c: 4.0 },
  { group: 'protein', category: '卵・乳・大豆', id: 'p-natto', name: '納豆（1パック）', base: 1, unit: 'パック', p: 7.4, f: 4.5, c: 5.4 },
  { group: 'protein', category: '卵・乳・大豆', id: 'p-tofu', name: '絹ごし豆腐', base: 100, unit: 'g', p: 5.3, f: 3.5, c: 2.0 },

  // 脂質
  { group: 'fat', category: 'オイル', id: 'p-olive-oil', name: 'オリーブオイル（大さじ1）', base: 1, unit: '大さじ', p: 0, f: 12.0, c: 0 },
  { group: 'fat', category: 'オイル', id: 'p-mct', name: 'MCTオイル（大さじ1）', base: 1, unit: '大さじ', p: 0, f: 14.0, c: 0 },
  { group: 'fat', category: 'ナッツ', id: 'p-almond', name: 'アーモンド（10粒）', base: 10, unit: '粒', p: 2.4, f: 6.2, c: 2.4 },
  { group: 'fat', category: 'ナッツ', id: 'p-walnut', name: 'くるみ', base: 10, unit: 'g', p: 1.5, f: 6.9, c: 1.2 },
  { group: 'fat', category: 'ナッツ', id: 'p-peanut-butter', name: 'ピーナッツバター（大さじ1）', base: 1, unit: '大さじ', p: 4.3, f: 8.6, c: 3.4 },
  { group: 'fat', category: 'そのほか', id: 'p-avocado', name: 'アボカド', base: 100, unit: 'g', p: 2.1, f: 17.5, c: 7.9 },

  // その他
  { group: 'other', category: '野菜', id: 'p-broccoli', name: 'ブロッコリー（ゆで）', base: 100, unit: 'g', p: 3.9, f: 0.4, c: 4.3 },
];

/**
 * マイ食品などの分類：一番カロリーの多い栄養素で決める。
 * どれも全体の半分に届かない（外食の丼など）ものは「その他」。
 */
export function groupOf(m: Macros): FoodGroup {
  const kcal = { protein: m.p * 4, fat: m.f * 9, carb: m.c * 4 };
  const total = kcal.protein + kcal.fat + kcal.carb;
  if (total <= 0) return 'other';
  const [top, value] = (Object.entries(kcal) as [FoodGroup, number][]).sort((a, b) => b[1] - a[1])[0];
  return value / total >= 0.5 ? top : 'other';
}
