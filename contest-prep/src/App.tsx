import { useMemo, useState } from 'react';
import { EMPTY, newId, useAppData } from './lib/storage';
import { calcTargets } from './lib/nutrition';
import { kcalByDate, recentRate, seriesOf } from './lib/analysis';
import { mergeBody } from './lib/importer';
import { sumMacros } from './lib/macros';
import { todayKey } from './lib/date';
import { ProfileForm } from './components/ProfileForm';
import { Today } from './components/Today';
import { Meals } from './components/Meals';
import { Body } from './components/Body';
import { Analysis } from './components/Analysis';
import { Plan } from './components/Plan';
import { Settings } from './components/Settings';
import { Importer } from './components/Importer';
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
  const [tab, setTab] = useState<Tab>('today');
  const today = todayKey();
  const { profile, logs, body, myFoods } = data;

  const intake = useMemo(() => kcalByDate(logs), [logs]);
  const weights = useMemo(() => seriesOf(body, 'weightKg'), [body]);

  const saveProfile = (p: Profile) => setData((d) => ({ ...d, profile: p }));
  const importBody = (records: BodyRecord[]) => setData((d) => ({ ...d, body: mergeBody(d.body, records) }));

  if (!profile) {
    return (
      <div className="app">
        <header className="hero">
          <h1>Contest Prep</h1>
          <p>大会までの減量を、PFC と体の数字で管理する</p>
        </header>
        <div className="stack">
          <Importer onImport={importBody} />
          {weights.length > 0 && <p className="muted center">{weights.length}日分の体重を取り込み済み。最新の値を開始体重に入れています。</p>}
          <ProfileForm
            key={weights.length}
            initial={null}
            today={today}
            latestWeight={weights.at(-1)?.value ?? null}
            onSave={saveProfile}
            submitLabel="はじめる"
          />
        </div>
      </div>
    );
  }

  const targets = calcTargets(profile, body, intake, today);
  const rate = recentRate(weights, today);
  const eaten = sumMacros(logs.filter((l) => l.date === today));

  return (
    <div className="app">
      <main>
        {tab === 'today' && (
          <Today
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
        {tab === 'plan' && (
          <Plan
            profile={profile}
            targets={targets}
            body={body}
            today={today}
            onSaveSizes={(sizes) => setData((d) => ({ ...d, body: upsertBody(d.body, { ...d.body.find((r) => r.date === today), date: today, ...sizes }) }))}
          />
        )}
        {tab === 'analysis' && <Analysis profile={profile} targetWeightKg={targets.targetWeightKg} body={body} logs={logs} today={today} />}
        {tab === 'settings' && (
          <Settings data={data} sync={sync} today={today} onSaveProfile={saveProfile} onRestore={setData} onReset={() => setData(EMPTY)} />
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
