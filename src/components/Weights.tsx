import { useState } from 'react';
import type { Profile, WeightEntry } from '../types';
import { calcBmi } from '../lib/calc';
import { formatJa, todayKey } from '../lib/date';

interface Props {
  profile: Profile;
  weights: WeightEntry[];
  onSave: (w: WeightEntry) => void;
  onRemove: (date: string) => void;
}

export function Weights({ profile, weights, onSave, onRemove }: Props) {
  const today = todayKey();
  const existing = weights.find((w) => w.date === today);
  const [kg, setKg] = useState(existing ? String(existing.kg) : '');
  const sorted = [...weights].sort((a, b) => a.date.localeCompare(b.date));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = Number(kg);
    if (!(v > 20 && v < 300)) return;
    onSave({ date: today, kg: Math.round(v * 10) / 10 });
  };

  const latest = sorted.at(-1)?.kg ?? profile.startWeightKg;

  return (
    <div className="stack">
      <form className="card form" onSubmit={submit}>
        <h3>今日の体重 {formatJa(today)}</h3>
        <div className="row">
          <label className="grow">
            体重 (kg)
            <input type="number" inputMode="decimal" step="0.1" value={kg} onChange={(e) => setKg(e.target.value)} placeholder={String(latest)} />
          </label>
          <button type="submit" className="primary" disabled={kg === ''}>
            {existing ? '更新' : '記録'}
          </button>
        </div>
        <p className="muted">毎朝トイレのあと・朝ごはん前に測るのがおすすめ。BMI {calcBmi(latest, profile.heightCm)}</p>
      </form>

      <section className="card">
        <h3>推移</h3>
        <WeightChart profile={profile} entries={sorted} />
      </section>

      {sorted.length > 0 && (
        <section className="card">
          <ul className="list">
            {[...sorted].reverse().map((w, i, arr) => {
              const prev = arr[i + 1]?.kg;
              const diff = prev === undefined ? null : Math.round((w.kg - prev) * 10) / 10;
              return (
                <li key={w.date}>
                  <span>{formatJa(w.date)}</span>
                  <span className="kcal">
                    {w.kg.toFixed(1)} kg
                    {diff !== null && diff !== 0 && <small className={diff < 0 ? 'down' : 'up'}> {diff > 0 ? `+${diff}` : diff}</small>}
                  </span>
                  <button className="icon" onClick={() => onRemove(w.date)} aria-label={`${w.date}の記録を削除`}>
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

function WeightChart({ profile, entries }: { profile: Profile; entries: WeightEntry[] }) {
  const points = [{ date: profile.startDate, kg: profile.startWeightKg }, ...entries.filter((e) => e.date !== profile.startDate)];
  if (points.length < 2) return <p className="muted">2日分以上記録するとグラフが出るよ</p>;

  const W = 320;
  const H = 160;
  const pad = { l: 34, r: 10, t: 10, b: 22 };
  const allDates = [...points.map((p) => p.date), profile.eventDate].sort();
  const t0 = Date.parse(allDates[0]);
  const t1 = Date.parse(allDates.at(-1)!);
  const kgs = [...points.map((p) => p.kg), profile.targetWeightKg];
  const lo = Math.floor(Math.min(...kgs) - 0.5);
  const hi = Math.ceil(Math.max(...kgs) + 0.5);
  const x = (d: string) => pad.l + ((Date.parse(d) - t0) / Math.max(1, t1 - t0)) * (W - pad.l - pad.r);
  const y = (kg: number) => pad.t + ((hi - kg) / (hi - lo)) * (H - pad.t - pad.b);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.kg).toFixed(1)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="体重の推移グラフ">
      {[lo, (lo + hi) / 2, hi].map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className="grid" />
          <text x={pad.l - 4} y={y(v) + 3} className="axis" textAnchor="end">
            {v.toFixed(1)}
          </text>
        </g>
      ))}
      {/* スタートから写真会当日の目標までの理想ライン */}
      <line
        x1={x(profile.startDate)}
        y1={y(profile.startWeightKg)}
        x2={x(profile.eventDate)}
        y2={y(profile.targetWeightKg)}
        className="goal-line"
      />
      <path d={path} className="line" />
      {points.map((p) => (
        <circle key={p.date} cx={x(p.date)} cy={y(p.kg)} r={3} className="dot" />
      ))}
      <text x={x(profile.eventDate)} y={H - 6} className="axis" textAnchor="end">
        📸 {formatJa(profile.eventDate)}
      </text>
      <text x={pad.l} y={H - 6} className="axis">
        {formatJa(allDates[0])}
      </text>
    </svg>
  );
}
