"""調査用（JRA公式）: 出馬表・結果ページのリンクのたどり方と表の形を表示する。"""
import re
import time
import urllib.parse
import urllib.request

UA = "Mozilla/5.0 (personal keiba-ai; low frequency)"
BASE = "https://www.jra.go.jp"


def get(path, cname=None):
    url = BASE + path
    data = urllib.parse.urlencode({"cname": cname}).encode() if cname else None
    req = urllib.request.Request(url, data=data, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read().decode("cp932", errors="replace")
    except Exception as e:
        return "ERR", repr(e)
    finally:
        time.sleep(2)


def cnames(text):
    a = re.findall(r"doAction\('(/JRADB/access\w+\.html)',\s*'([^']+)'\)", text)
    b = re.findall(r"(/JRADB/access\w+\.html)\?CNAME=([\w/]+)", text)
    return list(dict.fromkeys(a + b))


def section(title, text, n=1500):
    print(f"\n===== {title}  len={len(text)}")
    body = re.sub(r"<script.*?</script>|<style.*?</style>|<head.*?</head>", "", text, flags=re.S)
    body = re.sub(r"\n\s*\n+", "\n", body)
    print(body[:n])


# 出馬表のトップ（開催一覧）
st, top = get("/JRADB/accessD.html", "pw01dli00/F3")
section("出馬表トップ", top, 1200)
links = cnames(top)
print("links:", links[:40])
kaisai = [c for c in links if c[1].startswith("pw01drl")]
print("開催ごと:", kaisai)
if kaisai:
    st, k = get(kaisai[0][0], kaisai[0][1])
    section("開催のレース一覧", k, 1500)
    races = [c for c in cnames(k) if c[1].startswith("pw01dde")]
    print("races:", races[:15])
    if races:
        st, r = get(races[-1][0], races[-1][1])
        i = r.find("<table"); section("出馬表 1レース", r[i:], 7000)
        print("links in race:", [c for c in cnames(r)][:30])
        print("horse links:", re.findall(r"pw01dud\w+/\w+", r)[:5], "jockey:", re.findall(r"pw04kmk\w+/\w+|pw12\w+/\w+", r)[:5])

# 結果のトップ
st, rs = get("/JRADB/accessS.html", "pw01sli00/AF")
section("結果トップ", rs, 1000)
rl = cnames(rs)
print("result links:", rl[:30])
k2 = [c for c in rl if c[1].startswith("pw01srl")]
if k2:
    st, k = get(k2[0][0], k2[0][1])
    res = [c for c in cnames(k) if c[1].startswith("pw01sde")]
    print("result races:", res[:5])
    if res:
        st, r = get(res[-1][0], res[-1][1])
        i = r.find("<table"); section("結果 1レース", r[i:], 6000)
        j = r.find("払戻"); section("払戻", r[j:], 2500)
# 過去の結果（年月で検索）
st, past = get("/JRADB/accessS.html", "pw01skl00999999/B3")
section("過去のレース結果検索", past, 1500)
print("past links:", cnames(past)[:30])
