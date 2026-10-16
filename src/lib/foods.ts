export interface FoodPreset {
  name: string;
  kcal: number;
  category: string;
}

/** よく食べるもののざっくりカロリー（目安） */
export const FOOD_PRESETS: FoodPreset[] = [
  { category: '主食', name: 'ごはん（茶碗1杯 150g）', kcal: 234 },
  { category: '主食', name: 'ごはん（小盛り 100g）', kcal: 156 },
  { category: '主食', name: 'おにぎり（鮭）', kcal: 180 },
  { category: '主食', name: '食パン（6枚切り1枚）', kcal: 150 },
  { category: '主食', name: 'オートミール（30g）', kcal: 110 },
  { category: '主食', name: 'かけうどん', kcal: 320 },
  { category: '主食', name: 'ざるそば', kcal: 300 },
  { category: 'たんぱく質', name: 'サラダチキン', kcal: 110 },
  { category: 'たんぱく質', name: 'ゆで卵', kcal: 76 },
  { category: 'たんぱく質', name: '納豆（1パック）', kcal: 90 },
  { category: 'たんぱく質', name: '豆腐（150g）', kcal: 84 },
  { category: 'たんぱく質', name: 'ギリシャヨーグルト（無糖）', kcal: 90 },
  { category: 'たんぱく質', name: 'プロテイン（1杯）', kcal: 110 },
  { category: 'たんぱく質', name: '焼き鮭（1切れ）', kcal: 140 },
  { category: 'たんぱく質', name: '鶏むね肉（皮なし100g）', kcal: 108 },
  { category: '野菜・汁物', name: 'サラダ（ノンオイル）', kcal: 40 },
  { category: '野菜・汁物', name: 'みそ汁', kcal: 40 },
  { category: '野菜・汁物', name: '具だくさんスープ', kcal: 120 },
  { category: '外食', name: 'カレーライス', kcal: 750 },
  { category: '外食', name: 'ラーメン', kcal: 500 },
  { category: '外食', name: 'ハンバーガー', kcal: 260 },
  { category: '外食', name: 'フライドポテト（M）', kcal: 410 },
  { category: '外食', name: '牛丼（並）', kcal: 650 },
  { category: '外食', name: 'パスタ（ミートソース）', kcal: 600 },
  { category: 'おやつ・飲み物', name: 'チョコ（1かけ）', kcal: 30 },
  { category: 'おやつ・飲み物', name: 'ポテトチップス（1袋60g）', kcal: 330 },
  { category: 'おやつ・飲み物', name: 'アイス（カップ）', kcal: 250 },
  { category: 'おやつ・飲み物', name: 'カフェラテ（M）', kcal: 150 },
  { category: 'おやつ・飲み物', name: 'タピオカミルクティー', kcal: 350 },
  { category: 'おやつ・飲み物', name: 'バナナ', kcal: 86 },
  { category: 'おやつ・飲み物', name: 'エナジードリンク', kcal: 120 },
];
