import type { Targets } from '../lib/nutrition';
import { formatJa } from '../lib/date';

const CONFIDENCE: Record<'low' | 'medium' | 'high', string> = { low: '低', medium: '中', high: '高' };

const SOURCE: Record<Targets['tdeeSource'], string> = {
  formula: '計算式',
  manual: '反映した推定値',
  adaptive: '毎週自動で更新',
};

interface Props {
  targets: Targets;
  manualDate: string | null;
  onApply: (kcal: number) => void;
  onUseFormula: () => void;
}

/** 今あるデータからの維持カロリーの推定と、それを目標カロリーに反映するボタン */
export function MaintenanceSuggestion({ targets: t, manualDate, onApply, onUseFormula }: Props) {
  const q = t.quick;
  const applied = t.tdeeSource === 'manual' && q !== null && t.tdee === q.tdee;
  return (
    <section className="card maintenance-suggestion">
      <h3>記録からの維持カロリー</h3>
      {q ? (
        <>
          <div className="suggest-value">
            <b>{q.tdee.toLocaleString()} kcal</b>
            <span className={`pill conf-${q.confidence}`}>信頼度 {CONFIDENCE[q.confidence]}</span>
          </div>
          <p className="muted">
            ±{q.marginKcal} kcal ・ {formatJa(q.from)}〜{formatJa(q.to)} の食事 {q.loggedDays}日分（平均 {q.avgIntake.toLocaleString()} kcal）と体重 {q.weighIns}回（週{' '}
            {q.kgPerWeek > 0 ? '+' : ''}
            {q.kgPerWeek} kg）から
            {q.excludedDays > 0 && `。少なすぎる日 ${q.excludedDays}日は記録漏れとみて除外`}
          </p>
          {q.confidence === 'low' && <p className="muted">記録が増えると幅が狭くなり、信頼度が上がります。</p>}
        </>
      ) : (
        <p className="muted">
          直近4週間に、食事を記録した日が3日分と、4日以上あけた体重が2回分あると推定できます。毎日きっちりでなくても大丈夫です。
        </p>
      )}
      <ul className="kv">
        <li>
          <span>今使っている値</span>
          <span>
            {t.tdee.toLocaleString()} kcal{' '}
            <small>
              {SOURCE[t.tdeeSource]}
              {t.tdeeSource === 'manual' && manualDate ? `（${formatJa(manualDate)}に反映）` : ''}
            </small>
          </span>
        </li>
        {t.tdeeSource !== 'formula' && (
          <li>
            <span>計算式の値</span>
            <span>{t.formulaTdee.toLocaleString()} kcal</span>
          </li>
        )}
      </ul>
      {q && (
        <button className="primary wide" disabled={applied} onClick={() => onApply(q.tdee)}>
          {applied ? '反映済み' : `目標カロリーに反映する（${q.tdee.toLocaleString()} kcal）`}
        </button>
      )}
      {t.tdeeSource !== 'formula' && (
        <button className="ghost wide" onClick={onUseFormula}>
          計算式の値に戻す
        </button>
      )}
    </section>
  );
}
