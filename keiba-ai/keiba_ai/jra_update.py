"""JRA 公式サイトから、過去の結果（＋単勝オッズ・払戻）と今週の出馬表を集めて CSV にする。

  python -m keiba_ai.jra_update results --data DIR --since 202311 --budget-min 300
  python -m keiba_ai.jra_update card    --data DIR

- results: 新しい月から古い月へ。取り込み済みのレースは飛ばすので、何回に分けて実行してもよい。
  時間の上限（--budget-min）に来たら、そこまでを保存して終わる（次の実行で続きから）。
  全部取り終わった月は done_months.txt に書き、次からは見ない（直近2か月は毎回見直す）。
- card: 出馬表が出ている開催（今日以降）の全レースを card.csv に書く（単勝オッズは取得した時点の値）。
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import os
import time

from . import jra

RESULT_COLS = ["race_id", "date", "course", "surface", "league", "distance", "going", "race_class", "field_size",
               "horse_id", "horse_name", "frame", "number", "sex", "age", "weight_carried", "jockey_id", "trainer_id",
               "body_weight", "body_weight_diff", "win_odds", "popularity", "finish_pos", "time_sec", "last3f", "race_name"]
PAY_COLS = ["race_id", "bet_type", "combination", "payout"]
JST = dt.timezone(dt.timedelta(hours=9))


def read_csv(path: str) -> list[dict]:
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as f:
        return list(csv.DictReader(f))


def write_csv(path: str, cols: list[str], rows: list[dict]) -> None:
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({k: fmt(r.get(k)) for k in cols})
    os.replace(tmp, path)


def fmt(v):
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return v


def today_jst() -> dt.date:
    return dt.datetime.now(JST).date()


def update_results(data: str, since: str, budget_min: float, fetch: jra.Fetcher, log=print) -> dict:
    os.makedirs(data, exist_ok=True)
    rpath, ppath, dpath = f"{data}/results.csv", f"{data}/payouts.csv", f"{data}/done_months.txt"
    results, pays = read_csv(rpath), read_csv(ppath)
    have = {r["race_id"] for r in results}
    done = set(open(dpath).read().split()) if os.path.exists(dpath) else set()
    deadline = time.time() + budget_min * 60
    today = today_jst()
    recent = {today.strftime("%Y%m"), (today.replace(day=1) - dt.timedelta(days=1)).strftime("%Y%m")}
    stats = {"new_races": 0, "months": [], "finished": True}

    top = fetch.get("/JRADB/accessS.html", "pw01skl00999999/B3")
    months = jra.month_cnames(top)
    targets = sorted((m for m in months if since <= m <= today.strftime("%Y%m") and (m not in done or m in recent)), reverse=True)

    def save():
        write_csv(rpath, RESULT_COLS, results)
        write_csv(ppath, PAY_COLS, pays)
        with open(dpath, "w") as f:
            f.write("\n".join(sorted(done)) + "\n")

    for ym in targets:
        page = fetch.get("/JRADB/accessS.html", months[ym])
        kaisai = [k for k in jra.links(page, "pw01srl") if jra.parse_cname(k[1])["date"].replace("-", "")[:6] == ym]
        complete = True
        for path, cname in kaisai:
            if time.time() > deadline:
                complete = False
                break
            # 開催の日付が今日以降なら、まだ結果が無い
            if jra.parse_cname(cname)["date"] >= today.isoformat():
                complete = False
                continue
            kpage = fetch.get(path, cname)
            for rpath_, rcname in jra.links(kpage, "pw01sde"):
                rid = jra.race_id_from_cname(rcname)
                if rid in have:
                    continue
                if time.time() > deadline:
                    complete = False
                    break
                try:
                    rpage = fetch.get(rpath_, rcname)
                    rows, pr = jra.parse_result(rpage, rcname)
                    olink = jra.links(rpage, "pw151ou")
                    odds = jra.parse_odds(fetch.get(*olink[0])) if olink else {}
                except RuntimeError as e:
                    log(f"  飛ばしました: {e}")
                    complete = False
                    continue
                if not rows or rows[0]["surface"] == "障":
                    have.add(rid)  # 障害レースは使わない
                    continue
                for r in rows:
                    r["league"] = "jra"
                    r["win_odds"] = odds.get(int(r["number"])) if r["number"] is not None else None
                results.extend(rows)
                pays.extend(pr)
                have.add(rid)
                stats["new_races"] += 1
            save()
            log(f"{ym} {jra.parse_cname(cname)['date']} {jra.parse_cname(cname)['course']} まで  累計 {len(have)} レース  リクエスト {fetch.requests}")
        if complete and ym not in recent:
            done.add(ym)
        stats["months"].append(ym)
        save()
        if time.time() > deadline:
            stats["finished"] = False
            log("時間の上限に来たので、ここまでを保存して終わります（次の実行で続きから）")
            break
    return stats


def update_card(data: str, fetch: jra.Fetcher, log=print) -> int:
    os.makedirs(data, exist_ok=True)
    top = fetch.get("/JRADB/accessD.html", "pw01dli00/F3")
    today = today_jst().isoformat()
    rows = []
    for path, cname in jra.links(top, "pw01drl"):
        if jra.parse_cname(cname)["date"] < today:
            continue
        kpage = fetch.get(path, cname)
        goings = jra.kaisai_goings(kpage)
        for rp, rc in jra.links(kpage, "pw01dde"):
            if jra.parse_cname(rc)["date"] < today:
                continue
            card = jra.parse_card(fetch.get(rp, rc), rc)
            if not card or card[0]["surface"] == "障":
                continue
            for r in card:
                r["league"] = "jra"
                r["going"] = goings.get(r["surface"], "")
            rows.extend(card)
        log(f"出馬表 {jra.parse_cname(cname)['date']} {jra.parse_cname(cname)['course']}: 累計 {len(rows)} 頭")
    write_csv(f"{data}/card.csv", RESULT_COLS, rows)
    return len({r["race_id"] for r in rows})


def main(argv=None):
    ap = argparse.ArgumentParser(prog="jra_update")
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("results")
    r.add_argument("--data", default="data_jra")
    r.add_argument("--since", default="202311", help="この年月（YYYYMM）以降を集める")
    r.add_argument("--budget-min", type=float, default=300)
    r.add_argument("--wait", type=float, default=3.0, help="1回ごとに空ける秒数")
    c = sub.add_parser("card")
    c.add_argument("--data", default="data_jra")
    c.add_argument("--wait", type=float, default=3.0)
    a = ap.parse_args(argv)
    fetch = jra.Fetcher(wait=a.wait)
    if a.cmd == "results":
        s = update_results(a.data, a.since, a.budget_min, fetch)
        print(f"新しく {s['new_races']} レース。{'全部取り終わりました' if s['finished'] else '続きは次の実行で'}")
    else:
        n = update_card(a.data, fetch)
        print(f"出馬表 {n} レース")


if __name__ == "__main__":
    main()
