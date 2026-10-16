import type { ActivityLevel, Profile, Sex, WeightEntry } from '../types';
import { addDays, daysBetween } from './date';

/** 体脂肪 1kg あたりのエネルギー量（kcal） */
export const KCAL_PER_KG_FAT = 7200;
/** 1日の赤字の上限（これ以上は無理なペース） */
export const MAX_DAILY_DEFICIT = 700;
/** 1週間の減量ペースの上限（体重比） */
export const MAX_WEEKLY_LOSS_RATIO = 0.01;

export const ACTIVITY_FACTORS: Record<ActivityLevel, number> = {
  low: 1.2,
  normal: 1.375,
  high: 1.55,
  veryHigh: 1.725,
};

export const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  low: 'ほぼ座りっぱなし',
  normal: '通勤・家事くらい',
  high: '週3〜4回運動する',
  veryHigh: '毎日がっつり運動',
};

/** 基礎代謝（Mifflin-St Jeor 式） */
export function calcBmr(sex: Sex, weightKg: number, heightCm: number, age: number): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return Math.round(sex === 'male' ? base + 5 : base - 161);
}

export function calcTdee(bmr: number, activity: ActivityLevel): number {
  return Math.round(bmr * ACTIVITY_FACTORS[activity]);
}

export function calcBmi(weightKg: number, heightCm: number): number {
  const m = heightCm / 100;
  return Math.round((weightKg / (m * m)) * 10) / 10;
}

export function latestWeight(weights: WeightEntry[], fallback: number): number {
  if (weights.length === 0) return fallback;
  return [...weights].sort((a, b) => a.date.localeCompare(b.date))[weights.length - 1].kg;
}

export interface Plan {
  daysLeft: number;
  currentKg: number;
  remainingKg: number;
  bmr: number;
  tdee: number;
  /** 目標達成に必要な1日の赤字 */
  requiredDeficit: number;
  /** 安全上限を考慮して実際に設定する赤字 */
  deficit: number;
  /** 1日の目標摂取カロリー */
  targetKcal: number;
  /** 必要ペースが安全上限を超えている */
  tooFast: boolean;
  /** 安全なペースで当日までに到達できそうな体重 */
  projectedKg: number;
}

export function calcPlan(profile: Profile, weights: WeightEntry[], today: string): Plan {
  const currentKg = latestWeight(weights, profile.startWeightKg);
  const daysLeft = Math.max(0, daysBetween(today, profile.eventDate));
  const remainingKg = Math.max(0, Math.round((currentKg - profile.targetWeightKg) * 10) / 10);
  const bmr = calcBmr(profile.sex, currentKg, profile.heightCm, profile.age);
  const tdee = calcTdee(bmr, profile.activity);

  const requiredDeficit =
    daysLeft > 0 ? Math.round((remainingKg * KCAL_PER_KG_FAT) / daysLeft) : 0;

  // 週あたり体重の1% と固定上限のうち小さい方を安全な赤字の上限にする
  const weeklyCap = (currentKg * MAX_WEEKLY_LOSS_RATIO * KCAL_PER_KG_FAT) / 7;
  const safeCap = Math.round(Math.min(MAX_DAILY_DEFICIT, weeklyCap));
  // 基礎代謝を下回る摂取量にはしない
  const floorCap = Math.max(0, tdee - bmr);
  const cap = Math.min(safeCap, floorCap);

  const deficit = Math.min(requiredDeficit, cap);
  const targetKcal = tdee - deficit;
  const projectedKg =
    Math.round((currentKg - (deficit * daysLeft) / KCAL_PER_KG_FAT) * 10) / 10;

  return {
    daysLeft,
    currentKg,
    remainingKg,
    bmr,
    tdee,
    requiredDeficit,
    deficit,
    targetKcal,
    tooFast: requiredDeficit > cap,
    projectedKg,
  };
}

/** 開始体重から目標体重までの進捗率（0〜1） */
export function progressRatio(startKg: number, currentKg: number, targetKg: number): number {
  const total = startKg - targetKg;
  if (total <= 0) return 1;
  return Math.min(1, Math.max(0, (startKg - currentKg) / total));
}

/** 昨日までで、目標カロリー以内に収まった日の連続日数（今日は途中なので数えない） */
export function calcStreak(kcalByDate: Map<string, number>, targetKcal: number, today: string): number {
  let streak = 0;
  for (let day = addDays(today, -1); ; day = addDays(day, -1)) {
    const kcal = kcalByDate.get(day);
    if (kcal === undefined || kcal > targetKcal) break;
    streak++;
  }
  return streak;
}
