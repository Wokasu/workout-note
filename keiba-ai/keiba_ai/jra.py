"""JRA 公式サイト（www.jra.go.jp）の出馬表・結果・オッズのページを読む。

robots.txt は全ページの巡回を許可している（Disallow なし）。それでも負担をかけないよう、
1回ごとに数秒あけて、必要なページだけを取りに行く。

ページの住所は「cname」という合言葉（例: pw01sde1005202605011220261107/7E）で決まる。
末尾の /7E は検査用の文字で自分では作れないので、ページの中のリンクをたどって集める。
cname の中身: 種類(7) + 2桁 + 競馬場(2) + 年(4) + 回(2) + 日(2) + レース(2) + 日付(8)
"""

from __future__ import annotations

import html as htmllib
import re
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass

BASE = "https://www.jra.go.jp"
UA = "Mozilla/5.0 (compatible; personal keiba-ai; low frequency)"
COURSE = {"01": "札幌", "02": "函館", "03": "福島", "04": "新潟", "05": "東京",
          "06": "中山", "07": "中京", "08": "京都", "09": "阪神", "10": "小倉"}
PAY_TYPES = {"win": "win", "umaren": "quinella", "wide": "wide", "umatan": "exacta"}


# ---------------- 取得 ----------------
@dataclass
class Fetcher:
    wait: float = 3.0
    retries: int = 3
    requests: int = 0

    def get(self, path: str, cname: str) -> str:
        data = urllib.parse.urlencode({"cname": cname}).encode()
        last = None
        for attempt in range(self.retries):
            time.sleep(self.wait * (1 + attempt * 2))
            req = urllib.request.Request(BASE + path, data=data, headers={"User-Agent": UA})
            try:
                with urllib.request.urlopen(req, timeout=40) as r:
                    self.requests += 1
                    return r.read().decode("cp932", errors="replace")
            except Exception as e:  # 503 などは少し待ってやり直す
                last = e
        raise RuntimeError(f"取得できませんでした {path} {cname}: {last!r}")


# ---------------- 文字の整形 ----------------
def text(s: str) -> str:
    s = re.sub(r"<[^>]+>", " ", s)
    return re.sub(r"\s+", " ", htmllib.unescape(s)).strip()


def num(s: str | None) -> float | None:
    if s is None:
        return None
    s = text(s).replace(",", "")
    m = re.search(r"-?\d+(?:\.\d+)?", s)
    return float(m.group(0)) if m else None


def links(page: str, prefix: str) -> list[tuple[str, str]]:
    """ページ内の (path, cname) を出てきた順に重複なしで返す。"""
    found = re.findall(r"(/JRADB/access\w+\.html)(?:',\s*'|\?CNAME=)(" + prefix + r"[\w/]+)", page)
    return list(dict.fromkeys(found))


def parse_cname(cname: str) -> dict:
    s = re.sub(r"\D+$", "", cname.split("/")[0])[9:]
    if len(s) == 18:  # 開催（レース番号なし）
        s = s[:10] + "00" + s[10:]
    return {"course_code": s[0:2], "course": COURSE.get(s[0:2], s[0:2]), "year": s[2:6], "kai": s[6:8],
            "day": s[8:10], "race": s[10:12], "date": f"{s[12:16]}-{s[16:18]}-{s[18:20]}"}


def race_id_from_cname(cname: str) -> str:
    c = parse_cname(cname)
    return f"{c['year']}{c['course_code']}{c['kai']}{c['day']}{c['race']}"


def time_to_sec(s: str) -> float | None:
    s = text(s)
    m = re.match(r"(?:(\d+):)?(\d+)\.(\d)", s)
    if not m:
        return None
    return int(m.group(1) or 0) * 60 + int(m.group(2)) + int(m.group(3)) / 10


def cells(row: str) -> dict[str, str]:
    """<td class="xxx">…</td> を {xxx: 中身} にする（最初のクラス名で）。"""
    out = {}
    for cls, body in re.findall(r'<td class="([\w-]+)[^"]*"[^>]*>(.*?)</td>', row, flags=re.S):
        out.setdefault(cls, body)
    return out


def sex_age(s: str) -> tuple[str, float | None]:
    t = text(s)
    sex = "セ" if t.startswith("せん") or t.startswith("セ") else t[:1]
    return sex, num(t)


def id_after(prefix: str, s: str) -> str:
    """'pw01dud00' のような接頭辞の後ろの番号。8〜9文字目は現役・引退などで変わるので見ない。"""
    m = re.search(prefix[:7] + r"\d\d(\d+)/", s)
    return m.group(1) if m else ""


# ---------------- レース情報（出馬表・結果に共通の見出し） ----------------
CLASS_WORDS = [("新馬", 1), ("未勝利", 1), ("1勝クラス", 2), ("500万", 2), ("2勝クラス", 3), ("1000万", 3),
               ("3勝クラス", 4), ("1600万", 4), ("オープン", 5), ("リステッド", 5)]


def race_header(page: str) -> dict:
    head = page[: page.find("</caption>")] if "</caption>" in page else page[:20000]
    out: dict = {}
    m = re.search(r"コース：</span>([\d,]+)", head)
    out["distance"] = int(m.group(1).replace(",", "")) if m else None
    m = re.search(r'class="detail">（([^）]*)）', head)
    det = m.group(1) if m else ""
    out["surface"] = "障" if "障" in det else "ダ" if "ダ" in det else "芝" if "芝" in det else ""
    # 馬場状態（結果ページの見出し。芝とダートで分かれている）
    goings = dict(re.findall(r'<li class="(turf|durt)"><span class="inner"><span class="cap">[^<]*</span><span class="txt">([^<]*)</span>', head))
    g = goings.get("durt" if out["surface"] == "ダ" else "turf", "")
    out["going"] = {"稍重": "稍", "不良": "不"}.get(g, g)
    cls_txt = text(" ".join(re.findall(r'<div class="cell class">(.*?)</div>', head, flags=re.S)))
    name = text(" ".join(re.findall(r'<span class="race_name">(.*?)</span>', head, flags=re.S)))
    grade = re.search(r'alt="(G[123]|GⅠ|GⅡ|GⅢ|JpnI+)"', head) or re.search(r"(G[ⅠⅡⅢ123])", name)
    rc = None
    if grade:
        g = grade.group(1).replace("Ⅰ", "1").replace("Ⅱ", "2").replace("Ⅲ", "3")
        rc = {"G1": 8, "G2": 7, "G3": 6}.get(g[:2], 5)
    else:
        for w, v in CLASS_WORDS:
            if w in cls_txt or w in name:
                rc = v
                break
    out["race_class"] = rc
    out["race_name"] = name
    return out


# ---------------- 結果ページ ----------------
def parse_result(page: str, cname: str) -> tuple[list[dict], list[dict]]:
    """結果ページ → (各馬の行, 払戻の行)。単勝オッズは別ページ（parse_odds）で足す。"""
    meta = parse_cname(cname)
    rid = race_id_from_cname(cname)
    hdr = race_header(page)
    body = page[page.find("<tbody"): page.find("</tbody>")]
    rows = []
    for tr in re.findall(r"<tr>(.*?)</tr>", body, flags=re.S):
        c = cells(tr)
        if "num" not in c or "horse" not in c:
            continue
        sex, age = sex_age(c.get("age", ""))
        bw = c.get("h_weight", "")
        place = text(c.get("place", ""))
        rows.append({
            "race_id": rid, "date": meta["date"], "course": meta["course"], "surface": hdr["surface"],
            "distance": hdr["distance"], "going": hdr["going"], "race_class": hdr["race_class"],
            "horse_id": id_after("pw01dud00", c["horse"]), "horse_name": text(c["horse"]),
            "frame": num(re.search(r'alt="枠(\d)', c.get("waku", "")).group(1)) if re.search(r'alt="枠(\d)', c.get("waku", "")) else None,
            "number": num(c["num"]), "sex": sex, "age": age, "weight_carried": num(c.get("weight")),
            "jockey_id": id_after("pw04kmk00", c.get("jockey", "")), "trainer_id": id_after("pw05cmk00", c.get("trainer", "")),
            "body_weight": num(re.sub(r"<span>.*", "", bw, flags=re.S)) if text(bw) else None,
            "body_weight_diff": num(re.search(r"\(([-+]?\d+)\)", text(bw)).group(1)) if re.search(r"\(([-+]?\d+)\)", text(bw)) else None,
            "popularity": num(c.get("pop")),
            "finish_pos": int(place) if place.isdigit() else None,
            "time_sec": time_to_sec(c.get("time", "")), "last3f": num(c.get("f_time")),
            "race_name": hdr["race_name"],
        })
    n = len(rows)
    for r in rows:
        r["field_size"] = n
    pays = []
    area = page[page.find('class="refund_area'):]
    for cls, block in re.findall(r'<li class="(\w+)">\s*<dl>(.*?)</dl>', area, flags=re.S):
        t = PAY_TYPES.get(cls)
        if not t:
            continue
        for combo, yen in re.findall(r'<div class="num">([^<]*)</div>\s*<div class="yen">([\d,]+)', block):
            combo = combo.strip()
            if t in ("quinella", "wide"):
                combo = "-".join(sorted(combo.split("-"), key=int))
            pays.append({"race_id": rid, "bet_type": t, "combination": combo, "payout": int(yen.replace(",", ""))})
    return rows, pays


# ---------------- 単勝オッズのページ ----------------
def parse_odds(page: str) -> dict[int, float]:
    """単勝・複勝オッズのページ → {馬番: 単勝オッズ}"""
    t = page[page.find('class="basic narrow-xy tanpuku"'):]
    t = t[: t.find("</table>")]
    out = {}
    for tr in re.findall(r"<tr>(.*?)</tr>", t, flags=re.S):
        c = cells(tr)
        n, o = num(c.get("num")), num(c.get("odds_tan"))
        if n is not None and o is not None:
            out[int(n)] = o
    return out


# ---------------- 出馬表ページ ----------------
def parse_card(page: str, cname: str, going: str = "") -> list[dict]:
    meta = parse_cname(cname)
    rid = race_id_from_cname(cname)
    hdr = race_header(page)
    body = page[page.find("<tbody"): page.find("</tbody>")]
    rows = []
    for tr in re.split(r"<tr[^>]*>", body)[1:]:
        tr = tr.split('<td class="past')[0]
        c = cells(tr)
        if "num" not in c or "horse" not in c:
            continue
        horse, jockey = c["horse"], c.get("jockey", "")
        m_age = re.search(r'<p class="age">(.*?)</p>', jockey, flags=re.S)
        sex, age = sex_age(m_age.group(1) if m_age else "")
        m_w = re.search(r'<p class="weight">(.*?)</p>', jockey, flags=re.S)
        m_bw = re.search(r'<div class="cell weight">([^<]*)(?:<span class="transition">\(([-+]?\d+)\)</span>)?', horse)
        m_odds = re.search(r'<span class="num">(.*?)</span>', horse, flags=re.S)
        m_pop = re.search(r'<span class="pop_rank">\((\d+)', horse)
        name = re.search(r'<div class="name"><a[^>]*>(.*?)</a>', horse, flags=re.S)
        if "取消" in text(horse) or "除外" in text(horse):
            continue  # 出走取消・競走除外
        rows.append({
            "race_id": rid, "date": meta["date"], "course": meta["course"], "surface": hdr["surface"],
            "distance": hdr["distance"], "going": going, "race_class": hdr["race_class"],
            "horse_id": id_after("pw01dud00", horse), "horse_name": text(name.group(1)) if name else "",
            "frame": num(re.search(r'alt="枠(\d)', c.get("waku", "")).group(1)) if re.search(r'alt="枠(\d)', c.get("waku", "")) else None,
            "number": num(c["num"]), "sex": sex, "age": age,
            "weight_carried": num(m_w.group(1)) if m_w else None,
            "jockey_id": id_after("pw04kmk00", jockey), "trainer_id": id_after("pw05cmk00", horse),
            "body_weight": num(m_bw.group(1)) if m_bw and text(m_bw.group(1)) else None,
            "body_weight_diff": float(m_bw.group(2)) if m_bw and m_bw.group(2) else None,
            "win_odds": num(m_odds.group(1)) if m_odds else None,
            "popularity": float(m_pop.group(1)) if m_pop else None,
            "race_name": hdr["race_name"],
        })
    for r in rows:
        r["field_size"] = len(rows)
    return rows


def kaisai_goings(page: str) -> dict:
    """開催ページの馬場状態 {"芝": "稍", "ダ": "良"}"""
    out = {}
    for cls, g in re.findall(r'<li class="(turf|durt)"><span class="inner"><span class="cap">[^<]*</span><span class="txt">([^<]*)</span>', page):
        out["ダ" if cls == "durt" else "芝"] = {"稍重": "稍", "不良": "不"}.get(g, g)
    return out


def month_cnames(page: str) -> dict[str, str]:
    """過去の結果検索ページの年月→cname（例 {"202011": "pw01skl10202011/30"}）。"""
    cur = re.search(r'var yearMonth = "(\d{6})"', page)
    cur = cur.group(1) if cur else "999999"
    out = {}
    for yymm, chk in re.findall(r'objParam\["(\d{4})"\]="(\w\w)"', page):
        ym = ("19" if yymm[:2] >= "86" else "20") + yymm
        out[ym] = ("pw01skl00" if ym >= cur else "pw01skl10") + ym + "/" + chk
    return out
