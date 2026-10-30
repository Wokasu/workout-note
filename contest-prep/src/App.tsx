import { useMemo, useState } from 'react';
import { EMPTY, newId, useAppData } from './lib/storage';
import { calcTargets } from './lib/nutrition';
import { kcalByDate, movingAverage, recentRate, seriesOf, valueAtOrBefore } from './lib/analysis';
import { mergeBody } from './lib/importer';
import { sumMacros } from './lib/macros';
import { todayKey } from './lib/date';
import { ProfileForm, type NavySizes } from './components/ProfileForm';
import { Today } from './components/Today';
import { Meals } from './components/Meals';
import { Body } from './components/Body';
import { Analysis } from './components/Analysis';
import { Plan } from './components/Plan';
import { BulkPlan } from './components/BulkPlan';
import { bulkPlanFor } from './lib/bulk';
import { Settings } from './components/Settings';
import { Importer } from './components/Importer';
import { QuickWeight, isQuickWeight } from './components/QuickWeight';
import type { BodyRecord, Profile } from './types';

type Tab = 'today' | 'meals' | 'plan' | 'body' | 'analysis' | 'settings';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'today', label: '今日', icon: '🏁' },
  { id: 'meals', label: '食事', icon: '🍚' },
  { id: 'plan', label: '計画', icon: '🎯' },
  { id: 'body', label: '身体', icon: '⚖️' },
  { id: 'analysis', label: '分析', icon: '📈' },
  { id: 'settings', label: '設定', icon: '⚙️' },
];

/** 日付だけで値のない記録は消す */
function upsertBody(body: BodyRecord[], rec: BodyRecord): BodyRecord[] {
  const rest = body.filter((r) => r.date !== rec.date);
  return Object.keys(rec).length > 1 ? [...rest, rec].sort((a, b) => a.date.localeCompare(b.date)) : rest;
}

export function App() {
  const [data, setData, sync] = useAppData();
  const [tab, setTab] = useState<Tab>('meals');
  const today = todayKey();
  const { profile, logs, body, myFoods } = data;

  const intake = useMemo(() => kcalByDate(logs), [logs]);
  const weights = useMemo(() => seriesOf(body, 'weightKg'), [body]);

  const saveProfile = (p: Profile, sizes: NavySizes | null = null) =>
    setData((d) => ({
      ...d,
      profile: p,
      body: sizes ? upsertBody(d.body, { ...d.body.find((r) => r.date === today), date: today, ...sizes }) : d.body,
    }));
  const importBody = (records: BodyRecord[]) => setData((d) => ({ ...d, body: mergeBody(d.body, records) }));

  if (isQuickWeight()) {
    return (
      <QuickWeight
        current={body.find((r) => r.date === today)?.weightKg}
        last={weights.at(-1)?.value}
        status={sync.status}
        onSave={(kg) => setData((d) => ({ ...d, body: upsertBody(d.body, { ...d.body.find((r) => r.date === today), date: today, weightKg: kg }) }))}
      />
    );
  }

  // 目標体重が決まっていない（初回、または以前の版で体脂肪率から決めていた）ときは設定画面から
  if (!profile || (profile.phase === 'cut' && !(profile.targetWeightKg >= 30))) {
    const avg = valueAtOrBefore(movingAverage(weights), today)?.value;
    return (
      <div className="app">
        <header className="hero">
          <h1>Contest Prep</h1>
          <p>大会までの減量を、PFC と体の数字で管理する</p>
        </header>
        <div className="stack">
          <Importer onImport={importBody} />
          {weights.length > 0 && <p className="muted center">{weights.length}日分の体重を取り込み済み。最新の値を今の体重に入れています。</p>}
          {profile && <p className="status warn">大会時の目標体重を決めてください。海軍式の目安を見て入力できます。</p>}
          <ProfileForm
            key={body.length}
            initial={profile}
            today={today}
            body={body}
            currentKg={profile && avg !== undefined ? Math.round(avg * 10) / 10 : null}
            onSave={saveProfile}
            submitLabel="はじめる"
          />
        </div>
      </div>
    );
  }

  const targets = calcTargets(profile, body, intake, today);
  const bulkPlan = bulkPlanFor(profile, targets, today);
  // 記録から出した維持カロリーを、本人が選んだときだけ目標に反映する
  const applyTdee = (kcal: number) =>
    setData((d) => ({ ...d, profile: d.profile && { ...d.profile, tdeeMode: 'manual', manualTdee: { kcal, date: today } } }));
  const useFormula = () => setData((d) => ({ ...d, profile: d.profile && { ...d.profile, tdeeMode: 'formula' } }));
  // 増量期から大会に向けた減量へ：今日を減量開始日にして、目標体重は設定画面で決め直す
  const switchToCut = (calibrate: boolean) =>
    setData((d) => ({
      ...d,
      profile: d.profile && {
        ...d.profile,
        phase: 'cut',
        prepStartDate: today,
        startWeightKg: targets.currentKg,
        targetWeightKg: 0,
        calibrationSkippedOn: calibrate ? null : today,
      },
    }));
  // コンテスト減量の確認期間を切り上げる（始まる前なら開始日から確認なし）
  const skipPrepCalibration = () =>
    setData((d) => ({
      ...d,
      profile: d.profile && { ...d.profile, calibrationSkippedOn: d.profile.prepStartDate > today ? d.profile.prepStartDate : today },
    }));
  const rate = recentRate(weights, today);
  const eaten = sumMacros(logs.filter((l) => l.date === today));

  return (
    <div className="app">
      <main>
        {tab === 'today' && (
          <Today
            onApplyTdee={applyTdee}
            onUseFormula={useFormula}
            bulkPlan={bulkPlan}
            profile={profile}
            targets={targets}
            today={today}
            eaten={eaten}
            rate={rate}
            todayBody={body.find((r) => r.date === today)}
            onSaveWeight={(kg) => setData((d) => ({ ...d, body: upsertBody(d.body, { ...d.body.find((r) => r.date === today), date: today, weightKg: kg }) }))}
            onGoMeals={() => setTab('meals')}
          />
        )}
        {tab === 'meals' && (
          <Meals
            today={today}
            logs={logs}
            myFoods={myFoods}
            target={targets}
            onAdd={(items) => setData((d) => ({ ...d, logs: [...d.logs, ...items.map((l) => ({ ...l, id: newId() }))] }))}
            onRemove={(id) => setData((d) => ({ ...d, logs: d.logs.filter((l) => l.id !== id) }))}
            onAddFood={(f) =>
              setData((d) => ({ ...d, myFoods: [{ ...f, id: newId() }, ...d.myFoods.filter((x) => x.name !== f.name)] }))
            }
            onRemoveFood={(id) => setData((d) => ({ ...d, myFoods: d.myFoods.filter((f) => f.id !== id) }))}
          />
        )}
        {tab === 'body' && (
          <Body
            today={today}
            body={body}
            onImport={importBody}
            onSave={(rec) => setData((d) => ({ ...d, body: upsertBody(d.body, rec) }))}
            onRemove={(date) => setData((d) => ({ ...d, body: d.body.filter((r) => r.date !== date) }))}
          />
        )}
        {tab === 'plan' && profile.phase === 'bulk' && (
          <BulkPlan
            onApplyTdee={applyTdee}
            onSaveBulk={(bulk) => setData((d) => ({ ...d, profile: d.profile && { ...d.profile, bulk } }))}
            plan={bulkPlan!}
            onSwitchToCut={switchToCut}
            profile={profile}
            targets={targets}
            body={body}
            today={today}
            onSaveSizes={(sizes) => setData((d) => ({ ...d, body: upsertBody(d.body, { ...d.body.find((r) => r.date === today), date: today, ...sizes }) }))}
          />
        )}
        {tab === 'plan' && profile.phase === 'cut' && (
          <Plan
            onApplyTdee={applyTdee}
            onSkipCalibration={skipPrepCalibration}
            profile={profile}
            targets={targets}
            body={body}
            today={today}
            onSaveSizes={(sizes) => setData((d) => ({ ...d, body: upsertBody(d.body, { ...d.body.find((r) => r.date === today), date: today, ...sizes }) }))}
            onSetTarget={(kg) => setData((d) => ({ ...d, profile: d.profile && { ...d.profile, targetWeightKg: kg } }))}
          />
        )}
        {tab === 'analysis' && <Analysis onApplyTdee={applyTdee} onUseFormula={useFormula} profile={profile} targets={targets} targetWeightKg={profile.phase === 'cut' ? targets.targetWeightKg : null} body={body} logs={logs} today={today} />}
        {tab === 'settings' && (
          <Settings data={data} sync={sync} today={today} currentKg={targets.currentKg} onSaveProfile={saveProfile} onRestore={setData} onReset={() => setData(EMPTY)} />
        )}
      </main>
      <nav className="tabbar">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            <span className="tab-icon">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
