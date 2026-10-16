import { useState } from 'react';
import type { ActivityLevel, Profile } from '../types';
import { ACTIVITY_LABELS } from '../lib/calc';
import { addDays, todayKey } from '../lib/date';

const COLORS = ['#ff5fa2', '#ff4d4d', '#ff9a3c', '#ffd23f', '#4cd98a', '#3cc8ff', '#4d7cff', '#a66bff', '#ffffff'];

interface Props {
  initial: Profile | null;
  onSave: (p: Profile) => void;
  onCancel?: () => void;
}

export function ProfileForm({ initial, onSave, onCancel }: Props) {
  const [p, setP] = useState<Profile>(
    initial ?? {
      nickname: '',
      oshiName: '',
      oshiColor: COLORS[0],
      eventName: '写真会',
      eventDate: addDays(todayKey(), 30),
      sex: 'female',
      age: 25,
      heightCm: 158,
      startWeightKg: 55,
      targetWeightKg: 52,
      activity: 'normal',
      startDate: todayKey(),
    },
  );
  const [error, setError] = useState('');

  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setP((prev) => ({ ...prev, [k]: v }));
  const num = (k: 'age' | 'heightCm' | 'startWeightKg' | 'targetWeightKg') => (e: React.ChangeEvent<HTMLInputElement>) =>
    set(k, e.target.value === '' ? 0 : Number(e.target.value));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!p.oshiName.trim()) return setError('推しの名前を入れてね');
    if (p.eventDate < todayKey() && !initial) return setError('写真会の日付は今日以降にしてね');
    if (p.heightCm < 100 || p.heightCm > 230) return setError('身長を確認してね');
    if (p.startWeightKg < 25 || p.startWeightKg > 250) return setError('体重を確認してね');
    if (p.targetWeightKg >= p.startWeightKg) return setError('目標体重は今の体重より軽くしてね');
    if (p.age < 12 || p.age > 100) return setError('年齢を確認してね');
    setError('');
    onSave({ ...p, oshiName: p.oshiName.trim(), nickname: p.nickname.trim() });
  };

  return (
    <form className="card form" onSubmit={submit}>
      <h2>{initial ? 'プロフィール編集' : 'はじめに設定しよう📸'}</h2>

      <fieldset>
        <legend>推しと写真会</legend>
        <label>
          推しの名前
          <input value={p.oshiName} onChange={(e) => set('oshiName', e.target.value)} placeholder="例：みーちゃん" />
        </label>
        <div className="label">推しカラー</div>
        <div className="colors">
          {COLORS.map((c) => (
            <button
              type="button"
              key={c}
              className={`swatch ${p.oshiColor === c ? 'selected' : ''}`}
              style={{ background: c }}
              onClick={() => set('oshiColor', c)}
              aria-label={`推しカラー ${c}`}
            />
          ))}
          <input type="color" value={p.oshiColor} onChange={(e) => set('oshiColor', e.target.value)} aria-label="カスタムカラー" />
        </div>
        <label>
          イベント名
          <input value={p.eventName} onChange={(e) => set('eventName', e.target.value)} placeholder="例：個別写真会" />
        </label>
        <label>
          写真会の日付
          <input type="date" value={p.eventDate} onChange={(e) => set('eventDate', e.target.value)} required />
        </label>
      </fieldset>

      <fieldset>
        <legend>あなたのこと</legend>
        <label>
          ニックネーム
          <input value={p.nickname} onChange={(e) => set('nickname', e.target.value)} placeholder="例：ゆう" />
        </label>
        <div className="row">
          <label>
            性別（代謝計算用）
            <select value={p.sex} onChange={(e) => set('sex', e.target.value as Profile['sex'])}>
              <option value="female">女性</option>
              <option value="male">男性</option>
            </select>
          </label>
          <label>
            年齢
            <input type="number" inputMode="numeric" value={p.age || ''} onChange={num('age')} />
          </label>
        </div>
        <div className="row">
          <label>
            身長 (cm)
            <input type="number" inputMode="decimal" step="0.1" value={p.heightCm || ''} onChange={num('heightCm')} />
          </label>
          <label>
            {initial ? '開始時の体重 (kg)' : '今の体重 (kg)'}
            <input type="number" inputMode="decimal" step="0.1" value={p.startWeightKg || ''} onChange={num('startWeightKg')} />
          </label>
        </div>
        <label>
          写真会までの目標体重 (kg)
          <input type="number" inputMode="decimal" step="0.1" value={p.targetWeightKg || ''} onChange={num('targetWeightKg')} />
        </label>
        <label>
          ふだんの活動量
          <select value={p.activity} onChange={(e) => set('activity', e.target.value as ActivityLevel)}>
            {(Object.keys(ACTIVITY_LABELS) as ActivityLevel[]).map((k) => (
              <option key={k} value={k}>
                {ACTIVITY_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      {error && <p className="error">{error}</p>}
      <div className="actions">
        {onCancel && (
          <button type="button" className="ghost" onClick={onCancel}>
            キャンセル
          </button>
        )}
        <button type="submit" className="primary">
          {initial ? '保存' : 'ダイエットをはじめる'}
        </button>
      </div>
    </form>
  );
}
