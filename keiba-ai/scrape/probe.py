"""調査用（JRA公式）: パーサーを作るための見本ページを fixtures/ に保存する。"""
import os
import re
import time
import urllib.parse
import urllib.request

UA = "Mozilla/5.0 (personal keiba-ai; low frequency)"
BASE = "https://www.jra.go.jp"
OUT = os.environ.get("OUT", "fixtures")
os.makedirs(OUT, exist_ok=True)


def get(path, cname):
    data = urllib.parse.urlencode({"cname": cname}).encode()
    req = urllib.request.Request(BASE + path, data=data, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.read().decode("cp932", errors="replace")
    except Exception as e:
        return f"ERR {e!r}"
    finally:
        time.sleep(2)


def save(name, text):
    with open(f"{OUT}/{name}.html", "w", encoding="utf-8") as f:
        f.write(text)
    print("saved", name, len(text))


def links(text, prefix):
    a = re.findall(r"(/JRADB/access\w+\.html)(?:',\s*'|\?CNAME=)(" + prefix + r"[\w/]+)", text)
    return list(dict.fromkeys(a))


top = get("/JRADB/accessD.html", "pw01dli00/F3"); save("card_top", top)
kai = links(top, "pw01drl")
if kai:
    k = get(*kai[-1]); save("card_kaisai", k)
    r = links(k, "pw01dde")
    if r:
        save("card_race", get(*r[-1]))
        o = links(get(*r[-1]), "pw151ou")
        if o:
            save("odds_win_today", get(*o[0]))

rt = get("/JRADB/accessS.html", "pw01sli00/AF"); save("result_top", rt)
k = links(rt, "pw01srl")
if k:
    kk = get(*k[0]); save("result_kaisai", kk)
    r = links(kk, "pw01sde")
    if r:
        save("result_race", get(*r[-1]))

# 月ごとの過去結果を前の月へたどる（どこまで遡れるか）
month = get("/JRADB/accessS.html", "pw01skl00999999/B3"); save("month_current", month)
seen = []
for step in range(14):
    prev = [m for m in links(month, "pw01skl10") if m[1][9:15] not in seen]
    prev.sort(key=lambda m: m[1][9:15])
    if not prev:
        break
    target = prev[0]
    seen.append(target[1][9:15])
    month = get(*target)
    print("month", target[1], "kaisai links:", len(links(month, "pw01srl")))
save("month_old", month)
k = links(month, "pw01srl")
if k:
    kk = get(*k[0]); save("old_result_kaisai", kk)
    r = links(kk, "pw01sde")
    if r:
        old = get(*r[-1]); save("old_result_race", old)
        d = links(old, "pw01dde")
        if d:
            save("old_card_race", get(*d[0]))
        o = links(old, "pw151ou")
        if o:
            save("old_odds_win", get(*o[0]))
print("months visited:", seen)
