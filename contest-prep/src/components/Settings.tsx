import { useState } from 'react';
import type { AppData, Profile } from '../types';
import { normalizeData, type SyncState } from '../lib/storage';
import { getCapability } from '../lib/cloud';
import { ProfileForm, type NavySizes } from './ProfileForm';

interface Downloads {
  save(req: { filename: string; data: string }): Promise<unknown>;
}

const SYNC_LABEL: Record<SyncState['status'], string> = {
  local: 'この端末のブラウザにだけ保存しています',
  connecting: '保存領域に接続しています…',
  synced: 'あなた専用の保存領域に保存済み',
  saving: '保存しています…',
  error: '保存できていない変更があります',
};

interface Props {
  data: AppData;
  sync: SyncState;
  today: string;
  currentKg: number;
  /** PFC の見本に使う目標カロリー（コーチ指定の PFC を使う前の値） */
  targetKcal: number | null;
  onSaveProfile: (p: Profile, sizes: NavySizes | null) => void;
  onRestore: (d: AppData) => void;
  onReset: () => void;
}

export function Settings({ data, sync, today, currentKg, targetKcal, onSaveProfile, onRestore, onReset }: Props) {
  const [saved, setSaved] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [message, setMessage] = useState('');

  const backup = async () => {
    const json = JSON.stringify(data, null, 1);
    const filename = `contest-prep-${today}.json`;
    // claude.ai の公開ページでは、確認画面を出して保存する
    const downloads = await getCapability<Downloads>('downloads');
    if (downloads) {
      try {
        await downloads.save({ filename, data: json });
        setMessage('バックアップを保存しました');
      } catch (e) {
        if ((e as { code?: string })?.code !== 'declined') setMessage('バックアップを保存できませんでした');
      }
      return;
    }
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
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
        body={data.body}
        currentKg={currentKg}
        targetKcal={targetKcal}
        submitLabel={saved ? '保存しました' : '保存'}
        onSave={(p, sizes) => {
          onSaveProfile(p, sizes);
          setSaved(true);
          setTimeout(() => setSaved(false), 1500);
        }}
      />

      <section className="card form">
        <h3>データ</h3>
        <p className={`status ${sync.status === 'synced' ? 'ok' : sync.status === 'error' ? 'warn' : ''}`}>
          {SYNC_LABEL[sync.status]}
          {sync.status === 'error' && sync.message && (
            <>
              <br />
              {sync.message}
            </>
          )}
        </p>
        {sync.status === 'error' && sync.retry && (
          <button className="ghost wide" onClick={sync.retry}>
            もう一度保存する
          </button>
        )}
        <p className="muted">
          {sync.status === 'local'
            ? 'claude.ai のページで開くと、スマホと PC で同じデータを使えます。ブラウザのデータを消すと記録も消えるので、ときどきバックアップしてください。'
            : 'claude.ai のあなた専用の保存領域に保存しています。スマホでも PC でも同じデータが見られ、ブラウザのデータを消しても残ります。ほかの人がこのページを開いても記録は見えません。'}
          {sync.migrated && ' この端末にあった記録は保存領域に移しました。'}
        </p>
        <button className="ghost wide" onClick={() => void backup()}>
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
