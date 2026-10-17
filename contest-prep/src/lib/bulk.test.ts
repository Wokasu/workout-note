import { describe, expect, it } from 'vitest';
import type { BodyRecord, Profile } from '../types';
import { bulkLimits, bulkStatus, bulkSurplus, defaultBulkSettings, findPrepStart, miniCutDeficit, paceSurplus, planAhead, weeklyRows } from './bulk';
import { seriesOf } from './analysis';
import { addDays } from './date';
import { calcTargets } from './nutrition';

const settings = { ...defaultBulkSettings('male', '2026-09-01') };
const profile: Profile = {
  phase: 'bulk',
  bulk: settings,
  sex: 'male',
  age: 30,
  heightCm: 172,
  contestName: '',
  contestDate: '2027-06-01',
  prepStartDate: '2027-02-01',
  startWeightKg: 76,
  targetWeightKg: 72,
  bodyFatSource: 'scale',
  activityFactor: 1.55,
  proteinPerKg: 2.2,
  fatPct: 25,
  maxWeeklyLossPct: 1,
  tdeeMode: 'formula',
  manualMacros: null,
  calibrationDays: 0,
};

/** 除脂肪 68kg（体重 × (1 - 体脂肪率) が 68 になるよう体脂肪率も入れる） */
function days(start: string, weights: number[]): BodyRecord[] {
  return weights.map((w, i) => ({ date: addDays(start, i), weightKg: w, bodyFatPct: Math.round((1 - 68 / w) * 1000) / 10 }));
}

describe('bulk limits', () => {
  it('puts the ceiling 10kg above the contest weight', () => {
    expect(bulkLimits(68, settings)).toEqual({ leanKg: 68, contestKg: 71.6, ceilingKg: 81.6, lowerKg: 78.6 });
  });

  it('knows the surplus for the target pace and the mini cut deficit', () => {
    expect(paceSurplus(settings)).toBe(237); // 月1kg
    expect(miniCutDeficit(settings, 82)).toBe(633);
  });
});

describe('bulkSurplus', () => {
  const weightsOf = (perDay: number) => seriesOf(days('2026-08-01', Array.from({ length: 80 }, (_, i) => 78 + i * perDay)), 'weightKg');

  it('keeps ramping while the gain is too slow, up to the max', () => {
    expect(bulkSurplus(settings, weightsOf(0), '2026-09-01', '2026-09-22')).toEqual({ kcal: 250, move: 'up' });
    expect(bulkSurplus(settings, weightsOf(0), '2026-09-01', '2026-10-27')).toEqual({ kcal: 500, move: 'max' });
  });

  it('holds once the gain reaches the target pace', () => {
    // 1日0.033kg ≒ 月1kg
    expect(bulkSurplus(settings, weightsOf(0.033), '2026-09-01', '2026-09-29')).toEqual({ kcal: 100, move: 'hold' });
  });

  it('steps down when the gain is far too fast', () => {
    // 1日0.1kg ≒ 月3kg
    expect(bulkSurplus(settings, weightsOf(0.1), '2026-09-01', '2026-09-15')).toEqual({ kcal: 0, move: 'down' });
  });

  it('follows a faster target pace', () => {
    const fast = { ...settings, gainKgPerMonth: 2 };
    expect(bulkSurplus(fast, weightsOf(0.033), '2026-09-01', '2026-09-29').move).toBe('up');
  });
});

describe('bulkStatus', () => {
  it('is bulking below the ceiling, with the surplus for the week', () => {
    const body = days('2026-09-01', Array.from({ length: 22 }, (_, i) => 78 + i * 0.03));
    const st = bulkStatus(profile, body, 78.6, '2026-09-22');
    expect(st.state).toBe('bulk');
    expect(st.weeksInPhase).toBe(3);
    // 1〜2週目は増え方がまだ目標に届かず +50 ずつ、3週目は目標ペース（月1kg）前後で増えているので据え置き
    expect(st.adjustKcal).toBe(200);
    expect(st.surplusMove).toBe('hold');
    expect(st.limits?.ceilingKg).toBeCloseTo(81.6, 0);
    expect(st.roomKg).toBeGreaterThan(2);
  });

  it('switches to a mini cut at the ceiling and back to bulk at the lower line', () => {
    // 80 → 82（上限超え）→ 78（戻す線より下）→ 79
    const up = Array.from({ length: 20 }, (_, i) => 80 + i * 0.1);
    const down = Array.from({ length: 40 }, (_, i) => 82 - i * 0.1);
    const body = days('2026-09-01', [...up, ...down]);
    const mid = bulkStatus(profile, body, 81.5, addDays('2026-09-01', 25));
    expect(mid.state).toBe('minicut');
    expect(mid.adjustKcal).toBe(-miniCutDeficit(settings, 81.5));
    const end = bulkStatus(profile, body, 78.2, addDays('2026-09-01', 59));
    expect(end.state).toBe('bulk');
    expect(end.weeksInPhase).toBe(0);
    expect(end.adjustKcal).toBe(100);
  });

  it("uses today's lean mass for today's ceiling when given", () => {
    const body = days('2026-09-01', [78, 78.2]);
    expect(bulkStatus(profile, body, 78.1, '2026-09-02', 69).limits?.ceilingKg).toBe(82.6);
  });

  it('bulks without a ceiling when body fat is unknown', () => {
    const body: BodyRecord[] = [{ date: '2026-09-01', weightKg: 85 }];
    const st = bulkStatus(profile, body, 85, '2026-09-15');
    expect(st.limits).toBeNull();
    expect(st.state).toBe('bulk');
    expect(st.adjustKcal).toBe(200);
  });
});

describe('planAhead', () => {
  const base = { s: settings, calibrationDays: 0, currentKg: 79, tdee: 2800, kcalPerKg: 15.5, today: '2026-09-03' };
  const st = () => bulkStatus(profile, days('2026-09-01', [79, 79, 79]), 79, '2026-09-03');

  it('waves between the ceiling and the lower line when there is no contest', () => {
    const { days: d, contest } = planAhead({ ...base, status: st() }, 52);
    expect(contest).toBeNull();
    const states = d.map((w) => w.state);
    expect(states).toContain('minicut');
    expect(states.lastIndexOf('bulk')).toBeGreaterThan(states.indexOf('minicut'));
    for (const w of d) expect(w.weightKg).toBeLessThanOrEqual(81.6 + 0.2);
    // 増量中は摂取が週ごとに増えていく（目標ペースの量まで）
    const rows = weeklyRows(d);
    expect(rows[1].intakeKcal).toBeGreaterThan(rows[0].intakeKcal);
  });

  it('ends the bulk in time to reach the contest weight at 2-3kg a month', () => {
    const { days: d, contest } = planAhead({ ...base, calibrationDays: 14, status: st(), contestDate: '2027-06-01', contestKg: 71.6 });
    expect(contest).not.toBeNull();
    const { early, late } = contest!;
    expect(early.date < late.date).toBe(true);
    expect(early.overdue).toBe(false);
    // 早めの日：月2kgで、維持確認14日を除いた日数で落としきれる
    const lossDays = (Date.parse('2027-06-01') - Date.parse(early.date)) / 86_400_000 - 14;
    expect(early.lossKg).toBeLessThanOrEqual((2 / 30.4) * lossDays + 0.1);
    // 見込みは 増量… → 維持確認 → 大会減量 で終わり、大会当日にコンテスト体重
    const order = d.map((x) => x.state).filter((s, i, a) => i === 0 || s !== a[i - 1]);
    expect(order.slice(-2)).toEqual(['prepCalibrate', 'prep']);
    expect(d.find((x) => x.state === 'prepCalibrate')!.date).toBe(early.date);
    expect(d.at(-1)!.date).toBe('2027-06-01');
    expect(d.at(-1)!.weightKg).toBeCloseTo(71.6, 0);
  });

  it('is overdue when the contest is too close for the needed loss', () => {
    const p = findPrepStart(
      [{ date: '2026-09-03', state: 'bulk', intakeKcal: 3000, weightKg: 85 }],
      71.6,
      '2026-11-01',
      14,
      3,
    );
    expect(p?.overdue).toBe(true);
    expect(p?.date).toBe('2026-09-03');
  });
});

describe('calcTargets in bulk', () => {
  it('adds the surplus to maintenance', () => {
    const body = days('2026-09-01', Array.from({ length: 22 }, () => 78));
    const t = calcTargets(profile, body, new Map(), '2026-09-22');
    expect(t.bulk?.state).toBe('bulk');
    expect(t.kcal).toBe(t.tdee + 250);
    expect(t.deficit).toBe(0);
    expect(t.tooFast).toBe(false);
  });
});

describe('calibration before a mini cut', () => {
  const withCal: Profile = { ...profile, calibrationDays: 14 };
  const up = Array.from({ length: 20 }, (_, i) => 80 + i * 0.1); // 9/1〜9/20、9/16ごろ7日平均が上限81.6を超える
  const flat = Array.from({ length: 30 }, () => 82);

  it('eats at maintenance for 14 days after hitting the ceiling, then mini cuts', () => {
    const body = days('2026-09-01', [...up, ...flat]);
    const during = bulkStatus(withCal, body, 82, '2026-09-25');
    expect(during.state).toBe('calibrate');
    expect(during.adjustKcal).toBe(0);
    const start = during.calibration!.start;
    expect(during.calibration!.end).toBe(addDays(start, 14));
    const after = bulkStatus(withCal, body, 82, addDays(start, 15));
    expect(after.state).toBe('minicut');
    expect(after.since).toBe(addDays(start, 14));
    expect(after.adjustKcal).toBeLessThan(0);
  });

  it('projects bulk → calibrate → minicut → bulk', () => {
    const st = bulkStatus(withCal, days('2026-09-01', [79, 79, 79]), 79, '2026-09-03');
    const { days: weeks } = planAhead({ s: settings, calibrationDays: 14, status: st, currentKg: 79, tdee: 2800, kcalPerKg: 15.5, today: '2026-09-03' }, 52);
    const order = weeks.map((w) => w.state).filter((s, i, a) => i === 0 || s !== a[i - 1]);
    expect(order.slice(0, 4)).toEqual(['bulk', 'calibrate', 'minicut', 'bulk']);
    const cal = weeks.find((w) => w.state === 'calibrate')!;
    expect(cal.intakeKcal).toBeGreaterThan(2800); // 体重が増えたぶん維持カロリーも上がっている
  });
});

describe('calibration in calcTargets', () => {
  const cut: Profile = {
    ...profile,
    phase: 'cut',
    calibrationDays: 14,
    prepStartDate: '2026-10-01',
    contestDate: '2027-01-14',
    targetWeightKg: 72,
    tdeeMode: 'auto',
  };

  it('has no deficit during the calibration and plans the loss after it', () => {
    const body = days('2026-09-20', Array.from({ length: 16 }, () => 80));
    const t = calcTargets(cut, body, new Map(), '2026-10-05');
    expect(t.calibration).toMatchObject({ start: '2026-10-01', end: '2026-10-15', active: true, daysLeft: 10 });
    expect(t.deficit).toBe(0);
    expect(t.kcal).toBe(t.tdee);
    // 8kg を 10/15〜1/14（91日）で
    expect(t.requiredKgPerWeek).toBeCloseTo(0.62, 2);
  });

  it('uses the measured maintenance after the calibration', () => {
    // 期間中 2600kcal 食べて 14日で 0.3kg 減った → 維持は約 2754kcal
    const weights = Array.from({ length: 30 }, (_, i) => 80 - Math.max(0, Math.min(i - 11, 14)) * (0.3 / 14));
    const body = days('2026-09-20', weights);
    const intake = new Map(Array.from({ length: 14 }, (_, i) => [addDays('2026-10-01', i), 2600] as [string, number]));
    const t = calcTargets(cut, body, intake, '2026-10-18');
    expect(t.calibration?.active).toBe(false);
    expect(t.tdeeSource).toBe('adaptive');
    // 確認期間の実測値に合わせ直している
    const step = t.maintenance.history.find((h) => h.kind === 'calibration')!;
    expect(step.tdee).toBe(t.calibration?.result?.tdee);
    expect(step.date).toBe('2026-10-14');
    expect(t.tdee).toBeGreaterThan(2700);
    expect(t.tdee).toBeLessThan(2800);
    expect(t.deficit).toBeGreaterThan(0);
  });

  it('reports upcoming / active / done / expired', () => {
    const body = days('2026-09-20', [80, 80]);
    const status = (today: string) => calcTargets(cut, body, new Map(), today).calibration?.status;
    expect(status('2026-09-25')).toBe('upcoming');
    expect(status('2026-10-01')).toBe('active');
    expect(status('2026-10-15')).toBe('done');
    expect(status('2026-11-12')).toBe('expired');
  });

  it('can be turned off', () => {
    const t = calcTargets({ ...cut, calibrationDays: 0 }, days('2026-09-20', [80, 80]), new Map(), '2026-10-05');
    expect(t.calibration).toBeNull();
    expect(t.deficit).toBeGreaterThan(0);
  });
});
