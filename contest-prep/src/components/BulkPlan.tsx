import { useMemo } from 'react';
import type { BodyRecord, Profile } from '../types';
import type { Targets } from '../lib/nutrition';
import { movingAverage, seriesOf } from '../lib/analysis';
import { weeklyRows, type ContestPlan, type PlanDay, type PlanState } from '../lib/bulk';
import { contestRange, ffmi, formatContestRange } from '../lib/navy';
import { addDays, daysBetween, formatJa } from '../lib/date';
import { Chart } from './Chart';
import { CalibrationCard, NavyForm } from './Plan';

interface Props {
  profile: Profile;
  targets: Targets;
  plan: { days: PlanDay[]; contest: ContestPlan | null };
  body: BodyRecord[];
  today: string;
  onSaveSizes: (sizes: Pick<BodyRecord, 'waistCm' | 'neckCm' | 'hipCm'>) => void;
  onSwitchToCut: () => void;
  onApplyTdee: (kcal: number) => void;
}

const STATE_LABEL: Record<PlanState, string> = {
  bulk: '増量',
  calibrate: '維持（確認）',
  minicut: 'プチダイエット',
  prepCalibrate: '維持（確認）',
  prep: '大会減量',
};
const EVENT_TEXT: Record<PlanState, string> = {
  bulk: '増量を再開',
  calibrate: '上限に届いて維持カロリーの確認',
  minicut: 'プチダイエット開始',
  prepCalibrate: '大会に向けた減量を開始（まず維持カロリーの確認）',
  prep: '大会に向けた減量（赤字）開始',
};

/** 増量期の計画：上限・戻す線、増量とプチダイエットの波、大会に向けた減量に入る時期 */
export function BulkPlan({ profile, targets: t, plan, body, today, onSaveSizes, onSwitchToCut, onApplyTdee }: Props) {
  const st = t.bulk!;
  const s = profile.bulk;
  const lim = st.limits;
  const f = t.leanKg !== null ? ffmi(t.leanKg, profile.heightCm) : null;
  const range = lim ? contestRange(lim.leanKg, s.stageBodyFatPct) : null;

  const weights = useMemo(() => seriesOf(body, 'weightKg'), [body]);
  const average = useMemo(() => movingAverage(weights), [weights]);
  const rows = useMemo(() => weeklyRows(plan.days), [plan.days]);
  const events = plan.days.filter((d, i) => i > 0 && d.state !== plan.days[i - 1].state);
  const end = plan.days.at(-1)?.date ?? addDays(today, 182);

  return (
    <div className="stack">
      <ContestTimingCard profile={profile} plan={plan} today={today} hasLimits={!!lim} onSwitchToCut={onSwitchToCut} />

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

      {st.calibration && <CalibrationCard targets={t} onApply={onApplyTdee} />}

      <section className="card">
        <h3>{plan.contest ? '大会までの見込み' : 'これから26週の見込み'}</h3>
        <Chart
          points={weights}
          average={average}
          projection={plan.days.filter((_, i) => i % 3 === 0 || i === plan.days.length - 1).map((d) => ({ date: d.date, value: d.weightKg }))}
          lines={[
            ...(lim
              ? [
                  { value: lim.ceilingKg, label: '上限', cls: 'ceiling' },
                  { value: lim.lowerKg, label: '戻す線', cls: 'lower' },
                ]
              : []),
            ...(plan.contest ? [{ value: plan.contest.contestKg, label: 'コンテスト', cls: 'contest' }] : []),
          ]}
          from={addDays(today, -56)}
          to={end}
          label="体重の推移と見込み"
        />
        <div className="legend">
          <span className="lg avg">7日平均</span>
          <span className="lg plan">見込み</span>
        </div>
        {events.length > 0 && (
          <ul className="kv events">
            {events.map((e) => (
              <li key={e.date} className={e.state}>
                <span>{formatJa(e.date)}ごろ</span>
                <span>{EVENT_TEXT[e.state]}</span>
              </li>
            ))}
            {plan.contest && (
              <li className="prep">
                <span>{formatJa(plan.contest.contestDate)}</span>
                <span>
                  {profile.contestName || '大会'}（見込み {plan.days.at(-1)!.weightKg.toFixed(1)} kg）
                </span>
              </li>
            )}
          </ul>
        )}
        <details className="advanced">
          <summary>週ごとの摂取カロリーと体重</summary>
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
                {rows.map((w, i) => (
                  <tr key={w.date} className={`${w.state} ${i > 0 && w.state !== rows[i - 1].state ? 'switch' : ''}`}>
                    <td>{formatJa(w.date)}〜</td>
                    <td>{STATE_LABEL[w.state]}</td>
                    <td>{w.intakeKcal} kcal</td>
                    <td>{w.weightKg.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
        <p className="muted">
          今の維持カロリー {t.tdee} kcal をもとに、増量は目標ペース（月+{s.gainKgPerMonth}kg）で増えると仮定した見込みです。除脂肪体重（＝上限）は今のままと仮定しているので、筋肉がついて上限が上がれば波も上にずれていきます。実際の体重で毎日判定し直します。
        </p>
      </section>

      <NavyForm profile={profile} today={today} body={body} weightKg={t.currentKg} onSave={onSaveSizes} />
    </div>
  );
}

/** 大会に向けた減量に入る時期（月2〜3kg で落とす場合） */
function ContestTimingCard({
  profile,
  plan,
  today,
  hasLimits,
  onSwitchToCut,
}: {
  profile: Profile;
  plan: Props['plan'];
  today: string;
  hasLimits: boolean;
  onSwitchToCut: () => void;
}) {
  const s = profile.bulk;
  const c = plan.contest;
  if (!c) {
    return (
      <section className="card">
        <h3>大会に向けた減量の開始時期</h3>
        <p className="muted">
          {!hasLimits
            ? '体脂肪率がわかるとコンテスト体重が出せるので、大会日から減量に入る時期を計算します。'
            : profile.contestDate <= today
              ? '設定で次の大会日を入れると、そこから逆算して減量に入る時期を出します。'
              : '大会日が近すぎて計算できません。'}
        </p>
      </section>
    );
  }
  const weeksTo = (d: string) => Math.max(0, Math.ceil(daysBetween(today, d) / 7));
  const due = today >= c.early.date;
  return (
    <section className="card prep-timing">
      <h3>大会に向けた減量の開始時期</h3>
      <div className="prep-dates">
        <b>
          {formatJa(c.early.date)}〜{formatJa(c.late.date)}
        </b>
        <small>
          月{s.prepPaceMinKg}〜{s.prepPaceMaxKg}kg ペースの場合{!due && ` · あと${weeksTo(c.early.date)}〜${weeksTo(c.late.date)}週`}
        </small>
      </div>
      <ul className="kv">
        <li>
          <span>大会</span>
          <span>
            {profile.contestName || '大会'} {formatJa(c.contestDate)}
          </span>
        </li>
        <li>
          <span>開始時の見込み体重</span>
          <span>
            {c.early.weightKg.toFixed(1)}〜{c.late.weightKg.toFixed(1)} kg
          </span>
        </li>
        <li>
          <span>落とす量</span>
          <span>
            {c.early.lossKg.toFixed(1)}〜{c.late.lossKg.toFixed(1)} kg <small>コンテスト体重 {c.contestKg.toFixed(1)} kg（体脂肪率 {s.stageBodyFatPct}%）まで</small>
          </span>
        </li>
      </ul>
      {c.late.overdue ? (
        <p className="status warn">月{s.prepPaceMaxKg}kg のペースでも間に合わない見込みです。すぐに減量に入るか、大会や目標を見直してください。</p>
      ) : due ? (
        <p className="status warn">減量に入る時期です（遅くとも {formatJa(c.late.date)} まで）。</p>
      ) : null}
      {(due || c.late.overdue) && (
        <button className="primary wide" onClick={onSwitchToCut}>
          コンテスト減量に切り替える
        </button>
      )}
      <p className="muted">
        見込みどおり増量したときの体重から、維持カロリーの確認{profile.calibrationDays > 0 ? `（${profile.calibrationDays}日）` : ''}
        を含めて逆算しています。早めの日に始めれば月{s.prepPaceMinKg}kg、遅い方の日なら月{s.prepPaceMaxKg}kg のペースで間に合います。
      </p>
    </section>
  );
}

/** 増量中かプチダイエット中か、今日の余剰（赤字）と次の一手 */
export function PhaseLine({ targets: t, profile }: { targets: Targets; profile: Profile }) {
  const st = t.bulk!;
  if (st.state === 'bulk') {
    const note: Record<string, string> = {
      start: '増量を始めた週',
      up: '目標ペースに届いていないので +' + profile.bulk.rampKcal,
      hold: '目標ペースで増えているので据え置き',
      down: '増え方が速いので −' + profile.bulk.rampKcal,
      max: '余剰は上限',
    };
    return (
      <p className="phase-line">
        <span className="pill">増量中 {st.weeksInPhase + 1}週目</span> 維持 +{st.adjustKcal} kcal/日（{note[st.surplusMove ?? 'start']}）
      </p>
    );
  }
  if (st.state === 'calibrate') {
    return (
      <p className="phase-line">
        <span className="pill calibrate">維持カロリーの確認中</span> 維持カロリーで食べる期間 あと{t.calibration?.daysLeft ?? 0}日
        （終わったらプチダイエット）
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
