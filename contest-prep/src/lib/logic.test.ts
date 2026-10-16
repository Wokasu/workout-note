import { describe, expect, it } from 'vitest';
import type { BodyRecord, FoodLog, Profile } from '../types';
import { estimateTdee, mondayOf, movingAverage, recentRate, seriesOf, weeklySummary } from './analysis';
import { addDays } from './date';
import { applyMapping, autoMap, decodeText, mergeBody, parseDateTime, prepareImport } from './importer';
import { kcalOf, scaleMacros } from './macros';
import { bmrKatch, bmrMifflin, calcTargets, macrosFor } from './nutrition';
import { bodyFatSeries, ffmi, leanSeries, navyBodyFat, weightAtBodyFat } from './navy';
import { listZip, parseRecordTag, pickExportXml, readHealthExport, rowsToRecords, scanRecords } from './health';

const profile: Profile = {
  sex: 'male',
  age: 30,
  heightCm: 172,
  contestName: 'ボディビル選手権',
  contestDate: '2027-01-15',
  prepStartDate: '2026-10-16',
  startWeightKg: 80,
  targetWeightKg: 72,
  targetMode: 'weight',
  targetBodyFatPct: 5,
  bodyFatSource: 'auto',
  activityFactor: 1.55,
  proteinPerKg: 2.5,
  fatPct: 20,
  maxWeeklyLossPct: 1,
  tdeeMode: 'auto',
  manualMacros: null,
};

/** start から毎日 perDay kg ずつ変わる体重 */
function weightsFrom(start: string, days: number, kg: number, perDay: number): BodyRecord[] {
  return Array.from({ length: days }, (_, i) => ({ date: addDays(start, i), weightKg: Math.round((kg + perDay * i) * 100) / 100 }));
}

function logsFrom(start: string, days: number, kcal: number): FoodLog[] {
  // 炭水化物だけで kcal になるように入れる
  return Array.from({ length: days }, (_, i) => ({
    id: String(i),
    date: addDays(start, i),
    slot: 1,
    name: 'x',
    amount: '',
    p: 0,
    f: 0,
    c: kcal / 4,
  }));
}

describe('macros', () => {
  it('computes kcal with Atwater factors', () => {
    expect(kcalOf({ p: 30, f: 10, c: 50 })).toBe(410);
  });
  it('scales by amount', () => {
    expect(scaleMacros({ p: 23.3, f: 1.9, c: 0.1 }, 100, 150)).toEqual({ p: 35, f: 2.9, c: 0.2 });
  });
  it('fills carbs with the rest of the calories', () => {
    expect(macrosFor(2500, 80, 2.5, 20)).toEqual({ p: 200, f: 56, c: 299 });
  });
});

describe('bmr', () => {
  it('uses both formulas', () => {
    expect(bmrMifflin('male', 80, 172, 30)).toBe(1730);
    expect(bmrKatch(68)).toBe(1839);
  });
});

describe('analysis', () => {
  it('averages the last 7 calendar days', () => {
    const ma = movingAverage([
      { date: '2026-10-01', value: 80 },
      { date: '2026-10-05', value: 79 },
      { date: '2026-10-09', value: 78 },
    ]);
    expect(ma.map((p) => p.value)).toEqual([80, 79.5, 78.5]);
  });

  it('measures weekly rate from moving averages', () => {
    const body = weightsFrom('2026-10-01', 28, 80, -0.1);
    const rate = recentRate(seriesOf(body, 'weightKg'), '2026-10-28')!;
    expect(rate.kgPerWeek).toBeCloseTo(-0.7, 5);
    expect(rate.pctPerWeek).toBeCloseTo(-0.9, 1);
  });

  it('estimates TDEE from intake and weight change', () => {
    // 毎日 2400kcal 食べて 1日0.05kg（=360kcal）ずつ減っている → 消費は約 2760kcal
    const body = weightsFrom('2026-10-01', 40, 80, -0.05);
    const intake = new Map(logsFrom('2026-10-01', 40, 2400).map((l) => [l.date, kcalOf(l)]));
    const est = estimateTdee(seriesOf(body, 'weightKg'), intake, '2026-11-09')!;
    expect(est.days).toBe(21);
    expect(est.tdee).toBe(2760);
  });

  it('refuses to estimate when meals are rarely logged', () => {
    const body = weightsFrom('2026-10-01', 40, 80, -0.05);
    const intake = new Map(logsFrom('2026-10-01', 40, 2400).filter((_, i) => i % 2 === 0).map((l) => [l.date, kcalOf(l)]));
    expect(estimateTdee(seriesOf(body, 'weightKg'), intake, '2026-11-09')).toBeNull();
  });

  it('finds Monday', () => {
    expect(mondayOf('2026-10-16')).toBe('2026-10-12');
    expect(mondayOf('2026-10-12')).toBe('2026-10-12');
    expect(mondayOf('2026-10-18')).toBe('2026-10-12');
  });

  it('summarizes weeks newest first, excluding today from intake', () => {
    const body = weightsFrom('2026-10-05', 12, 80, -0.1);
    const logs = logsFrom('2026-10-12', 5, 2000);
    const weeks = weeklySummary(body, logs, '2026-10-16');
    expect(weeks.map((w) => w.weekStart)).toEqual(['2026-10-12', '2026-10-05']);
    expect(weeks[0].loggedDays).toBe(4);
    expect(weeks[0].avgKcal).toBe(2000);
    expect(weeks[0].change).toBe(-0.6);
  });
});

describe('calcTargets', () => {
  it('uses the formula until enough data exists', () => {
    const t = calcTargets(profile, [], new Map(), '2026-10-16');
    expect(t.tdeeSource).toBe('formula');
    expect(t.bmr).toBe(1730);
    expect(t.formulaTdee).toBe(2682);
    expect(t.daysLeft).toBe(91);
    // 8kg を 13週 → 0.615kg/週。上限 0.8kg/週の内側
    expect(t.requiredKgPerWeek).toBeCloseTo(0.62, 2);
    expect(t.tooFast).toBe(false);
    expect(t.deficit).toBe(633);
    expect(t.kcal).toBe(2682 - 633);
    expect(t.p).toBe(200);
    expect(t.projectedKg).toBe(72);
  });

  it('caps the loss rate and warns', () => {
    const t = calcTargets({ ...profile, targetWeightKg: 66 }, [], new Map(), '2026-10-16');
    expect(t.tooFast).toBe(true);
    expect(t.plannedKgPerWeek).toBe(0.8);
    expect(t.projectedKg).toBeGreaterThan(66);
  });

  it('uses lean mass when body fat is recent', () => {
    const body: BodyRecord[] = [{ date: '2026-10-16', weightKg: 80, bodyFatPct: 15 }];
    const t = calcTargets(profile, body, new Map(), '2026-10-16');
    expect(t.leanKg).toBe(68);
    expect(t.bmr).toBe(1839);
  });

  it('switches to the estimate in auto mode', () => {
    const body = weightsFrom('2026-10-01', 40, 80, -0.05);
    const intake = new Map(logsFrom('2026-10-01', 40, 2400).map((l) => [l.date, kcalOf(l)]));
    expect(calcTargets(profile, body, intake, '2026-11-09').tdee).toBe(2760);
    expect(calcTargets({ ...profile, tdeeMode: 'formula' }, body, intake, '2026-11-09').tdeeSource).toBe('formula');
  });

  it('respects coach-prescribed macros', () => {
    const t = calcTargets({ ...profile, manualMacros: { p: 220, f: 50, c: 200 } }, [], new Map(), '2026-10-16');
    expect(t.kcal).toBe(2130);
    expect(t.c).toBe(200);
  });

  it('plans maintenance after the contest', () => {
    const t = calcTargets(profile, [], new Map(), '2027-01-20');
    expect(t.daysLeft).toBe(0);
    expect(t.deficit).toBe(0);
  });
});

describe('importer', () => {
  it('parses many date formats', () => {
    expect(parseDateTime('2026/10/16 7:05')).toEqual({ date: '2026-10-16', minutes: 425 });
    expect(parseDateTime('2026-10-16T07:05:00')).toEqual({ date: '2026-10-16', minutes: 425 });
    expect(parseDateTime('2026年10月6日')).toEqual({ date: '2026-10-06', minutes: null });
    expect(parseDateTime('202610160705')).toEqual({ date: '2026-10-16', minutes: 425 });
    expect(parseDateTime('２０２６／１０／１６')).toEqual({ date: '2026-10-16', minutes: null });
    expect(parseDateTime('体重')).toBeNull();
  });

  it('reads a wide HealthPlanet style CSV and keeps the morning value', () => {
    const csv = [
      'ヘルスプラネット 測定データ',
      '測定日,測定時刻,体重(kg),体脂肪率(%),筋肉量(kg),筋肉スコア,内臓脂肪レベル,基礎代謝量(kcal),体内年齢(才),推定骨量(kg)',
      '2026/10/14,07:10,80.2,15.1,64.3,1,9.5,1750,28,3.3',
      '2026/10/14,22:30,81.0,15.4,64.5,1,9.5,1755,28,3.3',
      '2026/10/15,07:05,79.9,-,64.1,1,9.5,1745,28,3.3',
      '合計,,,,,,,,,',
    ].join('\r\n');
    const prepared = prepareImport(csv)!;
    expect(prepared.mapping.dateCol).toBe(0);
    expect(prepared.mapping.timeCol).toBe(1);
    expect(prepared.mapping.fields).toEqual({
      weightKg: 2,
      bodyFatPct: 3,
      muscleKg: 4,
      visceralFat: 6,
      bmrKcal: 7,
      metabolicAge: 8,
      boneKg: 9,
    });
    const result = applyMapping(prepared.table, prepared.mapping);
    expect(result.badRows).toBe(1);
    expect(result.records).toEqual([
      { date: '2026-10-14', weightKg: 80.2, bodyFatPct: 15.1, muscleKg: 64.3, visceralFat: 9.5, bmrKcal: 1750, metabolicAge: 28, boneKg: 3.3 },
      { date: '2026-10-15', weightKg: 79.9, muscleKg: 64.1, visceralFat: 9.5, bmrKcal: 1745, metabolicAge: 28, boneKg: 3.3 },
    ]);
  });

  it('pivots the long (date, tag, keydata) format', () => {
    const csv = ['date,keydata,model,tag', '202610140710,80.20,01000117,6021', '202610140710,15.10,01000117,6022', '202610150705,79.90,01000117,6021'].join('\n');
    const prepared = prepareImport(csv)!;
    const result = applyMapping(prepared.table, prepared.mapping);
    expect(result.records).toEqual([
      { date: '2026-10-14', weightKg: 80.2, bodyFatPct: 15.1 },
      { date: '2026-10-15', weightKg: 79.9 },
    ]);
  });

  it('maps body size columns and drops out-of-range values', () => {
    const table = { header: ['日付', 'ウエスト(cm)', '上腕', '太もも', '除脂肪体重'], rows: [['2026-10-14', '78.5', '41', '999', '68']] };
    const mapping = autoMap(table.header);
    expect(mapping.fields).toEqual({ waistCm: 1, armCm: 2, thighCm: 3 });
    const result = applyMapping(table, mapping);
    expect(result.records).toEqual([{ date: '2026-10-14', waistCm: 78.5, armCm: 41 }]);
    expect(result.outOfRange).toBe(1);
  });

  it('decodes Shift_JIS', () => {
    // 「体重」の Shift_JIS
    const sjis = new Uint8Array([0x91, 0xcc, 0x8f, 0x64]);
    expect(decodeText(sjis.buffer)).toBe('体重');
  });

  it('merges without dropping existing fields', () => {
    const merged = mergeBody(
      [{ date: '2026-10-14', weightKg: 80, waistCm: 80 }],
      [{ date: '2026-10-14', weightKg: 80.2 }, { date: '2026-10-13', weightKg: 80.5 }],
    );
    expect(merged).toEqual([
      { date: '2026-10-13', weightKg: 80.5 },
      { date: '2026-10-14', weightKg: 80.2, waistCm: 80 },
    ]);
  });
});

describe('navy', () => {
  it('matches the Hodgdon-Beckett formula', () => {
    expect(navyBodyFat('male', 178, 80, 38)).toBe(12.4);
    expect(navyBodyFat('female', 160, 68, 32, 92)).toBe(23.6);
    expect(navyBodyFat('female', 160, 68, 32)).toBeNull();
    expect(navyBodyFat('male', 178, 36, 38)).toBeNull();
  });

  it('prefers navy in auto mode and falls back to the scale', () => {
    const body: BodyRecord[] = [
      { date: '2026-10-14', weightKg: 80, bodyFatPct: 15, waistCm: 82, neckCm: 39 },
      { date: '2026-10-15', weightKg: 79.8, bodyFatPct: 14.8 },
    ];
    expect(bodyFatSeries(body, profile, 'auto').source).toBe('navy');
    expect(bodyFatSeries(body, profile, 'scale').points.map((p) => p.value)).toEqual([15, 14.8]);
    expect(bodyFatSeries([body[1]], profile, 'auto').source).toBe('scale');
    expect(bodyFatSeries([body[1]], profile, 'navy').source).toBeNull();
  });

  it('computes lean mass, FFMI and stage weight', () => {
    const body: BodyRecord[] = [{ date: '2026-10-14', weightKg: 80, waistCm: 82, neckCm: 39 }];
    const fat = bodyFatSeries(body, profile, 'navy').points;
    expect(leanSeries(body, fat)).toEqual([{ date: '2026-10-14', value: Math.round(80 * (1 - fat[0].value / 100) * 10) / 10 }]);
    expect(ffmi(68, 172)).toEqual({ ffmi: 23, normalized: 23.5 });
    expect(weightAtBodyFat(68, 5)).toBe(71.6);
  });

  it('sets the target weight from body fat', () => {
    const p: Profile = { ...profile, targetMode: 'bodyFat', targetBodyFatPct: 5 };
    const body: BodyRecord[] = [{ date: '2026-10-16', weightKg: 80, bodyFatPct: 15 }];
    const t = calcTargets(p, body, new Map(), '2026-10-16');
    expect(t.bodyFat).toEqual({ pct: 15, date: '2026-10-16', source: 'scale' });
    expect(t.targetWeightKg).toBe(71.6);
    expect(t.remainingKg).toBe(8.4);
    expect(t.targetFallback).toBe(false);
    const none = calcTargets(p, [], new Map(), '2026-10-16');
    expect(none.targetFallback).toBe(true);
    expect(none.targetWeightKg).toBe(72);
  });

  it('ignores body fat older than 30 days', () => {
    const body: BodyRecord[] = [{ date: '2026-09-01', weightKg: 80, bodyFatPct: 15 }];
    expect(calcTargets(profile, body, new Map(), '2026-10-16').bodyFat).toBeNull();
  });
});

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<HealthData locale="ja_JP">
 <Record type="HKQuantityTypeIdentifierBodyMass" sourceName="Health Planet" unit="kg" creationDate="2026-10-14 07:20:00 +0900" startDate="2026-10-14 07:10:00 +0900" endDate="2026-10-14 07:10:00 +0900" value="80.2"/>
 <Record type="HKQuantityTypeIdentifierBodyMass" sourceName="Health Planet" unit="kg" startDate="2026-10-14 21:10:00 +0900" endDate="2026-10-14 21:10:00 +0900" value="81"/>
 <Record type="HKQuantityTypeIdentifierBodyFatPercentage" sourceName="Health Planet" unit="%" startDate="2026-10-14 07:10:00 +0900" value="0.151"/>
 <Record type="HKQuantityTypeIdentifierStepCount" unit="count" startDate="2026-10-14 08:00:00 +0900" value="120"/>
 <Record type="HKQuantityTypeIdentifierBodyMass" unit="lb" startDate="2026-10-15 07:00:00 +0900" value="176"/>
 <Record type="HKQuantityTypeIdentifierWaistCircumference" unit="in" startDate="2026-10-15 07:00:00 +0900" value="32"/>
</HealthData>`;

/** 1ファイルだけの zip を作る（CRC は読み取り側で見ないので 0） */
async function makeZip(name: string, text: string): Promise<Uint8Array> {
  const raw = new TextEncoder().encode(text);
  const data = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  const nameBytes = new TextEncoder().encode(name);
  const header = (size: number, fill: (v: DataView) => void) => {
    const b = new Uint8Array(size);
    fill(new DataView(b.buffer));
    return b;
  };
  const local = header(30, (v) => {
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(8, 8, true);
    v.setUint32(18, data.length, true);
    v.setUint32(22, raw.length, true);
    v.setUint16(26, nameBytes.length, true);
  });
  const central = header(46, (v) => {
    v.setUint32(0, 0x02014b50, true);
    v.setUint16(10, 8, true);
    v.setUint32(20, data.length, true);
    v.setUint32(24, raw.length, true);
    v.setUint16(28, nameBytes.length, true);
  });
  const eocd = header(22, (v) => {
    v.setUint32(0, 0x06054b50, true);
    v.setUint16(8, 1, true);
    v.setUint16(10, 1, true);
    v.setUint32(12, 46 + nameBytes.length, true);
    v.setUint32(16, 30 + nameBytes.length + data.length, true);
  });
  return new Uint8Array(await new Blob([local, nameBytes, data, central, nameBytes, eocd]).arrayBuffer());
}

describe('health export', () => {
  it('parses a record tag with unit conversion', () => {
    expect(parseRecordTag('<Record type="HKQuantityTypeIdentifierBodyMass" unit="lb" startDate="2026-10-15 07:00:00 +0900" value="176"/>')).toEqual({
      dateTime: '2026-10-15 07:00',
      field: 'weightKg',
      value: 79.83,
    });
    expect(parseRecordTag('<Record type="HKQuantityTypeIdentifierStepCount" value="1"/>')).toBeNull();
  });

  it('scans across chunk boundaries and keeps the morning value', async () => {
    async function* chunks() {
      for (let i = 0; i < XML.length; i += 37) yield XML.slice(i, i + 37);
    }
    const rows = await scanRecords(chunks());
    expect(rows).toHaveLength(5);
    expect(rowsToRecords(rows).records).toEqual([
      { date: '2026-10-14', weightKg: 80.2, bodyFatPct: 15.1 },
      { date: '2026-10-15', weightKg: 79.83, waistCm: 81.28 },
    ]);
  });

  it('reads export.zip with a Japanese file name', async () => {
    const zip = await makeZip('apple_health_export/書き出したデータ.xml', XML);
    const file = new File([zip], 'export.zip');
    const entry = pickExportXml(await listZip(file));
    expect(entry?.name).toBe('apple_health_export/書き出したデータ.xml');
    const result = await readHealthExport(file);
    expect(result.rows).toBe(5);
    expect(result.records).toHaveLength(2);
  });
});
