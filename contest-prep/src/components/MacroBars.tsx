import type { Macros } from '../types';
import { kcalOf } from '../lib/macros';

const ROWS = [
  { key: 'p', label: 'P たんぱく質', cls: 'p' },
  { key: 'f', label: 'F 脂質', cls: 'f' },
  { key: 'c', label: 'C 炭水化物', cls: 'c' },
] as const;

/** 摂取量と目標の比較バー */
export function MacroBars({ eaten, target }: { eaten: Macros; target: Macros & { kcal: number } }) {
  const kcal = kcalOf(eaten);
  return (
    <div className="macros">
      <Bar label="カロリー" cls="kcal" value={kcal} goal={target.kcal} unit="kcal" />
      {ROWS.map((r) => (
        <Bar key={r.key} label={r.label} cls={r.cls} value={eaten[r.key]} goal={target[r.key]} unit="g" />
      ))}
    </div>
  );
}

function Bar({ label, cls, value, goal, unit }: { label: string; cls: string; value: number; goal: number; unit: string }) {
  const ratio = goal > 0 ? value / goal : 0;
  const rest = Math.round((goal - value) * 10) / 10;
  return (
    <div className={`bar ${cls}`}>
      <div className="bar-head">
        <span>{label}</span>
        <span>
          <b>{Math.round(value)}</b> / {goal} {unit}
          <small className={rest < 0 ? 'over' : ''}>{rest >= 0 ? ` あと${Math.round(rest)}` : ` +${Math.round(-rest)}`}</small>
        </span>
      </div>
      <div className="track">
        <div className="fill" style={{ width: `${Math.min(100, ratio * 100)}%` }} />
      </div>
    </div>
  );
}
