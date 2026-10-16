import type { TargetOption } from '../lib/navy';
import { recommendedOption } from '../lib/navy';

interface Props {
  options: TargetOption[];
  leanKg: number;
  maxWeeklyLossPct: number;
  /** 今選んでいる目標体重（一致する行を強調） */
  selectedKg: number | null;
  onPick: (weightKg: number) => void;
}

/** 除脂肪体重から出した、大会時の目標体重の目安。行を押すとその体重を入れる */
export function TargetGuide({ options, leanKg, maxWeeklyLossPct, selectedKg, onPick }: Props) {
  if (options.length === 0) {
    return <p className="muted">今の体脂肪率がすでに目安の範囲より低いため、表示できる目安がありません。</p>;
  }
  const best = recommendedOption(options);
  return (
    <div className="guide">
      <div className="guide-head">
        <span>体脂肪率</span>
        <span>体重</span>
        <span>必要なペース</span>
      </div>
      {options.map((o) => (
        <button
          type="button"
          key={o.bodyFatPct}
          className={`guide-row ${o === best ? 'best' : ''} ${selectedKg === o.weightKg ? 'on' : ''}`}
          onClick={() => onPick(o.weightKg)}
        >
          <span>
            {o.bodyFatPct}%{o === best && <em>おすすめ</em>}
          </span>
          <b>{o.weightKg.toFixed(1)} kg</b>
          <span className={o.withinCap ? '' : 'over'}>
            {Number.isFinite(o.kgPerWeek) ? `${o.kgPerWeek.toFixed(2)} kg/週` : '—'}
            <small>{Number.isFinite(o.pctPerWeek) ? `${o.pctPerWeek}%` : ''}</small>
          </span>
        </button>
      ))}
      <p className="muted">
        除脂肪体重 {leanKg.toFixed(1)} kg を保った場合の体重です。赤字のペースは上限（週{maxWeeklyLossPct}%）を超えます。減量中は筋量も少し落ちるので、実際の大会時体重はこれより軽くなりがちです。行を押すと目標体重に入ります。
      </p>
      {!best && <p className="status warn">どの目安も上限ペースでは届きません。大会日か上限ペースを見直すか、高めの体脂肪率を目標にしてください。</p>}
    </div>
  );
}
