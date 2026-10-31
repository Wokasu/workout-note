import { useState } from 'react';
import type { BodyFatSource, BodyRecord, BulkSettings, Profile, Sex } from '../types';
import { ACTIVITY_OPTIONS } from '../lib/nutrition';
import { seriesOf, valueAtOrBefore } from '../lib/analysis';
import { contestRange, ffmi, formatContestRange, navyBodyFat, targetOptions } from '../lib/navy';
import { addDays, daysBetween, formatJa } from '../lib/date';
import { TargetGuide } from './TargetGuide';
import { bulkLimits, defaultBulkSettings } from '../lib/bulk';

export type NavySizes = Pick<BodyRecord, 'waistCm' | 'neckCm' | 'hipCm'>;

interface Props {
  initial: Profile | null;
  today: string;
  /** 取り込み済みの身体データ（体重・サイズの初期値と体脂肪率に使う） */
  body: BodyRecord[];
  /** 今の体重（7日平均）。まだ記録がなければ null で、入力した体重を使う */
  currentKg: number | null;
  /** sizes は海軍式のサイズを入力し直したときだけ渡す（今日の記録に保存する） */
  onSave: (p: Profile, sizes: NavySizes | null) => void;
  submitLabel: string;
}

type Form = Record<
  | 'contestName'
  | 'contestDate'
  | 'prepStartDate'
  | 'age'
  | 'heightCm'
  | 'startWeightKg'
  | 'targetWeightKg'
  | 'neckCm'
  | 'waistCm'
  | 'hipCm'
  | 'proteinPerKg'
  | 'fatPct'
  | 'maxWeeklyLossPct'
  | 'calibrationDays'
  | 'manualP'
  | 'manualF'
  | 'manualC',
  string
>;

export function ProfileForm({ initial, today, body, currentKg, onSave, submitLabel }: Props) {
  const latestWeight = seriesOf(body, 'weightKg').at(-1)?.value;
  // 首とウエストを測った一番新しい記録をサイズの初期値にする
  const lastSizes = [...body].reverse().find((r) => r.waistCm !== undefined && r.neckCm !== undefined);
  const [sex, setSex] = useState<Sex>(initial?.sex ?? 'male');
  const [activity, setActivity] = useState(initial?.activityFactor ?? 1.55);
  const [sizesEdited, setSizesEdited] = useState(false);
  const [bodyFatSource, setBodyFatSource] = useState<BodyFatSource>(initial?.bodyFatSource ?? 'auto');
  const [tdeeMode, setTdeeMode] = useState<Profile['tdeeMode']>(initial?.tdeeMode ?? 'formula');
  const [useManual, setUseManual] = useState(initial?.manualMacros != null);
  const [phase, setPhase] = useState<Profile['phase']>(initial?.phase ?? 'cut');
  const bulkInit = initial?.bulk ?? defaultBulkSettings(initial?.sex ?? 'male', today);
  const [b, setB] = useState<Record<keyof BulkSettings, string>>(
    Object.fromEntries(Object.entries(bulkInit).map(([k, v]) => [k, String(v)])) as Record<keyof BulkSettings, string>,
  );
  const setBulk = (k: keyof BulkSettings) => (e: React.ChangeEvent<HTMLInputElement>) => setB((v) => ({ ...v, [k]: e.target.value }));
  const bn = (k: Exclude<keyof BulkSettings, 'startDate'>) => Number(b[k]);
  const [f, setF] = useState<Form>({
    contestName: initial?.contestName ?? '',
    contestDate: initial?.contestDate ?? addDays(today, 112),
    prepStartDate: initial?.prepStartDate ?? today,
    age: initial ? String(initial.age) : '',
    heightCm: initial ? String(initial.heightCm) : '',
    startWeightKg: initial ? String(initial.startWeightKg) : latestWeight ? String(Math.round(latestWeight * 10) / 10) : '',
    targetWeightKg: initial && initial.targetWeightKg >= 30 ? String(initial.targetWeightKg) : '',
    neckCm: lastSizes?.neckCm !== undefined ? String(lastSizes.neckCm) : '',
    waistCm: lastSizes?.waistCm !== undefined ? String(lastSizes.waistCm) : '',
    hipCm: lastSizes?.hipCm !== undefined ? String(lastSizes.hipCm) : '',
    proteinPerKg: String(initial?.proteinPerKg ?? 2.4),
    fatPct: String(initial?.fatPct ?? 20),
    maxWeeklyLossPct: String(initial?.maxWeeklyLossPct ?? 1),
    calibrationDays: String(initial?.calibrationDays ?? 14),
    manualP: initial?.manualMacros ? String(initial.manualMacros.p) : '',
    manualF: initial?.manualMacros ? String(initial.manualMacros.f) : '',
    manualC: initial?.manualMacros ? String(initial.manualMacros.c) : '',
  });
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => setF((v) => ({ ...v, [k]: e.target.value }));
  const setSize = (k: 'neckCm' | 'waistCm' | 'hipCm') => (e: React.ChangeEvent<HTMLInputElement>) => {
    setF((v) => ({ ...v, [k]: e.target.value }));
    setSizesEdited(true);
  };
  const num = (k: keyof Form) => Number(f[k]);

  // 海軍式で今の体脂肪率 → 除脂肪体重 → 大会時の目標体重の目安
  const female = sex === 'female';
  const weightNow = currentKg ?? (num('startWeightKg') >= 30 ? num('startWeightKg') : null);
  const navyBf =
    num('heightCm') >= 120 && num('waistCm') > 0 && num('neckCm') > 0 && (!female || num('hipCm') > 0)
      ? navyBodyFat(sex, num('heightCm'), num('waistCm'), num('neckCm'), female ? num('hipCm') : undefined)
      : null;
  const scale = valueAtOrBefore(seriesOf(body, 'bodyFatPct'), today);
  const scaleBf = bodyFatSource !== 'navy' && scale && scale.date >= addDays(today, -30) ? scale : null;
  const useNavy = navyBf !== null && bodyFatSource !== 'scale';
  const bf = useNavy ? navyBf : (scaleBf?.value ?? null);
  const leanKg = bf !== null && weightNow !== null ? Math.round(weightNow * (1 - bf / 100) * 10) / 10 : null;
  const daysLeft = Math.max(0, daysBetween(today, f.contestDate));
  const options =
    leanKg !== null && weightNow !== null && num('maxWeeklyLossPct') > 0
      ? targetOptions(sex, leanKg, weightNow, daysLeft, num('maxWeeklyLossPct'))
      : [];
  const pickTarget = (kg: number) => setF((v) => ({ ...v, targetWeightKg: String(kg) }));

  const manualOk = !useManual || (['manualP', 'manualF', 'manualC'] as const).every((k) => f[k] !== '' && num(k) >= 0);
  const bulking = phase === 'bulk';
  const bulkOk =
    !bulking ||
    (b.startDate !== '' &&
      b.startDate <= today &&
      bn('stageBodyFatPct') >= 3 &&
      bn('stageBodyFatPct') <= 30 &&
      bn('ceilingMarginKg') > 0 &&
      bn('returnKg') > 0 &&
      bn('returnKg') < bn('ceilingMarginKg') &&
      bn('startSurplusKcal') >= 0 &&
      bn('rampKcal') >= 0 &&
      bn('maxSurplusKcal') >= bn('startSurplusKcal') &&
      bn('miniCutPct') > 0 &&
      bn('miniCutPct') <= 2 &&
      bn('gainKgPerMonth') > 0 &&
      bn('gainKgPerMonth') <= 5 &&
      bn('prepPaceMinKg') > 0 &&
      bn('prepPaceMaxKg') >= bn('prepPaceMinKg'));
  const limits = bulking && leanKg !== null && bn('stageBodyFatPct') > 0 ? bulkLimits(leanKg, { ...bulkInit, ...numericBulk() }) : null;
  function numericBulk(): BulkSettings {
    return {
      startDate: b.startDate,
      stageBodyFatPct: bn('stageBodyFatPct'),
      ceilingMarginKg: bn('ceilingMarginKg'),
      returnKg: bn('returnKg'),
      startSurplusKcal: bn('startSurplusKcal'),
      rampKcal: bn('rampKcal'),
      maxSurplusKcal: bn('maxSurplusKcal'),
      miniCutPct: bn('miniCutPct'),
      gainKgPerMonth: bn('gainKgPerMonth'),
      prepPaceMinKg: bn('prepPaceMinKg'),
      prepPaceMaxKg: bn('prepPaceMaxKg'),
      manualCuts: bulkInit.manualCuts,
    };
  }
  const valid =
    (bulking || f.contestDate > f.prepStartDate) &&
    bulkOk &&
    num('age') >= 10 &&
    num('age') <= 100 &&
    num('heightCm') >= 120 &&
    num('heightCm') <= 230 &&
    num('startWeightKg') >= 30 &&
    (bulking || num('targetWeightKg') >= 30) &&
    num('proteinPerKg') > 0 &&
    num('fatPct') >= 10 &&
    num('fatPct') <= 50 &&
    num('maxWeeklyLossPct') > 0 &&
    f.calibrationDays !== '' &&
    num('calibrationDays') >= 0 &&
    num('calibrationDays') <= 42 &&
    manualOk;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    const sizes: NavySizes | null =
      sizesEdited && navyBf !== null
        ? { waistCm: num('waistCm'), neckCm: num('neckCm'), ...(female ? { hipCm: num('hipCm') } : {}) }
        : null;
    onSave(
      {
        phase,
        bulk: numericBulk(),
        sex,
        age: num('age'),
        heightCm: num('heightCm'),
        contestName: f.contestName.trim(),
        contestDate: f.contestDate,
        prepStartDate: f.prepStartDate,
        startWeightKg: num('startWeightKg'),
        targetWeightKg: num('targetWeightKg') || (initial?.targetWeightKg ?? 0),
        bodyFatSource,
        activityFactor: activity,
        proteinPerKg: num('proteinPerKg'),
        fatPct: num('fatPct'),
        maxWeeklyLossPct: num('maxWeeklyLossPct'),
        calibrationDays: Math.round(num('calibrationDays')),
        tdeeMode,
        manualTdee: initial?.manualTdee ?? null,
        calibrationSkippedOn: initial?.calibrationSkippedOn ?? null,
        manualMacros: useManual ? { p: num('manualP'), f: num('manualF'), c: num('manualC') } : null,
      },
      sizes,
    );
  };

  return (
    <form className="card form" onSubmit={submit}>
      <h3>今の時期</h3>
      <div className="seg">
        <button type="button" className={phase === 'cut' ? 'on' : ''} onClick={() => setPhase('cut')}>
          コンテスト減量
        </button>
        <button
          type="button"
          className={phase === 'bulk' ? 'on' : ''}
          onClick={() => {
            setPhase('bulk');
            // 増量を始めた日が未来（減量開始日の名残り）なら今日にする
            setB((v) => (v.startDate === '' || v.startDate > today ? { ...v, startDate: today } : v));
          }}
        >
          増量期（オフ）
        </button>
      </div>

      <h3>{bulking ? '次の大会（決まっていれば）' : '大会'}</h3>
      <label>
        大会名
        <input value={f.contestName} onChange={set('contestName')} placeholder="例：〇〇ボディビル選手権" />
      </label>
      <div className="row">
        <label className="grow">
          大会日
          <input type="date" value={f.contestDate} onChange={set('contestDate')} />
        </label>
        <label className="grow">
          減量開始日
          <input type="date" value={f.prepStartDate} onChange={set('prepStartDate')} />
        </label>
      </div>

      <h3>体</h3>
      <div className="seg">
        {(['male', 'female'] as const).map((s) => (
          <button type="button" key={s} className={sex === s ? 'on' : ''} onClick={() => setSex(s)}>
            {s === 'male' ? '男性' : '女性'}
          </button>
        ))}
      </div>
      <div className="row">
        <label className="grow">
          年齢
          <input type="number" inputMode="numeric" value={f.age} onChange={set('age')} />
        </label>
        <label className="grow">
          身長 (cm)
          <input type="number" inputMode="decimal" value={f.heightCm} onChange={set('heightCm')} />
        </label>
      </div>
      <label>
        {initial ? '減量開始時の体重 (kg)' : '今の体重 (kg)'}
        <input type="number" inputMode="decimal" step="0.1" value={f.startWeightKg} onChange={set('startWeightKg')} />
      </label>

      <h3>今の体脂肪率（米海軍式）</h3>
      <p className="muted">
        首は喉仏のすぐ下、ウエストは{female ? '一番細いところ、ヒップは一番太いところ' : 'へその高さ'}で測ります。
        {lastSizes && !sizesEdited && ` ${formatJa(lastSizes.date)}の記録を入れています。`}
      </p>
      <div className="row">
        <label className="grow">
          首 (cm)
          <input type="number" inputMode="decimal" step="0.1" value={f.neckCm} onChange={setSize('neckCm')} />
        </label>
        <label className="grow">
          ウエスト (cm)
          <input type="number" inputMode="decimal" step="0.1" value={f.waistCm} onChange={setSize('waistCm')} />
        </label>
        {female && (
          <label className="grow">
            ヒップ (cm)
            <input type="number" inputMode="decimal" step="0.1" value={f.hipCm} onChange={setSize('hipCm')} />
          </label>
        )}
      </div>
      {bf !== null && leanKg !== null ? (
        <div className="stats">
          <div className="stat">
            <div className="stat-label">体脂肪率</div>
            <div className="stat-value">{bf.toFixed(1)} %</div>
            <div className="stat-sub">{useNavy ? '海軍式' : `体組成計 · ${formatJa(scaleBf!.date)}`}</div>
          </div>
          <div className="stat">
            <div className="stat-label">除脂肪体重</div>
            <div className="stat-value">{leanKg.toFixed(1)} kg</div>
            <div className="stat-sub">FFMI {ffmi(leanKg, num('heightCm') || 170).normalized}（身長補正）</div>
          </div>
        </div>
      ) : (
        <p className="muted">身長・体重と、首・ウエスト{female ? '・ヒップ' : ''}を入れると計算します。</p>
      )}
      <label>
        体脂肪率に使う値
        <select value={bodyFatSource} onChange={(e) => setBodyFatSource(e.target.value as BodyFatSource)}>
          <option value="auto">自動（海軍式が出せれば海軍式）</option>
          <option value="navy">海軍式のみ</option>
          <option value="scale">体組成計の値</option>
        </select>
      </label>

      {bulking ? (
        <>
          <h3>増量の上限</h3>
          <div className="row">
            <label className="grow">
              コンテスト時の体脂肪率 (%)
              <input type="number" inputMode="decimal" step="0.5" value={b.stageBodyFatPct} onChange={setBulk('stageBodyFatPct')} />
            </label>
            <label className="grow">
              コンテスト体重からの幅 (kg)
              <input type="number" inputMode="decimal" step="0.5" value={b.ceilingMarginKg} onChange={setBulk('ceilingMarginKg')} />
            </label>
          </div>
          {limits ? (
            <div className="stats">
              <div className="stat">
                <div className="stat-label">推定コンテスト体重</div>
                <div className="stat-value">{formatContestRange(contestRange(limits.leanKg, bn('stageBodyFatPct')))}</div>
                <div className="stat-sub">
                  除脂肪 {limits.leanKg} kg・体脂肪率 {Math.max(1, bn('stageBodyFatPct') - 1)}〜{bn('stageBodyFatPct') + 1}%
                </div>
              </div>
              <div className="stat">
                <div className="stat-label">増量の上限</div>
                <div className="stat-value">{limits.ceilingKg.toFixed(1)} kg</div>
                <div className="stat-sub">超えたら {limits.lowerKg.toFixed(1)} kg までプチダイエット</div>
              </div>
            </div>
          ) : (
            <p className="muted">
              体脂肪率がわかると、上限を計算します（上の首・ウエストを入れてください）。それまでは上限なしで増量します。
            </p>
          )}
          <h3>ペース</h3>
          <label>
            増量の目標ペース（kg/月）
            <input type="number" inputMode="decimal" step="0.1" value={b.gainKgPerMonth} onChange={setBulk('gainKgPerMonth')} />
          </label>
          <p className="muted">
            余剰カロリーは毎週、直近2週間の増え方を見て調整します。目標の3/4に届かなければ増やし、1.5倍を超えたら減らし、その間なら据え置きます。
          </p>
          <div className="row">
            <label className="grow">
              大会に向けた減量（kg/月）
              <input type="number" inputMode="decimal" step="0.5" value={b.prepPaceMinKg} onChange={setBulk('prepPaceMinKg')} />
            </label>
            <label className="grow">
              〜（kg/月）
              <input type="number" inputMode="decimal" step="0.5" value={b.prepPaceMaxKg} onChange={setBulk('prepPaceMaxKg')} />
            </label>
          </div>
          <p className="muted">上の「次の大会」の日付から、このペースで落とすとしたら減量にいつ入ればよいかを計画タブに出します。</p>
          <details className="advanced" open={b.startDate > today || undefined}>
            <summary>増量の進め方</summary>
            <label>
              増量を始めた日
              <input type="date" value={b.startDate} max={today} onChange={setBulk('startDate')} />
            </label>
            {b.startDate > today && <p className="status warn">増量を始めた日が未来になっています。今日以前の日付にしてください。</p>}
            <div className="row">
              <label className="grow">
                最初の余剰 (kcal/日)
                <input type="number" inputMode="numeric" value={b.startSurplusKcal} onChange={setBulk('startSurplusKcal')} />
              </label>
              <label className="grow">
                毎週の調整幅 (kcal)
                <input type="number" inputMode="numeric" value={b.rampKcal} onChange={setBulk('rampKcal')} />
              </label>
              <label className="grow">
                余剰の上限 (kcal)
                <input type="number" inputMode="numeric" value={b.maxSurplusKcal} onChange={setBulk('maxSurplusKcal')} />
              </label>
            </div>
            <div className="row">
              <label className="grow">
                プチダイエットで戻す幅 (kg)
                <input type="number" inputMode="decimal" step="0.5" value={b.returnKg} onChange={setBulk('returnKg')} />
              </label>
              <label className="grow">
                プチダイエットのペース (%/週)
                <input type="number" inputMode="decimal" step="0.05" value={b.miniCutPct} onChange={setBulk('miniCutPct')} />
              </label>
            </div>
            <p className="muted">
              維持カロリーに余剰を足して増量します。余剰は「最初の余剰」から始め、毎週「調整幅」ずつ目標ペースに合わせて増減します（「余剰の上限」まで）。体重（7日平均）が上限に達したらプチダイエットに切り替えて「上限 − 戻す幅」まで落とし、また最初の余剰から増量を再開します。
            </p>
          </details>
        </>
      ) : (
        <>
          <h3>大会時の目標体重</h3>
          {leanKg !== null && (
            <TargetGuide
              options={options}
              leanKg={leanKg}
              maxWeeklyLossPct={num('maxWeeklyLossPct')}
              selectedKg={f.targetWeightKg === '' ? null : num('targetWeightKg')}
              onPick={pickTarget}
            />
          )}
          <label>
            目標体重 (kg)
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              value={f.targetWeightKg}
              onChange={set('targetWeightKg')}
              placeholder={leanKg !== null ? '上の目安を見て入力' : ''}
            />
          </label>
          {f.targetWeightKg !== '' && leanKg !== null && num('targetWeightKg') > leanKg && (
            <p className="muted">
              この体重だと体脂肪率は約 {Math.round((1 - leanKg / num('targetWeightKg')) * 1000) / 10}%（除脂肪体重を保った場合）
              {daysLeft > 0 && weightNow !== null && num('targetWeightKg') < weightNow
                ? `、必要なペースは週 ${(((weightNow - num('targetWeightKg')) / daysLeft) * 7).toFixed(2)} kg です。`
                : '。'}
            </p>
          )}
        </>
      )}
      <label>
        活動量
        <select value={activity} onChange={(e) => setActivity(Number(e.target.value))}>
          {ACTIVITY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}（×{o.value}）
            </option>
          ))}
        </select>
      </label>
      <label>
        減量前の維持カロリー確認期間（日）
        <input type="number" inputMode="numeric" value={f.calibrationDays} onChange={set('calibrationDays')} />
      </label>
      <p className="muted">
        {bulking ? '上限に届いてプチダイエットに入る前' : '減量開始日から'}
        、この日数は推定の維持カロリーで食べ、その間の摂取と体重の変化から実際の維持カロリーを測ります。終わったら実測値を基準に赤字を決めます。0 にすると確認期間なしですぐ減量に入ります。
      </p>

      <details className="advanced" open={initial !== null}>
        <summary>栄養の設定</summary>
        <div className="row">
          <label className="grow">
            たんぱく質 (g/体重kg)
            <input type="number" inputMode="decimal" step="0.1" value={f.proteinPerKg} onChange={set('proteinPerKg')} />
          </label>
          <label className="grow">
            脂質 (% of kcal)
            <input type="number" inputMode="numeric" value={f.fatPct} onChange={set('fatPct')} />
          </label>
        </div>
        <label>
          減量ペースの上限（体重の %/週）
          <input type="number" inputMode="decimal" step="0.1" value={f.maxWeeklyLossPct} onChange={set('maxWeeklyLossPct')} />
        </label>
        <p className="muted">筋量を守るには週0.5〜1.0%が目安。炭水化物は残りのカロリーで決まります。</p>

        <div className="label">維持カロリーの決め方</div>
        <div className="seg">
          <button type="button" className={tdeeMode === 'formula' ? 'on' : ''} onClick={() => setTdeeMode('formula')}>
            計算式
          </button>
          {initial?.manualTdee && (
            <button type="button" className={tdeeMode === 'manual' ? 'on' : ''} onClick={() => setTdeeMode('manual')}>
              反映した値
            </button>
          )}
          <button type="button" className={tdeeMode === 'auto' ? 'on' : ''} onClick={() => setTdeeMode('auto')}>
            毎週自動で更新
          </button>
        </div>
        <p className="muted">
          記録からの推定値は、今日タブ・分析タブに出る「目標カロリーに反映する」を押したときに使います（「反映した値」
          {initial?.manualTdee ? `：${initial.manualTdee.kcal} kcal` : ''}
          ）。「毎週自動で更新」は、食事を6割以上記録した2週間ごとに推定値を少しずつ自動で反映します。
        </p>

        <label className="check">
          <input type="checkbox" checked={useManual} onChange={(e) => setUseManual(e.target.checked)} />
          コーチ指定の PFC を使う
        </label>
        {useManual && (
          <div className="row">
            <label className="grow">
              P (g)
              <input type="number" inputMode="numeric" value={f.manualP} onChange={set('manualP')} />
            </label>
            <label className="grow">
              F (g)
              <input type="number" inputMode="numeric" value={f.manualF} onChange={set('manualF')} />
            </label>
            <label className="grow">
              C (g)
              <input type="number" inputMode="numeric" value={f.manualC} onChange={set('manualC')} />
            </label>
          </div>
        )}
      </details>

      <button type="submit" className="primary wide" disabled={!valid}>
        {submitLabel}
      </button>
    </form>
  );
}
