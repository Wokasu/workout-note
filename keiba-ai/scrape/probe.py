"""調査用: 各サイトの robots.txt と、ページの構造（先頭部分）を表示するだけ。"""
import re
import sys
import time
import urllib.request

UA = "Mozilla/5.0 (personal keiba-ai probe; low frequency)"


def get(url, data=None):
    req = urllib.request.Request(url, data=data, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
            ct = r.headers.get("Content-Type", "")
            enc = (re.search(r"charset=([\w-]+)", ct) or re.search(rb'charset="?([\w-]+)', raw[:2000]))
            enc = enc.group(1) if enc else "utf-8"
            enc = enc.decode() if isinstance(enc, bytes) else enc
            return r.status, ct, raw.decode(enc, errors="replace")
    except Exception as e:
        return "ERR", "", repr(e)
    finally:
        time.sleep(2)


def show(title, url, n=2500, pattern=None):
    st, ct, text = get(url)
    print(f"\n===== {title}\n{url}\nstatus={st} type={ct} len={len(text)}")
    if pattern:
        for m in re.finditer(pattern, text):
            print("  match:", m.group(0)[:200])
    body = re.sub(r"<script.*?</script>|<style.*?</style>", "", text, flags=re.S)
    print(body[:n])
    return text


for host in ["www.jra.go.jp", "race.netkeiba.com", "db.netkeiba.com"]:
    show(f"robots {host}", f"https://{host}/robots.txt", 3000)

date = sys.argv[1] if len(sys.argv) > 1 else "20261108"
lst = show("netkeiba race list", f"https://race.netkeiba.com/top/race_list_sub.html?kaisai_date={date}", 800,
           r"race_id=\d{12}")
ids = sorted(set(re.findall(r"race_id=(\d{12})", lst)))
print("race ids:", ids[:40])
if ids:
    t = show("netkeiba shutuba", f"https://race.netkeiba.com/race/shutuba.html?race_id={ids[-1]}", 200)
    i = t.find("Shutuba_Table")
    print("--- shutuba table snippet ---\n", t[i:i + 6000] if i >= 0 else t[:3000])
past = show("netkeiba db race", "https://db.netkeiba.com/race/202505021211/", 200)
i = past.find("race_table_01")
print("--- result table snippet ---\n", past[i:i + 4000])
j = past.find("pay_table_01")
print("--- payout snippet ---\n", past[j:j + 3000])
show("jra top", "https://www.jra.go.jp/", 1500, r"accessD\.html|JRADB[^\"']*")
