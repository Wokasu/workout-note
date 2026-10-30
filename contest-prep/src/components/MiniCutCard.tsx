import { useState } from 'react';
import type { BulkSettings, Profile } from '../types';
import type { Targets } from '../lib/nutrition';
import { miniCutDeficit, retargetCut, startManualCut, stopCut } from '../lib/bulk';
import { CutStartChoice, quickDiffers, type CutStartMode } from './CutStart';

interface Props {
  profile: Profile;
  targets: Targets;
  today: string;
  onSaveBulk: (s: BulkSettings) => void;
  onApplyTdee: (kcal: number) => void;
}

function parseKg(text: string): number {
  return Number(text.replace(/[０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(',', '.'));
}

/** プチダイエットを自分で始める・目標を変える・やめる */
export function MiniCutCard({ profile, targets: t, today, onSaveBulk, onApplyTdee }: Props) {
  const st = t.bulk!;
  const s = profile.bulk;
  const cutting = st.state !== 'bulk';
  const suggested = Math.round((t.currentKg - s.returnKg) * 10) / 10;
  const [text, setText] = useState(String(cutting && st.exitKg !== null ? st.exitKg : suggested));
  const [confirmStop, setConfirmStop] = useState(false);
  const kg = parseKg(text);
  const valid = text.trim() !== '' && kg >= 30 && kg < t.currentKg;
  const weeks = valid ? Math.ceil((t.currentKg - kg) / ((t.currentKg * s.miniCutPct) / 100)) : null;
  const cal = profile.calibrationDays;
  const [mode, setMode] = useState<CutStartMode>('calibrate');
  const [useQuick, setUseQuick] = useState(true);
  const calibrate = cal > 0 && mode === 'calibrate';

  if (!cutting) {
    return (
      <section className="card form">
        <h3>プチダイエットを始める</h3>
        <p className="muted">
          上限に届いていなくても、自分のタイミングで始められます。決めた体重（7日平均）まで落としたら、自動で増量に戻ります。
        </p>
        <label>
          どこまで落とす？（kg）
          <input type="text" inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        {valid ? (
          <p className="muted">
            今の7日平均 {t.currentKg.toFixed(1)} kg から −{(t.currentKg - kg).toFixed(1)} kg。週 {s.miniCutPct}%（1日 −{miniCutDeficit(s, t.currentKg)} kcal）で
            {calibrate ? `、最初の${cal}日は維持カロリーの確認、その後` : ''} 約{weeks}週間の見込み。
          </p>
        ) : (
          <p className="status warn">今の7日平均（{t.currentKg.toFixed(1)} kg）より軽い体重を入れてください。</p>
        )}
        <CutStartChoice targets={t} calibrationDays={cal} mode={mode} onMode={setMode} useQuick={useQuick} onUseQuick={setUseQuick} />
        <button
          className="primary wide"
          disabled={!valid}
          onClick={() => {
            if (!calibrate && useQuick && t.quick && quickDiffers(t)) onApplyTdee(t.quick.tdee);
            onSaveBulk(startManualCut(s, today, Math.round(kg * 10) / 10, calibrate));
          }}
        >
          今日からプチダイエット{calibrate ? `（まず${cal}日 維持）` : ''}
        </button>
        {st.holdAuto && <p className="muted">自分で増量に戻したので、上限を一度下回るまでは自動ではプチダイエットに入りません。</p>}
      </section>
    );
  }

  const changed = valid && kg !== st.exitKg;
  return (
    <section className="card form">
      <h3>{st.state === 'calibrate' ? 'プチダイエット前の維持確認' : 'プチダイエット'}</h3>
      <p className="muted">
        {st.manual ? `${st.manual.start.slice(5).replace('-', '/')} に自分で開始。` : '上限に届いたので自動で開始。'}
        {st.exitKg !== null && ` 7日平均が ${st.exitKg.toFixed(1)} kg まで下がったら増量に戻ります。`}
      </p>
      <div className="row">
        <label className="grow">
          目標（kg）
          <input type="text" inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <button className="ghost" disabled={!changed} onClick={() => onSaveBulk(retargetCut(s, st, Math.round(kg * 10) / 10))}>
          変更
        </button>
      </div>
      {confirmStop ? (
        <div className="row">
          <button className="ghost grow" onClick={() => setConfirmStop(false)}>
            続ける
          </button>
          <button
            className="primary grow"
            onClick={() => {
              onSaveBulk(stopCut(s, st, today));
              setConfirmStop(false);
            }}
          >
            今日から増量に戻る
          </button>
        </div>
      ) : (
        <button className="ghost wide" onClick={() => setConfirmStop(true)}>
          プチダイエットをやめて増量に戻る
        </button>
      )}
    </section>
  );
}
