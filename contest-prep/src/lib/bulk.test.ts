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
    const weeks = projectBulk(settings, st, 79, 2800, 15.5, '2026-09-03', 52);
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
