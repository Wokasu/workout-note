export type Sex = 'male' | 'female';

export interface Profile {
  /** cut：コンテストに向けた減量、bulk：増量期（オフ） */
  phase: 'cut' | 'bulk';
  bulk: BulkSettings;
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
  /** 維持カロリーの決め方：formula 計算式、manual 自分で反映した推定値、auto 記録から毎週自動で更新 */
  tdeeMode: 'auto' | 'formula' | 'manual';
  /** 「反映する」を押した推定値と、その日 */
  manualTdee: { kcal: number; date: string } | null;
  /** コンテスト減量の維持カロリー確認を切り上げた（またはとらなかった）日 */
  calibrationSkippedOn: string | null;
  /** 減量（コンテスト減量・プチダイエット）に入る前に、維持カロリーで食べて実際の維持カロリーを測る日数（0 でなし） */
  calibrationDays: number;
  /** コーチ等から指定された PFC を使う場合 */
  manualMacros: Macros | null;
}

export type BodyFatSource = 'auto' | 'navy' | 'scale';

/** 増量期の進め方 */
export interface BulkSettings {
  /** 増量を始めた日（YYYY-MM-DD） */
  startDate: string;
  /** コンテスト体重の計算に使う、大会時の体脂肪率（%） */
  stageBodyFatPct: number;
  /** コンテスト体重から何 kg まで増やしてよいか */
  ceilingMarginKg: number;
  /** 上限に達したら、上限から何 kg 下がるまでプチダイエットするか */
  returnKg: number;
  /** 増量を始めた週の余剰カロリー（kcal/日） */
  startSurplusKcal: number;
  /** 余剰カロリーを毎週いくつ増やすか（kcal/日） */
  rampKcal: number;
  /** 余剰カロリーの上限（kcal/日） */
  maxSurplusKcal: number;
  /** プチダイエットの減量ペース（体重の %/週） */
  miniCutPct: number;
  /** 増量の目標ペース（kg/月）。実際の増え方を見て余剰カロリーを増やす・据え置く・減らす */
  gainKgPerMonth: number;
  /** 大会に向けた減量のペースの幅（kg/月）。減量に入る時期の計算に使う */
  prepPaceMinKg: number;
  prepPaceMaxKg: number;
  /** 自分で始めた・やめたプチダイエット（日付順）。上限に届かなくても始められる */
  manualCuts: ManualCut[];
}

/** 手動のプチダイエット。start はこの日から（維持確認があればそこから）、end は増量に戻した日 */
export interface ManualCut {
  start: string;
  /** ここまで落としたら増量に戻る（7日平均） */
  targetKg: number;
  end: string | null;
  /** 最初に維持カロリーの確認期間をとるか（false なら今の推定値ですぐ赤字。古い記録は true 扱い） */
  calibrate?: boolean;
  /** 確認期間を切り上げて赤字に入った日 */
  cutFrom?: string | null;
  /** このプチダイエットの減量ペース（体重の %/週）。なければ設定の値 */
  pct?: number;
}

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
