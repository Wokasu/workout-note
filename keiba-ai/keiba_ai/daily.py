"""毎朝の予想ファイルを作る（GitHub Actions から実行）。

  python -m keiba_ai.daily --data data_jra --out data_jra/predictions.json [--backtest]

能力モデル（LightGBM）の勝率 model_p と、市場との合成係数 a, b を書き出す。
最終の勝率と買い目はスマホのページが計算する（締切前に入れた実オッズで合成し直せるように）。
--backtest を付けると、ウォークフォワード検証の結果も backtest.json に書く。
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os

import pandas as pd

from .backtest import summary_data, walk_forward
from .pipeline import predict_card, train_model
from .schema import load_payouts, load_results
from .strategy import StrategyConfig

JST = dt.timezone(dt.timedelta(hours=9))


def clean(x):
    if isinstance(x, dict):
        return {k: clean(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [clean(v) for v in x]
    if hasattr(x, "item"):
        x = x.item()
    if isinstance(x, float) and not math.isfinite(x):
        return None
    return x


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="data_jra")
    ap.add_argument("--out", default=None)
    ap.add_argument("--backtest", action="store_true")
    a = ap.parse_args(argv)
    out = a.out or f"{a.data}/predictions.json"
    now = dt.datetime.now(JST).strftime("%Y-%m-%d %H:%M")
    res_path, card_path = f"{a.data}/results.csv", f"{a.data}/card.csv"
    hist = load_results(res_path, "jra")
    n_races = int(hist["race_id"].nunique())
    span = f"{hist['date'].min():%Y-%m-%d}〜{hist['date'].max():%Y-%m-%d}"
    doc: dict = {"generated_at": now, "league": "jra", "history": {"races": n_races, "span": span}, "races": []}
    try:
        model = train_model(hist, "jra")
        doc["model"] = {"kind": "lightgbm", "a": model.a, "b": model.b}
    except ValueError as e:
        doc["error"] = f"過去データを集めている途中です（{n_races} レース、{span}）。{e}"
        model = None

    if model is not None and os.path.exists(card_path) and os.path.getsize(card_path) > 200:
        card = load_results(card_path, "jra")
        pred = predict_card(model, hist, card, "jra")
        names = card.drop_duplicates("race_id").set_index("race_id")["race_name"].to_dict() if "race_name" in card else {}
        for rid, r in pred.groupby("race_id", sort=False):
            f = r.iloc[0]
            doc["races"].append({
                "race_id": str(rid), "date": f"{f['date']:%Y-%m-%d}", "course": str(f["course"]),
                "surface": str(f["surface"]), "distance": int(f["distance"]), "race_name": names.get(rid, ""),
                "race_no": int(str(rid)[-2:]),
                "horses": [{"number": int(h["number"]), "frame": int(h["frame"]) if pd.notna(h["frame"]) else 1,
                            "name": h["horse_name"], "model_p": float(h["model_p"]),
                            "win_odds": float(h["win_odds"]) if pd.notna(h["win_odds"]) else None,
                            "popularity": int(h["popularity"]) if pd.notna(h["popularity"]) else None}
                           for _, h in r.sort_values("number").iterrows()],
            })
        doc["races"].sort(key=lambda x: (x["date"], x["course"], x["race_no"]))

    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(clean(doc), fh, ensure_ascii=False, separators=(",", ":"))
    print(f"{out}: {len(doc['races'])} レース {doc.get('error', '')}")

    if a.backtest and model is not None:
        pay_path = f"{a.data}/payouts.csv"
        pay = load_payouts(pay_path) if os.path.exists(pay_path) else None
        logs: list[str] = []
        bets, preds = walk_forward(hist, pay, None, StrategyConfig(league="jra"), log=logs.append)
        bt = {"generated_at": now, "summary": summary_data(bets, preds), "logs": logs, "estimated_odds": True}
        with open(os.path.join(os.path.dirname(out) or ".", "backtest.json"), "w", encoding="utf-8") as fh:
            json.dump(clean(bt), fh, ensure_ascii=False, separators=(",", ":"))
        print("backtest.json:", "; ".join(logs))


if __name__ == "__main__":
    main()
