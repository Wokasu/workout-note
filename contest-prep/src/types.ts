export type Sex = 'male' | 'female';

export interface Profile {
  sex: Sex;
  age: number;
  heightCm: number;
  contestName: string;
  /** 大会日（YYYY-MM-DD） */
  contestDate: string;
  /** 減量開始日（YYYY-MM-DD） */
  prepStartDate: string;
  /** 減量開始時の体重 */
  startWeightKg: number;
  /** 大会当日の目標体重（海軍式の目安を見て自分で決める） */
  targetWeightKg: number;
  /** 体脂肪率に使う値（auto は海軍式が出せれば海軍式） */
  bodyFatSource: BodyFatSource;
  /** 活動係数（トレーニング込み） */
  activityFactor: number;
  /** 体重1kgあたりのたんぱく質（g） */
  proteinPerKg: number;
  /** 総カロリーに占める脂質の割合（%） */
  fatPct: number;
  /** 週あたり減量ペースの上限（体重比 %） */
  maxWeeklyLossPct: number;
  /** 'auto' は記録から推定した消費カロリーが出せればそちらを使う */
  tdeeMode: 'auto' | 'formula';
  /** コーチ等から指定された PFC を使う場合 */
  manualMacros: Macros | null;
}

export type BodyFatSource = 'auto' | 'navy' | 'scale';

export interface Macros {
  p: number;
  f: number;
  c: number;
}

export interface FoodLog extends Macros {
  id: string;
  date: string;
  /** 食事番号（1〜6） */
  slot: number;
  name: string;
  /** 「150g」「2個」など表示用 */
  amount: string;
}

/** 量を変えて記録できる食品（base 量あたりの PFC） */
export interface Food extends Macros {
  id: string;
  name: string;
  base: number;
  unit: string;
}

export const BODY_FIELDS = [
  'weightKg',
  'bodyFatPct',
  'muscleKg',
  'visceralFat',
  'bmrKcal',
  'bodyWaterPct',
  'boneKg',
  'metabolicAge',
  'waistCm',
  'chestCm',
  'hipCm',
  'armCm',
  'thighCm',
  'calfCm',
  'neckCm',
] as const;

export type BodyField = (typeof BODY_FIELDS)[number];

/** 1日1件の身体データ（体組成計の値とサイズ） */
export type BodyRecord = { date: string } & Partial<Record<BodyField, number>>;

export interface AppData {
  profile: Profile | null;
  logs: FoodLog[];
  body: BodyRecord[];
  myFoods: Food[];
}
