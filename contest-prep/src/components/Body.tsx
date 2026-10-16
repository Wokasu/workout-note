import { useState } from 'react';
import { BODY_FIELDS, type BodyField, type BodyRecord } from '../types';
import { FIELD_BY_KEY, FIELD_DEFS, formatValue } from '../lib/fields';
import { formatJa } from '../lib/date';
import { Importer } from './Importer';

interface Props {
  today: string;
  body: BodyRecord[];
  onImport: (records: BodyRecord[]) => void;
  onSave: (record: BodyRecord) => void;
  onRemove: (date: string) => void;
}

const QUICK: BodyField[] = ['weightKg', 'bodyFatPct', 'waistCm', 'chestCm', 'hipCm', 'armCm', 'thighCm', 'calfCm', 'neckCm'];

export function Body({ today, body, onImport, onSave, onRemove }: Props) {
  const [date, setDate] = useState(today);
  const existing = body.find((r) => r.date === date);
  const [values, setValues] = useState<Partial<Record<BodyField, string>>>({});
  const [showAll, setShowAll] = useState(false);
  const [listCount, setListCount] = useState(14);

  const fields = showAll ? FIELD_DEFS.map((f) => f.key) : QUICK;
  const sorted = [...body].sort((a, b) => b.date.localeCompare(a.date));

  const changeDate = (d: string) => {
    setDate(d);
    setValues({});
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const rec: BodyRecord = { ...existing, date };
    for (const k of BODY_FIELDS) {
      const raw = values[k];
      if (raw === undefined) continue;
      if (raw === '') {
        delete rec[k];
        continue;
      }
      const v = Number(raw);
      const def = FIELD_BY_KEY[k];
      if (v >= def.min && v <= def.max) rec[k] = v;
    }
    onSave(rec);
    setValues({});
  };

  return (
    <div className="stack">
      <Importer onImport={onImport} />

      <form className="card form" onSubmit={submit}>
        <h3>手で記録する</h3>
        <label>
          日付
          <input type="date" value={date} max={today} onChange={(e) => changeDate(e.target.value)} />
        </label>
        <div className="grid2">
          {fields.map((k) => {
            const def = FIELD_BY_KEY[k];
            return (
              <label key={k}>
                {def.label}
                {def.unit && ` (${def.unit})`}
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  value={values[k] ?? (existing?.[k] !== undefined ? String(existing[k]) : '')}
                  onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))}
                />
              </label>
            );
          })}
        </div>
        <button type="button" className="ghost wide" onClick={() => setShowAll((v) => !v)}>
          {showAll ? '項目を減らす' : '体組成の項目もすべて表示'}
        </button>
        <p className="muted">サイズは同じ時間帯・同じ位置（ウエストはへその高さ）で測ると比較しやすくなります。</p>
        <button type="submit" className="primary wide" disabled={Object.keys(values).length === 0}>
          {existing ? '更新' : '記録'}
        </button>
      </form>

      {sorted.length > 0 && (
        <section className="card">
          <h3>記録（新しい順）</h3>
          <ul className="list">
            {sorted.slice(0, listCount).map((r) => (
              <li key={r.date}>
                <span className="date-cell">{formatJa(r.date)}</span>
                <span className="grow values">
                  {BODY_FIELDS.filter((k) => r[k] !== undefined)
                    .map((k) => (k === 'weightKg' ? formatValue(k, r[k]!) : `${FIELD_BY_KEY[k].label} ${formatValue(k, r[k]!)}`))
                    .join(' · ')}
                </span>
                <button className="icon" onClick={() => onRemove(r.date)} aria-label={`${r.date}の記録を削除`}>
                  ×
                </button>
              </li>
            ))}
          </ul>
          {sorted.length > listCount && (
            <button className="ghost wide" onClick={() => setListCount((n) => n + 30)}>
              もっと見る（残り {sorted.length - listCount} 日分）
            </button>
          )}
        </section>
      )}
    </div>
  );
}
