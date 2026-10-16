import { describe, expect, it } from 'vitest';
import { calcBmr, calcPlan, calcStreak, progressRatio } from './calc';
import { addDays, daysBetween } from './date';
import { decideMood } from './cheers';
import type { Profile } from '../types';

const profile: Profile = {
  nickname: 'ゆう',
  oshiName: 'みーちゃん',
  oshiColor: '#ff5fa2',
  eventName: '写真会',
  eventDate: '2026-11-15',
  sex: 'female',
  age: 25,
  heightCm: 158,
  startWeightKg: 55,
  targetWeightKg: 53,
  activity: 'normal',
  startDate: '2026-10-16',
};

describe('date', () => {
  it('counts days across month boundaries', () => {
    expect(daysBetween('2026-10-16', '2026-11-15')).toBe(30);
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('calcBmr', () => {
  it('uses Mifflin-St Jeor', () => {
    expect(calcBmr('female', 55, 158, 25)).toBe(1252);
    expect(calcBmr('male', 70, 175, 30)).toBe(1649);
  });
});

describe('calcPlan', () => {
  it('sets a deficit that reaches the goal when the pace is safe', () => {
    const plan = calcPlan({ ...profile, activity: 'high' }, [], '2026-10-16');
    expect(plan.daysLeft).toBe(30);
    expect(plan.requiredDeficit).toBe(480);
    expect(plan.deficit).toBe(480);
    expect(plan.targetKcal).toBe(plan.tdee - 480);
    expect(plan.tooFast).toBe(false);
    expect(plan.projectedKg).toBe(53);
  });

  it('never goes below BMR for low activity', () => {
    const plan = calcPlan({ ...profile, activity: 'low' }, [], '2026-10-16');
    expect(plan.targetKcal).toBe(plan.bmr);
    expect(plan.tooFast).toBe(true);
  });

  it('caps aggressive goals and never goes below BMR', () => {
    const plan = calcPlan({ ...profile, targetWeightKg: 48 }, [], '2026-10-16');
    expect(plan.tooFast).toBe(true);
    expect(plan.targetKcal).toBeGreaterThanOrEqual(plan.bmr);
    expect(plan.deficit).toBeLessThanOrEqual(700);
    expect(plan.projectedKg).toBeGreaterThan(48);
  });

  it('uses the latest weight entry', () => {
    const plan = calcPlan(profile, [
      { date: '2026-10-20', kg: 54.2 },
      { date: '2026-10-18', kg: 54.6 },
    ], '2026-10-20');
    expect(plan.currentKg).toBe(54.2);
    expect(plan.remainingKg).toBe(1.2);
  });

  it('has no deficit after the event', () => {
    const plan = calcPlan(profile, [], '2026-11-20');
    expect(plan.daysLeft).toBe(0);
    expect(plan.deficit).toBe(0);
  });
});

describe('progressRatio', () => {
  it('clamps between 0 and 1', () => {
    expect(progressRatio(55, 54, 53)).toBe(0.5);
    expect(progressRatio(55, 56, 53)).toBe(0);
    expect(progressRatio(55, 52, 53)).toBe(1);
  });
});

describe('calcStreak', () => {
  it('counts consecutive finished days within target, ignoring today', () => {
    const map = new Map([
      ['2026-10-13', 2500],
      ['2026-10-14', 1500],
      ['2026-10-15', 1600],
    ]);
    expect(calcStreak(map, 1700, '2026-10-16')).toBe(2);
    map.set('2026-10-16', 1800);
    expect(calcStreak(map, 1700, '2026-10-16')).toBe(2);
    expect(calcStreak(map, 1700, '2026-10-17')).toBe(0);
  });
});

describe('decideMood', () => {
  it('prioritizes event state', () => {
    expect(decideMood({ daysLeft: 0, eventPassed: true, todayKcal: 0, targetKcal: 1500 })).toBe('after');
    expect(decideMood({ daysLeft: 0, eventPassed: false, todayKcal: 0, targetKcal: 1500 })).toBe('eventDay');
    expect(decideMood({ daysLeft: 10, eventPassed: false, todayKcal: 1600, targetKcal: 1500 })).toBe('over');
    expect(decideMood({ daysLeft: 2, eventPassed: false, todayKcal: 500, targetKcal: 1500 })).toBe('eventSoon');
    expect(decideMood({ daysLeft: 10, eventPassed: false, todayKcal: 0, targetKcal: 1500 })).toBe('start');
  });
});
