import type { BodyField } from '../types';

export interface FieldDef {
  key: BodyField;
  label: string;
  unit: string;
  group: 'composition' | 'size';
  /** 妥当な値の範囲（範囲外は取り込まない） */
  min: number;
  max: number;
  /** CSV の列名に含まれていたらこの項目とみなす */
  keywords: string[];
  /** 含まれていたら除外する */
  excludes?: string[];
  /** ヘルスプラネット API のタグ番号 */
  tag?: string;
  /** 増えると良い項目か（グラフの色分け用） */
  higherIsBetter?: boolean;
}

export const FIELD_DEFS: FieldDef[] = [
  { key: 'weightKg', label: '体重', unit: 'kg', group: 'composition', min: 25, max: 250, keywords: ['体重', 'weight'], excludes: ['目標', '除脂肪', '標準'], tag: '6021' },
  { key: 'bodyFatPct', label: '体脂肪率', unit: '%', group: 'composition', min: 2, max: 60, keywords: ['体脂肪率', 'bodyfat', 'fat%'], tag: '6022' },
  { key: 'muscleKg', label: '筋肉量', unit: 'kg', group: 'composition', min: 10, max: 150, keywords: ['筋肉量', '骨格筋量', 'muscle'], excludes: ['スコア', '率'], tag: '6023', higherIsBetter: true },
  { key: 'visceralFat', label: '内臓脂肪レベル', unit: '', group: 'composition', min: 0.5, max: 60, keywords: ['内臓脂肪', 'visceral'], tag: '6026' },
  { key: 'bmrKcal', label: '基礎代謝量', unit: 'kcal', group: 'composition', min: 600, max: 5000, keywords: ['基礎代謝', 'bmr'], tag: '6027' },
  { key: 'bodyWaterPct', label: '体水分率', unit: '%', group: 'composition', min: 30, max: 80, keywords: ['体水分', '水分率', 'water'] },
  { key: 'boneKg', label: '推定骨量', unit: 'kg', group: 'composition', min: 0.5, max: 10, keywords: ['骨量', 'bone'], tag: '6029' },
  { key: 'metabolicAge', label: '体内年齢', unit: '才', group: 'composition', min: 10, max: 99, keywords: ['体内年齢', 'metabolicage'], tag: '6028' },
  { key: 'waistCm', label: 'ウエスト', unit: 'cm', group: 'size', min: 40, max: 200, keywords: ['ウエスト', 'ウェスト', '腹囲', 'waist'] },
  { key: 'chestCm', label: '胸囲', unit: 'cm', group: 'size', min: 50, max: 200, keywords: ['胸囲', 'チェスト', 'バスト', 'chest'], higherIsBetter: true },
  { key: 'hipCm', label: 'ヒップ', unit: 'cm', group: 'size', min: 50, max: 200, keywords: ['ヒップ', '臀囲', 'hip'] },
  { key: 'armCm', label: '上腕', unit: 'cm', group: 'size', min: 15, max: 70, keywords: ['上腕', '腕', 'アーム', 'arm'], excludes: ['前腕'], higherIsBetter: true },
  { key: 'thighCm', label: '太もも', unit: 'cm', group: 'size', min: 30, max: 100, keywords: ['太もも', '太腿', '大腿', 'thigh'], higherIsBetter: true },
  { key: 'calfCm', label: 'ふくらはぎ', unit: 'cm', group: 'size', min: 20, max: 70, keywords: ['ふくらはぎ', '下腿', 'カーフ', 'calf'], higherIsBetter: true },
  { key: 'neckCm', label: '首', unit: 'cm', group: 'size', min: 25, max: 70, keywords: ['首', 'ネック', 'neck'], excludes: ['手首', '足首'] },
];

export const FIELD_BY_KEY = Object.fromEntries(FIELD_DEFS.map((f) => [f.key, f])) as Record<BodyField, FieldDef>;

export function formatValue(key: BodyField, v: number): string {
  const def = FIELD_BY_KEY[key];
  const digits = key === 'bmrKcal' || key === 'metabolicAge' ? 0 : 1;
  return `${v.toFixed(digits)}${def.unit ? ` ${def.unit}` : ''}`;
}
