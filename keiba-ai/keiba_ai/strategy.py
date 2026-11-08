"""◎○ と買い目を決める。

考え方
- 「当たりやすい馬」ではなく「期待値（確率 × オッズ）が 1 を十分に上回る買い目」を買う。
- ◎-○ の組（順序つき）を全通り試し、単勝◎・馬連・ワイド・馬単のうち
  基準を満たす買い目の期待利益の合計が最大になる組を ◎○ にする。
- 基準を満たす買い目が1つもないレースは「見送り」。回収率を上げる一番の手段は買わないこと。
- 金額は分数ケリー（ケリー基準の一部）。1レースの合計は資金の max_race_frac まで。

オッズ
- 単勝は出馬表の win_odds。
- 馬連・ワイド・馬単は odds（実オッズ）があればそれを使う。ワイドは「下限」のオッズを入れること。
- 無いときは単勝オッズから推定する（市場の確率 × 払戻率）。推定は外れることがあるので、
  実際に買う前は必ず実オッズで見直す。
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .probs import combo_probs
from .schema import BET_LABEL, BET_TYPES, PAYBACK


@dataclass
class StrategyConfig:
    # 買う期待値の下限（モデルの誤差を見込んで 1.0 より上に置く）
    min_ev: dict = field(default_factory=lambda: {"win": 1.15, "quinella": 1.20, "wide": 1.15, "exacta": 1.30})
    # 当たる確率の下限（極端な穴は確率の見積り誤差が大きく、期待値が過大に出やすい）
    min_prob: dict = field(default_factory=lambda: {"win": 0.05, "quinella": 0.02, "wide": 0.05, "exacta": 0.015})
    # オッズの上限（同じ理由）
    max_odds: dict = field(default_factory=lambda: {"win": 30.0, "quinella": 80.0, "wide": 30.0, "exacta": 150.0})
    enabled: tuple = BET_TYPES
    # ◎・○ になれる最低の勝率（○ が大穴になるのを防ぐ。「◎○の2頭」の形を保つ）
    min_honmei_p: float = 0.06
    min_taikou_p: float = 0.04
    # 推定オッズは実オッズより甘く出やすいので割り引いて判断する（実オッズを渡せば関係なし）
    est_odds_haircut: float = 0.85
    kelly_fraction: float = 0.15
    bankroll: float = 100_000
    max_race_frac: float = 0.03      # 1レースに使う上限（資金に対して）
    unit: int = 100
    g2: float = 0.81
    g3: float = 0.65


@dataclass
class Bet:
    bet_type: str
    combo: str
    prob: float
    odds: float
    ev: float
    stake: int
    odds_estimated: bool

    def label(self) -> str:
        sep = "→" if self.bet_type == "exacta" else "-"
        return f"{BET_LABEL[self.bet_type]} {self.combo.replace('-', sep)}"


@dataclass
class Recommendation:
    race_id: str
    honmei: int          # ◎ の馬番
    taikou: int          # ○ の馬番
    bets: list[Bet]
    table: pd.DataFrame  # 各馬の確率と単勝期待値

    @property
    def skip(self) -> bool:
        return not self.bets

    @property
    def total_stake(self) -> int:
        return sum(b.stake for b in self.bets)


def estimate_odds(win_odds: np.ndarray, g2: float, g3: float) -> dict[str, np.ndarray]:
    """単勝オッズから馬連・ワイド・馬単のオッズを推定する。"""
    inv = 1.0 / np.clip(win_odds, 1.0, None)
    cp = combo_probs(inv / inv.sum(), g2, g3)
    out = {}
    for t in ("quinella", "wide", "exacta"):
        with np.errstate(divide="ignore"):
            o = PAYBACK[t] / cp[t]
        out[t] = np.round(np.clip(o, 1.0, 9999.0), 1)
    return out


def _odds_matrix(numbers: np.ndarray, table: dict[str, float] | None, bet_type: str, est: np.ndarray):
    """実オッズの辞書 {'3-7': 12.3} を馬番の並びの行列にする。無い所は推定値。"""
    n = len(numbers)
    mat = est.copy()
    is_est = np.ones((n, n), dtype=bool)
    if table:
        pos = {int(x): i for i, x in enumerate(numbers)}
        for combo, o in table.items():
            a, b = (int(x) for x in combo.split("-"))
            if a in pos and b in pos:
                i, j = pos[a], pos[b]
                mat[i, j] = o
                is_est[i, j] = False
                if bet_type != "exacta":
                    mat[j, i] = o
                    is_est[j, i] = False
    return mat, is_est


def _kelly_stake(p, o, ev, ok, cfg: StrategyConfig):
    with np.errstate(divide="ignore", invalid="ignore"):
        f = (p * o - 1.0) / (o - 1.0)
    f = np.where(ok & (o > 1.0), np.clip(f, 0, None), 0.0) * cfg.kelly_fraction
    stake = f * cfg.bankroll
    return stake, np.where(ok, stake * (ev - 1.0), 0.0)


def recommend(race: pd.DataFrame, cfg: StrategyConfig, odds: dict[str, dict[str, float]] | None = None) -> Recommendation:
    """race: 1レース分（列 number, p, win_odds）。odds: {'quinella': {'3-7': 12.3}, ...}"""
    race = race.dropna(subset=["p"]).sort_values("number").reset_index(drop=True)
    num = race["number"].astype(int).to_numpy()
    n = len(num)
    cp = combo_probs(race["p"].to_numpy(), cfg.g2, cfg.g3)
    win_o = race["win_odds"].to_numpy(dtype=float)
    est = {t: o * cfg.est_odds_haircut for t, o in estimate_odds(win_o, cfg.g2, cfg.g3).items()}
    odds = odds or {}

    probs, omat, estm = {}, {}, {}
    probs["win"] = np.repeat(cp["win"][:, None], n, axis=1)    # 行 = ◎
    omat["win"] = np.repeat(win_o[:, None], n, axis=1)
    estm["win"] = np.zeros((n, n), dtype=bool)
    for t in ("quinella", "wide", "exacta"):
        probs[t] = cp[t]
        omat[t], estm[t] = _odds_matrix(num, odds.get(t), t, est[t])

    eye = np.eye(n, dtype=bool)
    stakes, score = {}, np.zeros((n, n))
    for t in BET_TYPES:
        p, o = probs[t], omat[t]
        ev = p * o
        ok = ((t in cfg.enabled) & (ev >= cfg.min_ev[t]) & (p >= cfg.min_prob[t])
              & (o <= cfg.max_odds[t]) & ~eye & np.isfinite(o))
        stakes[t], ep = _kelly_stake(p, o, ev, ok, cfg)
        score += ep
    score[eye] = -np.inf
    pw = cp["win"]
    score[pw < cfg.min_honmei_p, :] = -np.inf
    score[:, pw < cfg.min_taikou_p] = -np.inf

    table = race[["number", "horse_name", "win_odds", "p", "model_p", "market_p"]].copy() \
        if {"model_p", "market_p", "horse_name"} <= set(race.columns) else race[["number", "win_odds", "p"]].copy()
    table["place3_p"] = cp["place3"]
    table["win_ev"] = cp["win"] * win_o

    rid = str(race["race_id"].iloc[0])
    if not np.isfinite(score).any() or score.max() <= 0:
        order = np.argsort(-cp["win"])
        return Recommendation(rid, int(num[order[0]]), int(num[order[1]]), [], table)

    i, j = np.unravel_index(np.argmax(score), score.shape)
    bets: list[Bet] = []
    for t in BET_TYPES:
        s = stakes[t][i, j]
        if s <= 0:
            continue
        if t == "win":
            combo = str(num[i])
        elif t == "exacta":
            combo = f"{num[i]}-{num[j]}"
        else:
            combo = "-".join(str(x) for x in sorted((num[i], num[j])))
        bets.append(Bet(t, combo, float(probs[t][i, j]), float(omat[t][i, j]),
                        float(probs[t][i, j] * omat[t][i, j]), s, bool(estm[t][i, j])))

    # 1レースの上限で縮め、100円単位にする（最低1単位）
    total = sum(b.stake for b in bets)
    cap = cfg.bankroll * cfg.max_race_frac
    scale = min(1.0, cap / total) if total > 0 else 1.0
    for b in bets:
        b.stake = int(max(1, round(b.stake * scale / cfg.unit)) * cfg.unit)
    return Recommendation(rid, int(num[i]), int(num[j]), bets, table)


def format_recommendation(rec: Recommendation, show_table: bool = True) -> str:
    lines = [f"■ レース {rec.race_id}"]
    t = rec.table.set_index("number")
    name = lambda k: f"{k}番 {t.loc[k, 'horse_name']}" if "horse_name" in t.columns else f"{k}番"
    lines.append(f"  ◎ {name(rec.honmei)}  （勝率 {t.loc[rec.honmei, 'p']:.1%} / 単勝 {t.loc[rec.honmei, 'win_odds']:.1f}倍）")
    lines.append(f"  ○ {name(rec.taikou)}  （勝率 {t.loc[rec.taikou, 'p']:.1%} / 単勝 {t.loc[rec.taikou, 'win_odds']:.1f}倍）")
    if rec.skip:
        lines.append("  → 見送り（期待値の基準を満たす買い目なし）。◎○ は参考の上位2頭")
    else:
        for b in rec.bets:
            mark = "（推定オッズ。実オッズで要確認）" if b.odds_estimated else ""
            lines.append(f"  {b.label():<12} {b.stake:>6,}円   的中率 {b.prob:5.1%}  オッズ {b.odds:6.1f}  期待値 {b.ev:.2f}{mark}")
        lines.append(f"  合計 {rec.total_stake:,}円")
    if show_table:
        tbl = rec.table.sort_values("p", ascending=False).head(8).copy()
        for c in ("p", "model_p", "market_p", "place3_p"):
            if c in tbl:
                tbl[c] = (tbl[c] * 100).round(1)
        tbl["win_ev"] = tbl["win_ev"].round(2)
        lines.append("  上位8頭（%）:")
        lines += ["    " + s for s in tbl.to_string(index=False).splitlines()]
    return "\n".join(lines)
