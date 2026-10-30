import type { Targets } from '../lib/nutrition';

export type CutStartMode = 'calibrate' | 'estimate';

const SOURCE: Record<Targets['tdeeSource'], string> = {
  formula: '計算式',
  manual: '反映した推定値',
  adaptive: '毎週自動で更新',
};
const CONFIDENCE = { low: '低', medium: '中', high: '高' } as const;

/** 記録からの推定値に切り替える余地があるか（今の値と違うときだけ） */
export function quickDiffers(t: Targets): boolean {
  return t.quick !== null && t.quick.tdee !== t.tdee;
}

/** 減量の入り方：維持カロリーで◯日確認してからか、今の推定値ですぐ赤字か */
export function CutStartChoice({
  targets: t,
  calibrationDays,
  mode,
  onMode,
  useQuick,
  onUseQuick,
}: {
  targets: Targets;
  calibrationDays: number;
  mode: CutStartMode;
  onMode: (m: CutStartMode) => void;
  useQuick: boolean;
  onUseQuick: (v: boolean) => void;
}) {
  return (
    <>
      {calibrationDays > 0 && (
        <div className="seg">
          <button type="button" className={mode === 'calibrate' ? 'on' : ''} onClick={() => onMode('calibrate')}>
            {calibrationDays}日 維持してから
          </button>
          <button type="button" className={mode === 'estimate' ? 'on' : ''} onClick={() => onMode('estimate')}>
            推定値ですぐ減量
          </button>
        </div>
      )}
      {mode === 'calibrate' && calibrationDays > 0 ? (
        <p className="muted">最初の{calibrationDays}日は維持カロリーで食べて実際の維持カロリーを測り、それを基準に赤字を決めます。正確ですが、減り始めは遅くなります。</p>
      ) : (
        <EstimateNote targets={t} useQuick={useQuick} onUseQuick={onUseQuick} />
      )}
    </>
  );
}

/** 推定値で減量に入るときに基準にする維持カロリー */
export function EstimateNote({ targets: t, useQuick, onUseQuick }: { targets: Targets; useQuick: boolean; onUseQuick: (v: boolean) => void }) {
  const q = t.quick;
  const base = useQuick && q && quickDiffers(t) ? q.tdee : t.tdee;
  return (
    <div className="estimate-note">
      <p className="muted">
        今日から赤字に入ります。基準にする維持カロリーは <b>{base.toLocaleString()} kcal</b>
        {useQuick && q && quickDiffers(t) ? '（記録からの推定）' : `（${SOURCE[t.tdeeSource]}）`}。
      </p>
      {q && quickDiffers(t) && (
        <label className="check">
          <input type="checkbox" checked={useQuick} onChange={(e) => onUseQuick(e.target.checked)} />
          記録からの推定値 {q.tdee.toLocaleString()} kcal（±{q.marginKcal}・信頼度 {CONFIDENCE[q.confidence]}）を使う（今は {t.tdee.toLocaleString()} kcal・{SOURCE[t.tdeeSource]}）
        </label>
      )}
    </div>
  );
}
