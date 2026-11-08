"""ウォークフォワード検証（過去のある年を「未来」とみなし、それより前のデータだけで予想して買う）。

年 Y を検証するとき:
  能力モデルの学習 = Y-2 年以前、市場との合成係数 = Y-1 年、検証 = Y 年
こうすると検証年の情報は一切使っていないので、回収率を素直に評価できる。
"""

from __future__ import annotations

from dataclasses import asdict

import numpy as np
import pandas as pd

from .features import build_features
from .model import KeibaModel, log_loss_report
from .schema import BET_LABEL
from .strategy import StrategyConfig, recommend


def odds_lookup(odds: pd.DataFrame | None) -> dict[str, dict[str, dict[str, float]]]:
    if odds is None or odds.empty:
        return {}
    out: dict = {}
    for (rid, t), g in odds.groupby(["race_id", "bet_type"]):
        out.setdefault(rid, {})[t] = dict(zip(g["combination"], g["odds"].astype(float)))
    return out


def _settle(bet, race: pd.DataFrame, pay: dict) -> float:
    fin = race.dropna(subset=["finish_pos"]).sort_values("finish_pos")
    top = fin["number"].astype(int).tolist()
    nums = [int(x) for x in bet.combo.split("-")]
    if bet.bet_type == "win":
        hit = len(top) >= 1 and nums[0] == top[0]
    elif bet.bet_type == "quinella":
        hit = len(top) >= 2 and set(nums) == set(top[:2])
    elif bet.bet_type == "exacta":
        hit = len(top) >= 2 and nums == top[:2]
    else:  # wide
        hit = len(top) >= 3 and set(nums) <= set(top[:3])
    if not hit:
        return 0.0
    p = pay.get((bet.bet_type, bet.combo))
    per100 = p if p is not None else bet.odds * 100
    return per100 * bet.stake / 100


def walk_forward(raw: pd.DataFrame, payouts: pd.DataFrame | None = None, odds: pd.DataFrame | None = None,
                 cfg: StrategyConfig | None = None, test_years: list[int] | None = None,
                 verbose: bool = True) -> tuple[pd.DataFrame, pd.DataFrame]:
    cfg = cfg or StrategyConfig()
    feats = build_features(raw)
    years = sorted(feats["date"].dt.year.unique())
    test_years = test_years or years[2:]
    olk = odds_lookup(odds)
    pay_idx: dict = {}
    if payouts is not None:
        for rid, g in payouts.groupby("race_id"):
            pay_idx[rid] = dict(zip(zip(g["bet_type"], g["combination"]), g["payout"].astype(float)))

    bets_rows, preds = [], []
    for y in test_years:
        yr = feats["date"].dt.year
        train, calib, test = feats[yr <= y - 2], feats[yr == y - 1], feats[yr == y]
        if train.empty or calib.empty or test.empty:
            continue
        model = KeibaModel().fit(train, calib)
        pred = model.predict(test[test["win_odds"].notna()])
        preds.append(pred.assign(test_year=y))
        if verbose:
            ll = log_loss_report(pred)
            print(f"[{y}] 合成係数 a(モデル)={model.a:.2f} b(市場)={model.b:.2f}  "
                  f"勝ち馬の平均対数尤度 モデル{ll['model_p']:.3f} 市場{ll['market_p']:.3f} 合成{ll['p']:.3f}")
        for rid, race in pred.groupby("race_id", sort=False):
            if race["finish_pos"].notna().sum() < 3:
                continue
            rec = recommend(race, cfg, olk.get(rid))
            for b in rec.bets:
                ret = _settle(b, race, pay_idx.get(rid, {}))
                bets_rows.append({"race_id": rid, "date": race["date"].iloc[0], "honmei": rec.honmei,
                                  "taikou": rec.taikou, **asdict(b), "return": ret})
    bets = pd.DataFrame(bets_rows)
    return bets, pd.concat(preds) if preds else pd.DataFrame()


def summarize(bets: pd.DataFrame, preds: pd.DataFrame, n_races: int | None = None) -> str:
    out = []
    if bets.empty:
        return "買い目がありませんでした（基準が厳しすぎるか、データが少なすぎます）。"
    bets = bets.sort_values("date")
    races = bets["race_id"].nunique()
    total_races = preds["race_id"].nunique() if not preds.empty else n_races
    out.append(f"検証レース {total_races} / 購入レース {races}（購入率 {races / max(total_races, 1):.1%}）")

    def row(name, g):
        st, rt = g["stake"].sum(), g["return"].sum()
        return {"券種": name, "点数": len(g), "的中": int((g["return"] > 0).sum()),
                "的中率": f"{(g['return'] > 0).mean():.1%}", "投資": int(st), "払戻": int(rt),
                "回収率": f"{rt / st:.1%}" if st else "-", "平均オッズ": round(g["odds"].mean(), 1)}

    rows = [row(BET_LABEL[t], g) for t, g in bets.groupby("bet_type")] + [row("合計", bets)]
    out.append(pd.DataFrame(rows).to_string(index=False))

    # 期待値の帯ごとの回収率（min_ev の決め方の材料）
    b = bets.assign(ev_band=pd.cut(bets["ev"], [1.0, 1.15, 1.3, 1.5, 2.0, 99]))
    band = b.groupby(["bet_type", "ev_band"], observed=True).apply(
        lambda g: pd.Series({"点数": len(g), "回収率": g["return"].sum() / g["stake"].sum()}), include_groups=False)
    band["回収率"] = band["回収率"].map("{:.1%}".format)
    out.append("期待値の帯ごとの回収率:\n" + band.to_string())

    by_year = bets.assign(year=bets["date"].dt.year).groupby("year").apply(
        lambda g: f"{g['return'].sum() / g['stake'].sum():.1%}（投資 {int(g['stake'].sum()):,}円）", include_groups=False)
    out.append("年ごとの回収率:\n" + by_year.to_string())

    cum = (bets["return"] - bets["stake"]).cumsum()
    dd = (cum.cummax() - cum).max()
    out.append(f"収支 {int(cum.iloc[-1]):+,}円 / 最大ドローダウン {int(dd):,}円")

    if not preds.empty:
        p = preds.dropna(subset=["finish_pos"])
        base = []
        for name, col in [("モデル単体の1位の単勝", "model_p"), ("合成確率の1位の単勝", "p"), ("1番人気の単勝", "market_p")]:
            top = p.loc[p.groupby("race_id")[col].idxmax()]
            r = (top["win_odds"] * (top["finish_pos"] == 1)).sum() / len(top)
            base.append(f"  {name}を毎レース100円: 的中率 {(top['finish_pos'] == 1).mean():.1%} 回収率 {r:.1%}")
        out.append("比較（期待値を見ずに買った場合）:\n" + "\n".join(base))
    return "\n\n".join(out)
