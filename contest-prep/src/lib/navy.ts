import type { BodyFatSource, BodyRecord, Profile, Sex } from '../types';
import { movingAverage, seriesOf, valueAtOrBefore, type Point } from './analysis';

/**
 * 米海軍式（Hodgdon & Beckett）の体脂肪率。長さはすべて cm。
 * 男性：ウエスト（へその高さ）と首、女性：ウエスト（一番細いところ）・ヒップ・首。
 */
export function navyBodyFat(sex: Sex, heightCm: number, waistCm: number, neckCm: number, hipCm?: number): number | null {
  let bf: number;
  if (sex === 'male') {
    const d = waistCm - neckCm;
    if (d <= 0) return null;
    bf = 495 / (1.0324 - 0.19077 * Math.log10(d) + 0.15456 * Math.log10(heightCm)) - 450;
  } else {
    if (hipCm === undefined) return null;
    const d = waistCm + hipCm - neckCm;
    if (d <= 0) return null;
    bf = 495 / (1.29579 - 0.35004 * Math.log10(d) + 0.221 * Math.log10(heightCm)) - 450;
  }
  if (!Number.isFinite(bf) || bf < 1 || bf > 70) return null;
  return Math.round(bf * 10) / 10;
}

/** 海軍式の計算に必要なサイズ */
export function navyInputs(sex: Sex): ('waistCm' | 'neckCm' | 'hipCm')[] {
  return sex === 'male' ? ['waistCm', 'neckCm'] : ['waistCm', 'neckCm', 'hipCm'];
}

/** 記録のうち、サイズがそろっている日の海軍式体脂肪率 */
export function navySeries(body: BodyRecord[], profile: Pick<Profile, 'sex' | 'heightCm'>): Point[] {
  const out: Point[] = [];
  for (const r of [...body].sort((a, b) => a.date.localeCompare(b.date))) {
    if (r.waistCm === undefined || r.neckCm === undefined) continue;
    const bf = navyBodyFat(profile.sex, profile.heightCm, r.waistCm, r.neckCm, r.hipCm);
    if (bf !== null) out.push({ date: r.date, value: bf });
  }
  return out;
}

export interface BodyFatSeries {
  source: 'navy' | 'scale' | null;
  points: Point[];
}

/** 設定に従って使う体脂肪率の系列を選ぶ */
export function bodyFatSeries(body: BodyRecord[], profile: Pick<Profile, 'sex' | 'heightCm'>, pref: BodyFatSource): BodyFatSeries {
  const navy = navySeries(body, profile);
  const scale = seriesOf(body, 'bodyFatPct');
  if (pref === 'navy') return { source: navy.length ? 'navy' : null, points: navy };
  if (pref === 'scale') return { source: scale.length ? 'scale' : null, points: scale };
  if (navy.length) return { source: 'navy', points: navy };
  return { source: scale.length ? 'scale' : null, points: scale };
}

/** 体脂肪率の各日の除脂肪体重（その日の体重がなければ直前の7日平均を使う） */
export function leanSeries(body: BodyRecord[], fat: Point[]): Point[] {
  const weights = seriesOf(body, 'weightKg');
  const ma = movingAverage(weights);
  const out: Point[] = [];
  for (const p of fat) {
    const w = weights.find((x) => x.date === p.date)?.value ?? valueAtOrBefore(ma, p.date)?.value;
    if (w === undefined) continue;
    out.push({ date: p.date, value: Math.round(w * (1 - p.value / 100) * 10) / 10 });
  }
  return out;
}

/** 除脂肪量指数（FFMI）。身長差を補正した値も返す */
export function ffmi(leanKg: number, heightCm: number): { ffmi: number; normalized: number } {
  const m = heightCm / 100;
  const v = leanKg / (m * m);
  return { ffmi: Math.round(v * 10) / 10, normalized: Math.round((v + 6.1 * (1.8 - m)) * 10) / 10 };
}

/** 除脂肪量を保ったまま目標体脂肪率になる体重 */
export function weightAtBodyFat(leanKg: number, bodyFatPct: number): number {
  return Math.round((leanKg / (1 - bodyFatPct / 100)) * 10) / 10;
}

/** ボディビル・フィジークの大会でよく目安にされる体脂肪率 */
export const STAGE_BODY_FAT: Record<Sex, number[]> = {
  male: [4, 5, 6, 8, 10],
  female: [10, 12, 14, 16, 18],
};

export interface TargetOption {
  bodyFatPct: number;
  /** 除脂肪体重を保ったままこの体脂肪率になる体重 */
  weightKg: number;
  /** 大会までに必要な週あたり減量 */
  kgPerWeek: number;
  /** 今の体重に対する週あたり減量（%） */
  pctPerWeek: number;
  /** 減量ペースの上限内で届くか */
  withinCap: boolean;
}

/** 大会時の目標体重の目安（今より軽いものだけ、体脂肪率の低い順） */
export function targetOptions(
  sex: Sex,
  leanKg: number,
  currentKg: number,
  daysLeft: number,
  maxWeeklyLossPct: number,
): TargetOption[] {
  return STAGE_BODY_FAT[sex]
    .map((bodyFatPct) => {
      const weightKg = weightAtBodyFat(leanKg, bodyFatPct);
      const kgPerWeek = daysLeft > 0 ? ((currentKg - weightKg) / daysLeft) * 7 : Infinity;
      const pctPerWeek = (kgPerWeek / currentKg) * 100;
      return {
        bodyFatPct,
        weightKg,
        kgPerWeek: Math.round(kgPerWeek * 100) / 100,
        pctPerWeek: Math.round(pctPerWeek * 10) / 10,
        withinCap: pctPerWeek <= maxWeeklyLossPct + 1e-9,
      };
    })
    .filter((o) => o.weightKg < currentKg);
}

/** 上限ペース内で届く中で一番絞れた目安 */
export function recommendedOption(options: TargetOption[]): TargetOption | undefined {
  return options.find((o) => o.withinCap);
}

export interface ContestRange {
  /** 絞れた側（体脂肪率が低い方）の体脂肪率と体重 */
  lowBf: number;
  minKg: number;
  highBf: number;
  maxKg: number;
}

/** 推定コンテスト体重の幅：大会時の体脂肪率 ±1%（標準なら男性 4〜6%） */
export function contestRange(leanKg: number, centerBf: number): ContestRange {
  const lowBf = Math.max(1, centerBf - 1);
  const highBf = centerBf + 1;
  return { lowBf, minKg: weightAtBodyFat(leanKg, lowBf), highBf, maxKg: weightAtBodyFat(leanKg, highBf) };
}

export function formatContestRange(r: ContestRange): string {
  return `${r.minKg.toFixed(1)}〜${r.maxKg.toFixed(1)} kg`;
}
