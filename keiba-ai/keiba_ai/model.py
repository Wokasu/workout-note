"""能力モデル（LightGBM）と、市場オッズとの合成（Benter 型の条件付きロジット）。

最終確率 p_i ∝ exp( a·log(モデル確率_i) + b·log(市場確率_i) )
a, b はモデルの学習に使っていない年のデータで、勝ち馬の対数尤度が最大になるように決める。
- b が大きい: 市場がよく当たっている（モデルの上乗せ分が小さい）
- a > 0 で有意: モデルが市場にない情報を持っている → ここが回収率の源泉
"""

from __future__ import annotations

import warnings
from dataclasses import dataclass, field

import lightgbm as lgb
import numpy as np
import pandas as pd
from scipy.optimize import minimize

from .features import feature_columns


def race_softmax(score: np.ndarray, race_ids: np.ndarray) -> np.ndarray:
    s = pd.Series(score)
    s = s - s.groupby(race_ids).transform("max")
    e = np.exp(s)
    return (e / e.groupby(race_ids).transform("sum")).to_numpy()


def market_prob(win_odds: pd.Series, race_ids) -> np.ndarray:
    inv = 1.0 / win_odds.clip(lower=1.0).fillna(999.0)
    return (inv / inv.groupby(np.asarray(race_ids)).transform("sum")).to_numpy()


@dataclass
class KeibaModel:
    params: dict = field(default_factory=lambda: dict(
        n_estimators=2000, learning_rate=0.03, num_leaves=31, min_child_samples=50,
        subsample=0.8, subsample_freq=1, colsample_bytree=0.8, reg_lambda=1.0, verbose=-1,
    ))
    features: list[str] = field(default_factory=list)
    booster: lgb.LGBMClassifier | None = None
    a: float = 1.0
    b: float = 0.0
    g2: float = 0.81
    g3: float = 0.65

    # ---- 学習 ----
    def fit(self, train: pd.DataFrame, calib: pd.DataFrame) -> "KeibaModel":
        """train で能力モデル、calib（train より後の期間）で市場との合成係数を決める。"""
        train = train[train["finish_pos"].notna()]
        calib = calib[calib["finish_pos"].notna()]
        self.features = feature_columns(train)
        y = (train["finish_pos"] == 1).astype(int)
        # 早期打ち切り用に train の最後の 15% を使う（時間順）
        cut = train["date"].quantile(0.85)
        tr, va = train["date"] < cut, train["date"] >= cut
        clf = lgb.LGBMClassifier(**self.params)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", category=FutureWarning)
            warnings.simplefilter("ignore", category=DeprecationWarning)
            clf.fit(train.loc[tr, self.features], y[tr],
                    eval_set=[(train.loc[va, self.features], y[va])],
                    callbacks=[lgb.early_stopping(100, verbose=False)])
        self.booster = clf
        self._fit_blend(calib)
        return self

    def _fit_blend(self, calib: pd.DataFrame) -> None:
        rid = calib["race_id"].to_numpy()
        lm = np.log(np.clip(self.model_prob(calib), 1e-6, 1))
        lq = np.log(np.clip(market_prob(calib["win_odds"], rid), 1e-6, 1))
        won = (calib["finish_pos"] == 1).to_numpy()

        def nll(w):
            p = race_softmax(w[0] * lm + w[1] * lq, rid)
            return -np.log(np.clip(p[won], 1e-12, 1)).sum()

        res = minimize(nll, x0=[0.5, 0.5], method="Nelder-Mead")
        self.a, self.b = map(float, res.x)

    # ---- 予測 ----
    def model_prob(self, df: pd.DataFrame) -> np.ndarray:
        raw = self.booster.predict(df[self.features], raw_score=True)
        return race_softmax(raw, df["race_id"].to_numpy())

    def predict(self, df: pd.DataFrame) -> pd.DataFrame:
        """各馬の model_p（モデル単体）, market_p（オッズから）, p（合成＝最終）を付けて返す。"""
        out = df.copy()
        rid = out["race_id"].to_numpy()
        out["model_p"] = self.model_prob(out)
        out["market_p"] = market_prob(out["win_odds"], rid)
        if out["win_odds"].notna().all():
            z = self.a * np.log(np.clip(out["model_p"], 1e-6, 1)) + self.b * np.log(np.clip(out["market_p"], 1e-6, 1))
            out["p"] = race_softmax(z.to_numpy(), rid)
        else:  # オッズが無いときはモデル単体
            out["p"] = out["model_p"]
        return out

    def feature_importance(self, top: int = 20) -> pd.Series:
        imp = pd.Series(self.booster.booster_.feature_importance("gain"), index=self.features)
        return imp.sort_values(ascending=False).head(top)


def log_loss_report(df: pd.DataFrame) -> dict[str, float]:
    """勝ち馬の平均対数尤度（大きいほど良い）を、モデル単体・市場・合成で比べる。"""
    won = (df["finish_pos"] == 1).to_numpy()
    out = {}
    for c in ("model_p", "market_p", "p"):
        out[c] = float(np.log(np.clip(df[c].to_numpy()[won], 1e-12, 1)).mean())
    return out
