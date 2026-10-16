import { useMemo, useState } from 'react';
import { useAppData, newId } from './lib/storage';
import { calcPlan, calcStreak } from './lib/calc';
import { todayKey } from './lib/date';
import { ProfileForm } from './components/ProfileForm';
import { Home } from './components/Home';
import { Meals } from './components/Meals';
import { Weights } from './components/Weights';
import { Settings } from './components/Settings';
import type { Profile } from './types';

type Tab = 'home' | 'meals' | 'weights' | 'settings';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'home', label: 'ホーム', icon: '🏠' },
  { id: 'meals', label: 'ごはん', icon: '🍙' },
  { id: 'weights', label: '体重', icon: '⚖️' },
  { id: 'settings', label: '設定', icon: '⚙️' },
];

export function App() {
  const [data, setData] = useAppData();
  const [tab, setTab] = useState<Tab>('home');
  const today = todayKey();
  const { profile, meals, weights } = data;

  const kcalByDate = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of meals) map.set(m.date, (map.get(m.date) ?? 0) + m.kcal);
    return map;
  }, [meals]);

  const saveProfile = (p: Profile) => setData((d) => ({ ...d, profile: p }));

  if (!profile) {
    return (
      <Shell color="#ff5fa2">
        <header className="hero">
          <h1>推し活ダイエット</h1>
          <p>写真会で、いちばん好きな自分で推しの隣に。</p>
        </header>
        <ProfileForm initial={null} onSave={saveProfile} />
      </Shell>
    );
  }

  const plan = calcPlan(profile, weights, today);
  const todayKcal = kcalByDate.get(today) ?? 0;
  const streak = calcStreak(kcalByDate, plan.targetKcal, today);

  return (
    <Shell color={profile.oshiColor}>
      <main className="content">
        {tab === 'home' && (
          <Home profile={profile} plan={plan} today={today} todayKcal={todayKcal} streak={streak} onGoMeals={() => setTab('meals')} />
        )}
        {tab === 'meals' && (
          <Meals
            meals={meals}
            targetKcal={plan.targetKcal}
            onAdd={(m) => setData((d) => ({ ...d, meals: [...d.meals, { ...m, id: newId() }] }))}
            onRemove={(id) => setData((d) => ({ ...d, meals: d.meals.filter((m) => m.id !== id) }))}
          />
        )}
        {tab === 'weights' && (
          <Weights
            profile={profile}
            weights={weights}
            onSave={(w) => setData((d) => ({ ...d, weights: [...d.weights.filter((x) => x.date !== w.date), w] }))}
            onRemove={(date) => setData((d) => ({ ...d, weights: d.weights.filter((x) => x.date !== date) }))}
          />
        )}
        {tab === 'settings' && (
          <Settings profile={profile} plan={plan} onSave={saveProfile} onReset={() => setData({ profile: null, meals: [], weights: [] })} />
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
    </Shell>
  );
}

/** 推しカラーの上に乗せる文字色（明るい色なら黒） */
function textOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 170 ? '#2a2230' : '#ffffff';
}

function Shell({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <div className="app" style={{ '--oshi': color, '--on-oshi': textOn(color) } as React.CSSProperties}>
      {children}
    </div>
  );
}
