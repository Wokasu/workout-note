"""コマンドライン。

  python -m keiba_ai.cli synth    --out data/
  python -m keiba_ai.cli backtest --results data/results.csv --payouts data/payouts.csv [--odds data/odds.csv]
  python -m keiba_ai.cli train    --results data/results.csv          （models/model_jra.pkl に保存）
  python -m keiba_ai.cli predict  --results data/results.csv --card data/card.csv [--odds data/odds_today.csv]

南関東は全部のコマンドに --league nankan を付ける（モデルは models/model_nankan.pkl に別に保存される）。
"""

from __future__ import annotations

import argparse
import os
import pickle

import pandas as pd

from .backtest import odds_lookup, summarize, walk_forward
from .features import build_features
from .model import KeibaModel
from .schema import LEAGUE_LABEL, LEAGUES, load_odds, load_payouts, load_results
from .strategy import StrategyConfig, format_recommendation, recommend


def _cfg(a) -> StrategyConfig:
    cfg = StrategyConfig(bankroll=a.bankroll, kelly_fraction=a.kelly, max_race_frac=a.max_race, league=a.league)
    if a.bets:
        cfg.enabled = tuple(a.bets.split(","))
    for t in ("win", "quinella", "wide", "exacta"):
        v = getattr(a, f"ev_{t}")
        if v is not None:
            cfg.min_ev[t] = v
    return cfg


def main(argv=None):
    ap = argparse.ArgumentParser(prog="keiba_ai")
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--league", choices=LEAGUES, default="jra", help="jra=中央, nankan=南関東（浦和・船橋・大井・川崎）")
    sub = ap.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("synth", help="動作確認用の架空データを作る", parents=[common])
    s.add_argument("--out", default="data")
    s.add_argument("--years", type=int, default=4)

    def strategy_args(p):
        p.add_argument("--bankroll", type=float, default=100_000, help="資金（金額の計算に使う）")
        p.add_argument("--kelly", type=float, default=0.15, help="ケリー基準の何割で張るか")
        p.add_argument("--max-race", type=float, default=0.03, help="1レースに使う資金の上限割合")
        p.add_argument("--bets", default="", help="使う券種（例: win,quinella,wide）。既定は全部")
        for t in ("win", "quinella", "wide", "exacta"):
            p.add_argument(f"--ev-{t}", type=float, default=None, help=f"{t} を買う期待値の下限")

    b = sub.add_parser("backtest", help="ウォークフォワードで回収率を検証", parents=[common])
    b.add_argument("--results", required=True)
    b.add_argument("--payouts")
    b.add_argument("--odds")
    b.add_argument("--out", default="out/bets.csv")
    strategy_args(b)

    t = sub.add_parser("train", help="最新までのデータで学習してモデルを保存", parents=[common])
    t.add_argument("--results", required=True)
    t.add_argument("--model", default=None, help="既定は models/model_<league>.pkl")

    p = sub.add_parser("predict", help="出馬表から ◎○ と買い目を出す", parents=[common])
    p.add_argument("--model", default=None, help="既定は models/model_<league>.pkl")
    p.add_argument("--results", required=True, help="過去の結果（特徴量の材料）")
    p.add_argument("--card", required=True, help="これから走るレースの出馬表（results と同じ列、結果の列は空）")
    p.add_argument("--odds", help="馬連・ワイド・馬単の実オッズ（任意）")
    p.add_argument("--table", action="store_true", help="各馬の確率表も出す")
    strategy_args(p)

    a = ap.parse_args(argv)
    if getattr(a, "model", None) is None:
        a.model = f"models/model_{a.league}.pkl"
    print(f"【{LEAGUE_LABEL[a.league]}】")

    if a.cmd == "synth":
        from .synthetic import generate
        os.makedirs(a.out, exist_ok=True)
        res, pay = generate(n_years=a.years, league=a.league)
        res.to_csv(f"{a.out}/results.csv", index=False)
        pay.to_csv(f"{a.out}/payouts.csv", index=False)
        print(f"{a.out}/results.csv（{res['race_id'].nunique()} レース）と payouts.csv を作りました")

    elif a.cmd == "backtest":
        raw = load_results(a.results, a.league)
        pay = load_payouts(a.payouts) if a.payouts else None
        odds = load_odds(a.odds) if a.odds else None
        if odds is None:
            print("※ 馬連・ワイド・馬単のオッズは単勝オッズからの推定で判断します（払戻は payouts.csv の実績）\n")
        bets, preds = walk_forward(raw, pay, odds, _cfg(a))
        print()
        print(summarize(bets, preds))
        os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
        bets.to_csv(a.out, index=False)
        print(f"\n買い目の明細: {a.out}")

    elif a.cmd == "train":
        feats = build_features(load_results(a.results, a.league))
        feats = feats[feats["finish_pos"].notna() & (feats["league"] == a.league)]
        if feats.empty:
            raise SystemExit(f"{LEAGUE_LABEL[a.league]}のレースがありません（league 列か --league を確認）")
        last = feats["date"].max() - pd.DateOffset(years=1)
        model = KeibaModel().fit(feats[feats["date"] <= last], feats[feats["date"] > last])
        os.makedirs(os.path.dirname(a.model) or ".", exist_ok=True)
        with open(a.model, "wb") as f:
            pickle.dump(model, f)
        print(f"保存: {a.model}  合成係数 a(モデル)={model.a:.2f} b(市場)={model.b:.2f}")
        print("重要な特徴量:\n" + model.feature_importance(15).round(0).to_string())

    elif a.cmd == "predict":
        with open(a.model, "rb") as f:
            model: KeibaModel = pickle.load(f)
        hist, card = load_results(a.results, a.league), load_results(a.card, a.league)
        card[["finish_pos", "time_sec", "last3f"]] = float("nan")
        hist = hist[~hist["race_id"].isin(card["race_id"])]
        feats = build_features(pd.concat([hist, card], ignore_index=True))
        target = feats[feats["race_id"].isin(card["race_id"].unique()) & (feats["league"] == a.league)]
        pred = model.predict(target)
        olk = odds_lookup(load_odds(a.odds)) if a.odds else {}
        cfg = _cfg(a)
        for rid, race in pred.groupby("race_id", sort=False):
            print(format_recommendation(recommend(race, cfg, olk.get(rid)), show_table=a.table))
            print()


if __name__ == "__main__":
    main()
