import { useMemo } from 'react';
import type { BodyRecord, Profile } from '../types';
import type { Targets } from '../lib/nutrition';
import { movingAverage, seriesOf } from '../lib/analysis';
import { projectBulk, surplusFor } from '../lib/bulk';
import { contestRange, ffmi, formatContestRange } from '../lib/navy';
import { addDays, formatJa } from '../lib/date';
import { Chart } from './Chart';
import { NavyForm } from './Plan';

interface Props {
  profile: Profile;
  targets: Targets;
  body: BodyRecord[];
  today: string;
  onSaveSizes: (sizes: Pick<BodyRecord, 'waistCm' | 'neckCm' | 'hipCm'>) => void;
}

const WEEKS = 26;

/** 増量期の計画：上限・戻す線と、これからの増量とプチダイエットの波 */
export function BulkPlan({ profile, targets: t, body, today, onSaveSizes }: Props) {
  const st = t.bulk!;
  const s = profile.bulk;
  const lim = st.limits;
  const f = t.leanKg !== null ? ffmi(t.leanKg, profile.heightCm) : null;
  const range = lim ? contestRange(lim.leanKg, s.stageBodyFatPct) : null;

  const weights = useMemo(() => seriesOf(body, 'weightKg'), [body]);
  const average = useMemo(() => movingAverage(weights), [weights]);
  // 維持カロリーは体重 1kg あたり「10kcal × 活動係数」ずつ変わるとみる（Mifflin-St Jeor 式の傾き）
  const projection = useMemo(
    () => projectBulk(s, st, t.currentKg, t.tdee, 10 * profile.activityFactor, today, WEEKS),
    [s, st, t.currentKg, t.tdee, profile.activityFactor, today],
  );
  const firstSwitch = projection.find((w, i) => i > 0 && w.state !== projection[i - 1].state);

  return (
    <div className="stack">
      <section className="card">
        <h3>増量期の状態</h3>
        <PhaseLine targets={t} profile={profile} />
        <div className="stats">
          <Stat label="体重（7日平均）" value={`${t.currentKg.toFixed(1)} kg`} />
          <Stat label="上限まで" value={st.roomKg !== null ? `${st.roomKg.toFixed(1)} kg` : '—'} sub={lim ? `上限 ${lim.ceilingKg.toFixed(1)} kg` : '体脂肪率が必要'} />
          <Stat label="除脂肪体重" value={t.leanKg !== null ? `${t.leanKg.toFixed(1)} kg` : '—'} sub={f ? `FFMI ${f.ffmi}（補正 ${f.normalized}）` : undefined} />
          <Stat label="推定コンテスト体重" value={range ? formatContestRange(range) : '—'} sub={range ? `体脂肪率 ${range.lowBf}〜${range.highBf}%` : undefined} />
        </div>
        {!lim && (
          <p className="status warn">
            直近の体脂肪率がないので、上限なしで増量しています。下で首とウエスト{profile.sex === 'female' ? '・ヒップ' : ''}を測ると上限を計算します。
          </p>
        )}
      </section>

      <section className="card">
        <h3>これから{WEEKS}週の見込み</h3>
        <Chart
          points={weights}
          average={average}
          projection={projection.map((w) => ({ date: w.date, value: w.weightKg }))}
          lines={
            lim
              ? [
                  { value: lim.ceilingKg, label: '上限', cls: 'ceiling' },
                  { value: lim.lowerKg, label: '戻す線', cls: 'lower' },
                ]
              : undefined
          }
          from={addDays(today, -56)}
          to={addDays(today, WEEKS * 7)}
          label="体重の推移と見込み"
        />
        <div className="legend">
          <span className="lg avg">7日平均</span>
          <span className="lg plan">見込み</span>
        </div>
        {firstSwitch && (
          <p className="muted">
            このペースだと {formatJa(firstSwitch.date)} ごろに{firstSwitch.state === 'minicut' ? '上限に届いてプチダイエット' : '戻す線まで下がって増量を再開'}
            になる見込みです。
          </p>
        )}
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>週</th>
                <th>状態</th>
                <th>摂取</th>
                <th>体重</th>
              </tr>
            </thead>
            <tbody>
              {projection.slice(0, -1).map((w, i) => (
                <tr key={w.date} className={`${w.state} ${i > 0 && w.state !== projection[i - 1].state ? 'switch' : ''}`}>
                  <td>{formatJa(w.date)}〜</td>
                  <td>{w.state === 'bulk' ? '増量' : 'プチダイエット'}</td>
                  <td>{w.intakeKcal} kcal</td>
                  <td>{w.weightKg.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted">
          今の維持カロリー {t.tdee} kcal（{t.tdeeSource === 'estimate' ? '記録から推定' : '計算式'}）をもとにした見込みです。除脂肪体重（＝上限）は今のままと仮定しているので、筋肉がついて上限が上がれば波も上にずれていきます。実際の体重で毎日判定し直します。
        </p>
      </section>

      <NavyForm profile={profile} today={today} body={body} weightKg={t.currentKg} onSave={onSaveSizes} />
    </div>
  );
}

/** 増量中かプチダイエット中か、今日の余剰（赤字）と次の一手 */
export function PhaseLine({ targets: t, profile }: { targets: Targets; profile: Profile }) {
  const st = t.bulk!;
  if (st.state === 'bulk') {
    const next = surplusFor(profile.bulk, st.weeksInPhase + 1);
    return (
      <p className="phase-line">
        <span className="pill">増量中 {st.weeksInPhase + 1}週目</span> 維持 +{st.adjustKcal} kcal/日
        {next > st.adjustKcal ? `（来週 +${next}）` : '（余剰は上限）'}
      </p>
    );
  }
  return (
    <p className="phase-line">
      <span className="pill minicut">プチダイエット中 {st.weeksInPhase + 1}週目</span> 維持 {st.adjustKcal} kcal/日
      {st.limits && `（${st.limits.lowerKg.toFixed(1)} kg まで）`}
    </p>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}
