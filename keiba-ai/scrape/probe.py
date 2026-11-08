"""調査用（JRA公式）: 数年前のレースでも結果・オッズのページが残っているか確かめ、見本を保存する。"""
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
        time.sleep(3)


def links(text, prefix):
    return list(dict.fromkeys(re.findall(r"(/JRADB/access\w+\.html)(?:',\s*'|\?CNAME=)(" + prefix + r"[\w/]+)", text)))


def save(name, text):
    open(f"{OUT}/{name}.html", "w", encoding="utf-8").write(text)
    print("saved", name, len(text), text[:60].replace("\n", " ") if text.startswith("ERR") else "")


for ym, cname in [("202011", "pw01skl10202011/30"), ("201811", "pw01skl10201811/25")]:
    m = get("/JRADB/accessS.html", cname)
    save(f"m{ym}_month", m)
    k = links(m, "pw01srl")
    print(ym, "kaisai", len(k))
    if not k:
        continue
    kk = get(*k[0]); save(f"m{ym}_kaisai", kk)
    r = links(kk, "pw01sde")
    print(ym, "races", len(r))
    if r:
        rr = get(*r[-1]); save(f"m{ym}_result", rr)
        o = links(rr, "pw151ou")
        print(ym, "odds links", o[:2])
        if o:
            save(f"m{ym}_odds", get(*o[0]))
