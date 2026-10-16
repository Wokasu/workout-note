import { useMemo, useState } from 'react';
import type { BodyField, BodyRecord, FoodLog, Profile } from '../types';
import { bodyFatSeries, leanSeries, navySeries } from '../lib/navy';
import { movingAverage, seriesOf, weeklySummary, type Point } from '../lib/analysis';
import { FIELD_BY_KEY, FIELD_DEFS, formatValue } from '../lib/fields';
import { addDays, formatJa } from '../lib/date';
import { Chart } from './Chart';

interface Props {
  profile: Profile;
  targetWeightKg: number;
  body: BodyRecord[];
  logs: FoodLog[];
  today: string;
}

type Range = 28 | 84 | 'prep';

/** 記録から計算して出す項目 */
type Derived = 'navyBf' | 'leanKg';
type Metric = BodyField | Derived;

const DERIVED: Record<Derived, { label: string; unit: string }> = {
  navyBf: { label: '体脂肪率（海軍式）', unit: '%' },
  leanKg: { label: '除脂肪体重', unit: 'kg' },
};

function fmtChange(v: number | null, unit: string): string {
  if (v === null) return '—';
  return `${v > 0 ? '+' : ''}${v}${unit}`;
}

export function Analysis({ profile, targetWeightKg, body, logs, today }: Props) {
  const navy = useMemo(() => navySeries(body, profile), [body, profile]);
  const lean = useMemo(() => leanSeries(body, bodyFatSeries(body, profile, profile.bodyFatSource).points), [body, profile]);
  const available: { key: Metric; label: string }[] = [
    ...FIELD_DEFS.filter((f) => body.some((r) => r[f.key] !== undefined)),
    ...(navy.length ? [{ key: 'navyBf' as const, label: DERIVED.navyBf.label }] : []),
    ...(lean.length ? [{ key: 'leanKg' as const, label: DERIVED.leanKg.label }] : []),
  ];
  const [metric, setMetric] = useState<Metric>('weightKg');
  const [range, setRange] = useState<Range>('prep');
  const def = metric in DERIVED ? DERIVED[metric as Derived] : FIELD_BY_KEY[metric as BodyField];
  const fmt = (v: number) => (metric in DERIVED ? `${v.toFixed(1)} ${def.unit}` : formatValue(metric as BodyField, v));

  const points = useMemo(
    () => (metric === 'navyBf' ? navy : metric === 'leanKg' ? lean : seriesOf(body, metric)),
    [body, metric, navy, lean],
  );
  const average = useMemo(() => movingAverage(points), [points]);
  const weeks = useMemo(() => weeklySummary(body, logs, today), [body, logs, today]);

  const from = range === 'prep' ? (profile.prepStartDate < today ? profile.prepStartDate : addDays(today, -28)) : addDays(today, -range);
  const to = range === 'prep' && profile.contestDate > today ? profile.contestDate : today;
  const plan: [Point, Point] | undefined =
    metric === 'weightKg' && range === 'prep'
      ? [
          { date: profile.prepStartDate, value: profile.startWeightKg },
          { date: profile.contestDate, value: targetWeightKg },
        ]
      : undefined;

  const visible = points.filter((p) => p.date >= from && p.date <= to);
  const first = average.find((p) => p.date >= from);
  const last = average.filter((p) => p.date <= to).at(-1);

  return (
    <div className="stack">
      <section className="card">
        <div className="chips metric-chips">
          {(available.length ? available : [{ key: 'weightKg' as const, label: '体重' }]).map((f) => (
            <button key={f.key} className={`chip ${metric === f.key ? 'on' : ''}`} onClick={() => setMetric(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="seg">
          {(
            [
              ['prep', '減量期間'],
              [28, '4週'],
              [84, '12週'],
            ] as const
          ).map(([r, l]) => (
            <button key={r} className={range === r ? 'on' : ''} onClick={() => setRange(r)}>
              {l}
            </button>
          ))}
        </div>
        <Chart points={points} average={average} plan={plan} from={from} to={to} digits={metric === 'bmrKcal' ? 0 : 1} label={`${def.label}の推移`} />
        <div className="legend">
          <span className="lg dot">日々の値</span>
          <span className="lg avg">7日平均</span>
          {plan && <span className="lg plan">計画（開始→大会の目標）</span>}
        </div>
        {first && last && first.date !== last.date && visible.length > 1 && (
          <p className="muted">
            7日平均で {formatJa(first.date)} {fmt(first.value)} → {formatJa(last.date)} {fmt(last.value)}（
            {fmtChange(Math.round((last.value - first.value) * 10) / 10, def.unit)}）
          </p>
        )}
      </section>

      <section className="card">
        <h3>週ごとのまとめ</h3>
        {weeks.length === 0 ? (
          <p className="muted">記録がたまると表示されます</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>週</th>
                  <th>平均体重</th>
                  <th>前週比</th>
                  <th>kcal</th>
                  <th>P/F/C</th>
                  <th>ウエスト</th>
                  <th>体脂肪</th>
                </tr>
              </thead>
              <tbody>
                {weeks.map((w) => (
                  <tr key={w.weekStart}>
                    <td>{formatJa(w.weekStart)}〜</td>
                    <td>{w.avgWeight ?? '—'}</td>
                    <td className={w.change !== null && w.change > 0 ? 'up' : 'down'}>
                      {fmtChange(w.change, '')}
                      {w.changePct !== null && <small> ({fmtChange(w.changePct, '%')})</small>}
                    </td>
                    <td>
                      {w.avgKcal ?? '—'}
                      {w.loggedDays > 0 && <small> ({w.loggedDays}日)</small>}
                    </td>
                    <td>{w.avgP !== null ? `${Math.round(w.avgP)}/${Math.round(w.avgF!)}/${Math.round(w.avgC!)}` : '—'}</td>
                    <td>{w.avgWaist ?? '—'}</td>
                    <td>{w.avgBodyFat !== null ? `${w.avgBodyFat}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted">
          kcal・PFC は記録した日の平均（今日は含みません）。体重が停滞していても、ウエストが減っていれば脂肪は落ちています。家庭用体組成計の体脂肪率は水分の影響を受けやすいので、傾向として見てください。
        </p>
      </section>
    </div>
  );
}
