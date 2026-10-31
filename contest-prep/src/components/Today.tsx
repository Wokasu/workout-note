import { useEffect, useState } from 'react';
import type { BodyRecord, Macros, Profile } from '../types';
import type { Targets } from '../lib/nutrition';
import type { Rate } from '../lib/analysis';
import { daysBetween, formatJa } from '../lib/date';
import type { bulkPlanFor } from '../lib/bulk';
import { MacroBars } from './MacroBars';
import { PhaseLine } from './BulkPlan';
import { MaintenanceSuggestion } from './MaintenanceSuggestion';
import { contestRange, formatContestRange } from '../lib/navy';

interface Props {
  onApplyTdee: (kcal: number) => void;
  onUseFormula: () => void;
  bulkPlan: ReturnType<typeof bulkPlanFor>;
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
  if (t.calibration?.active)
    return { cls: '', text: '維持カロリーの確認期間です。食事を毎日記録して、体重が大きく動かないか見てください' };
  if (t.remainingKg <= 0) return { cls: 'ok', text: '目標体重に届いています。大会までは維持カロリーで調整期間です' };
  if (!rate) return { cls: '', text: '体重を2週間ほど記録すると、実際のペースを判定します' };
  const loss = -rate.kgPerWeek;
  if (-rate.pctPerWeek > maxPct * 1.2) return { cls: 'warn', text: '落ちるのが速すぎます。筋量を守るためカロリーを少し戻す検討を' };
  if (t.plannedKgPerWeek > 0 && loss < t.plannedKgPerWeek * 0.5)
    return { cls: 'warn', text: '計画より遅れています。摂取量の見直しか有酸素の追加を' };
  return { cls: 'ok', text: '計画どおりのペースです' };
}

function bulkPaceStatus(rate: Rate | null, t: Targets, gainKgPerMonth: number): { cls: string; text: string } {
  const st = t.bulk!;
  if (!rate) return { cls: '', text: '体重を2週間ほど記録すると、実際のペースを判定します' };
  if (st.state === 'minicut') {
    return rate.kgPerWeek < 0
      ? { cls: 'ok', text: 'プチダイエットで順調に下がっています' }
      : { cls: 'warn', text: 'まだ下がっていません。摂取量を確かめてください' };
  }
  if (st.state === 'calibrate') return { cls: '', text: '維持カロリーの確認中です。体重が大きく動かないか見ています' };
  const perMonth = Math.round(((rate.kgPerWeek * 30.4) / 7) * 10) / 10;
  const target = (gainKgPerMonth * 7) / 30.4;
  if (rate.kgPerWeek > target * 1.5)
    return { cls: 'warn', text: `月+${perMonth}kg のペースで、目標（月+${gainKgPerMonth}kg）より速めです。余剰カロリーを自動で減らしています` };
  if (rate.kgPerWeek < target * 0.75 && st.weeksInPhase >= 2)
    return { cls: 'warn', text: `月${perMonth >= 0 ? '+' : ''}${perMonth}kg で、目標（月+${gainKgPerMonth}kg）より遅めです。余剰を自動で増やしているので、食べきれているか確かめてください` };
  return { cls: 'ok', text: `月+${perMonth}kg のペースで、目標（月+${gainKgPerMonth}kg）どおり増えています` };
}

export function Today({ onApplyTdee, onUseFormula, bulkPlan, profile, targets: t, today, eaten, rate, todayBody, onSaveWeight, onGoMeals }: Props) {
  const savedKg = todayBody?.weightKg;
  const [kg, setKg] = useState(savedKg !== undefined ? String(savedKg) : '');
  const [edited, setEdited] = useState(false);
  const [message, setMessage] = useState<{ cls: string; text: string } | null>(null);
  // 保存領域や取り込みで今日の体重が後から入ったときも、入力中でなければ欄に反映する
  useEffect(() => {
    if (!edited) setKg(savedKg !== undefined ? String(savedKg) : '');
  }, [savedKg, edited]);
  const parsed = Number(kg.replace(/[０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(',', '.'));
  const unchanged = savedKg !== undefined && parsed === savedKg;
  const weeks = Math.floor(t.daysLeft / 7);
  const status = paceStatus(rate, t, profile.maxWeeklyLossPct);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!(parsed >= 25 && parsed <= 250)) {
      setMessage({ cls: 'warn', text: '体重は 25〜250 の数値で入れてください（例：78.6）' });
      return;
    }
    const v = Math.round(parsed * 10) / 10;
    onSaveWeight(v);
    setKg(String(v));
    setEdited(false);
    const time = new Date().toTimeString().slice(0, 5);
    setMessage({ cls: 'ok', text: `${formatJa(today)} の体重 ${v.toFixed(1)} kg を保存しました（${time}）` });
  };

  return (
    <div className="stack">
      {t.bulk ? (
        <section className="card countdown bulk-head">
          <div className="contest">増量期（オフ）</div>
          <PhaseLine targets={t} profile={profile} />
          {bulkPlan?.contest && (
            <div className="cal-note">
              大会減量の開始目安 {formatJa(bulkPlan.contest.early.date)}〜{formatJa(bulkPlan.contest.late.date)}
              {today < bulkPlan.contest.early.date ? `（あと${Math.ceil(daysBetween(today, bulkPlan.contest.early.date) / 7)}週）` : '（減量に入る時期です）'}
            </div>
          )}
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
          {t.daysLeft > 0 && (
            <div className="cal-note">
              {t.readyDate > today
                ? `目標体重の期限 ${formatJa(t.readyDate)}（大会の${profile.readyDaysBefore / 7}週間前・あと${daysBetween(today, t.readyDate)}日）`
                : t.remainingKg > 0
                  ? `目標体重の期限（${formatJa(t.readyDate)}）を過ぎています`
                  : '調整期間（目標体重に到達済み）'}
            </div>
          )}
          {t.calibration?.active && (
            <div className="cal-note">
              減量前の維持カロリー確認期間 あと{t.calibration.daysLeft}日（{formatJa(t.calibration.end)}から減量）
            </div>
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
              type="text"
              inputMode="decimal"
              value={kg}
              onChange={(e) => {
                setKg(e.target.value);
                setEdited(true);
                setMessage(null);
              }}
              placeholder={String(t.currentKg)}
            />
          </label>
          <button type="submit" className="primary" disabled={kg === '' || (unchanged && !edited)}>
            {savedKg === undefined ? '記録' : unchanged && !edited ? '記録済み' : '更新'}
          </button>
        </div>
        {message ? (
          <p className={`status ${message.cls}`}>{message.text}</p>
        ) : (
          savedKg !== undefined && <p className="muted">今日の記録：{savedKg.toFixed(1)} kg。測り直したら数字を変えて「更新」を押してください。</p>
        )}
        <p className="muted">ヘルスケアや体組成計のデータは「身体」タブからまとめて取り込めます。</p>
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
            const st = bulkPaceStatus(rate, t, profile.bulk.gainKgPerMonth);
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
              目標体重には週{profile.maxWeeklyLossPct}%の上限ペースでは期限（{formatJa(t.readyDate)}）までに届きません。このペースだと期限の日は約 {t.projectedKg} kg
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
            <span>維持カロリー</span>
            <span>
              {t.tdee} kcal{' '}
              <small>
                {t.tdeeSource === 'adaptive'
                  ? `記録から毎週更新（${t.maintenance.updates}回・最終 ${formatJa(t.maintenance.lastUpdate!)}）`
                  : t.tdeeSource === 'manual'
                    ? `反映した推定値（${formatJa(profile.manualTdee!.date)}）`
                    : `計算式（×${profile.activityFactor}）`}
              </small>
            </span>
          </li>
          {t.calibration?.active ? (
            <li>
              <span>維持カロリーの確認中</span>
              <span>
                ±0 kcal <small>あと{t.calibration.daysLeft}日</small>
              </span>
            </li>
          ) : t.bulk && t.bulk.adjustKcal > 0 ? (
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

      <MaintenanceSuggestion targets={t} manualDate={profile.manualTdee?.date ?? null} onApply={onApplyTdee} onUseFormula={onUseFormula} />
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
