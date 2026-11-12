"""入力CSVの列の定義。

results.csv（1行 = 1頭 × 1レース。過去レースの結果と、これから走るレースの出馬表を同じ形で持つ）
payouts.csv（1行 = 1つの払戻。race_id, bet_type, combination, payout）
odds.csv   （任意。発走前の組み合わせオッズ。race_id, bet_type, combination, odds）
"""

from __future__ import annotations

import pandas as pd

# 任意の列
#   league: 主催。"jra"（中央）または "nankan"（南関東 = 浦和・船橋・大井・川崎）。
#           無ければ CLI の --league の値で埋める。中央と南関東を1つの CSV にまとめてもよい
#           （中央からの転入馬は中央時代の成績も特徴量に使える）。

# 出馬表の時点で分かる列（予想に使ってよい）
CARD_COLUMNS = [
    "race_id",        # レースID（例: 202405020811）
    "date",           # 開催日 YYYY-MM-DD
    "course",         # 競馬場（東京・中山 など）
    "surface",        # 芝 / ダ / 障
    "distance",       # 距離 m
    "going",          # 馬場状態 良 / 稍 / 重 / 不
    "race_class",     # クラスを数値化したもの（主催ごとの対応は CLASS_SCALE）
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

LEAGUES = ("jra", "nankan")
LEAGUE_LABEL = {"jra": "中央", "nankan": "南関東"}
NANKAN_COURSES = ("浦和", "船橋", "大井", "川崎")

# 払戻率（控除率の裏返し）。主催者が変えることがあるので、たまに公式で確認すること。
PAYBACK_BY_LEAGUE = {
    "jra": {"win": 0.80, "quinella": 0.775, "wide": 0.775, "exacta": 0.75},
    "nankan": {"win": 0.80, "quinella": 0.75, "wide": 0.75, "exacta": 0.75},
}
PAYBACK = PAYBACK_BY_LEAGUE["jra"]

# race_class の数値の付け方（大きいほど上のクラス。主催の中で順序が合っていればよい）
CLASS_SCALE = {
    "jra": {"新馬": 1, "未勝利": 1, "1勝": 2, "2勝": 3, "3勝": 4, "OP": 5, "L": 5, "G3": 6, "G2": 7, "G1": 8},
    "nankan": {"新馬": 1, "未格付": 1, "C3": 2, "C2": 3, "C1": 4, "B3": 5, "B2": 6, "B1": 7,
               "A2": 8, "A1": 9, "OP": 10, "S3": 11, "S2": 12, "S1": 13, "Jpn3": 13, "Jpn2": 14, "Jpn1": 15},
}


def load_results(path: str, league: str | None = None) -> pd.DataFrame:
    """league は文字のクラス（"B1" など）を数値に直すときの既定の主催。"""
    df = pd.read_csv(path, dtype={"race_id": str, "horse_id": str, "jockey_id": str, "trainer_id": str})
    missing = [c for c in CARD_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"{path} に必要な列がありません: {missing}")
    # league 列が無い・空のときは競馬場名から判断する（南関東4場以外は中央とみなす）
    by_course = pd.Series(["nankan" if c in NANKAN_COURSES else "jra" for c in df["course"]], index=df.index)
    df["league"] = df["league"].fillna(by_course).str.lower() if "league" in df.columns else by_course
    if not pd.api.types.is_numeric_dtype(df["race_class"]):
        # "B1" や "3勝" のような文字のクラスは数値に直す
        df["race_class"] = [CLASS_SCALE.get(lg or league, {}).get(str(c), c) for lg, c in zip(df["league"], df["race_class"])]
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

