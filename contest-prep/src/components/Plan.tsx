import { useMemo, useState } from 'react';
import type { BodyRecord, Profile } from '../types';
import type { Targets } from '../lib/nutrition';
import { movingAverage, seriesOf, valueAtOrBefore } from '../lib/analysis';
import { contestRange, ffmi, formatContestRange, navyBodyFat, navySeries, targetOptions } from '../lib/navy';
import { TargetGuide } from './TargetGuide';
import { EstimateNote, quickDiffers } from './CutStart';
import { addDays, daysBetween, formatJa } from '../lib/date';

interface Props {
  profile: Profile;
  targets: Targets;
  body: BodyRecord[];
  today: string;
  onSaveSizes: (sizes: Pick<BodyRecord, 'waistCm' | 'neckCm' | 'hipCm'>) => void;
  onSetTarget: (weightKg: number) => void;
  onApplyTdee: (kcal: number) => void;
  onSkipCalibration: () => void;
}

interface Milestone {
  date: string;
  weeksOut: number;
  plan: number;
  actual: number | null;
  bodyFat: number | null;
  past: boolean;
  isThisWeek: boolean;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

export function Plan({ profile, targets: t, body, today, onSaveSizes, onSetTarget, onApplyTdee, onSkipCalibration }: Props) {
  const navy = useMemo(() => navySeries(body, profile), [body, profile]);
  const latestNavy = navy.at(-1);
  const latestScale = seriesOf(body, 'bodyFatPct').at(-1);
  const lean = t.leanKg;
  const f = lean !== null ? ffmi(lean, profile.heightCm) : null;
  const fatKg = lean !== null ? r1(t.currentKg - lean) : null;
  const targetBf = lean !== null && t.targetWeightKg > lean ? r1((1 - lean / t.targetWeightKg) * 100) : null;
  const targetFatKg = lean !== null ? r1(t.targetWeightKg - lean) : null;

  const milestones = useMemo<Milestone[]>(() => {
    const ma = movingAverage(seriesOf(body, 'weightKg'));
    // 確認期間は体重を保ち、その後は目標の日（大会の数週間前）まで落として、そこからは保つ
    const calEnd = addDays(profile.prepStartDate, profile.calibrationDays);
    const lossFrom = calEnd < t.readyDate ? calEnd : profile.prepStartDate;
    const total = Math.max(1, daysBetween(lossFrom, t.readyDate));
    const dates: string[] = [];
    for (let d = profile.prepStartDate; d < profile.contestDate; d = addDays(d, 7)) dates.push(d);
    if (t.readyDate > profile.prepStartDate && !dates.includes(t.readyDate)) dates.push(t.readyDate);
    dates.push(profile.contestDate);
    dates.sort();
    return dates.map((date) => {
      const past = date <= today;
      // 過去は開始時に立てた計画線、これからは今の体重から上限ペース内で引き直した線
      const plan = past
        ? profile.startWeightKg + ((t.targetWeightKg - profile.startWeightKg) * Math.min(1, Math.max(0, daysBetween(lossFrom, date)) / total))
        : Math.max(t.targetWeightKg, t.currentKg - (t.plannedKgPerWeek * Math.max(0, daysBetween(today > lossFrom ? today : lossFrom, date))) / 7);
      const point = past ? valueAtOrBefore(ma, date) : undefined;
      const actual = point && point.date >= addDays(date, -3) ? point.value : null;
      const w = actual ?? plan;
      return {
        date,
        weeksOut: Math.ceil(daysBetween(date, profile.contestDate) / 7),
        plan: r1(plan),
        actual: actual !== null ? r1(actual) : null,
        bodyFat: lean !== null && w > lean ? r1((1 - lean / w) * 100) : null,
        past,
        isThisWeek: date <= today && addDays(date, 7) > today,
      };
    });
  }, [body, profile, t, today, lean]);

  return (
    <div className="stack">
      <section className="card">
        <h3>今の体組成</h3>
        <div className="stats">
          <Stat label="体重（7日平均）" value={`${t.currentKg.toFixed(1)} kg`} />
          <Stat
            label="体脂肪率"
            value={t.bodyFat ? `${t.bodyFat.pct.toFixed(1)} %` : '—'}
            sub={t.bodyFat ? `${t.bodyFat.source === 'navy' ? '海軍式' : '体組成計'} · ${formatJa(t.bodyFat.date)}` : '直近30日の値なし'}
          />
          <Stat label="除脂肪体重" value={lean !== null ? `${lean.toFixed(1)} kg` : '—'} sub={fatKg !== null ? `体脂肪 ${fatKg} kg` : undefined} />
          <Stat label="FFMI" value={f ? f.ffmi.toFixed(1) : '—'} sub={f ? `身長補正 ${f.normalized}` : undefined} />
        </div>
        {latestNavy && latestScale && (
          <p className="muted">
            比較：海軍式 {latestNavy.value}%（{formatJa(latestNavy.date)}）／体組成計 {latestScale.value}%（{formatJa(latestScale.date)}）
          </p>
        )}
      </section>

      <section className="card">
        <h3>大会時の目標</h3>
        <ul className="kv">
          <li>
            <span>目標体重</span>
            <span>
              <b>{t.targetWeightKg.toFixed(1)} kg</b>

            </span>
          </li>
          {targetBf !== null && (
            <li>
              <span>その時の体脂肪率</span>
              <span>約 {targetBf}%</span>
            </li>
          )}
          {fatKg !== null && targetFatKg !== null && (
            <li>
              <span>落とす体脂肪</span>
              <span>
                {fatKg} → {Math.max(0, targetFatKg)} kg <small>あと {r1(Math.max(0, fatKg - targetFatKg))} kg</small>
              </span>
            </li>
          )}
          <li>
            <span>必要なペース</span>
            <span>
              {t.requiredKgPerWeek.toFixed(2)} kg/週 <small>上限 {profile.maxWeeklyLossPct}%/週</small>
            </span>
          </li>
          <li>
            <span>目標体重の期限</span>
            <span>
              {formatJa(t.readyDate)} <small>大会の{profile.readyDaysBefore / 7}週間前 · 見込み {t.projectedKg.toFixed(1)} kg</small>
            </span>
          </li>
        </ul>
        {t.tooFast && <p className="status warn">上限ペースでは期限までに目標に届きません。目標・上限ペース・期限（設定の「目標体重に届く日」）の見直しを検討してください。</p>}
        <p className="muted">除脂肪体重が変わらない前提の計算です。減量中は筋量も多少落ちるため、実際の大会時体重はこれより軽くなることが多いです。</p>
        <TargetEditor profile={profile} targets={t} today={today} onSetTarget={onSetTarget} />
      </section>

      <CalibrationCard targets={t} onApply={onApplyTdee} onSkip={onSkipCalibration} />

      <NavyForm profile={profile} today={today} body={body} weightKg={t.currentKg} onSave={onSaveSizes} />

      <section className="card">
        <h3>週ごとの計画</h3>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>日付</th>
                <th>大会まで</th>
                <th>計画</th>
                <th>実績</th>
                <th>差</th>
                <th>体脂肪率</th>
              </tr>
            </thead>
            <tbody>
              {milestones.map((m) => {
                const diff = m.actual !== null ? r1(m.actual - m.plan) : null;
                return (
                  <tr key={m.date} className={m.isThisWeek ? 'current' : m.past ? '' : 'future'}>
                    <td>{m.date === profile.contestDate ? `🏆 ${formatJa(m.date)}` : m.date === t.readyDate ? `🎯 ${formatJa(m.date)}` : formatJa(m.date)}</td>
                    <td>{m.weeksOut > 0 ? `${m.weeksOut}週` : '当日'}</td>
                    <td>{m.plan.toFixed(1)}</td>
                    <td>{m.actual !== null ? m.actual.toFixed(1) : '—'}</td>
                    <td className={diff === null ? '' : diff > 0.3 ? 'up' : 'down'}>{diff !== null ? `${diff > 0 ? '+' : ''}${diff}` : ''}</td>
                    <td>{m.bodyFat !== null ? `${m.bodyFat}%` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="muted">
          過去の行は開始時の計画線と実績（7日平均）の比較、これからの行は今の体重から上限ペース内で引き直した計画です。体脂肪率は今の除脂肪体重のままと仮定した値です。
        </p>
      </section>
    </div>
  );
}

/** 減量前に維持カロリーで食べる期間の状態と、そこで測った維持カロリー */
export function CalibrationCard({
  targets: t,
  onApply,
  onSkip,
}: {
  targets: Targets;
  onApply: (kcal: number) => void;
  /** 確認期間を切り上げて（とらずに）推定値で減量に入る */
  onSkip?: () => void;
}) {
  const c = t.calibration;
  const [skipping, setSkipping] = useState(false);
  const [useQuick, setUseQuick] = useState(true);
  if (!c || c.status === 'expired') return null;
  const canSkip = !!onSkip && (c.status === 'active' || c.status === 'upcoming');
  return (
    <section className="card">
      <h3>維持カロリーの確認期間</h3>
      <p className="muted">
        {formatJa(c.start)}〜{formatJa(addDays(c.end, -1))}（{daysBetween(c.start, c.end)}日間）
      </p>
      {c.status === 'upcoming' && (
        <p className="status">減量開始日から始まります。期間中は推定の維持カロリーで食べ、食事を毎日記録してください。</p>
      )}
      {c.status === 'active' && (
        <p className="status">
          確認中 · あと{c.daysLeft}日。推定の維持カロリー {t.tdee} kcal で食べ、食事を毎日記録してください。終わったら実際の体重の動きから維持カロリーを測り、それを基準に赤字を決めます。
        </p>
      )}
      {canSkip &&
        (skipping ? (
          <div className="form">
            <EstimateNote targets={t} useQuick={useQuick} onUseQuick={setUseQuick} />
            <div className="row">
              <button className="ghost grow" onClick={() => setSkipping(false)}>
                確認を続ける
              </button>
              <button
                className="primary grow"
                onClick={() => {
                  if (useQuick && t.quick && quickDiffers(t)) onApply(t.quick.tdee);
                  onSkip!();
                  setSkipping(false);
                }}
              >
                {c.status === 'upcoming' ? '確認なしで減量する' : '今日から減量に入る'}
              </button>
            </div>
          </div>
        ) : (
          <button className="ghost wide" onClick={() => setSkipping(true)}>
            {c.status === 'upcoming' ? '確認期間をとらず、推定値で減量する' : '確認を切り上げて、推定値で減量に入る'}
          </button>
        ))}
      {c.status === 'done' && c.result && (
        <ul className="kv">
          <li>
            <span>実測の維持カロリー</span>
            <span>
              <b>{c.result.tdee} kcal</b>
              <small>
                計算式より {c.result.tdee - t.formulaTdee >= 0 ? '+' : ''}
                {c.result.tdee - t.formulaTdee} kcal
              </small>
            </span>
          </li>
          <li>
            <span>期間中の平均摂取</span>
            <span>
              {c.result.avgIntake} kcal <small>記録 {c.result.loggedDays}/{c.result.days}日</small>
            </span>
          </li>
        </ul>
      )}
      {c.status === 'done' && c.result && (
        <button className="primary wide" disabled={t.tdeeSource === 'manual' && t.tdee === c.result.tdee} onClick={() => onApply(c.result!.tdee)}>
          {t.tdeeSource === 'manual' && t.tdee === c.result.tdee ? '反映済み' : `この値を目標カロリーに反映する（${c.result.tdee} kcal）`}
        </button>
      )}
      {c.status === 'done' && !c.result && (
        <p className="status warn">期間中の食事の記録が足りないため（7割以上必要）、維持カロリーを実測できませんでした。記録からの推定か計算式を使っています。</p>
      )}
    </section>
  );
}

/** 今の除脂肪体重から出した目安を見ながら、目標体重を変える */
function TargetEditor({ profile, targets: t, today, onSetTarget }: { profile: Profile; targets: Targets; today: string; onSetTarget: (kg: number) => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(String(t.targetWeightKg));
  if (!open) {
    return (
      <button className="ghost wide" onClick={() => setOpen(true)}>
        目安を見て目標体重を変える
      </button>
    );
  }
  const kg = Number(value);
  const options =
    t.leanKg !== null ? targetOptions(profile.sex, t.leanKg, t.currentKg, Math.max(0, daysBetween(today, t.readyDate)), profile.maxWeeklyLossPct) : [];
  return (
    <form
      className="form target-editor"
      onSubmit={(e) => {
        e.preventDefault();
        if (kg >= 30) {
          onSetTarget(Math.round(kg * 10) / 10);
          setOpen(false);
        }
      }}
    >
      {t.leanKg !== null ? (
        <TargetGuide options={options} leanKg={t.leanKg} maxWeeklyLossPct={profile.maxWeeklyLossPct} selectedKg={kg} onPick={(w) => setValue(String(w))} />
      ) : (
        <p className="muted">直近30日の体脂肪率がないため目安を出せません。下で首とウエスト{profile.sex === 'female' ? '・ヒップ' : ''}を測ると表示されます。</p>
      )}
      <div className="row">
        <label className="grow">
          目標体重 (kg)
          <input type="number" inputMode="decimal" step="0.1" value={value} onChange={(e) => setValue(e.target.value)} />
        </label>
        <button type="submit" className="primary" disabled={!(kg >= 30)}>
          保存
        </button>
      </div>
      <button type="button" className="ghost wide" onClick={() => setOpen(false)}>
        閉じる
      </button>
    </form>
  );
}

export function NavyForm({
  profile,
  today,
  body,
  weightKg,
  onSave,
}: {
  profile: Profile;
  today: string;
  body: BodyRecord[];
  /** 除脂肪体重の計算に使う体重（7日平均） */
  weightKg: number;
  onSave: Props['onSaveSizes'];
}) {
  const female = profile.sex === 'female';
  // 首とウエストを測った一番新しい記録を初期値にする
  const last = [...body].sort((a, b) => b.date.localeCompare(a.date)).find((r) => r.waistCm !== undefined && r.neckCm !== undefined);
  const init = (v: number | undefined) => (v !== undefined ? String(v) : '');
  const [waist, setWaist] = useState(init(last?.waistCm));
  const [neck, setNeck] = useState(init(last?.neckCm));
  const [hip, setHip] = useState(init(last?.hipCm));
  const [saved, setSaved] = useState(false);
  const [edited, setEdited] = useState(false);
  const edit = (setter: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setter(e.target.value);
    setSaved(false);
    setEdited(true);
  };
  // 前の日の値を表示しているだけのときは、今日の記録として保存しない
  const showingOld = !edited && last !== undefined && last.date !== today;

  const w = Number(waist);
  const n = Number(neck);
  const h = Number(hip);
  const ready = w > 0 && n > 0 && (!female || h > 0);
  const bf = ready ? navyBodyFat(profile.sex, profile.heightCm, w, n, female ? h : undefined) : null;
  const leanKg = bf !== null ? r1(weightKg * (1 - bf / 100)) : null;
  const contest = leanKg !== null ? contestRange(leanKg, profile.bulk.stageBodyFatPct) : null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (bf === null) return;
    onSave({ waistCm: w, neckCm: n, ...(female ? { hipCm: h } : {}) });
    setSaved(true);
  };

  return (
    <form className="card form" onSubmit={submit}>
      <h3>海軍式で体脂肪率を測る</h3>
      <div className="row">
        <label className="grow">
          首 (cm)
          <input type="number" inputMode="decimal" step="0.1" value={neck} onChange={edit(setNeck)} />
        </label>
        <label className="grow">
          ウエスト (cm)
          <input type="number" inputMode="decimal" step="0.1" value={waist} onChange={edit(setWaist)} />
        </label>
        {female && (
          <label className="grow">
            ヒップ (cm)
            <input type="number" inputMode="decimal" step="0.1" value={hip} onChange={edit(setHip)} />
          </label>
        )}
      </div>
      {bf !== null && leanKg !== null && contest !== null ? (
        <div className="navy-result">
          <div>
            <div className="stat-label">体脂肪率</div>
            <b>{bf.toFixed(1)}%</b>
          </div>
          <div>
            <div className="stat-label">除脂肪体重</div>
            <b>{leanKg.toFixed(1)} kg</b>
          </div>
          <div className="navy-contest">
            <div className="stat-label">
              推定コンテスト体重（体脂肪率 {contest.lowBf}〜{contest.highBf}%）
            </div>
            <b>{formatContestRange(contest)}</b>
          </div>
          <small className="muted navy-basis">
            身長 {profile.heightCm}cm・体重 {weightKg.toFixed(1)}kg（7日平均）から。コンテスト体重は除脂肪体重を保ってその体脂肪率になる体重
            {showingOld && `。${formatJa(last!.date)}に測ったサイズで計算しています`}
          </small>
        </div>
      ) : (
        <div className="navy-result">
          <span className="muted">{ready ? 'この組み合わせでは計算できません（ウエストが首より大きい値か確認してください）' : 'サイズを入れると計算します'}</span>
        </div>
      )}
      <button type="submit" className="primary wide" disabled={bf === null || saved || showingOld}>
        {saved ? `${formatJa(today)}の記録に保存しました` : showingOld ? '測り直したら今日の記録に保存できます' : `${formatJa(today)}の記録に保存`}
      </button>
      <p className="muted">
        測り方：首は喉仏のすぐ下を、やや下向きに斜めに。
        {female ? 'ウエストは一番細いところ、ヒップは一番太いところ' : 'ウエストはへその高さで水平に'}
        。朝の空腹時、力を抜いて息を吐いたところで測ります。米海軍が隊員向けに作った推定式で、筋肉量がとても多い人やかなり絞れた人では誤差が大きくなりやすいため、絶対値より推移を見てください。
      </p>
    </form>
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
