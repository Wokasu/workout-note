"""Build the full AKB48 theater schedule (all shows, with cast) from the official blog.

Sources, in order of precedence (later overrides earlier for the same date+time):
  1. 「公演 受付開始のお知らせ」「公演スケジュール更新のお知らせ」 (one post lists many days)
  2. 「◯月◯日 「…」公演のご案内」 (one post per day; more recent)
  3. 「出演メンバー変更のお知らせ」 (休演 → 代役)

使い方: python3 -I theater-counter/tools/collect_schedule.py <cache_dir> <out.json> YYYYMM [YYYYMM ...]
"""
import html, json, os, re, subprocess, sys, time
from datetime import date as D

CACHE, OUT, MONTHS = sys.argv[1], sys.argv[2], sys.argv[3:]
BASE = "https://ameblo.jp"


def get(url, name, refresh=False):
    path = os.path.join(CACHE, name)
    if refresh or not os.path.exists(path):
        subprocess.run(["curl", "-sS", "--max-time", "30", "-A", "Mozilla/5.0", "-o", path, url], check=False)
        time.sleep(0.4)
    try:
        return open(path, encoding="utf-8", errors="ignore").read()
    except FileNotFoundError:
        return ""


entries = {}
entry_ym = {}
for ym in MONTHS:
    for page in range(1, 13):
        # 直近2か月のアーカイブは毎回取り直す（新しい記事が増えるため）
        t = get(f"{BASE}/akihabara48/archive{page}-{ym}.html", f"arch-{ym}-{page}.html", refresh=ym >= MONTHS[-2])
        found = re.findall(r'entryItemTitle"><a[^>]*href="(/akihabara48/entry-\d+\.html)">([^<]+)</a>', t)
        for u, ti in found:
            entries[BASE + u] = re.sub(r"[\x00-\x1f]", "", html.unescape(ti))
            entry_ym.setdefault(BASE + u, ym)   # その記事が載っていた月（年の推定に使う）
        if not found or f"archive{page + 1}-{ym}.html" not in t:
            break


def body(u):
    t = get(u, u.rsplit("/", 1)[1])
    m = re.search(r'id="entryBody"[^>]*>(.*?)</div>', t, re.S)
    if not m:
        return ""
    b = html.unescape(re.sub(r"<[^>]+>", "", re.sub(r"<br\s*/?>", "\n", m.group(1))))
    return re.sub(r"[ 　\x00]", " ", b)


def norm_show(s):
    s = re.sub(r"\s+", "", s)
    # 全角英数を半角に（「ＲＥＳＥＴ」→「RESET」）
    return s.translate({c: c - 0xFEE0 for c in range(0xFF01, 0xFF5F)}).replace("「RESET」", "「RESET」")


def split_cast(line):
    return [x.strip() for x in re.split(r"[・、,]", line) if x.strip() and not re.search(r"[【】:：※★]", x)]


shows = {}  # (date, time) -> dict


def put(date, tm, show, cast, tag, src, prio):
    k = (date, tm)
    cur = shows.get(k)
    if cur and cur["_prio"] > prio:
        return
    tags = set((cur or {}).get("_tags", set())) | ({tag} if tag else set())
    shows[k] = {"date": date, "time": tm, "show": show, "cast": cast or (cur or {}).get("cast", []),
                "_tags": tags, "source": src, "_prio": prio}


DAYLINE = re.compile(r"^(\d{1,2})/(\d{1,2})\s*\([^)]*\)\s*(.*)$")
TIMES = re.compile(r"(\d{1,2}:\d{2})\s*開演")

# 1) 複数日の一覧記事
for u, ti in entries.items():
    if not ("受付開始" in ti or "スケジュール" in ti):
        continue
    b = body(u)
    ym = re.search(r"(20\d{2})年(\d{1,2})月", b)
    if not ym:
        continue
    year = int(ym.group(1))
    cur = None
    lines = [l.strip() for l in b.split("\n")]
    for i, line in enumerate(lines):
        m = DAYLINE.match(line)
        if m:
            mo, da, rest = int(m.group(1)), int(m.group(2)), m.group(3)
            # 年は書かれていないので、今日にいちばん近くなる年にする（記事内の別の「YYYY年」に引っぱられないように）
            # 年は書かれていないので、記事が載っていた月にいちばん近くなる年にする
            # （過去分を集めるときも正しく、記事内の別の「YYYY年」にも引っぱられない）
            ey, em = int(entry_ym[u][:4]), int(entry_ym[u][4:])
            ref = D(ey, em, 15)
            y = min((ey - 1, ey, ey + 1), key=lambda yy: abs((D(yy, mo, min(da, 28)) - ref).days))
            sm = re.search(r"「[^」]+」\s*公演|\S+\s*卒業公演", rest)
            times = TIMES.findall(rest)
            if not sm or not times:
                cur = None
                continue
            tag = "初日" if "初日" in rest else ""
            cur = {"date": f"{y}-{mo:02d}-{da:02d}", "show": norm_show(sm.group(0)), "times": times, "tags": {t: tag for t in times}, "src": u}
            continue
        if not cur:
            continue
        if "生誕祭" in line:
            name = re.sub(r"\s+", "", line.split("生誕祭")[0])
            name = re.sub(r"^.*[；;:：]", "", name)
            lt = re.findall(r"\d{1,2}:\d{2}", line)
            for t in (lt or cur["times"]):
                cur["tags"][t] = f"{name} 生誕祭"
        elif re.search(r"\d{1,2}:\d{2}\s*公演\s*[；;:：]", line):
            t = re.search(r"(\d{1,2}:\d{2})", line).group(1)
            cur["tags"][t] = re.sub(r"^.*[；;:：]", "", line).strip()
        elif line.startswith("【出演メンバー】"):
            nxt = next((l for l in lines[i + 1:] if l), "")
            cast = split_cast(nxt)
            for t in cur["times"]:
                put(cur["date"], t, cur["show"], cast, cur["tags"].get(t, ""), cur["src"], 1)
            cur = None

# 2) 1日ごとの案内記事
for u, ti in entries.items():
    if "案内" not in ti and "出演メンバー" not in ti:
        continue
    if "変更" in ti:
        continue
    b = body(u)
    dm = re.search(r"\n\s*(20\d{2})年(\d{1,2})月(\d{1,2})日", "\n" + b)
    if not dm:
        continue
    date = f"{int(dm.group(1))}-{int(dm.group(2)):02d}-{int(dm.group(3)):02d}"
    intro = re.search(r"(\d{1,2})月(\d{1,2})日\s*\([^)]*\)\s*に", b)
    if intro and (int(intro.group(1)), int(intro.group(2))) != (int(dm.group(2)), int(dm.group(3))):
        print("skip (date mismatch in post):", u, file=sys.stderr)   # 記事内で日付が食い違う → 一覧記事を優先
        continue
    head = b[dm.end():b.find("【出演メンバー】")] if "【出演メンバー】" in b else ""
    sm = re.search(r"「[^」]+」\s*公演|\S+\s*卒業公演", head)
    times = TIMES.findall(head)
    if not sm or not times:
        continue
    after = b[b.find("【出演メンバー】") + len("【出演メンバー】"):].strip().split("\n")[0]
    cast = split_cast(after)
    for t in times:
        tag = ""
        for line in head.split("\n"):
            if t in line and "生誕祭" in line:
                tag = re.sub(r"\s+", "", line.split("生誕祭")[0].split(t)[-1]).replace("開演", "") + " 生誕祭"
        if not tag and "生誕祭" in head and len(times) == 1:
            tag = re.sub(r"\s+", "", head.split("生誕祭")[0].split("\n")[-1]) + " 生誕祭"
        put(date, t, norm_show(sm.group(0)), cast, tag, u, 2)

# 3) 出演メンバー変更
for u, ti in entries.items():
    if "変更" not in ti or "メンバー" not in ti:
        continue
    b = body(u)
    for m in re.finditer(r"(\d{1,2})/(\d{1,2})\s*\([^)]*\)\s*「[^」]+」\s*公演\s*(\d{1,2}:\d{2})", b):
        yr = re.search(r"(20\d{2})年", b)
        if not yr:
            continue
        date = f"{yr.group(1)}-{int(m.group(1)):02d}-{int(m.group(2)):02d}"
        seg = b[m.end():m.end() + 300]
        off = re.search(r"【休演】\s*([^\n【]+)", seg)
        on = re.search(r"【出演】\s*([^\n【]+)", seg)
        k = (date, m.group(3))
        if k in shows and off:
            offs, ons = split_cast(off.group(1)), split_cast(on.group(1)) if on else []
            cast = [x for x in shows[k]["cast"] if x not in offs] + [x for x in ons if x not in shows[k]["cast"]]
            shows[k]["cast"] = cast
            shows[k]["_tags"].add("メンバー変更あり")

out = []
for k in sorted(shows):
    s = shows[k]
    s["tag"] = " / ".join(sorted(t for t in s.pop("_tags") if t))
    s.pop("_prio")
    out.append(s)
json.dump({"version": 1, "source": "https://ameblo.jp/akihabara48/", "asOf": D.today().isoformat(), "shows": out},
          open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"{len(out)} shows {out[0]['date'] if out else ''}..{out[-1]['date'] if out else ''}", file=sys.stderr)
