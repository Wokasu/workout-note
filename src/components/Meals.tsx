import { useMemo, useState } from 'react';
import type { Meal, MealType } from '../types';
import { FOOD_PRESETS } from '../lib/foods';
import { addDays, formatJa, todayKey } from '../lib/date';

export const MEAL_LABELS: Record<MealType, string> = {
  breakfast: '🌅 朝ごはん',
  lunch: '☀️ 昼ごはん',
  dinner: '🌙 夜ごはん',
  snack: '🍪 間食',
};

function guessMealType(): MealType {
  const h = new Date().getHours();
  if (h < 10) return 'breakfast';
  if (h < 15) return 'lunch';
  if (h < 17) return 'snack';
  return 'dinner';
}

interface Props {
  meals: Meal[];
  targetKcal: number;
  onAdd: (m: Omit<Meal, 'id'>) => void;
  onRemove: (id: string) => void;
}

export function Meals({ meals, targetKcal, onAdd, onRemove }: Props) {
  const [date, setDate] = useState(todayKey());
  const [type, setType] = useState<MealType>(guessMealType);
  const [name, setName] = useState('');
  const [kcal, setKcal] = useState('');
  const [showPresets, setShowPresets] = useState(false);

  const dayMeals = useMemo(() => meals.filter((m) => m.date === date), [meals, date]);
  const total = dayMeals.reduce((s, m) => s + m.kcal, 0);

  // 自分がよく記録するメニューを上に出す
  const recent = useMemo(() => {
    const seen = new Map<string, number>();
    for (const m of [...meals].reverse()) if (!seen.has(m.name)) seen.set(m.name, m.kcal);
    return [...seen].slice(0, 6).map(([n, k]) => ({ name: n, kcal: k }));
  }, [meals]);

  const add = (n: string, k: number) => {
    if (!n.trim() || !(k >= 0)) return;
    onAdd({ date, type, name: n.trim(), kcal: Math.round(k) });
    setName('');
    setKcal('');
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (kcal === '') return;
    add(name, Number(kcal));
  };

  const categories = [...new Set(FOOD_PRESETS.map((f) => f.category))];
  const isToday = date === todayKey();

  return (
    <div className="stack">
      <section className="card">
        <div className="date-nav">
          <button className="ghost" onClick={() => setDate(addDays(date, -1))} aria-label="前の日">
            ‹
          </button>
          <div className="date-title">{isToday ? `今日 ${formatJa(date)}` : formatJa(date)}</div>
          <button className="ghost" onClick={() => setDate(addDays(date, 1))} disabled={isToday} aria-label="次の日">
            ›
          </button>
        </div>
        <div className={`day-total ${total > targetKcal ? 'over' : ''}`}>
          合計 <b>{total}</b> / {targetKcal} kcal
        </div>
      </section>

      <form className="card form" onSubmit={submit}>
        <div className="seg">
          {(Object.keys(MEAL_LABELS) as MealType[]).map((t) => (
            <button type="button" key={t} className={type === t ? 'on' : ''} onClick={() => setType(t)}>
              {MEAL_LABELS[t]}
            </button>
          ))}
        </div>
        <div className="row">
          <label className="grow">
            メニュー
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例：サラダチキン" />
          </label>
          <label className="kcal-input">
            kcal
            <input type="number" inputMode="numeric" min={0} value={kcal} onChange={(e) => setKcal(e.target.value)} />
          </label>
        </div>
        <button type="submit" className="primary wide" disabled={!name.trim() || kcal === ''}>
          追加
        </button>

        {recent.length > 0 && (
          <>
            <div className="label">よく食べるもの</div>
            <div className="chips">
              {recent.map((f) => (
                <button type="button" key={f.name} className="chip" onClick={() => add(f.name, f.kcal)}>
                  {f.name} <small>{f.kcal}</small>
                </button>
              ))}
            </div>
          </>
        )}

        <button type="button" className="ghost wide" onClick={() => setShowPresets((v) => !v)}>
          {showPresets ? 'カロリー目安を閉じる' : 'カロリー目安から選ぶ'}
        </button>
        {showPresets &&
          categories.map((c) => (
            <div key={c}>
              <div className="label">{c}</div>
              <div className="chips">
                {FOOD_PRESETS.filter((f) => f.category === c).map((f) => (
                  <button type="button" key={f.name} className="chip" onClick={() => add(f.name, f.kcal)}>
                    {f.name} <small>{f.kcal}</small>
                  </button>
                ))}
              </div>
            </div>
          ))}
      </form>

      <section className="card">
        {dayMeals.length === 0 && <p className="muted">まだ記録がないよ</p>}
        {(Object.keys(MEAL_LABELS) as MealType[]).map((t) => {
          const list = dayMeals.filter((m) => m.type === t);
          if (list.length === 0) return null;
          return (
            <div key={t} className="meal-group">
              <h4>
                {MEAL_LABELS[t]} <span className="muted">{list.reduce((s, m) => s + m.kcal, 0)} kcal</span>
              </h4>
              <ul className="list">
                {list.map((m) => (
                  <li key={m.id}>
                    <span>{m.name}</span>
                    <span className="kcal">{m.kcal} kcal</span>
                    <button className="icon" onClick={() => onRemove(m.id)} aria-label={`${m.name}を削除`}>
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </section>
    </div>
  );
}
