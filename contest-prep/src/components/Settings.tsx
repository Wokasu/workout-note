import { useState } from 'react';
import type { AppData, Profile } from '../types';
import { normalizeData } from '../lib/storage';
import { ProfileForm } from './ProfileForm';

interface Props {
  data: AppData;
  today: string;
  onSaveProfile: (p: Profile) => void;
  onRestore: (d: AppData) => void;
  onReset: () => void;
}

export function Settings({ data, today, onSaveProfile, onRestore, onReset }: Props) {
  const [saved, setSaved] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [message, setMessage] = useState('');

  const backup = () => {
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `contest-prep-${today}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const restore = async (file: File) => {
    try {
      const restored = normalizeData(JSON.parse(await file.text()));
      if (!restored.profile && restored.logs.length === 0 && restored.body.length === 0) throw new Error('empty');
      onRestore(restored);
      setMessage('バックアップから復元しました');
    } catch {
      setMessage('このファイルは読み込めませんでした');
    }
  };

  return (
    <div className="stack">
      <ProfileForm
        initial={data.profile}
        today={today}
        latestWeight={null}
        submitLabel={saved ? '保存しました' : '保存'}
        onSave={(p) => {
          onSaveProfile(p);
          setSaved(true);
          setTimeout(() => setSaved(false), 1500);
        }}
      />

      <section className="card form">
        <h3>データ</h3>
        <p className="muted">
          データはこの端末のブラウザにだけ保存されています。機種変更やブラウザのデータ削除に備えて、ときどきバックアップしてください。
        </p>
        <button className="ghost wide" onClick={backup}>
          バックアップを保存（JSON）
        </button>
        <label className="file">
          バックアップから復元
          <input
            type="file"
            accept=".json,application/json"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void restore(file);
              e.target.value = '';
            }}
          />
        </label>
        {message && <p className="muted">{message}</p>}
        {confirmReset ? (
          <div className="row">
            <button className="ghost grow" onClick={() => setConfirmReset(false)}>
              やめる
            </button>
            <button className="danger grow" onClick={onReset}>
              本当に全部消す
            </button>
          </div>
        ) : (
          <button className="danger-ghost wide" onClick={() => setConfirmReset(true)}>
            すべてのデータを消す
          </button>
        )}
      </section>

      <p className="muted disclaimer">
        数値は推定値です。大会前の極端な減量や水抜きは体調を崩すことがあるため、体調に異変があれば中止し、必要に応じて医師や指導者に相談してください。
      </p>
    </div>
  );
}
