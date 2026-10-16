import type { Point } from '../lib/analysis';
import { formatJa } from '../lib/date';

interface Props {
  points: Point[];
  average?: Point[];
  /** 計画線（開始点→大会） */
  plan?: [Point, Point];
  /** これからの見込み（点線） */
  projection?: Point[];
  /** 上限などの水平線 */
  lines?: { value: number; label: string; cls: string }[];
  from: string;
  to: string;
  digits?: number;
  label: string;
}

const W = 340;
const H = 190;
const PAD = { l: 38, r: 10, t: 12, b: 24 };

function ms(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

export function Chart({ points, average, plan, projection, lines, from, to, digits = 1, label }: Props) {
  const visible = points.filter((p) => p.date >= from && p.date <= to);
  if (visible.length < 2 && !projection?.length) return <p className="muted">この期間の記録が2日分以上あるとグラフを表示します</p>;

  const t0 = ms(from);
  const t1 = Math.max(ms(to), t0 + 86_400_000);
  const planValues = plan ? plan.map((p) => p.value) : [];
  const values = [...visible.map((p) => p.value), ...planValues, ...(projection ?? []).map((p) => p.value), ...(lines ?? []).map((l) => l.value)];
  const span = Math.max(...values) - Math.min(...values) || 1;
  const lo = Math.min(...values) - span * 0.08;
  const hi = Math.max(...values) + span * 0.08;
  const x = (d: string) => PAD.l + ((ms(d) - t0) / (t1 - t0)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + ((hi - v) / (hi - lo)) * (H - PAD.t - PAD.b);
  const path = (pts: Point[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const avgVisible = average?.filter((p) => p.date >= from && p.date <= to) ?? [];
  const ticks = [lo + (hi - lo) * 0.1, (lo + hi) / 2, hi - (hi - lo) * 0.1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={label}>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className="grid" />
          <text x={PAD.l - 4} y={y(v) + 3} className="axis" textAnchor="end">
            {v.toFixed(digits)}
          </text>
        </g>
      ))}
      {plan && (
        <line x1={x(plan[0].date)} y1={y(plan[0].value)} x2={x(plan[1].date)} y2={y(plan[1].value)} className="plan-line">
          <title>計画線</title>
        </line>
      )}
      {lines?.map((l) => (
        <g key={l.label}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(l.value)} y2={y(l.value)} className={`hline ${l.cls}`} />
          <text x={W - PAD.r - 2} y={y(l.value) - 3} className={`axis hlabel ${l.cls}`} textAnchor="end">
            {l.label} {l.value.toFixed(digits)}
          </text>
        </g>
      ))}
      {projection && projection.length > 1 && <path d={path(projection)} className="proj-line" />}
      {visible.map((p) => (
        <circle key={p.date} cx={x(p.date)} cy={y(p.value)} r={2.2} className="dot">
          <title>
            {formatJa(p.date)} {p.value}
          </title>
        </circle>
      ))}
      {avgVisible.length > 1 && <path d={path(avgVisible)} className="avg-line" />}
      {avgVisible.length <= 1 && visible.length > 1 && <path d={path(visible)} className="avg-line" />}
      <text x={PAD.l} y={H - 6} className="axis">
        {formatJa(from)}
      </text>
      <text x={W - PAD.r} y={H - 6} className="axis" textAnchor="end">
        {formatJa(to)}
      </text>
    </svg>
  );
}
