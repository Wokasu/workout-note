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
