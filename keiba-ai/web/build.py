"""web/template.html に web/engine.js を埋め込んで web/dist/index.html（1ファイルで動くページ）を作る。

  python web/build.py
"""

import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent


def main() -> None:
    engine = (ROOT / "engine.js").read_text(encoding="utf-8")
    engine = re.sub(r"</(script)", r"<\\/\1", engine, flags=re.I)
    html = (ROOT / "template.html").read_text(encoding="utf-8").replace("/*__ENGINE__*/", engine)
    out = ROOT / "dist" / "index.html"
    out.parent.mkdir(exist_ok=True)
    out.write_text(html, encoding="utf-8")
    print(f"{out}  ({len(html) / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
