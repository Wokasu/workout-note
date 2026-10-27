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

/** 決まった期間の「平均摂取 ＋ 体重（7日平均）の変化」から出した維持カロリー。記録が6割未満なら null */
function windowTdee(ma: Point[], intake: Map<string, number>, start: string, end: string): number | null {
  const a = valueAtOrBefore(ma, start);
  const b = valueAtOrBefore(ma, end);
  if (!a || !b || a.date < addDays(start, -3) || b.date < addDays(end, -3)) return null;
  const days = daysBetween(a.date, b.date);
  if (days < 7) return null;
  let total = 0;
  let logged = 0;
  for (let d = addDays(start, 1); d <= end; d = addDays(d, 1)) {
    const k = intake.get(d);
    if (k !== undefined && k > 0) {
      total += k;
      logged++;
    }
  }
  if (logged < daysBetween(start, end) * 0.6) return null;
  return total / logged + ((a.value - b.value) * KCAL_PER_KG) / days;
}

export interface MaintenanceStep {
  /** この日までの記録で更新した */
  date: string;
  /** 更新後の推定維持カロリー */
  tdee: number;
  /** その週に記録から計算した値（記録不足なら null） */
  observed: number | null;
  /** week：毎週の更新、calibration：確認期間の実測で合わせ直した */
  kind: 'week' | 'calibration';
}

export interface MaintenanceEstimate {
  tdee: number;
  /** 記録から更新できた週の数（確認期間を含む） */
  updates: number;
  /** 最後に更新した日（一度も更新していなければ null） */
  lastUpdate: string | null;
  history: MaintenanceStep[];
}

export const MAINTENANCE_WINDOW_DAYS = 14;
const SMOOTHING = 0.3;
const MAX_STEP_KCAL = 500;

/**
 * 推定維持カロリーを毎週更新する。
 * 計算式の値から始めて、毎週「直近14日の平均摂取 ＋ 体重（7日平均）の変化」で出した値へ30%ずつ近づける。
 * 体重は水分でぶれるので、1回の更新では ±500kcal を超えて動かさない。
 * 確認期間（維持カロリーで食べた期間）が終わった週は、その期間で測った値に合わせ直す。
 */
export function maintenanceEstimate(
  weights: Point[],
  intake: Map<string, number>,
  today: string,
  prior: number,
  calibrations: { start: string; end: string }[] = [],
  maxDays = 182,
): MaintenanceEstimate {
  const ma = movingAverage(weights);
  const logged = [...intake.entries()].filter(([, k]) => k > 0).map(([d]) => d).sort();
  const firstLog = logged.find((d) => d >= addDays(today, -maxDays));
  const history: MaintenanceStep[] = [];
  let tdee = prior;
  let updates = 0;
  if (!firstLog) return { tdee: Math.round(prior), updates: 0, lastUpdate: null, history };

  // 今日の食事は途中なので、昨日を最後の週の終わりにして7日ずつさかのぼる
  const ends: string[] = [];
  for (let end = addDays(today, -1); daysBetween(firstLog, end) >= MAINTENANCE_WINDOW_DAYS - 1; end = addDays(end, -7)) ends.unshift(end);

  let prev = addDays(firstLog, -1);
  for (const end of ends) {
    for (const c of calibrations) {
      if (c.end > prev && addDays(c.end, -1) <= end) {
        const r = calibratedTdee(weights, intake, c.start, c.end);
        if (r) {
          tdee = r.tdee;
          updates++;
          history.push({ date: addDays(c.end, -1), tdee: r.tdee, observed: r.tdee, kind: 'calibration' });
        }
      }
    }
    const observed = windowTdee(ma, intake, addDays(end, -MAINTENANCE_WINDOW_DAYS), end);
    if (observed !== null) {
      const clipped = Math.max(tdee - MAX_STEP_KCAL, Math.min(tdee + MAX_STEP_KCAL, observed));
      tdee += SMOOTHING * (clipped - tdee);
      updates++;
    }
    history.push({ date: end, tdee: Math.round(tdee), observed: observed === null ? null : Math.round(observed), kind: 'week' });
    prev = end;
  }
  const last = [...history].reverse().find((h) => h.observed !== null);
  return { tdee: Math.round(tdee), updates, lastUpdate: last?.date ?? null, history };
}

export interface QuickEstimate {
  tdee: number;
  /** 推定の幅（±kcal） */
  marginKcal: number;
  confidence: 'low' | 'medium' | 'high';
  /** 計算に使った食事の記録日数 */
  loggedDays: number;
  /** 記録が少なすぎて（1日の一部だけとみて）外した日数 */
  excludedDays: number;
  /** 計算に使った体重の記録回数 */
  weighIns: number;
  /** 期間（最初と最後の体重の日） */
  from: string;
  to: string;
  avgIntake: number;
  /** 体重の変化（kg/週、減れば負） */
  kgPerWeek: number;
}

/**
 * 今あるデータだけで維持カロリーを推定する（きっちり記録した期間がなくても出す）。
 * 直近 days 日のうち、食事を記録した日の平均摂取と、体重の直線の傾き（最小二乗）から
 * 「平均摂取 − 体重の変化 × 7200」を出し、データの量とばらつきから幅と信頼度をつける。
 * ふだんの6割に満たない日は1日の一部しか記録していないとみて外す。
 */
export function quickEstimate(weights: Point[], intake: Map<string, number>, today: string, days = 28): QuickEstimate | null {
  const end = addDays(today, -1);
  const start = addDays(today, -days);
  const logged = [...intake.entries()].filter(([d, k]) => d >= start && d <= end && k > 0).map(([, k]) => k);
  if (logged.length === 0) return null;
  const median = [...logged].sort((a, b) => a - b)[Math.floor(logged.length / 2)];
  const used = logged.filter((k) => k >= median * 0.6);
  const w = weights.filter((p) => p.date >= start && p.date <= end);
  if (used.length < 3 || w.length < 2) return null;
  const span = daysBetween(w[0].date, w[w.length - 1].date);
  if (span < 4) return null;

  // 体重の傾き（kg/日）と、その標準誤差
  const xs = w.map((p) => daysBetween(w[0].date, p.date));
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = w.reduce((a, p) => a + p.value, 0) / w.length;
  const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  const slope = xs.reduce((a, x, i) => a + (x - mx) * (w[i].value - my), 0) / sxx;
  const resid = w.map((p, i) => p.value - (my + slope * (xs[i] - mx)));
  // 点が少ないときは、体重の日々のぶれ（約0.5kg）を下限にして過信しない
  const sd = Math.max(0.5, w.length > 2 ? Math.sqrt(resid.reduce((a, r) => a + r * r, 0) / (w.length - 2)) : 0.5);
  const slopeErr = sd / Math.sqrt(sxx);

  const avgIntake = used.reduce((a, b) => a + b, 0) / used.length;
  const intakeSd = Math.sqrt(used.reduce((a, k) => a + (k - avgIntake) ** 2, 0) / Math.max(1, used.length - 1));
  const tdee = avgIntake - slope * KCAL_PER_KG;
  const margin = Math.sqrt((slopeErr * KCAL_PER_KG) ** 2 + (intakeSd / Math.sqrt(used.length)) ** 2);
  const marginKcal = Math.round(margin / 10) * 10;
  return {
    tdee: Math.round(tdee / 10) * 10,
    marginKcal,
    confidence: marginKcal <= 150 ? 'high' : marginKcal <= 350 ? 'medium' : 'low',
    loggedDays: used.length,
    excludedDays: logged.length - used.length,
    weighIns: w.length,
    from: w[0].date,
    to: w[w.length - 1].date,
    avgIntake: Math.round(avgIntake),
    kgPerWeek: Math.round(slope * 7 * 100) / 100,
  };
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
