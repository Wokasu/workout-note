import type { Profile } from '../types';
import type { Plan } from '../lib/calc';
import { progressRatio } from '../lib/calc';
import { decideMood, pickCheer } from '../lib/cheers';
import { formatJa } from '../lib/date';

interface Props {
  profile: Profile;
  plan: Plan;
  today: string;
  todayKcal: number;
  streak: number;
  onGoMeals: () => void;
}

export function Home({ profile, plan, today, todayKcal, streak, onGoMeals }: Props) {
  const eventPassed = today > profile.eventDate;
  const mood = decideMood({ daysLeft: plan.daysLeft, eventPassed, todayKcal, targetKcal: plan.targetKcal });
  const seed = Number(today.replaceAll('-', '')) + Math.floor(todayKcal / 300);
  const cheer = pickCheer(mood, profile, { days: plan.daysLeft, streak }, seed);

  const remainKcal = plan.targetKcal - todayKcal;
  const ratio = Math.min(1, todayKcal / plan.targetKcal);
  const progress = progressRatio(profile.startWeightKg, plan.currentKg, profile.targetWeightKg);

  return (
    <div className="stack">
      <section className="card countdown">
        <div className="event-name">
          {profile.eventName} · {formatJa(profile.eventDate)}
        </div>
        {eventPassed ? (
          <div className="big">おつかれさま！</div>
        ) : plan.daysLeft === 0 ? (
          <div className="big">今日が当日🎉</div>
        ) : (
          <div className="big">
            {profile.oshiName}に会えるまで
            <span className="days">{plan.daysLeft}</span>日
          </div>
        )}
      </section>

      <section className="card cheer">
        <div className="avatar" aria-hidden>
          📸
        </div>
        <p>{cheer}</p>
      </section>

      <section className="card">
        <h3>今日のカロリー</h3>
        <div className="ring-wrap">
          <Ring ratio={ratio} over={remainKcal < 0} />
          <div className="ring-text">
            <div className="ring-main">{todayKcal}</div>
            <div className="ring-sub">/ {plan.targetKcal} kcal</div>
          </div>
        </div>
        <p className={`remain ${remainKcal < 0 ? 'over' : ''}`}>
          {remainKcal >= 0 ? `あと ${remainKcal} kcal 食べられるよ` : `${-remainKcal} kcal オーバー`}
        </p>
        <button className="primary wide" onClick={onGoMeals}>
          ごはんを記録する
        </button>
      </section>

      <section className="card">
        <h3>目標まで</h3>
        <div className="stats">
          <Stat label="いま" value={`${plan.currentKg.toFixed(1)}kg`} />
          <Stat label="目標" value={`${profile.targetWeightKg.toFixed(1)}kg`} />
          <Stat label="あと" value={`${plan.remainingKg.toFixed(1)}kg`} />
          <Stat label="連続達成" value={`${streak}日`} />
        </div>
        <div className="bar" aria-label={`進捗 ${Math.round(progress * 100)}%`}>
          <div className="bar-fill" style={{ width: `${progress * 100}%` }} />
        </div>
        <div className="bar-label">{Math.round(progress * 100)}% 達成</div>
        {plan.tooFast && !eventPassed && plan.remainingKg > 0 && (
          <p className="notice">
            ⚠️ 当日までに目標達成するには1日あたり約{plan.requiredDeficit}kcalのマイナスが必要で、体に負担が大きいペースです。
            健康的なペース（1日{plan.targetKcal}kcal）で続けると、当日は約<b>{plan.projectedKg.toFixed(1)}kg</b>の見込み。
            むくみ対策や姿勢・表情の練習でも写真映えは変わるよ！
          </p>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

function Ring({ ratio, over }: { ratio: number; over: boolean }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 120 120" className="ring" aria-hidden>
      <circle cx="60" cy="60" r={r} className="ring-bg" />
      <circle
        cx="60"
        cy="60"
        r={r}
        className={`ring-fg ${over ? 'over' : ''}`}
        strokeDasharray={c}
        strokeDashoffset={c * (1 - ratio)}
        transform="rotate(-90 60 60)"
      />
    </svg>
  );
}
