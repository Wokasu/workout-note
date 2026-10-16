import type { BodyRecord, Macros, Profile, Sex } from '../types';
import {
  KCAL_PER_KG,
  estimateTdee,
  movingAverage,
  seriesOf,
  valueAtOrBefore,
  type TdeeEstimate,
} from './analysis';
import { addDays, daysBetween } from './date';
import { kcalOf } from './macros';
import { bodyFatSeries } from './navy';

export const ACTIVITY_OPTIONS = [
  { value: 1.4, label: 'デスクワーク＋週3〜4回トレ' },
  { value: 1.55, label: 'デスクワーク＋週5〜6回トレ' },
  { value: 1.7, label: '立ち仕事＋週5〜6回トレ／有酸素多め' },
  { value: 1.85, label: '肉体労働＋毎日トレ＆有酸素' },
];

/** Mifflin-St Jeor 式 */
export function bmrMifflin(sex: Sex, weightKg: number, heightCm: number, age: number): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return Math.round(sex === 'male' ? base + 5 : base - 161);
}

/** Katch-McArdle 式（除脂肪量から。筋肉量の多い人はこちらの方が近い） */
export function bmrKatch(leanKg: number): number {
  return Math.round(370 + 21.6 * leanKg);
}

export interface Targets extends Macros {
  kcal: number;
  currentKg: number;
  /** 計算に使った体脂肪率（直近30日以内の値がなければ null） */
  bodyFat: { pct: number; date: string; source: 'navy' | 'scale' } | null;
  leanKg: number | null;
  targetWeightKg: number;
  bmr: number;
  formulaTdee: number;
  estimate: TdeeEstimate | null;
  tdee: number;
  tdeeSource: 'formula' | 'estimate';
  daysLeft: number;
  remainingKg: number;
  /** 大会までに目標体重へ届くのに必要な週あたり減量（kg） */
  requiredKgPerWeek: number;
  /** 上限を考慮して計画する週あたり減量（kg） */
  plannedKgPerWeek: number;
  deficit: number;
  /** このペースで大会当日に見込まれる体重 */
  projectedKg: number;
  tooFast: boolean;
  belowBmr: boolean;
  manual: boolean;
}

export function macrosFor(kcal: number, weightKg: number, proteinPerKg: number, fatPct: number): Macros {
  const p = Math.round(weightKg * proteinPerKg);
  const f = Math.round((kcal * fatPct) / 100 / 9);
  const c = Math.max(0, Math.round((kcal - p * 4 - f * 9) / 4));
  return { p, f, c };
}

export function calcTargets(
  profile: Profile,
  body: BodyRecord[],
  intake: Map<string, number>,
  today: string,
): Targets {
  const weights = seriesOf(body, 'weightKg');
  // 1日だけの体重はブレが大きいので7日平均を「今の体重」とする
  const currentKg = Math.round((valueAtOrBefore(movingAverage(weights), today)?.value ?? profile.startWeightKg) * 10) / 10;

  // 体脂肪率は直近30日以内の値だけ使う
  const fatSeries = bodyFatSeries(body, profile, profile.bodyFatSource);
  const fatPoint = valueAtOrBefore(fatSeries.points, today);
  const bodyFat =
    fatPoint && fatSeries.source && fatPoint.date >= addDays(today, -30)
      ? { pct: fatPoint.value, date: fatPoint.date, source: fatSeries.source }
      : null;
  const leanKg = bodyFat ? Math.round(currentKg * (1 - bodyFat.pct / 100) * 10) / 10 : null;
  const targetWeightKg = profile.targetWeightKg;

  const bmr = leanKg !== null ? bmrKatch(leanKg) : bmrMifflin(profile.sex, currentKg, profile.heightCm, profile.age);
  const formulaTdee = Math.round(bmr * profile.activityFactor);
  const estimate = estimateTdee(weights, intake, today);
  const useEstimate = profile.tdeeMode === 'auto' && estimate !== null;
  const tdee = useEstimate ? estimate.tdee : formulaTdee;

  const daysLeft = Math.max(0, daysBetween(today, profile.contestDate));
  const remainingKg = Math.round((currentKg - targetWeightKg) * 10) / 10;
  const requiredKgPerWeek = daysLeft > 0 ? Math.max(0, (remainingKg / daysLeft) * 7) : 0;
  const capKgPerWeek = (currentKg * profile.maxWeeklyLossPct) / 100;
  const plannedKgPerWeek = Math.min(requiredKgPerWeek, capKgPerWeek);
  const deficit = Math.round((plannedKgPerWeek * KCAL_PER_KG) / 7);

  let kcal = tdee - deficit;
  let macros = macrosFor(kcal, currentKg, profile.proteinPerKg, profile.fatPct);
  const manual = profile.manualMacros !== null;
  if (profile.manualMacros) {
    macros = profile.manualMacros;
    kcal = kcalOf(macros);
  }

  return {
    ...macros,
    kcal,
    currentKg,
    bodyFat,
    leanKg,
    targetWeightKg,
    bmr,
    formulaTdee,
    estimate,
    tdee,
    tdeeSource: useEstimate ? 'estimate' : 'formula',
    daysLeft,
    remainingKg,
    requiredKgPerWeek: Math.round(requiredKgPerWeek * 100) / 100,
    plannedKgPerWeek: Math.round(plannedKgPerWeek * 100) / 100,
    deficit,
    projectedKg: Math.round((currentKg - (plannedKgPerWeek * daysLeft) / 7) * 10) / 10,
    tooFast: requiredKgPerWeek > capKgPerWeek + 1e-9,
    belowBmr: kcal < bmr,
    manual,
  };
}
