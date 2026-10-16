import { useState } from 'react';
import type { Profile } from '../types';
import type { Plan } from '../lib/calc';
import { ProfileForm } from './ProfileForm';

interface Props {
  profile: Profile;
  plan: Plan;
  onSave: (p: Profile) => void;
  onReset: () => void;
}

export function Settings({ profile, plan, onSave, onReset }: Props) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <ProfileForm
        initial={profile}
        onSave={(p) => {
          onSave(p);
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="stack">
      <section className="card">
        <h3>あなたのプラン</h3>
        <ul className="list plain">
          <li>
            <span>基礎代謝</span>
            <span className="kcal">{plan.bmr} kcal</span>
          </li>
          <li>
            <span>1日の消費カロリー（目安）</span>
            <span className="kcal">{plan.tdee} kcal</span>
          </li>
          <li>
            <span>1日のマイナス</span>
            <span className="kcal">−{plan.deficit} kcal</span>
          </li>
          <li>
            <span>1日の目標摂取カロリー</span>
            <span className="kcal">
              <b>{plan.targetKcal} kcal</b>
            </span>
          </li>
        </ul>
        <p className="muted">
          目標摂取カロリーは基礎代謝を下回らず、減量ペースが週に体重の1%以内になるように自動で調整しています。
          数値はあくまで目安です。持病のある方や体調に不安がある方は医師に相談してください。
        </p>
        <button className="primary wide" onClick={() => setEditing(true)}>
          プロフィール・写真会の日を編集
        </button>
      </section>

      <section className="card">
        <h3>データ</h3>
        <p className="muted">記録はこの端末のブラウザにだけ保存されます。</p>
        <button
          className="danger wide"
          onClick={() => {
            if (confirm('すべての記録を削除して最初からやり直しますか？')) onReset();
          }}
        >
          すべてリセット
        </button>
      </section>
    </div>
  );
}
