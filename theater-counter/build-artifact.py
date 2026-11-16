#!/usr/bin/env python3
"""index.html から Claude アーティファクト公開用の HTML を作る。

- <!doctype>/<html>/<head>/<body> の外枠を外す（公開時に付けられるため）
- ../events.json をページ内に埋め込む（アーティファクトからは fetch できないため）

使い方: python3 theater-counter/build-artifact.py <出力パス>
"""
import json
import pathlib
import re
import sys

here = pathlib.Path(__file__).resolve().parent
src = (here / "index.html").read_text(encoding="utf-8")
events = json.loads((here.parent / "events.json").read_text(encoding="utf-8"))

# 外枠と、アーティファクトでは不要な meta を外す
src = re.sub(r"<!doctype html>\s*<html[^>]*>\s*<head>\s*", "", src, flags=re.I)
src = re.sub(r'<meta (charset|name="viewport"|name="apple-[^"]*"|name="theme-color")[^>]*>\s*', "", src)
src = re.sub(r"</head>\s*<body>\s*", "", src)
src = re.sub(r"</body>\s*</html>\s*$", "", src)

data = json.dumps(events, ensure_ascii=False).replace("</", "<\\/")
embed = f'<script type="application/json" id="events-data">{data}</script>\n'
idx = src.rfind("<script>")
src = src[:idx] + embed + src[idx:]

out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "theater-counter-artifact.html")
out.write_text(src, encoding="utf-8")
print(f"wrote {out} ({len(src):,} bytes, {len(events.get('events', []))} events embedded)")
