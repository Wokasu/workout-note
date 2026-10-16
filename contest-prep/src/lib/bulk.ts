import type { BodyRecord, BulkSettings, Profile, Sex } from '../types';
import { KCAL_PER_KG, movingAverage, seriesOf, valueAtOrBefore } from './analysis';
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
  };
}

export type BulkState = 'bulk' | 'minicut';

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

/** 増量中の余剰カロリー：始めた週は start、以後毎週 ramp ずつ、max まで */
export function surplusFor(s: BulkSettings, weeksInPhase: number): number {
  return Math.min(s.maxSurplusKcal, s.startSurplusKcal + s.rampKcal * Math.max(0, weeksInPhase));
}

/** プチダイエットの1日の赤字 */
export function miniCutDeficit(s: BulkSettings, weightKg: number): number {
  return Math.round((((weightKg * s.miniCutPct) / 100) * KCAL_PER_KG) / 7);
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
  /** 上限までの残り（kg） */
  roomKg: number | null;
}

/**
 * 増量を始めた日から体重の7日平均をたどって、今が増量中かプチダイエット中かを決める。
 * 上限はその日までにわかっている除脂肪体重で計算する（筋肉が増えれば上限も上がる）。
 */
export function bulkStatus(
  profile: Pick<Profile, 'sex' | 'heightCm' | 'bodyFatSource' | 'bulk'>,
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

  let state: BulkState = 'bulk';
  let since = s.startDate;
  for (const p of movingAverage(seriesOf(body, 'weightKg'))) {
    if (p.date < s.startDate || p.date > today) continue;
    const lim = limitsAt(p.date);
    if (!lim) continue;
    if (state === 'bulk' && p.value >= lim.ceilingKg) {
      state = 'minicut';
      since = p.date;
    } else if (state === 'minicut' && p.value <= lim.lowerKg) {
      state = 'bulk';
      since = p.date;
    }
  }
  const weeksInPhase = Math.max(0, Math.floor(daysBetween(since, today) / 7));
  const limits = leanNow !== null ? bulkLimits(leanNow, s) : limitsAt(today);
  return {
    state,
    since,
    weeksInPhase,
    limits,
    adjustKcal: state === 'bulk' ? surplusFor(s, weeksInPhase) : -miniCutDeficit(s, currentKg),
    roomKg: limits ? Math.round((limits.ceilingKg - currentKg) * 10) / 10 : null,
  };
}

export interface ProjectionWeek {
  date: string;
  state: BulkState;
  intakeKcal: number;
  weightKg: number;
}

/**
 * これからの見込み。今の維持カロリーから、体重 1kg あたり kcalPerKg ずつ消費が増減するとして、
 * 増量とプチダイエットの切り替えをくり返したときの週ごとの体重と摂取カロリーを出す。
 * 除脂肪体重（＝上限）は今のまま変わらないと仮定する。
 */
export function projectBulk(
  s: BulkSettings,
  status: BulkStatus,
  currentKg: number,
  tdee: number,
  kcalPerKg: number,
  today: string,
  weeks = 26,
): ProjectionWeek[] {
  const out: ProjectionWeek[] = [];
  let w = currentKg;
  let state = status.state;
  let since = status.since;
  for (let day = 0; day <= weeks * 7; day++) {
    const date = addDays(today, day);
    const maintenance = tdee + kcalPerKg * (w - currentKg);
    const adjust = state === 'bulk' ? surplusFor(s, Math.floor(daysBetween(since, date) / 7)) : -miniCutDeficit(s, w);
    const intake = Math.round(maintenance + adjust);
    if (day % 7 === 0) out.push({ date, state, intakeKcal: intake, weightKg: Math.round(w * 10) / 10 });
    w += (intake - maintenance) / KCAL_PER_KG;
    if (status.limits) {
      if (state === 'bulk' && w >= status.limits.ceilingKg) {
        state = 'minicut';
        since = date;
      } else if (state === 'minicut' && w <= status.limits.lowerKg) {
        state = 'bulk';
        since = date;
      }
    }
  }
  return out;
}
