import { describe, expect, it } from 'vitest';
import type { BodyRecord, Profile } from '../types';
import { bulkLimits, bulkStatus, defaultBulkSettings, miniCutDeficit, projectBulk, surplusFor } from './bulk';
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

  it('ramps the surplus weekly up to the max', () => {
    expect([0, 1, 2, 8, 20].map((w) => surplusFor(settings, w))).toEqual([100, 150, 200, 500, 500]);
    expect(miniCutDeficit(settings, 82)).toBe(633);
  });
});

describe('bulkStatus', () => {
  it('is bulking below the ceiling, with the surplus for the week', () => {
    const body = days('2026-09-01', Array.from({ length: 22 }, (_, i) => 78 + i * 0.03));
    const st = bulkStatus(profile, body, 78.6, '2026-09-22');
    expect(st.state).toBe('bulk');
    expect(st.weeksInPhase).toBe(3);
    expect(st.adjustKcal).toBe(250);
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

describe('projectBulk', () => {
  it('waves between the ceiling and the lower line', () => {
    const st = bulkStatus(profile, days('2026-09-01', [79, 79, 79]), 79, '2026-09-03');
    const weeks = projectBulk(settings, 0, st, 79, 2800, 15.5, '2026-09-03', 52);
    const states = weeks.map((w) => w.state);
    expect(states).toContain('minicut');
    expect(states.lastIndexOf('bulk')).toBeGreaterThan(states.indexOf('minicut'));
    for (const w of weeks) expect(w.weightKg).toBeLessThanOrEqual(81.6 + 0.2);
    // 増量中は摂取が週ごとに増えていく
    expect(weeks[1].intakeKcal).toBeGreaterThan(weeks[0].intakeKcal);
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
    const weeks = projectBulk(settings, 14, st, 79, 2800, 15.5, '2026-09-03', 52);
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
    expect(t.tdeeSource).toBe('calibration');
    expect(t.calibration?.result?.tdee).toBe(t.tdee);
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
