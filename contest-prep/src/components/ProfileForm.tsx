import { useState } from 'react';
import type { Profile, Sex } from '../types';
import { ACTIVITY_OPTIONS } from '../lib/nutrition';
import { addDays } from '../lib/date';

interface Props {
  initial: Profile | null;
  today: string;
  /** 取り込み済みの最新体重（初回設定の初期値に使う） */
  latestWeight: number | null;
  onSave: (p: Profile) => void;
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
  | 'proteinPerKg'
  | 'fatPct'
  | 'maxWeeklyLossPct'
  | 'manualP'
  | 'manualF'
  | 'manualC',
  string
>;

export function ProfileForm({ initial, today, latestWeight, onSave, submitLabel }: Props) {
  const [sex, setSex] = useState<Sex>(initial?.sex ?? 'male');
  const [activity, setActivity] = useState(initial?.activityFactor ?? 1.55);
  const [tdeeMode, setTdeeMode] = useState<Profile['tdeeMode']>(initial?.tdeeMode ?? 'auto');
  const [useManual, setUseManual] = useState(initial?.manualMacros != null);
  const [f, setF] = useState<Form>({
    contestName: initial?.contestName ?? '',
    contestDate: initial?.contestDate ?? addDays(today, 112),
    prepStartDate: initial?.prepStartDate ?? today,
    age: initial ? String(initial.age) : '',
    heightCm: initial ? String(initial.heightCm) : '',
    startWeightKg: initial ? String(initial.startWeightKg) : latestWeight ? String(latestWeight) : '',
    targetWeightKg: initial ? String(initial.targetWeightKg) : '',
    proteinPerKg: String(initial?.proteinPerKg ?? 2.4),
    fatPct: String(initial?.fatPct ?? 20),
    maxWeeklyLossPct: String(initial?.maxWeeklyLossPct ?? 1),
    manualP: initial?.manualMacros ? String(initial.manualMacros.p) : '',
    manualF: initial?.manualMacros ? String(initial.manualMacros.f) : '',
    manualC: initial?.manualMacros ? String(initial.manualMacros.c) : '',
  });
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => setF((v) => ({ ...v, [k]: e.target.value }));
  const num = (k: keyof Form) => Number(f[k]);

  const manualOk = !useManual || (['manualP', 'manualF', 'manualC'] as const).every((k) => f[k] !== '' && num(k) >= 0);
  const valid =
    f.contestDate > f.prepStartDate &&
    num('age') >= 10 &&
    num('age') <= 100 &&
    num('heightCm') >= 120 &&
    num('heightCm') <= 230 &&
    num('startWeightKg') >= 30 &&
    num('targetWeightKg') >= 30 &&
    num('proteinPerKg') > 0 &&
    num('fatPct') >= 10 &&
    num('fatPct') <= 50 &&
    num('maxWeeklyLossPct') > 0 &&
    manualOk;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    onSave({
      sex,
      age: num('age'),
      heightCm: num('heightCm'),
      contestName: f.contestName.trim(),
      contestDate: f.contestDate,
      prepStartDate: f.prepStartDate,
      startWeightKg: num('startWeightKg'),
      targetWeightKg: num('targetWeightKg'),
      activityFactor: activity,
      proteinPerKg: num('proteinPerKg'),
      fatPct: num('fatPct'),
      maxWeeklyLossPct: num('maxWeeklyLossPct'),
      tdeeMode,
      manualMacros: useManual ? { p: num('manualP'), f: num('manualF'), c: num('manualC') } : null,
    });
  };

  return (
    <form className="card form" onSubmit={submit}>
      <h3>大会</h3>
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
      <div className="row">
        <label className="grow">
          開始時の体重 (kg)
          <input type="number" inputMode="decimal" step="0.1" value={f.startWeightKg} onChange={set('startWeightKg')} />
        </label>
        <label className="grow">
          大会時の目標体重 (kg)
          <input type="number" inputMode="decimal" step="0.1" value={f.targetWeightKg} onChange={set('targetWeightKg')} />
        </label>
      </div>
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
        <p className="muted">
          筋量を守るには週0.5〜1.0%が目安。炭水化物は残りのカロリーで決まります。
        </p>

        <div className="label">消費カロリーの決め方</div>
        <div className="seg">
          <button type="button" className={tdeeMode === 'auto' ? 'on' : ''} onClick={() => setTdeeMode('auto')}>
            記録から推定
          </button>
          <button type="button" className={tdeeMode === 'formula' ? 'on' : ''} onClick={() => setTdeeMode('formula')}>
            計算式のみ
          </button>
        </div>
        <p className="muted">
          「記録から推定」は、食事を7割以上記録した2〜3週間分のデータがたまると、実際の体重の減り方から消費カロリーを逆算して使います。
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
