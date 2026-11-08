"""動作確認用の架空データを作る（本物のレースではない。回収率の数字に意味はない）。"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .probs import combo_probs
from .schema import PAYBACK

COURSES = ["東京", "中山", "阪神", "京都", "中京", "新潟", "福島", "小倉", "札幌", "函館"]


def generate(n_years: int = 4, races_per_year: int = 1200, seed: int = 0) -> tuple[pd.DataFrame, pd.DataFrame]:
    rng = np.random.default_rng(seed)
    n_horses, n_jockeys, n_trainers = 4000, 120, 200
    ability = rng.normal(0, 1, n_horses)
    turf_apt = rng.normal(0, 0.5, n_horses)
    best_dist = rng.choice([1200, 1400, 1600, 1800, 2000, 2400], n_horses)
    jockey_skill = rng.normal(0, 0.3, n_jockeys)
    trainer_skill = rng.normal(0, 0.2, n_trainers)
    trainer_of = rng.integers(0, n_trainers, n_horses)
    sex = rng.choice(["牡", "牝", "セ"], n_horses, p=[0.55, 0.4, 0.05])
    birth = 2020 - rng.integers(0, 6, n_horses)
    weight = rng.normal(480, 25, n_horses).round()

    rows, pays = [], []
    start = pd.Timestamp("2021-01-05")
    for r in range(n_years * races_per_year):
        date = start + pd.DateOffset(years=r // races_per_year) + pd.Timedelta(days=int(r % races_per_year / races_per_year * 350))
        rid = f"{date:%Y%m%d}{r % 100000:05d}"
        surface = rng.choice(["芝", "ダ"])
        dist = int(rng.choice([1200, 1400, 1600, 1800, 2000, 2400]))
        fs = int(rng.integers(8, 17))
        cls = int(rng.integers(1, 9))
        # クラスが高いほど能力の高い馬が集まる
        cand = np.argsort(ability + rng.normal(0, 1.2, n_horses) - (cls - 4.5) * 0.35)
        lo = int((cls - 1) / 8 * (n_horses - fs * 20))
        horses = rng.choice(cand[lo: lo + fs * 20], fs, replace=False)
        jockeys = rng.integers(0, n_jockeys, fs)
        apt = (turf_apt[horses] * (1 if surface == "芝" else -1)
               - np.abs(best_dist[horses] - dist) / 800)
        strength = ability[horses] + apt + jockey_skill[jockeys] + trainer_skill[trainer_of[horses]]
        perf = strength + rng.gumbel(0, 0.9, fs)
        order = np.argsort(-perf)
        finish = np.empty(fs, int)
        finish[order] = np.arange(1, fs + 1)
        # 市場は強さをある程度知っているが、ノイズと「人気への寄りすぎ」がある
        mkt = ability[horses] + 0.6 * apt + jockey_skill[jockeys] * 1.5 + trainer_skill[trainer_of[horses]] + rng.normal(0, 0.35, fs)
        q = np.exp(mkt / 0.9)
        q /= q.sum()
        win_odds = np.clip(np.round(PAYBACK["win"] / q, 1), 1.1, 999.9)
        pop = pd.Series(win_odds).rank(method="first").astype(int).to_numpy()
        base = dist / 16.5 + (0.8 if surface == "ダ" else 0)
        time = base + (perf.max() - perf) * 0.25
        last3f = 35.0 - (perf - perf.mean()) * 0.3 + rng.normal(0, 0.3, fs)
        for k in range(fs):
            h = horses[k]
            rows.append(dict(
                race_id=rid, date=date.date().isoformat(), course=COURSES[r % len(COURSES)], surface=surface,
                distance=dist, going=rng.choice(["良", "稍", "重", "不"], p=[0.7, 0.15, 0.1, 0.05]),
                race_class=cls, field_size=fs, horse_id=f"H{h:05d}", horse_name=f"ホース{h}",
                frame=min(8, k // 2 + 1), number=k + 1, sex=sex[h], age=date.year - birth[h],
                weight_carried=55 + (sex[h] != "牝") * 2, jockey_id=f"J{jockeys[k]:03d}",
                trainer_id=f"T{trainer_of[h]:03d}", body_weight=weight[h] + rng.integers(-8, 9),
                body_weight_diff=int(rng.integers(-8, 9)), win_odds=win_odds[k], popularity=pop[k],
                finish_pos=finish[k], time_sec=round(time[k], 1), last3f=round(last3f[k], 1),
            ))
        # 払戻（市場の確率 × 払戻率で作る）
        nums = np.arange(1, fs + 1)
        cp = combo_probs(q)
        f1, f2, f3 = order[0], order[1], order[2]
        pays.append((rid, "win", str(nums[f1]), round(win_odds[f1] * 100)))
        a, b = sorted((nums[f1], nums[f2]))
        pays.append((rid, "quinella", f"{a}-{b}", round(PAYBACK["quinella"] / cp["quinella"][f1, f2] * 100, -1)))
        pays.append((rid, "exacta", f"{nums[f1]}-{nums[f2]}", round(PAYBACK["exacta"] / cp["exacta"][f1, f2] * 100, -1)))
        for x, y in [(f1, f2), (f1, f3), (f2, f3)]:
            a, b = sorted((nums[x], nums[y]))
            # ワイドは票数を3等分した的中組ごとに払い戻すので、オッズ ≒ 払戻率 / P(2頭とも3着内)
            pays.append((rid, "wide", f"{a}-{b}", max(100, round(PAYBACK["wide"] / cp["wide"][x, y] * 100, -1))))
    return pd.DataFrame(rows), pd.DataFrame(pays, columns=["race_id", "bet_type", "combination", "payout"])
