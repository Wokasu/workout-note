import type { BodyRecord, BulkSettings, Profile, Sex } from '../types';
import { KCAL_PER_KG, movingAverage, recentRate, seriesOf, valueAtOrBefore, type Point } from './analysis';
import { addDays, daysBetween } from './date';
import { bodyFatSeries, leanSeries, weightAtBodyFat } from './navy';

/**
 * 増量期の計画。
 * 上限体重 ＝ 今の除脂肪体重から出したコンテスト体重 ＋ 幅（標準 10kg）。
 * 余剰カロリーを週ごとに少しずつ増やし、体重（7日平均）が上限に達したらプチダイエットで
 * 「上限 − 戻す幅」まで落とし、また増量に戻る。これをくり返して波をつける。
 */

export function defaultBulkSettings(sex: Sex, today: string): BulkSettings {
  return {
    startDate: today,
    stageBodyFatPct: sex === 'male' ? 5 : 12,
    ceilingMarginKg: 10,
    returnKg: 3,
    startSurplusKcal: 100,
    rampKcal: 50,
    maxSurplusKcal: 500,
    miniCutPct: 0.75,
    gainKgPerMonth: 1,
    prepPaceMinKg: 2,
    prepPaceMaxKg: 3,
  };
}

/** 増量中・維持カロリーの確認中（プチダイエット前）・プチダイエット中 */
export type BulkState = 'bulk' | 'calibrate' | 'minicut';

export interface BulkLimits {
  leanKg: number;
  /** 除脂肪体重を保って大会時の体脂肪率になる体重 */
  contestKg: number;
  /** これを超えたらプチダイエット */
  ceilingKg: number;
  /** プチダイエットでここまで落とす */
  lowerKg: number;
}

export function bulkLimits(leanKg: number, s: BulkSettings): BulkLimits {
  const contestKg = weightAtBodyFat(leanKg, s.stageBodyFatPct);
  const ceilingKg = Math.round((contestKg + s.ceilingMarginKg) * 10) / 10;
  return { leanKg, contestKg, ceilingKg, lowerKg: Math.round((ceilingKg - s.returnKg) * 10) / 10 };
}

export const DAYS_PER_MONTH = 30.4;

/** 目標ペースで増えるのに必要な余剰カロリー（kcal/日） */
export function paceSurplus(s: BulkSettings): number {
  return Math.round((s.gainKgPerMonth * KCAL_PER_KG) / DAYS_PER_MONTH);
}

/** プチダイエットの1日の赤字 */
export function miniCutDeficit(s: BulkSettings, weightKg: number): number {
  return Math.round((((weightKg * s.miniCutPct) / 100) * KCAL_PER_KG) / 7);
}

/** 余剰カロリーを今週どうしたか */
export type SurplusMove = 'start' | 'up' | 'hold' | 'down' | 'max';

/**
 * 増量中の余剰カロリー。始めた週は start、以後は週ごとに直近の増え方（7日平均の2週間の変化）を見て、
 * 目標ペースの 3/4 未満なら ramp だけ増やし、1.5 倍を超えたら ramp だけ減らし、その間なら据え置く。
 */
export function bulkSurplus(s: BulkSettings, weights: Point[], since: string, today: string): { kcal: number; move: SurplusMove } {
  const targetPerWeek = (s.gainKgPerMonth * 7) / DAYS_PER_MONTH;
  let kcal = s.startSurplusKcal;
  let move: SurplusMove = 'start';
  const weeks = Math.max(0, Math.floor(daysBetween(since, today) / 7));
  for (let k = 1; k <= weeks; k++) {
    const rate = recentRate(weights, addDays(since, 7 * k));
    if (!rate || rate.kgPerWeek < targetPerWeek * 0.75) {
      kcal += s.rampKcal;
      move = 'up';
    } else if (rate.kgPerWeek > targetPerWeek * 1.5) {
      kcal -= s.rampKcal;
      move = 'down';
    } else {
      move = 'hold';
    }
    kcal = Math.max(0, Math.min(s.maxSurplusKcal, kcal));
    if (move === 'up' && kcal === s.maxSurplusKcal) move = 'max';
  }
  return { kcal, move };
}

export interface BulkStatus {
  state: BulkState;
  /** 今の状態になった日 */
  since: string;
  weeksInPhase: number;
  /** 上限（体脂肪率がなければ null で、上限なしの増量になる） */
  limits: BulkLimits | null;
  /** 維持カロリーに足す量（プチダイエット中はマイナス） */
  adjustKcal: number;
  /** 増量中、余剰カロリーを今週どうしたか */
  surplusMove: SurplusMove | null;
  /** 上限までの残り（kg） */
  roomKg: number | null;
  /** 一番新しいキャリブレーション期間（終わっていなければ end は予定日） */
  calibration: { start: string; end: string } | null;
}

/**
 * 増量を始めた日から体重の7日平均をたどって、今が増量中かプチダイエット中かを決める。
 * 上限はその日までにわかっている除脂肪体重で計算する（筋肉が増えれば上限も上がる）。
 */
export function bulkStatus(
  profile: Pick<Profile, 'sex' | 'heightCm' | 'bodyFatSource' | 'bulk' | 'calibrationDays'>,
  body: BodyRecord[],
  currentKg: number,
  today: string,
  /** 今日の除脂肪体重（画面のほかの場所と同じ値で今日の上限を出すため） */
  leanNow: number | null = null,
): BulkStatus {
  const s = profile.bulk;
  const lean = leanSeries(body, bodyFatSeries(body, profile, profile.bodyFatSource).points);
  const limitsAt = (date: string) => {
    const l = valueAtOrBefore(lean, date) ?? lean[0];
    return l ? bulkLimits(l.value, s) : null;
  };
  const weights = seriesOf(body, 'weightKg');

  const cal = profile.calibrationDays;
  let state: BulkState = 'bulk';
  let since = s.startDate;
  let calibration: BulkStatus['calibration'] = null;
  // 上限に届いたら、キャリブレーション（あれば）→ プチダイエット → 戻す線で増量に戻る
  const finishCalibration = (date: string) => {
    if (state === 'calibrate' && daysBetween(since, date) >= cal) {
      state = 'minicut';
      since = addDays(since, cal);
    }
  };
  for (const p of movingAverage(weights)) {
    if (p.date < s.startDate || p.date > today) continue;
    finishCalibration(p.date);
    const lim = limitsAt(p.date);
    if (!lim) continue;
    if (state === 'bulk' && p.value >= lim.ceilingKg) {
      state = cal > 0 ? 'calibrate' : 'minicut';
      since = p.date;
      if (cal > 0) calibration = { start: p.date, end: addDays(p.date, cal) };
    } else if (state === 'minicut' && p.value <= lim.lowerKg) {
      state = 'bulk';
      since = p.date;
    }
  }
  finishCalibration(today);
  const weeksInPhase = Math.max(0, Math.floor(daysBetween(since, today) / 7));
  const limits = leanNow !== null ? bulkLimits(leanNow, s) : limitsAt(today);
  const surplus = state === 'bulk' ? bulkSurplus(s, weights, since, today) : null;
  return {
    state,
    since,
    weeksInPhase,
    limits,
    adjustKcal: surplus ? surplus.kcal : state === 'calibrate' ? 0 : -miniCutDeficit(s, currentKg),
    surplusMove: surplus?.move ?? null,
    roomKg: limits ? Math.round((limits.ceilingKg - currentKg) * 10) / 10 : null,
    calibration,
  };
}

/** 見込みの状態：増量期の3つに、大会前の維持確認と大会減量を加えたもの */
export type PlanState = BulkState | 'prepCalibrate' | 'prep';

export interface PlanDay {
  date: string;
  state: PlanState;
  intakeKcal: number;
  weightKg: number;
}

interface SimOptions {
  s: BulkSettings;
  calibrationDays: number;
  status: BulkStatus;
  currentKg: number;
  /** 今の維持カロリー */
  tdee: number;
  /** 体重 1kg あたりの維持カロリーの増減 */
  kcalPerKg: number;
  today: string;
  /** この日まで（含まない） */
  until: string;
  /** 大会に向けた減量（維持確認を含む）を始める日。なければ増量を続ける */
  prepStart?: string | null;
  contestDate?: string;
  contestKg?: number;
}

/**
 * 1日ずつの見込み。今の維持カロリーから、体重 1kg あたり kcalPerKg ずつ消費が増減するとして計算する。
 * 増量中の余剰は今日の値から、目標ペースに必要な量へ週 ramp ずつ近づける（体重が目標ペースで増える）。
 * 除脂肪体重（＝上限）は今のまま変わらないと仮定する。
 */
function simulate(o: SimOptions): PlanDay[] {
  const { s, calibrationDays: cal, status, currentKg, tdee, kcalPerKg, today } = o;
  const pace = Math.min(paceSurplus(s), s.maxSurplusKcal);
  const out: PlanDay[] = [];
  let w = currentKg;
  let state: PlanState = status.state;
  let since = status.since;
  let surplus = status.state === 'bulk' ? status.adjustKcal : s.startSurplusKcal;
  for (let date = today; date < o.until; date = addDays(date, 1)) {
    const maintenance = tdee + kcalPerKg * (w - currentKg);
    if (o.prepStart && date >= o.prepStart && state !== 'prepCalibrate' && state !== 'prep') {
      state = cal > 0 ? 'prepCalibrate' : 'prep';
      since = date;
    }
    if (state === 'prepCalibrate' && daysBetween(since, date) >= cal) {
      state = 'prep';
      since = date;
    }
    if (state === 'calibrate' && daysBetween(since, date) >= cal) {
      state = 'minicut';
      since = date;
    }
    // 増量中は週の変わり目で余剰を目標ペースの量に近づける
    if (state === 'bulk' && date !== since && daysBetween(since, date) % 7 === 0 && date !== today) {
      surplus = surplus < pace ? Math.min(pace, surplus + s.rampKcal) : Math.max(pace, surplus - s.rampKcal);
    }
    let adjust = 0;
    if (state === 'bulk') adjust = surplus;
    else if (state === 'minicut') adjust = -miniCutDeficit(s, w);
    else if (state === 'prep' && o.contestDate && o.contestKg !== undefined) {
      // 大会当日にコンテスト体重になるよう、残りの日数で割った赤字
      const left = Math.max(1, daysBetween(date, o.contestDate));
      adjust = -Math.max(0, Math.round(((w - o.contestKg) / left) * KCAL_PER_KG));
    }
    const intake = Math.round(maintenance + adjust);
    out.push({ date, state, intakeKcal: intake, weightKg: Math.round(w * 10) / 10 });
    w += (intake - maintenance) / KCAL_PER_KG;
    if (status.limits && (state === 'bulk' || state === 'minicut')) {
      if (state === 'bulk' && w >= status.limits.ceilingKg) {
        state = cal > 0 ? 'calibrate' : 'minicut';
        since = addDays(date, 1);
      } else if (state === 'minicut' && w <= status.limits.lowerKg) {
        state = 'bulk';
        since = addDays(date, 1);
        surplus = s.startSurplusKcal;
      }
    }
  }
  return out;
}

export interface PrepStart {
  /** 減量（維持確認を含む）を始める日 */
  date: string;
  /** その日の見込み体重 */
  weightKg: number;
  /** 大会までに落とす量 */
  lossKg: number;
  /** もうその日を過ぎている（今日から始めても、このペースでは間に合わない） */
  overdue: boolean;
}

/**
 * 増量を続けた場合の見込み体重から、「この日に減量を始めれば、月 paceKg のペースで大会当日にコンテスト体重になる」
 * 一番遅い日を探す。維持確認の日数は減量に使えない日として差し引く。
 */
export function findPrepStart(days: PlanDay[], contestKg: number, contestDate: string, calibrationDays: number, paceKgPerMonth: number): PrepStart | null {
  let found: PlanDay | null = null;
  for (const d of days) {
    if (d.date >= contestDate) break;
    const lossDays = daysBetween(d.date, contestDate) - calibrationDays;
    const possible = lossDays > 0 ? (paceKgPerMonth / DAYS_PER_MONTH) * lossDays : 0;
    if (d.weightKg - contestKg > possible) break;
    found = d;
  }
  const first = days[0];
  if (!first) return null;
  const pick = found ?? first;
  return {
    date: pick.date,
    weightKg: pick.weightKg,
    lossKg: Math.round((pick.weightKg - contestKg) * 10) / 10,
    overdue: found === null || found === first,
  };
}

export interface ContestPlan {
  /** 月 prepPaceMinKg で落とす場合（早めに始める） */
  early: PrepStart;
  /** 月 prepPaceMaxKg で落とす場合（遅くともこの日） */
  late: PrepStart;
  contestDate: string;
  contestKg: number;
}

/**
 * これからの見込み。大会日とコンテスト体重がわかれば、減量に入る時期（月2〜3kg ペース）を出し、
 * 早めの方の日で増量を終えて、維持確認 → 大会減量 → 大会までを描く。
 */
export function planAhead(
  o: Omit<SimOptions, 'until' | 'prepStart'>,
  defaultWeeks = 26,
): { days: PlanDay[]; contest: ContestPlan | null } {
  const { contestDate, contestKg } = o;
  const hasContest = !!contestDate && contestKg !== undefined && daysBetween(o.today, contestDate) > o.calibrationDays;
  if (!hasContest) return { days: simulate({ ...o, until: addDays(o.today, defaultWeeks * 7) }), contest: null };
  const bulkOnly = simulate({ ...o, until: contestDate });
  const early = findPrepStart(bulkOnly, contestKg, contestDate, o.calibrationDays, o.s.prepPaceMinKg)!;
  const late = findPrepStart(bulkOnly, contestKg, contestDate, o.calibrationDays, o.s.prepPaceMaxKg)!;
  const days = simulate({ ...o, until: addDays(contestDate, 1), prepStart: early.date });
  return { days, contest: { early, late, contestDate, contestKg } };
}

/** 週ごとの行（各週の最初の日）。状態が週の途中で変わったときもその日を入れる */
export function weeklyRows(days: PlanDay[]): PlanDay[] {
  return days.filter((d, i) => i % 7 === 0 || d.state !== days[i - 1].state || i === days.length - 1);
}

/** 増量期の見込みと、大会に向けた減量の開始時期（画面用のまとめ） */
export function bulkPlanFor(
  profile: Pick<Profile, 'bulk' | 'calibrationDays' | 'activityFactor' | 'contestDate'>,
  t: { bulk: BulkStatus | null; currentKg: number; tdee: number },
  today: string,
): { days: PlanDay[]; contest: ContestPlan | null } | null {
  if (!t.bulk) return null;
  return planAhead({
    s: profile.bulk,
    calibrationDays: profile.calibrationDays,
    status: t.bulk,
    currentKg: t.currentKg,
    tdee: t.tdee,
    // 維持カロリーは体重 1kg あたり「10kcal × 活動係数」ずつ変わるとみる（Mifflin-St Jeor 式の傾き）
    kcalPerKg: 10 * profile.activityFactor,
    today,
    contestDate: profile.contestDate > today ? profile.contestDate : undefined,
    contestKg: t.bulk.limits?.contestKg,
  });
}
