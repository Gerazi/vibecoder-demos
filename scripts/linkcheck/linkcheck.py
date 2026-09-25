#!/usr/bin/env python3
"""linkcheck — находит мёртвые ссылки в Markdown и HTML.

Проходит по файлам (или папкам), вытаскивает все http(s)-ссылки и
относительные ссылки на файлы, проверяет каждую и печатает только битые —
с файлом и строкой, где ссылка стоит. Код выхода 1, если нашлась хоть одна
битая: удобно поставить в CI перед публикацией документации.

Только стандартная библиотека Python 3.8+, ставить ничего не нужно.

Примеры:
    python3 linkcheck.py README.md
    python3 linkcheck.py docs/ --workers 16 --timeout 5
    python3 linkcheck.py . --ignore 'localhost|example\\.com' --json > report.json
"""

import argparse
import concurrent.futures
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict

EXTENSIONS = {".md", ".markdown", ".mdx", ".html", ".htm"}
SKIP_DIRS = {".git", "node_modules", ".venv", "venv", "__pycache__", "dist", "build", ".next"}
USER_AGENT = "linkcheck/1.0 (+https://github.com/Gerazi/vibecoder-demos)"

# [текст](адрес "заголовок"), <адрес>, href="адрес", src="адрес" и голые http(s)-ссылки.
MD_LINK = re.compile(r"\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+[\"'][^\"']*[\"'])?\s*\)")
MD_REF = re.compile(r"^\s{0,3}\[[^\]]+\]:\s*<?(\S+?)>?(?:\s|$)", re.M)
HTML_ATTR = re.compile(r"""(?:href|src)\s*=\s*["']([^"']+)["']""", re.I)
# Голая ссылка — но не та, что уже внутри ](…), href="…" или <…>.
BARE_URL = re.compile(r"(?<![\"'<=])(?<!\]\()\bhttps?://[^\s<>()\"'\]]+")
FENCE = re.compile(r"^(```|~~~)")


def find_files(paths):
    for p in paths:
        if os.path.isfile(p):
            yield p
            continue
        for root, dirs, files in os.walk(p):
            dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS)
            for name in sorted(files):
                if os.path.splitext(name)[1].lower() in EXTENSIONS:
                    yield os.path.join(root, name)


def extract(path):
    """Возвращает список (ссылка, номер строки). Код в ```-блоках пропускается."""
    try:
        with open(path, encoding="utf-8") as f:
            lines = f.read().splitlines()
    except (UnicodeDecodeError, OSError) as e:
        print(f"пропущен {path}: {e}", file=sys.stderr)
        return []

    found = []
    in_fence = False
    for no, line in enumerate(lines, 1):
        if FENCE.match(line.lstrip()):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        seen = set()
        for rx in (MD_LINK, MD_REF, HTML_ATTR, BARE_URL):
            for m in rx.finditer(line):
                url = (m.group(1) if m.groups() else m.group(0)).rstrip(".,;:!?")
                if url not in seen:
                    seen.add(url)
                    found.append((url, no))
    return found


def classify(url):
    scheme = urllib.parse.urlsplit(url).scheme.lower()
    if scheme in ("http", "https"):
        return "web"
    if scheme or url.startswith(("#", "//")):
        return None  # mailto:, tel:, якоря, протокол-относительные — не проверяем
    return "file"


def check_file_link(url, source):
    target = urllib.parse.unquote(urllib.parse.urlsplit(url).path)
    if not target:
        return None
    base = os.path.dirname(os.path.abspath(source))
    full = os.path.normpath(os.path.join(base, target))
    return None if os.path.exists(full) else "файл не найден"


def check_web(url, timeout):
    """None — ссылка жива; иначе строка с причиной."""
    headers = {"User-Agent": USER_AGENT, "Accept": "*/*"}
    # Сначала HEAD — дёшево. Часть серверов HEAD не любит (405/403/501) —
    # тогда повторяем GET, читая только начало ответа.
    for method in ("HEAD", "GET"):
        req = urllib.request.Request(url, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                if method == "GET":
                    resp.read(1024)
                return None
        except urllib.error.HTTPError as e:
            if method == "HEAD" and e.code in (400, 403, 405, 429, 501):
                continue
            if e.code == 429:
                return None  # ограничение частоты — не значит, что ссылка мертва
            return f"HTTP {e.code}"
        except urllib.error.URLError as e:
            reason = getattr(e, "reason", e)
            return f"недоступно: {reason}"
        except TimeoutError:
            return f"нет ответа за {timeout} с"
        except Exception as e:  # noqa: BLE001 — любая сетевая неожиданность = битая ссылка
            return f"ошибка: {e}"
    return None


def main(argv=None):
    ap = argparse.ArgumentParser(description="Находит мёртвые ссылки в Markdown и HTML.")
    ap.add_argument("paths", nargs="*", default=["."], help="файлы или папки (по умолчанию текущая)")
    ap.add_argument("--timeout", type=float, default=10, help="секунд на одну ссылку (10)")
    ap.add_argument("--workers", type=int, default=8, help="сколько ссылок проверять параллельно (8)")
    ap.add_argument("--ignore", metavar="REGEX", help="не проверять ссылки, подходящие под выражение")
    ap.add_argument("--no-web", action="store_true", help="проверять только ссылки на файлы, без сети")
    ap.add_argument("--json", action="store_true", help="вывести отчёт в JSON")
    args = ap.parse_args(argv)

    ignore = re.compile(args.ignore) if args.ignore else None
    # ссылка → [(файл, строка), ...]: одна и та же ссылка проверяется один раз.
    web = defaultdict(list)
    broken = []
    files = list(find_files(args.paths))

    for path in files:
        for url, line in extract(path):
            if ignore and ignore.search(url):
                continue
            kind = classify(url)
            if kind == "file":
                reason = check_file_link(url, path)
                if reason:
                    broken.append({"file": path, "line": line, "url": url, "reason": reason})
            elif kind == "web" and not args.no_web:
                web[url].append((path, line))

    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        futures = {pool.submit(check_web, url, args.timeout): url for url in web}
        for fut in concurrent.futures.as_completed(futures):
            url = futures[fut]
            reason = fut.result()
            if reason:
                for path, line in web[url]:
                    broken.append({"file": path, "line": line, "url": url, "reason": reason})

    broken.sort(key=lambda b: (b["file"], b["line"], b["url"]))
    total = len(web)  # уникальные веб-ссылки
    if args.json:
        json.dump({"files": len(files), "web_links": total, "broken": broken}, sys.stdout, ensure_ascii=False, indent=2)
        print()
    else:
        for b in broken:
            print(f"{b['file']}:{b['line']}: {b['url']} — {b['reason']}")
        summary = f"файлов: {len(files)}, уникальных веб-ссылок: {total}, битых: {len(broken)}"
        print(summary if broken else f"всё живо — {summary}", file=sys.stderr)
    return 1 if broken else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
