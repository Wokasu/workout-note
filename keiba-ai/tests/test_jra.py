"""JRA 公式サイトの読み取りのテスト。

見本ページは keiba-fixtures ブランチにある（サイトのページなので main には入れない）:
  git fetch origin keiba-fixtures && mkdir -p /tmp/fx && for f in $(git ls-tree --name-only origin/keiba-fixtures); do git show origin/keiba-fixtures:$f > /tmp/fx/$f; done
  KEIBA_FIXTURES=/tmp/fx pytest tests/test_jra.py
"""
import csv
import datetime as dt
import os

import pytest

from keiba_ai import jra, jra_update

FX = os.environ.get("KEIBA_FIXTURES", "/tmp/claude-0/fx")
pytestmark = pytest.mark.skipif(not os.path.exists(f"{FX}/result_race.html"), reason="見本ページがありません")


def page(name):
    return open(f"{FX}/{name}.html", encoding="utf-8").read()


def test_parse_result_and_payouts():
    rows, pays = jra.parse_result(page("result_race"), "pw01sde1005202605011220261107/7E")
    assert len(rows) == 18 and rows[0]["field_size"] == 18
    w = rows[0]
    assert (w["race_id"], w["finish_pos"], w["number"], w["horse_id"]) == ("202605050112", 1, 15, "2023106947")
    assert (w["surface"], w["distance"], w["going"], w["race_class"]) == ("芝", 1600, "良", 2)
    assert (w["time_sec"], w["last3f"], w["body_weight"], w["body_weight_diff"]) == (93.6, 33.2, 484, 2)
    assert {"win", "quinella", "wide", "exacta"} == {p["bet_type"] for p in pays}
    assert [p["combination"] for p in pays if p["bet_type"] == "wide"] == ["14-15", "5-15", "5-14"]
    assert next(p for p in pays if p["bet_type"] == "exacta")["combination"] == "15-14"


def test_parse_old_result_page():
    rows, _ = jra.parse_result(page("m201811_result"), "pw01sde1005201805011220181103/00")
    assert rows[0]["horse_id"] == "2015100529" and rows[0]["sex"] == "セ" and rows[0]["race_class"] == 3


def test_parse_odds_and_card():
    odds = jra.parse_odds(page("odds_win_today"))
    assert odds[1] == 7.2 and len(odds) == 16
    card = jra.parse_card(page("card_race"), "pw01dde1005202605011220261107/C9")
    assert len(card) == 16 and card[0]["win_odds"] == 7.2 and card[0]["popularity"] == 3
    assert card[0]["jockey_id"] == "1206" and card[0]["trainer_id"] == "1169" and card[0]["weight_carried"] == 55


def test_month_cnames():
    m = jra.month_cnames(page("month_current"))
    assert m["202011"] == "pw01skl10202011/30" and m["202611"].startswith("pw01skl00")


class FakeFetch:
    requests = 0

    def get(self, path, cname):
        self.requests += 1
        for prefix, name in [("pw01skl", "month_current"), ("pw01srl", "result_kaisai"), ("pw01sde", "result_race"),
                             ("pw151ou", "odds_win_today"), ("pw01dli", "card_top"), ("pw01drl", "card_kaisai"),
                             ("pw01dde", "card_race")]:
            if cname.startswith(prefix):
                return page(name)
        raise AssertionError(cname)


def test_update_results_and_card(tmp_path, monkeypatch):
    monkeypatch.setattr(jra_update, "today_jst", lambda: dt.date(2026, 11, 8))
    s = jra_update.update_results(str(tmp_path), "202611", 10, FakeFetch(), log=lambda *_: None)
    rows = list(csv.DictReader(open(tmp_path / "results.csv", encoding="utf-8")))
    assert s["new_races"] > 0 and rows and rows[0]["league"] == "jra" and rows[0]["win_odds"]
    again = jra_update.update_results(str(tmp_path), "202611", 10, FakeFetch(), log=lambda *_: None)
    assert again["new_races"] == 0  # 取り込み済みは飛ばす
    n = jra_update.update_card(str(tmp_path), FakeFetch(), log=lambda *_: None)
    card = list(csv.DictReader(open(tmp_path / "card.csv", encoding="utf-8")))
    assert n > 0 and card[0]["going"] in ("良", "稍", "重", "不")
