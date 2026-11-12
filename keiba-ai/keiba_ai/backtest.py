"""ウォークフォワード検証（過去のある年を「未来」とみなし、それより前のデータだけで予想して買う）。

年 Y を検証するとき:
  能力モデルの学習 = Y-2 年以前、市場との合成係数 = Y-1 年、検証 = Y 年
こうすると検証年の情報は一切使っていないので、回収率を素直に評価できる。
"""

from __future__ import annotations

from dataclasses import asdict

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
                 verbose: bool = True, log=print) -> tuple[pd.DataFrame, pd.DataFrame]:
    """cfg.league の主催のレースだけを学習・検証する（特徴量は全主催の過去走から作る）。"""
    cfg = cfg or StrategyConfig()
    feats = build_features(raw)
    feats = feats[feats["league"] == cfg.league]
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
            log(f"[{y}] 合成係数 a(モデル)={model.a:.2f} b(市場)={model.b:.2f}  "
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


def summary_data(bets: pd.DataFrame, preds: pd.DataFrame) -> dict:
    """検証結果を数字のまとまりにする（CLI の文章とブラウザの表の両方がこれを使う）。"""
    total_races = int(preds["race_id"].nunique()) if not preds.empty else 0
    out: dict = {"races": total_races, "bought_races": 0, "by_type": [], "ev_bands": [], "by_year": [],
                 "profit": 0, "max_drawdown": 0, "baselines": [], "curve": []}
    if not preds.empty:
        p = preds.dropna(subset=["finish_pos"])
        for name, col in [("モデル単体の1位の単勝", "model_p"), ("合成確率の1位の単勝", "p"), ("1番人気の単勝", "market_p")]:
            top = p.loc[p.groupby("race_id")[col].idxmax()]
            won = top["finish_pos"] == 1
            out["baselines"].append({"name": name, "hit_rate": float(won.mean()),
                                     "roi": float((top["win_odds"] * won).sum() / len(top))})
    if bets.empty:
        return out
    bets = bets.sort_values("date")
    out["bought_races"] = int(bets["race_id"].nunique())

    def row(name, g):
        st, rt = float(g["stake"].sum()), float(g["return"].sum())
        return {"name": name, "bets": int(len(g)), "hits": int((g["return"] > 0).sum()),
                "hit_rate": float((g["return"] > 0).mean()), "stake": st, "return": rt,
                "roi": rt / st if st else 0.0, "avg_odds": float(g["odds"].mean())}

    order = [t for t in ("win", "quinella", "wide", "exacta") if t in set(bets["bet_type"])]
    out["by_type"] = [row(BET_LABEL[t], bets[bets["bet_type"] == t]) for t in order] + [row("合計", bets)]
    edges = [1.0, 1.15, 1.3, 1.5, 2.0, 99]
    b = bets.assign(ev_band=pd.cut(bets["ev"], edges))
    for (t, band), g in b.groupby(["bet_type", "ev_band"], observed=True):
        lo, hi = band.left, band.right
        out["ev_bands"].append({"bet_type": BET_LABEL[t], "band": f"{lo:.2f}〜{hi:.2f}" if hi < 99 else f"{lo:.2f}〜",
                                **{k: v for k, v in row("", g).items() if k != "name"}})
    for y, g in bets.groupby(bets["date"].dt.year):
        out["by_year"].append({"year": int(y), **{k: v for k, v in row("", g).items() if k != "name"}})
    cum = (bets["return"] - bets["stake"]).cumsum()
    out["profit"] = float(cum.iloc[-1])
    out["max_drawdown"] = float((cum.cummax() - cum).max())
    # 収支の推移（多すぎると重いので間引く）
    step = max(1, len(cum) // 300)
    out["curve"] = [float(x) for x in cum.iloc[::step]] + [float(cum.iloc[-1])]
    return out


def summarize(bets: pd.DataFrame, preds: pd.DataFrame) -> str:
    d = summary_data(bets, preds)
    if not d["by_type"]:
        return "買い目がありませんでした（基準が厳しすぎるか、データが少なすぎます）。"
    pct = "{:.1%}".format
    out = [f"検証レース {d['races']} / 購入レース {d['bought_races']}（購入率 {d['bought_races'] / max(d['races'], 1):.1%}）"]
    out.append(pd.DataFrame([{"券種": r["name"], "点数": r["bets"], "的中": r["hits"], "的中率": pct(r["hit_rate"]),
                              "投資": int(r["stake"]), "払戻": int(r["return"]), "回収率": pct(r["roi"]),
                              "平均オッズ": round(r["avg_odds"], 1)} for r in d["by_type"]]).to_string(index=False))
    out.append("期待値の帯ごとの回収率:\n" + pd.DataFrame([{"券種": r["bet_type"], "期待値": r["band"], "点数": r["bets"],
                                                   "回収率": pct(r["roi"])} for r in d["ev_bands"]]).to_string(index=False))
    out.append("年ごとの回収率:\n" + "\n".join(f"  {r['year']}  {pct(r['roi'])}（投資 {int(r['stake']):,}円）" for r in d["by_year"]))
    out.append(f"収支 {int(d['profit']):+,}円 / 最大ドローダウン {int(d['max_drawdown']):,}円")
    out.append("比較（期待値を見ずに買った場合）:\n" + "\n".join(
        f"  {r['name']}を毎レース100円: 的中率 {pct(r['hit_rate'])} 回収率 {pct(r['roi'])}" for r in d["baselines"]))
    return "\n\n".join(out)
