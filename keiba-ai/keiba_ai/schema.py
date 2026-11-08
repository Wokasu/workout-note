"""入力CSVの列の定義。

results.csv（1行 = 1頭 × 1レース。過去レースの結果と、これから走るレースの出馬表を同じ形で持つ）
payouts.csv（1行 = 1つの払戻。race_id, bet_type, combination, payout）
odds.csv   （任意。発走前の組み合わせオッズ。race_id, bet_type, combination, odds）
"""

from __future__ import annotations

import pandas as pd

# 出馬表の時点で分かる列（予想に使ってよい）
CARD_COLUMNS = [
    "race_id",        # レースID（例: 202405020811）
    "date",           # 開催日 YYYY-MM-DD
    "course",         # 競馬場（東京・中山 など）
    "surface",        # 芝 / ダ / 障
    "distance",       # 距離 m
    "going",          # 馬場状態 良 / 稍 / 重 / 不
    "race_class",     # クラスを数値化したもの（新馬・未勝利=1, 1勝=2, 2勝=3, 3勝=4, OP/L=5, G3=6, G2=7, G1=8）
    "field_size",     # 出走頭数
    "horse_id",
    "horse_name",
    "frame",          # 枠番
    "number",         # 馬番
    "sex",            # 牡 / 牝 / セ
    "age",
    "weight_carried",  # 斤量
    "jockey_id",
    "trainer_id",
    "body_weight",     # 馬体重（当日。未発表なら空でよい）
    "body_weight_diff",
    "win_odds",        # 単勝オッズ（予想時は締切直前の値が望ましい）
    "popularity",      # 単勝人気
]

# レース後に分かる列（過去レースだけに入っていればよい）
RESULT_COLUMNS = [
    "finish_pos",  # 着順（取消・除外・中止は空）
    "time_sec",    # 走破タイム 秒
    "last3f",      # 上がり3F 秒
]

BET_TYPES = ("win", "quinella", "wide", "exacta")
BET_LABEL = {"win": "単勝", "quinella": "馬連", "wide": "ワイド", "exacta": "馬単"}

# JRA の払戻率（控除率の裏返し）
PAYBACK = {"win": 0.80, "quinella": 0.775, "wide": 0.775, "exacta": 0.75}


def load_results(path: str) -> pd.DataFrame:
    df = pd.read_csv(path, dtype={"race_id": str, "horse_id": str, "jockey_id": str, "trainer_id": str})
    missing = [c for c in CARD_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"{path} に必要な列がありません: {missing}")
    for c in RESULT_COLUMNS:
        if c not in df.columns:
            df[c] = pd.NA
    df["date"] = pd.to_datetime(df["date"])
    for c in ["distance", "race_class", "field_size", "frame", "number", "age",
              "weight_carried", "body_weight", "body_weight_diff", "win_odds",
              "popularity", "finish_pos", "time_sec", "last3f"]:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    return df


def load_payouts(path: str) -> pd.DataFrame:
    df = pd.read_csv(path, dtype={"race_id": str, "combination": str})
    df["combination"] = [normalize_combo(t, c) for t, c in zip(df["bet_type"], df["combination"])]
    return df


def load_odds(path: str) -> pd.DataFrame:
    df = pd.read_csv(path, dtype={"race_id": str, "combination": str})
    df["combination"] = [normalize_combo(t, c) for t, c in zip(df["bet_type"], df["combination"])]
    return df


def normalize_combo(bet_type: str, combo: str) -> str:
    """'7-3' → 馬連・ワイドは '3-7'（小さい順）、馬単はそのまま '7-3'、単勝は '7'。"""
    parts = [int(x) for x in str(combo).replace("→", "-").replace(">", "-").split("-") if x.strip()]
    if bet_type in ("quinella", "wide"):
        parts = sorted(parts)
    return "-".join(str(x) for x in parts)

