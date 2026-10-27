import { useMemo, useState } from 'react';
import type { BodyField, BodyRecord, FoodLog, Profile } from '../types';
import { bodyFatSeries, leanSeries, navySeries } from '../lib/navy';
import { MAINTENANCE_WINDOW_DAYS, movingAverage, seriesOf, weeklySummary, type Point } from '../lib/analysis';
import { FIELD_BY_KEY, FIELD_DEFS, formatValue } from '../lib/fields';
import { addDays, formatJa } from '../lib/date';
import { Chart } from './Chart';
import { MaintenanceSuggestion } from './MaintenanceSuggestion';
import type { Targets } from '../lib/nutrition';

interface Props {
  profile: Profile;
  targets: Targets;
  onApplyTdee: (kcal: number) => void;
  onUseFormula: () => void;
  /** 減量期の目標体重（増量期は計画線を出さないので null） */
  targetWeightKg: number | null;
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

export function Analysis({ profile, targetWeightKg, body, logs, today, targets, onApplyTdee, onUseFormula }: Props) {
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

  const bulking = profile.phase === 'bulk';
  const periodStart = bulking ? profile.bulk.startDate : profile.prepStartDate;
  const from = range === 'prep' ? (periodStart < today ? periodStart : addDays(today, -28)) : addDays(today, -range);
  const to = range === 'prep' && !bulking && profile.contestDate > today ? profile.contestDate : today;
  // 確認期間（維持カロリーで食べる期間）は体重を保ち、その後大会まで落としていく計画線
  const calEnd = addDays(profile.prepStartDate, profile.calibrationDays);
  const plan: Point[] | undefined =
    metric === 'weightKg' && range === 'prep' && targetWeightKg !== null
      ? [
          { date: profile.prepStartDate, value: profile.startWeightKg },
          ...(profile.calibrationDays > 0 && calEnd < profile.contestDate ? [{ date: calEnd, value: profile.startWeightKg }] : []),
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
              ['prep', bulking ? '増量期間' : '減量期間'],
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

      <MaintenanceSuggestion targets={targets} manualDate={profile.manualTdee?.date ?? null} onApply={onApplyTdee} onUseFormula={onUseFormula} />

      <MaintenanceCard targets={targets} today={today} />

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

/** 維持カロリーの推移：毎週の記録から出した値（点）と、それをならした推定値（線） */
function MaintenanceCard({ targets: t, today }: { targets: Targets; today: string }) {
  const h = t.maintenance.history;
  const weekly = h.filter((x) => x.observed !== null).map((x) => ({ date: x.date, value: x.observed! }));
  const line = h.map((x) => ({ date: x.date, value: x.tdee }));
  const recent = [...h].reverse().slice(0, 6);
  return (
    <section className="card">
      <h3>維持カロリーの推移（2週間ごとの自動更新）</h3>
      {t.maintenance.updates === 0 ? (
        <p className="muted">
          食事と体重を2週間ほど記録すると、その間の平均摂取と体重の変化から維持カロリーを計算し、毎週更新していきます。今は計算式の値（{t.formulaTdee} kcal）を使っています。
        </p>
      ) : (
        <>
          <div className="stats">
            <div className="stat">
              <div className="stat-label">推定維持カロリー</div>
              <div className="stat-value">{t.maintenance.tdee} kcal</div>
              <div className="stat-sub">{t.tdeeSource === 'adaptive' ? '目標カロリーの計算に使用中' : '参考（設定で「毎週自動で更新」にすると使います）'}</div>
            </div>
            <div className="stat">
              <div className="stat-label">計算式の値</div>
              <div className="stat-value">{t.formulaTdee} kcal</div>
              <div className="stat-sub">
                差 {t.maintenance.tdee - t.formulaTdee >= 0 ? '+' : ''}
                {t.maintenance.tdee - t.formulaTdee} kcal
              </div>
            </div>
          </div>
          <Chart
            points={weekly}
            average={line}
            lines={[{ value: t.formulaTdee, label: '計算式', cls: 'contest' }]}
            from={line[0]?.date ?? addDays(today, -28)}
            to={today}
            digits={0}
            label="維持カロリーの推移"
          />
          <div className="legend">
            <span className="lg dot">その週の記録から計算した値</span>
            <span className="lg avg">推定維持カロリー</span>
          </div>
          <ul className="kv">
            {recent.map((x) => (
              <li key={x.date + x.kind}>
                <span>
                  {formatJa(x.date)}
                  {x.kind === 'calibration' ? ' 確認期間' : ''}
                </span>
                <span>
                  {x.tdee} kcal{' '}
                  <small>
                    {x.kind === 'calibration' ? '確認期間の実測に合わせ直し' : x.observed !== null ? `その週の計算値 ${x.observed}` : '記録が足りず更新なし'}
                  </small>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="muted">
        毎週、直近{MAINTENANCE_WINDOW_DAYS}日の「平均摂取 ＋ 体重（7日平均）の変化」から維持カロリーを計算し、推定値をその値へ30%ずつ近づけます。体重は水分でぶれるので、1回の更新では最大±150kcalまでしか動かしません。食事を6割以上記録した週だけ使います。
      </p>
    </section>
  );
}
