"""学習と予想の手順（CLI とブラウザ版の両方から使う）。"""

from __future__ import annotations

import pandas as pd

from .features import build_features
from .model import KeibaModel
from .schema import LEAGUE_LABEL


def train_model(raw: pd.DataFrame, league: str) -> KeibaModel:
    """最後の1年で市場との合成係数を決め、それより前で能力モデルを学習する。"""
    feats = build_features(raw)
    feats = feats[feats["finish_pos"].notna() & (feats["league"] == league)]
    if feats.empty:
        raise ValueError(f"{LEAGUE_LABEL[league]}のレースがありません（league 列か競馬場名を確認してください）")
    last = feats["date"].max() - pd.DateOffset(years=1)
    train, calib = feats[feats["date"] <= last], feats[feats["date"] > last]
    if train.empty or calib.empty:
        raise ValueError("データが1年分に足りません。最低2年分（できれば3年以上）入れてください")
    return KeibaModel().fit(train, calib)


def predict_card(model: KeibaModel, hist: pd.DataFrame, card: pd.DataFrame, league: str) -> pd.DataFrame:
    """出馬表の各馬に勝率を付けて返す（過去走は hist から取る）。"""
    card = card.copy()
    card[["finish_pos", "time_sec", "last3f"]] = float("nan")
    hist = hist[~hist["race_id"].isin(card["race_id"])]
    feats = build_features(pd.concat([hist, card], ignore_index=True))
    target = feats[feats["race_id"].isin(card["race_id"].unique()) & (feats["league"] == league)]
    if target.empty:
        raise ValueError(f"出馬表に{LEAGUE_LABEL[league]}のレースがありません")
    return model.predict(target)
