import { useMemo, useState } from 'react';
import type { Food, FoodLog, Macros } from '../types';
import { FOOD_GROUPS, PRESET_FOODS, groupOf, type FoodGroup } from '../lib/foods';
import { kcalOf, scaleMacros, sumMacros } from '../lib/macros';
import { addDays, formatJa } from '../lib/date';
import { MacroBars } from './MacroBars';
import { TextEntry } from './TextEntry';

const SLOTS = [1, 2, 3, 4, 5, 6];

type NewLog = Omit<FoodLog, 'id'>;

interface Props {
  today: string;
  logs: FoodLog[];
  myFoods: Food[];
  target: Macros & { kcal: number };
  onAdd: (logs: NewLog[]) => void;
  onRemove: (id: string) => void;
  onAddFood: (food: Omit<Food, 'id'>) => void;
  onRemoveFood: (id: string) => void;
}

function pfc(m: Macros): string {
  return `P${m.p} F${m.f} C${m.c}`;
}

export function Meals({ today, logs, myFoods, target, onAdd, onRemove, onAddFood, onRemoveFood }: Props) {
  const [date, setDate] = useState(today);
  const [slot, setSlot] = useState(1);
  const [mode, setMode] = useState<'text' | 'pick' | 'manual'>('pick');

  const dayLogs = useMemo(() => logs.filter((l) => l.date === date), [logs, date]);
  const eaten = sumMacros(dayLogs);
  const prevDayLogs = useMemo(() => logs.filter((l) => l.date === addDays(date, -1)), [logs, date]);

  // 同じ食品を同じ量で食べることが多いので、最近の記録をワンタップで再登録できるようにする
  const recent = useMemo(() => {
    const seen = new Map<string, FoodLog>();
    for (const l of [...logs].reverse()) {
      const key = `${l.name}|${l.amount}`;
      if (!seen.has(key)) seen.set(key, l);
      if (seen.size >= 10) break;
    }
    return [...seen.values()];
  }, [logs]);

  const addOne = (name: string, amount: string, m: Macros) => onAdd([{ date, slot, name, amount, ...m }]);

  const copyPrevDay = () => onAdd(prevDayLogs.map(({ id: _id, ...l }) => ({ ...l, date })));

  return (
    <div className="stack">
      <section className="card">
        <div className="date-nav">
          <button className="ghost" onClick={() => setDate(addDays(date, -1))} aria-label="前の日">
            ‹
          </button>
          <div className="date-title">{date === today ? `今日 ${formatJa(date)}` : formatJa(date)}</div>
          <button className="ghost" onClick={() => setDate(addDays(date, 1))} disabled={date >= today} aria-label="次の日">
            ›
          </button>
        </div>
        <MacroBars eaten={eaten} target={target} />
        {dayLogs.length === 0 && prevDayLogs.length > 0 && (
          <button className="ghost wide" onClick={copyPrevDay}>
            前日の食事（{prevDayLogs.length}品）をコピー
          </button>
        )}
      </section>

      <section className="card form">
        <div className="label">どの食事に追加？</div>
        <div className="seg">
          {SLOTS.map((s) => (
            <button type="button" key={s} className={slot === s ? 'on' : ''} onClick={() => setSlot(s)}>
              {s}食目
            </button>
          ))}
        </div>

        {recent.length > 0 && (
          <>
            <div className="label">最近の記録</div>
            <div className="chips">
              {recent.map((l) => (
                <button type="button" key={l.id} className="chip" onClick={() => addOne(l.name, l.amount, { p: l.p, f: l.f, c: l.c })}>
                  {l.name} {l.amount && <small>{l.amount}</small>}
                </button>
              ))}
            </div>
          </>
        )}

        <div className="seg">
          <button type="button" className={mode === 'pick' ? 'on' : ''} onClick={() => setMode('pick')}>
            食品から選ぶ
          </button>
          <button type="button" className={mode === 'text' ? 'on' : ''} onClick={() => setMode('text')}>
            文章で入力
          </button>
          <button type="button" className={mode === 'manual' ? 'on' : ''} onClick={() => setMode('manual')}>
            PFC を直接入力
          </button>
        </div>
        {mode === 'text' ? (
          <TextEntry myFoods={myFoods} onAdd={(items) => onAdd(items.map((i) => ({ date, slot, ...i })))} onAddFood={onAddFood} />
        ) : mode === 'pick' ? (
          <FoodPicker myFoods={myFoods} onPick={addOne} onRemoveFood={onRemoveFood} />
        ) : (
          <ManualEntry onAdd={addOne} onAddFood={onAddFood} />
        )}
      </section>

      <section className="card">
        {dayLogs.length === 0 && <p className="muted">まだ記録がありません</p>}
        {SLOTS.map((s) => {
          const list = dayLogs.filter((l) => l.slot === s);
          if (list.length === 0) return null;
          const t = sumMacros(list);
          return (
            <div key={s} className="meal-group">
              <h4>
                {s}食目 <span className="muted">{kcalOf(t)} kcal · {pfc(t)}</span>
              </h4>
              <ul className="list">
                {list.map((l) => (
                  <li key={l.id}>
                    <span className="grow">
                      {l.name} {l.amount && <small className="muted">{l.amount}</small>}
                      <br />
                      <small className="muted">{pfc(l)}</small>
                    </span>
                    <span className="num">{kcalOf(l)} kcal</span>
                    <button className="icon" onClick={() => onRemove(l.id)} aria-label={`${l.name}を削除`}>
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

function FoodPicker({
  myFoods,
  onPick,
  onRemoveFood,
}: {
  myFoods: Food[];
  onPick: (name: string, amount: string, m: Macros) => void;
  onRemoveFood: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<FoodGroup>('protein');
  const [selected, setSelected] = useState<Food | null>(null);
  const [amount, setAmount] = useState('');

  // マイ食品は PFC から分類して、各タブの先頭に出す
  const all: (Food & { group: FoodGroup; category: string; mine?: boolean })[] = [
    ...myFoods.map((f) => ({ ...f, group: groupOf(f), category: 'マイ食品', mine: true })),
    ...PRESET_FOODS,
  ];
  const q = query.trim();
  const shown = q ? all.filter((f) => f.name.includes(q)) : all.filter((f) => f.group === group);
  const categories = [...new Set(shown.map((f) => f.category))];

  const select = (f: Food) => {
    setSelected(f);
    setAmount(String(f.base));
  };

  const scaled = selected && Number(amount) > 0 ? scaleMacros(selected, selected.base, Number(amount)) : null;

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected || !scaled) return;
    onPick(selected.name, `${amount}${selected.unit}`, scaled);
    setSelected(null);
    setQuery('');
  };

  if (selected) {
    return (
      <form className="picked" onSubmit={add}>
        <div className="picked-name">{selected.name}</div>
        <div className="row">
          <label className="grow">
            量 ({selected.unit})
            <input type="number" inputMode="decimal" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
          </label>
          <div className="preview">{scaled ? `${kcalOf(scaled)} kcal · ${pfc(scaled)}` : '—'}</div>
        </div>
        <div className="row">
          <button type="button" className="ghost grow" onClick={() => setSelected(null)}>
            戻る
          </button>
          <button type="submit" className="primary grow" disabled={!scaled}>
            追加
          </button>
        </div>
      </form>
    );
  }

  return (
    <div>
      <div className="seg group-tabs">
        {FOOD_GROUPS.map((g) => (
          <button
            type="button"
            key={g.id}
            className={`${g.id} ${group === g.id && !q ? 'on' : ''}`}
            onClick={() => {
              setGroup(g.id);
              setQuery('');
            }}
          >
            {g.label}
          </button>
        ))}
      </div>
      <input className="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="すべての食品から検索（例：鶏むね）" />
      <div className="food-list">
        {categories.map((c) => (
          <div key={c}>
            <div className="label">{c}</div>
            {shown
              .filter((f) => f.category === c)
              .map((f) => (
                <div key={f.id} className="food-row">
                  <button type="button" className="food-pick" onClick={() => select(f)}>
                    <span>{f.name}</span>
                    <small className="muted">
                      {f.base}
                      {f.unit}あたり {kcalOf(f)}kcal · {pfc(f)}
                    </small>
                  </button>
                  {f.mine && (
                    <button type="button" className="icon" onClick={() => onRemoveFood(f.id)} aria-label={`${f.name}をマイ食品から削除`}>
                      ×
                    </button>
                  )}
                </div>
              ))}
          </div>
        ))}
        {shown.length === 0 && <p className="muted">見つかりません。「PFC を直接入力」から登録できます。</p>}
      </div>
    </div>
  );
}

function ManualEntry({
  onAdd,
  onAddFood,
}: {
  onAdd: (name: string, amount: string, m: Macros) => void;
  onAddFood: (food: Omit<Food, 'id'>) => void;
}) {
  const [v, setV] = useState({ name: '', base: '', unit: 'g', p: '', f: '', c: '' });
  const [save, setSave] = useState(true);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV((x) => ({ ...x, [k]: e.target.value }));

  const m = { p: Number(v.p) || 0, f: Number(v.f) || 0, c: Number(v.c) || 0 };
  const ok = v.name.trim() !== '' && (v.p !== '' || v.f !== '' || v.c !== '');
  const base = Number(v.base);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ok) return;
    const name = v.name.trim();
    const amount = base > 0 ? `${base}${v.unit}` : '';
    onAdd(name, amount, m);
    if (save) onAddFood({ name, base: base > 0 ? base : 1, unit: base > 0 ? v.unit : '食', ...m });
    setV({ name: '', base: '', unit: 'g', p: '', f: '', c: '' });
  };

  return (
    <form onSubmit={submit} className="form">
      <label>
        食品名
        <input value={v.name} onChange={set('name')} placeholder="例：自作チキンカレー" />
      </label>
      <div className="row">
        <label className="grow">
          量（任意）
          <input type="number" inputMode="decimal" value={v.base} onChange={set('base')} />
        </label>
        <label className="grow">
          単位
          <input value={v.unit} onChange={set('unit')} />
        </label>
      </div>
      <div className="row">
        <label className="grow">
          P (g)
          <input type="number" inputMode="decimal" value={v.p} onChange={set('p')} />
        </label>
        <label className="grow">
          F (g)
          <input type="number" inputMode="decimal" value={v.f} onChange={set('f')} />
        </label>
        <label className="grow">
          C (g)
          <input type="number" inputMode="decimal" value={v.c} onChange={set('c')} />
        </label>
      </div>
      <label className="check">
        <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />
        マイ食品に登録して次から量を変えて使う
      </label>
      <button type="submit" className="primary wide" disabled={!ok}>
        追加（{kcalOf(m)} kcal）
      </button>
    </form>
  );
}
