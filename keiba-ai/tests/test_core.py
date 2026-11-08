import numpy as np
import pandas as pd
import pytest

from keiba_ai.features import build_features
from keiba_ai.probs import combo_probs
from keiba_ai.schema import normalize_combo
from keiba_ai.strategy import StrategyConfig, recommend
from keiba_ai.synthetic import generate


def test_combo_probs_are_consistent():
    p = np.array([0.4, 0.25, 0.15, 0.1, 0.06, 0.04])
    cp = combo_probs(p)
    assert cp["exacta"].sum() == pytest.approx(1.0)
    assert cp["quinella"].sum() / 2 == pytest.approx(1.0)
    assert cp["wide"].sum() / 2 == pytest.approx(3.0)       # 3着内のペアは毎レース3組
    assert cp["place3"].sum() == pytest.approx(3.0)
    assert cp["exacta"][0].sum() == pytest.approx(0.4)     # 1着の周辺確率は単勝確率
    assert np.allclose(cp["wide"], cp["wide"].T)


def test_normalize_combo():
    assert normalize_combo("quinella", "7-3") == "3-7"
    assert normalize_combo("wide", "12-3") == "3-12"
    assert normalize_combo("exacta", "7→3") == "7-3"


def test_features_do_not_leak_future_results():
    res, _ = generate(n_years=1, races_per_year=300, seed=1)
    res["date"] = pd.to_datetime(res["date"])
    f1 = build_features(res)
    # 最後の日の結果を書き換えても、それ以前のレースの特徴量は変わらない
    last = res["date"].max()
    res2 = res.copy()
    res2.loc[res2["date"] == last, "finish_pos"] = res2.loc[res2["date"] == last, "finish_pos"][::-1].values
    f2 = build_features(res2)
    cols = [c for c in f1.columns if c.startswith(("h_", "j_", "t_"))]
    before = f1["date"] <= last
    pd.testing.assert_frame_equal(f1.loc[before, cols], f2.loc[before, cols])
    # 当日のレースの特徴量も、その日の結果には左右されない
    same_day = f1["date"] == last
    pd.testing.assert_frame_equal(f1.loc[same_day, cols], f2.loc[same_day, cols])


def _race(p, odds):
    return pd.DataFrame({"race_id": "R", "number": np.arange(1, len(p) + 1), "p": p, "win_odds": odds})


def test_skip_when_odds_are_fair():
    p = np.array([0.35, 0.25, 0.15, 0.1, 0.08, 0.07])
    rec = recommend(_race(p, np.round(0.8 / p, 1)), StrategyConfig())
    assert rec.skip
    assert (rec.honmei, rec.taikou) == (1, 2)


def test_bets_on_underrated_horse():
    p = np.array([0.20, 0.30, 0.15, 0.15, 0.10, 0.10])
    market = np.array([0.40, 0.15, 0.15, 0.12, 0.10, 0.08])   # 2番を市場が軽く見ている
    rec = recommend(_race(p, np.round(0.8 / market, 1)), StrategyConfig())
    assert not rec.skip
    assert rec.honmei == 2
    assert any(b.bet_type == "win" and b.combo == "2" for b in rec.bets)
    assert all(b.stake % 100 == 0 and b.stake > 0 for b in rec.bets)
    assert rec.total_stake <= StrategyConfig().bankroll * StrategyConfig().max_race_frac + 100 * 4


def test_real_odds_override_estimate():
    p = np.array([0.20, 0.30, 0.15, 0.15, 0.10, 0.10])
    market = np.array([0.40, 0.15, 0.15, 0.12, 0.10, 0.08])
    race = _race(p, np.round(0.8 / market, 1))
    rec = recommend(race, StrategyConfig(enabled=("quinella",)), {"quinella": {"1-2": 1.5}})
    assert not any(b.combo == "1-2" for b in rec.bets)  # 実オッズが安すぎれば買わない
