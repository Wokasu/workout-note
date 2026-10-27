import { useState } from 'react';
import type { SyncStatus } from '../lib/cloud';

interface Props {
  current: number | undefined;
  last: number | undefined;
  status: SyncStatus;
  onSave: (kg: number) => void;
}

/** 通知から開いて体重だけ入れる画面（URL に ?quick=weight または #quick=weight） */
export function QuickWeight({ current, last, status, onSave }: Props) {
  const [text, setText] = useState(current !== undefined ? String(current) : '');
  const [saved, setSaved] = useState(false);
  const kg = Number(text.replace(/[０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(',', '.'));
  const valid = text.trim() !== '' && kg >= 25 && kg <= 250;
  const ready = status === 'synced';

  const save = () => {
    if (!valid || !ready) return;
    onSave(Math.round(kg * 10) / 10);
    setSaved(true);
  };

  return (
    <div className="app">
      <div className="stack">
        <header className="hero">
          <h1>体重</h1>
          <p>{last !== undefined ? `前回 ${last} kg` : '今日の体重を入力'}</p>
        </header>
        <section className="card form">
          <label>
            今日の体重（kg）
            <input
              type="text"
              inputMode="decimal"
              autoFocus
              placeholder="例 83.5"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setSaved(false);
              }}
              onKeyDown={(e) => e.key === 'Enter' && save()}
            />
          </label>
          <button type="button" className="primary wide" disabled={!valid || !ready} onClick={save}>
            {ready ? '保存' : '接続中…'}
          </button>
          {saved && status === 'synced' && <p className="status ok">保存しました。このページは閉じて大丈夫です。</p>}
          {saved && status === 'saving' && <p className="status">保存中…</p>}
          {status === 'error' && <p className="status warn">保存できませんでした。ページを開き直してください。</p>}
          {status === 'local' && <p className="status warn">保存領域に接続できません。</p>}
        </section>
      </div>
    </div>
  );
}

export function isQuickWeight(): boolean {
  try {
    const q = (s: string) => new URLSearchParams(s).get('quick') === 'weight';
    return q(location.search) || q(location.hash.replace(/^#/, ''));
  } catch {
    return false;
  }
}
