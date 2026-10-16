import type { Food } from '../types';

/**
 * 減量中によく食べる食品の PFC（日本食品標準成分表 2020年版（八訂）などをもとにした目安）。
 * 商品やメーカーで差があるので、よく使うものはマイ食品として登録し直すのがおすすめ。
 */
export const PRESET_FOODS: (Food & { category: string })[] = [
  { category: '肉', id: 'p-chicken-breast', name: '鶏むね肉（皮なし・生）', base: 100, unit: 'g', p: 23.3, f: 1.9, c: 0.1 },
  { category: '肉', id: 'p-sasami', name: '鶏ささみ（生）', base: 100, unit: 'g', p: 23.9, f: 0.8, c: 0.1 },
  { category: '肉', id: 'p-chicken-thigh', name: '鶏もも肉（皮なし・生）', base: 100, unit: 'g', p: 19.0, f: 5.0, c: 0 },
  { category: '肉', id: 'p-beef-round', name: '牛もも赤身（生）', base: 100, unit: 'g', p: 21.2, f: 4.3, c: 0.4 },
  { category: '肉', id: 'p-pork-fillet', name: '豚ヒレ（生）', base: 100, unit: 'g', p: 22.2, f: 3.7, c: 0.3 },
  { category: '魚', id: 'p-salmon', name: '鮭（白鮭・生）', base: 100, unit: 'g', p: 22.3, f: 4.1, c: 0.1 },
  { category: '魚', id: 'p-tuna', name: 'まぐろ赤身（生）', base: 100, unit: 'g', p: 26.4, f: 1.4, c: 0.1 },
  { category: '魚', id: 'p-cod', name: 'まだら（生）', base: 100, unit: 'g', p: 17.6, f: 0.2, c: 0.1 },
  { category: '魚', id: 'p-tuna-can', name: 'ツナ缶（水煮・ノンオイル）', base: 70, unit: 'g', p: 11.2, f: 0.5, c: 0.1 },
  { category: '魚', id: 'p-mackerel-can', name: 'サバ缶（水煮）', base: 100, unit: 'g', p: 20.9, f: 10.7, c: 0.2 },
  { category: '卵・乳・大豆', id: 'p-egg', name: '全卵（M玉）', base: 1, unit: '個', p: 6.1, f: 5.1, c: 0.2 },
  { category: '卵・乳・大豆', id: 'p-egg-white', name: '卵白', base: 100, unit: 'g', p: 10.1, f: 0, c: 0.5 },
  { category: '卵・乳・大豆', id: 'p-greek-yogurt', name: 'ギリシャヨーグルト（無脂肪・無糖）', base: 100, unit: 'g', p: 10.0, f: 0, c: 4.0 },
  { category: '卵・乳・大豆', id: 'p-natto', name: '納豆（1パック）', base: 1, unit: 'パック', p: 7.4, f: 4.5, c: 5.4 },
  { category: '卵・乳・大豆', id: 'p-tofu', name: '絹ごし豆腐', base: 100, unit: 'g', p: 5.3, f: 3.5, c: 2.0 },
  { category: '卵・乳・大豆', id: 'p-whey', name: 'ホエイプロテイン（1杯30g）', base: 1, unit: '杯', p: 22.0, f: 1.5, c: 3.0 },
  { category: '炭水化物', id: 'p-rice', name: '白米（炊飯後）', base: 100, unit: 'g', p: 2.5, f: 0.3, c: 37.1 },
  { category: '炭水化物', id: 'p-brown-rice', name: '玄米（炊飯後）', base: 100, unit: 'g', p: 2.8, f: 1.0, c: 35.6 },
  { category: '炭水化物', id: 'p-oatmeal', name: 'オートミール', base: 100, unit: 'g', p: 13.7, f: 5.7, c: 69.1 },
  { category: '炭水化物', id: 'p-sweet-potato', name: 'さつまいも（蒸し）', base: 100, unit: 'g', p: 1.2, f: 0.2, c: 31.9 },
  { category: '炭水化物', id: 'p-mochi', name: '切り餅（1個50g）', base: 1, unit: '個', p: 2.0, f: 0.3, c: 25.2 },
  { category: '炭水化物', id: 'p-bagel', name: 'ベーグル（1個90g）', base: 1, unit: '個', p: 8.6, f: 1.8, c: 49.4 },
  { category: '炭水化物', id: 'p-banana', name: 'バナナ（1本・可食部100g）', base: 1, unit: '本', p: 1.1, f: 0.2, c: 22.5 },
  { category: '野菜・脂質', id: 'p-broccoli', name: 'ブロッコリー（ゆで）', base: 100, unit: 'g', p: 3.9, f: 0.4, c: 4.3 },
  { category: '野菜・脂質', id: 'p-avocado', name: 'アボカド', base: 100, unit: 'g', p: 2.1, f: 17.5, c: 7.9 },
  { category: '野菜・脂質', id: 'p-almond', name: 'アーモンド（10粒）', base: 10, unit: '粒', p: 2.4, f: 6.2, c: 2.4 },
  { category: '野菜・脂質', id: 'p-olive-oil', name: 'オリーブオイル（大さじ1）', base: 1, unit: '大さじ', p: 0, f: 12.0, c: 0 },
  { category: '野菜・脂質', id: 'p-mct', name: 'MCTオイル（大さじ1）', base: 1, unit: '大さじ', p: 0, f: 14.0, c: 0 },
];
