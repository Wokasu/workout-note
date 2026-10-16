import { useState } from 'react';
import type { BodyRecord, Macros, Profile } from '../types';
import type { Targets } from '../lib/nutrition';
import type { Rate } from '../lib/analysis';
import { formatJa } from '../lib/date';
import { MacroBars } from './MacroBars';
import { PhaseLine } from './BulkPlan';
import { contestRange, formatContestRange } from '../lib/navy';

interface Props {
  profile: Profile;
  targets: Targets;
  today: string;
  eaten: Macros;
  rate: Rate | null;
  todayBody: BodyRecord | undefined;
  onSaveWeight: (kg: number) => void;
  onGoMeals: () => void;
}

function paceStatus(rate: Rate | null, t: Targets, maxPct: number): { cls: string; text: string } {
  if (t.daysLeft === 0) return { cls: '', text: '大会おつかれさまでした' };
  if (!rate) return { cls: '', text: '体重を2週間ほど記録すると、実際のペースを判定します' };
  const loss = -rate.kgPerWeek;
  if (-rate.pctPerWeek > maxPct * 1.2) return { cls: 'warn', text: '落ちるのが速すぎます。筋量を守るためカロリーを少し戻す検討を' };
  if (t.plannedKgPerWeek > 0 && loss < t.plannedKgPerWeek * 0.5)
    return { cls: 'warn', text: '計画より遅れています。摂取量の見直しか有酸素の追加を' };
  return { cls: 'ok', text: '計画どおりのペースです' };
}

function bulkPaceStatus(rate: Rate | null, t: Targets): { cls: string; text: string } {
  const st = t.bulk!;
  if (!rate) return { cls: '', text: '体重を2週間ほど記録すると、実際のペースを判定します' };
  if (st.state === 'minicut') {
    return rate.kgPerWeek < 0
      ? { cls: 'ok', text: 'プチダイエットで順調に下がっています' }
      : { cls: 'warn', text: 'まだ下がっていません。摂取量を確かめてください' };
  }
  if (rate.pctPerWeek > 0.5) return { cls: 'warn', text: '増え方が速めです（週0.5%超）。脂肪がつきやすいので余剰の上限を下げる検討を' };
  if (rate.kgPerWeek <= 0 && st.weeksInPhase >= 2)
    return { cls: 'warn', text: '体重が増えていません。余剰は毎週自動で増えますが、食べきれているか確かめてください' };
  return { cls: 'ok', text: 'ゆるやかに増えています' };
}

export function Today({ profile, targets: t, today, eaten, rate, todayBody, onSaveWeight, onGoMeals }: Props) {
  const [kg, setKg] = useState(todayBody?.weightKg !== undefined ? String(todayBody.weightKg) : '');
  const weeks = Math.floor(t.daysLeft / 7);
  const status = paceStatus(rate, t, profile.maxWeeklyLossPct);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = Number(kg);
    if (v >= 25 && v <= 250) onSaveWeight(Math.round(v * 10) / 10);
  };

  return (
    <div className="stack">
      {t.bulk ? (
        <section className="card countdown bulk-head">
          <div className="contest">増量期（オフ）</div>
          <PhaseLine targets={t} profile={profile} />
        </section>
      ) : (
        <section className="card countdown">
          <div className="contest">
            {profile.contestName || '大会'} · {formatJa(profile.contestDate)}
          </div>
          {t.daysLeft > 0 ? (
            <div className="big">
              あと<span className="days">{t.daysLeft}</span>日
              <small>
                （{weeks}週{t.daysLeft % 7 ? `${t.daysLeft % 7}日` : ''}）
              </small>
            </div>
          ) : (
            <div className="big">大会当日・終了後</div>
          )}
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <h3>今日の PFC {formatJa(today)}</h3>
          <button className="ghost small" onClick={onGoMeals}>
            食事を記録
          </button>
        </div>
        <MacroBars eaten={eaten} target={t} />
      </section>

      <form className="card form" onSubmit={submit}>
        <h3>朝の体重</h3>
        <div className="row">
          <label className="grow">
            体重 (kg)
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              value={kg}
              onChange={(e) => setKg(e.target.value)}
              placeholder={String(t.currentKg)}
            />
          </label>
          <button type="submit" className="primary" disabled={kg === ''}>
            {todayBody?.weightKg !== undefined ? '更新' : '記録'}
          </button>
        </div>
        <p className="muted">体組成計のデータは「身体」タブから CSV でまとめて取り込めます。</p>
      </form>

      {t.bulk ? (
        <section className="card">
          <h3>増量の進み具合</h3>
          <div className="stats">
            <Stat label="今の体重（7日平均）" value={`${t.currentKg.toFixed(1)} kg`} />
            <Stat
              label="上限まで"
              value={t.bulk.roomKg !== null ? `${t.bulk.roomKg.toFixed(1)} kg` : '—'}
              sub={t.bulk.limits ? `上限 ${t.bulk.limits.ceilingKg.toFixed(1)} kg` : '体脂肪率が必要'}
            />
            <Stat
              label="直近の実績"
              value={rate ? `${rate.kgPerWeek > 0 ? '+' : ''}${rate.kgPerWeek.toFixed(2)} kg/週` : '—'}
              sub={rate ? `${rate.pctPerWeek}%/週` : undefined}
            />
            {(() => {
              const r = t.bulk.limits ? contestRange(t.bulk.limits.leanKg, profile.bulk.stageBodyFatPct) : null;
              return (
                <Stat label="推定コンテスト体重" value={r ? formatContestRange(r) : '—'} sub={r ? `体脂肪率 ${r.lowBf}〜${r.highBf}%` : undefined} />
              );
            })()}
          </div>
          {(() => {
            const st = bulkPaceStatus(rate, t);
            return <p className={`status ${st.cls}`}>{st.text}</p>;
          })()}
        </section>
      ) : (
        <section className="card">
          <h3>減量の進み具合</h3>
          <div className="stats">
            <Stat label="今の体重（7日平均）" value={`${t.currentKg.toFixed(1)} kg`} />
            <Stat
              label="目標まで"
              value={t.remainingKg > 0 ? `${t.remainingKg.toFixed(1)} kg` : '到達'}
              sub={`目標 ${t.targetWeightKg.toFixed(1)} kg`}
            />
            <Stat label="必要なペース" value={`${t.requiredKgPerWeek.toFixed(2)} kg/週`} />
            <Stat
              label="直近の実績"
              value={rate ? `${rate.kgPerWeek > 0 ? '+' : ''}${rate.kgPerWeek.toFixed(2)} kg/週` : '—'}
              sub={rate ? `${rate.pctPerWeek}%/週` : undefined}
            />
          </div>
          <p className={`status ${status.cls}`}>{status.text}</p>
          {t.tooFast && (
            <p className="status warn">
              目標体重には週{profile.maxWeeklyLossPct}%の上限ペースでは届きません。このペースだと大会当日は約 {t.projectedKg} kg
              の見込みです。
            </p>
          )}
        </section>
      )}

      <section className="card">
        <h3>カロリーの根拠</h3>
        <ul className="kv">
          <li>
            <span>基礎代謝</span>
            <span>
              {t.bmr} kcal{' '}
              <small>
                {t.leanKg !== null && t.bodyFat
                  ? `除脂肪量 ${t.leanKg}kg（${t.bodyFat.source === 'navy' ? '海軍式' : '体組成計'}）から`
                  : '身長・体重・年齢から'}
              </small>
            </span>
          </li>
          <li>
            <span>消費カロリー</span>
            <span>
              {t.tdee} kcal{' '}
              <small>
                {t.tdeeSource === 'estimate' ? `直近${t.estimate!.days}日の記録から推定` : `計算式（×${profile.activityFactor}）`}
              </small>
            </span>
          </li>
          {t.estimate && t.tdeeSource === 'formula' && (
            <li>
              <span>記録からの推定</span>
              <span>{t.estimate.tdee} kcal</span>
            </li>
          )}
          {t.bulk && t.bulk.adjustKcal > 0 ? (
            <li>
              <span>増量のための余剰</span>
              <span>+{t.bulk.adjustKcal} kcal</span>
            </li>
          ) : (
            <li>
              <span>{t.bulk ? 'プチダイエットの赤字' : '減量のための赤字'}</span>
              <span>−{t.deficit} kcal</span>
            </li>
          )}
          <li>
            <span>目標摂取</span>
            <span>
              <b>{t.kcal} kcal</b> {t.manual && <small>コーチ指定</small>}
            </span>
          </li>
        </ul>
        {t.belowBmr && <p className="status warn">目標摂取が基礎代謝を下回っています。体調や筋量の変化に注意してください。</p>}
      </section>
    </div>
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
