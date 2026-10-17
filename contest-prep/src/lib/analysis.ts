import type { BodyField, BodyRecord, FoodLog } from '../types';
import { addDays, daysBetween } from './date';
import { kcalOf } from './macros';

/** 体脂肪 1kg あたりのエネルギー量（kcal） */
export const KCAL_PER_KG = 7200;

export interface Point {
  date: string;
  value: number;
}

export function seriesOf(body: BodyRecord[], key: BodyField): Point[] {
  return body
    .filter((r) => typeof r[key] === 'number')
    .map((r) => ({ date: r.date, value: r[key] as number }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** 直近 windowDays 日（その日を含む）の平均。水分による日々のブレをならす */
export function movingAverage(points: Point[], windowDays = 7): Point[] {
  return points.map((p) => {
    const from = addDays(p.date, -(windowDays - 1));
    const inWindow = points.filter((q) => q.date >= from && q.date <= p.date);
    const avg = inWindow.reduce((s, q) => s + q.value, 0) / inWindow.length;
    return { date: p.date, value: Math.round(avg * 100) / 100 };
  });
}

/** date 以前で最も新しい点 */
export function valueAtOrBefore(points: Point[], date: string): Point | undefined {
  let found: Point | undefined;
  for (const p of points) {
    if (p.date > date) break;
    found = p;
  }
  return found;
}

export interface Rate {
  /** 週あたりの変化量（kg、減ればマイナス） */
  kgPerWeek: number;
  /** 週あたりの変化率（%） */
  pctPerWeek: number;
}

/** 7日平均どうしを比べた直近の週あたり変化 */
export function recentRate(weights: Point[], today: string, spanDays = 14): Rate | null {
  const ma = movingAverage(weights);
  const end = valueAtOrBefore(ma, today);
  if (!end) return null;
  const start = valueAtOrBefore(ma, addDays(end.date, -spanDays));
  if (!start) return null;
  const days = daysBetween(start.date, end.date);
  // 比較する2点が近すぎると誤差ばかりになる
  if (days < 7) return null;
  const kgPerWeek = ((end.value - start.value) / days) * 7;
  return {
    kgPerWeek: Math.round(kgPerWeek * 100) / 100,
    pctPerWeek: Math.round((kgPerWeek / start.value) * 1000) / 10,
  };
}

export function kcalByDate(logs: FoodLog[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const l of logs) map.set(l.date, (map.get(l.date) ?? 0) + kcalOf(l));
  return map;
}

export interface TdeeEstimate {
  tdee: number;
  avgIntake: number;
  days: number;
  loggedDays: number;
}

/**
 * 実際の消費カロリーを推定する。
 * 期間中の平均摂取カロリー ＋ 体重（7日平均）の減少分のカロリー ＝ 消費カロリー
 * 食事を記録した日が少ないと当てにならないので、7割以上記録した期間だけ使う。
 */
export function estimateTdee(
  weights: Point[],
  intake: Map<string, number>,
  today: string,
  windowDays = 21,
): TdeeEstimate | null {
  const ma = movingAverage(weights);
  // 今日の食事は途中なので、昨日までで計算する
  const end = valueAtOrBefore(ma, addDays(today, -1));
  if (!end) return null;
  const start = valueAtOrBefore(ma, addDays(end.date, -windowDays));
  if (!start) return null;
  const days = daysBetween(start.date, end.date);
  if (days < 14) return null;

  let total = 0;
  let loggedDays = 0;
  for (let d = addDays(start.date, 1); d <= end.date; d = addDays(d, 1)) {
    const k = intake.get(d);
    if (k !== undefined && k > 0) {
      total += k;
      loggedDays++;
    }
  }
  if (loggedDays < days * 0.7) return null;

  const avgIntake = total / loggedDays;
  const tdee = avgIntake + ((start.value - end.value) * KCAL_PER_KG) / days;
  return { tdee: Math.round(tdee), avgIntake: Math.round(avgIntake), days, loggedDays };
}

/**
 * キャリブレーション期間（維持カロリーで食べた期間）の結果から、実際の維持カロリーを出す。
 * 期間の初めと終わりの体重（7日平均）の差と、期間中の平均摂取カロリーから計算する。
 * 7日以上たっていて、食事を7割以上記録しているときだけ。
 */
export function calibratedTdee(weights: Point[], intake: Map<string, number>, start: string, end: string): TdeeEstimate | null {
  const ma = movingAverage(weights);
  const first = ma.find((p) => p.date >= start && p.date <= end);
  const last = valueAtOrBefore(ma, end);
  if (!first || !last || last.date < start) return null;
  const days = daysBetween(first.date, last.date);
  if (days < 7) return null;
  let total = 0;
  let loggedDays = 0;
  for (let d = start; d < end; d = addDays(d, 1)) {
    const k = intake.get(d);
    if (k !== undefined && k > 0) {
      total += k;
      loggedDays++;
    }
  }
  const span = daysBetween(start, end);
  if (loggedDays < span * 0.7) return null;
  const avgIntake = total / loggedDays;
  const tdee = avgIntake + ((first.value - last.value) * KCAL_PER_KG) / days;
  return { tdee: Math.round(tdee), avgIntake: Math.round(avgIntake), days: span, loggedDays };
}

/** その日が属する週の月曜日 */
export function mondayOf(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDays(date, -((dow + 6) % 7));
}

export interface WeekSummary {
  weekStart: string;
  avgWeight: number | null;
  /** 前の週の平均体重との差 */
  change: number | null;
  changePct: number | null;
  avgWaist: number | null;
  avgBodyFat: number | null;
  loggedDays: number;
  avgKcal: number | null;
  avgP: number | null;
  avgF: number | null;
  avgC: number | null;
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10;
}

/** 週ごとのまとめ（新しい週が先頭） */
export function weeklySummary(body: BodyRecord[], logs: FoodLog[], today: string, weeks = 12): WeekSummary[] {
  const result: WeekSummary[] = [];
  const thisMonday = mondayOf(today);
  for (let i = weeks; i >= 0; i--) {
    const weekStart = addDays(thisMonday, -7 * i);
    const weekEnd = addDays(weekStart, 6);
    const inWeek = (d: string) => d >= weekStart && d <= weekEnd && d <= today;
    const recs = body.filter((r) => inWeek(r.date));
    const pick = (k: BodyField) => recs.map((r) => r[k]).filter((v): v is number => typeof v === 'number');

    // 今日の分は食べている途中なので週平均には入れない
    const dayTotals = new Map<string, { p: number; f: number; c: number }>();
    for (const l of logs) {
      if (!inWeek(l.date) || l.date === today) continue;
      const t = dayTotals.get(l.date) ?? { p: 0, f: 0, c: 0 };
      t.p += l.p;
      t.f += l.f;
      t.c += l.c;
      dayTotals.set(l.date, t);
    }
    const totals = [...dayTotals.values()];

    result.push({
      weekStart,
      avgWeight: avg(pick('weightKg')),
      change: null,
      changePct: null,
      avgWaist: avg(pick('waistCm')),
      avgBodyFat: avg(pick('bodyFatPct')),
      loggedDays: totals.length,
      avgKcal: totals.length ? Math.round(totals.reduce((s, t) => s + kcalOf(t), 0) / totals.length) : null,
      avgP: avg(totals.map((t) => t.p)),
      avgF: avg(totals.map((t) => t.f)),
      avgC: avg(totals.map((t) => t.c)),
    });
  }
  for (let i = 1; i < result.length; i++) {
    const prev = result[i - 1].avgWeight;
    const cur = result[i].avgWeight;
    if (prev !== null && cur !== null) {
      result[i].change = Math.round((cur - prev) * 10) / 10;
      result[i].changePct = Math.round(((cur - prev) / prev) * 1000) / 10;
    }
  }
  // 記録のない古い週は省く
  const firstUsed = result.findIndex((w) => w.avgWeight !== null || w.loggedDays > 0);
  return (firstUsed === -1 ? [] : result.slice(firstUsed)).reverse();
}
