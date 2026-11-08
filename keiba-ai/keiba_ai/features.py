"""特徴量づくり。

大原則: あるレースの特徴量には「そのレースの日より前」に分かっていた情報しか使わない。
（同じ日の別レースの結果も使わない。騎手・調教師の成績は前日までで集計する）

単勝オッズ・人気はモデルの特徴量に入れない。モデルは「能力の見立て」だけを出し、
市場（オッズ）とは後で blend.py で合わせる。こうするとモデルが市場の写しにならず、
市場とずれている所 = 妙味のある所を見つけやすくなる。
"""

from __future__ import annotations

import numpy as np
import pandas as pd

CATEGORICAL = ["course", "surface", "going", "sex"]

# レース内で順位・偏差に直す列（相手関係を見るため）
RELATIVE = [
    "h_fp_mean5", "h_fp_last", "h_tb_mean5", "h_l3f_rank_mean5", "h_top3_rate",
    "h_best_tb5", "h_same_surface_fp", "h_same_dist_fp", "j_win_rate", "j_top3_rate",
    "t_win_rate", "t_top3_rate", "h_prev_pop_resid", "weight_carried",
]


def _race_level(df: pd.DataFrame) -> pd.DataFrame:
    """そのレースの中での成績（過去走の材料になる列）。"""
    df = df.copy()
    fs = df.groupby("race_id")["finish_pos"].transform("count").clip(lower=2)
    df["fp_pct"] = (df["finish_pos"] - 1) / (fs - 1)             # 0=1着, 1=最下位
    df["is_win"] = (df["finish_pos"] == 1).astype(float)
    df["is_top3"] = (df["finish_pos"] <= 3).astype(float)
    df.loc[df["finish_pos"].isna(), ["fp_pct", "is_win", "is_top3"]] = np.nan
    win_time = df.groupby("race_id")["time_sec"].transform("min")
    df["time_behind"] = (df["time_sec"] - win_time).clip(upper=5.0)  # 勝ち馬とのタイム差
    df["l3f_rank"] = df.groupby("race_id")["last3f"].rank(pct=True)  # 上がりの速さ（小さいほど速い）
    # 人気より着順が良かったか（市場の見立てを上回った度合い）
    df["pop_resid"] = (df["popularity"] - df["finish_pos"]) / fs
    df["dist_band"] = (df["distance"] // 400).astype("Int64")
    return df


def _horse_history(df: pd.DataFrame) -> pd.DataFrame:
    df = df.sort_values(["horse_id", "date", "race_id"]).copy()
    g = df.groupby("horse_id", sort=False)

    def prev_roll(col, n, how="mean"):
        s = g[col].shift(1)
        r = s.groupby(df["horse_id"]).rolling(n, min_periods=1)
        r = r.mean() if how == "mean" else r.min()
        return r.reset_index(level=0, drop=True)

    df["h_runs"] = g.cumcount()
    df["h_fp_last"] = g["fp_pct"].shift(1)
    df["h_fp_last2"] = g["fp_pct"].shift(2)
    df["h_fp_mean5"] = prev_roll("fp_pct", 5)
    df["h_tb_mean5"] = prev_roll("time_behind", 5)
    df["h_best_tb5"] = prev_roll("time_behind", 5, "min")
    df["h_l3f_rank_mean5"] = prev_roll("l3f_rank", 5)
    df["h_prev_pop_resid"] = prev_roll("pop_resid", 3)
    wins = g["is_win"].transform(lambda s: s.shift(1).fillna(0).cumsum())
    top3 = g["is_top3"].transform(lambda s: s.shift(1).fillna(0).cumsum())
    n = df["h_runs"].replace(0, np.nan)
    df["h_win_rate"] = wins / n
    df["h_top3_rate"] = top3 / n
    df["h_days_since"] = (df["date"] - g["date"].shift(1)).dt.days
    df["h_dist_change"] = df["distance"] - g["distance"].shift(1)
    df["h_class_change"] = df["race_class"] - g["race_class"].shift(1)
    df["h_weight_carried_change"] = df["weight_carried"] - g["weight_carried"].shift(1)

    # 同じ芝ダ・同じ距離帯での過去の着順
    for key, name in [("surface", "h_same_surface_fp"), ("dist_band", "h_same_dist_fp")]:
        gg = df.groupby(["horse_id", key], sort=False)["fp_pct"]
        df[name] = gg.transform(lambda s: s.shift(1).expanding().mean())
    return df


def _people_rates(df: pd.DataFrame, id_col: str, prefix: str, prior_win=0.07, prior_top3=0.21, k=30) -> pd.DataFrame:
    """騎手・調教師の勝率・複勝率（前日までの累積。少ない騎乗数は全体平均へ縮める）。"""
    d = (df.dropna(subset=["is_win"])
           .groupby([id_col, "date"])
           .agg(w=("is_win", "sum"), t=("is_top3", "sum"), n=("is_win", "size"))
           .reset_index().sort_values([id_col, "date"]))
    cs = d.groupby(id_col)[["w", "t", "n"]].cumsum()
    d[["cw", "ct", "cn"]] = cs.values
    d = d[[id_col, "date", "cw", "ct", "cn"]]

    keys = df[[id_col, "date"]].drop_duplicates().sort_values("date")
    # 「その日より前」の最新の累積を当てる（同じ日は含めない）
    keys = keys.assign(_d=keys["date"] - pd.Timedelta(days=1))
    merged = pd.merge_asof(
        keys.sort_values("_d"), d.sort_values("date").rename(columns={"date": "_d"}),
        on="_d", by=id_col, direction="backward",
    ).drop(columns="_d")
    merged[["cw", "ct", "cn"]] = merged[["cw", "ct", "cn"]].fillna(0)
    merged[f"{prefix}_win_rate"] = (merged["cw"] + prior_win * k) / (merged["cn"] + k)
    merged[f"{prefix}_top3_rate"] = (merged["ct"] + prior_top3 * k) / (merged["cn"] + k)
    merged[f"{prefix}_rides"] = merged["cn"]
    return df.merge(merged[[id_col, "date", f"{prefix}_win_rate", f"{prefix}_top3_rate", f"{prefix}_rides"]],
                    on=[id_col, "date"], how="left")


def build_features(raw: pd.DataFrame) -> pd.DataFrame:
    df = _race_level(raw)
    df = _horse_history(df)
    df = _people_rates(df, "jockey_id", "j")
    df = _people_rates(df, "trainer_id", "t")

    df["frame_pct"] = df["number"] / df["field_size"]
    for c in RELATIVE:
        grp = df.groupby("race_id")[c]
        df[f"{c}_rank"] = grp.rank(pct=True)
        df[f"{c}_diff"] = df[c] - grp.transform("mean")
    for c in CATEGORICAL:
        df[c] = df[c].astype("category")
    return df.sort_values(["date", "race_id", "number"]).reset_index(drop=True)


def feature_columns(df: pd.DataFrame) -> list[str]:
    base = [
        "distance", "race_class", "field_size", "frame", "frame_pct", "age", "weight_carried",
        "body_weight", "body_weight_diff",
        "h_runs", "h_fp_last", "h_fp_last2", "h_fp_mean5", "h_tb_mean5", "h_best_tb5",
        "h_l3f_rank_mean5", "h_prev_pop_resid", "h_win_rate", "h_top3_rate", "h_days_since",
        "h_dist_change", "h_class_change", "h_weight_carried_change",
        "h_same_surface_fp", "h_same_dist_fp",
        "j_win_rate", "j_top3_rate", "j_rides", "t_win_rate", "t_top3_rate", "t_rides",
    ] + CATEGORICAL
    rel = [f"{c}_{s}" for c in RELATIVE for s in ("rank", "diff")]
    return [c for c in base + rel if c in df.columns]
