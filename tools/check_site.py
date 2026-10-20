"""Check the standalone website with Python's standard library (Node optional)."""
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit
import json
import os
import re
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
errors = []
references = []
external = set()
visited = set()
prefixes = ("assets/", "media/", "css/", "js/")
local_string = re.compile(r"[\"']((?:assets|media|css|js)/[^\"'\r\n]+)[\"']")
css_url = re.compile(r"url\(\s*['\"]?([^'\")]+)['\"]?\s*\)")
local_machine = re.compile(r"(?:/workspace/|/home/|/mnt/|file://|https?://(?:localhost|127\.0\.0\.1))")


class Document(HTMLParser):
    def __init__(self, path):
        super().__init__()
        self.path = path
        self.ids = set()
        self.anchors = []
        self.rows = []
        self.h1_count = 0

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if "id" in attrs:
            if attrs["id"] in self.ids:
                errors.append(f"Duplicate ID in {self.path}: {attrs['id']}")
            self.ids.add(attrs["id"])
        self.h1_count += tag == "h1"
        if tag == "img" and "alt" not in attrs:
            errors.append(f"Image without alt text: {self.path}")
        if tag == "a" and attrs.get("target") == "_blank" and "noopener" not in attrs.get("rel", ""):
            errors.append(f"New-tab link missing noopener: {self.path}")
        if "data-f5-row" in attrs:
            self.rows.append(int(attrs["data-f5-row"]) + 1)
        for name, value in attrs.items():
            if not value:
                continue
            if name in ("src", "href", "xlink:href", "poster", "data-src", "data-webm") or (tag == "object" and name == "data"):
                if value.startswith("#"):
                    if self.path == "index.html":
                        self.anchors.append(value[1:])
                else:
                    references.append((self.path, value))


def resolve(origin, url):
    parsed = urlsplit(url)
    if parsed.scheme or parsed.netloc:
        if parsed.scheme not in ("data", "mailto", "tel"):
            external.add(url)
        return None
    if not parsed.path:
        return None
    if parsed.path.startswith("/"):
        errors.append(f"Root-relative URL will break project hosting: {origin} -> {url}")
        return None
    # JS data URLs resolve against the document, not the script file's directory.
    base = ROOT if origin.endswith(".js") else (ROOT / origin).parent
    path = base / unquote(parsed.path)
    if not path.resolve().is_relative_to(ROOT):
        errors.append(f"Dependency escapes website directory: {origin} -> {url}")
        return None
    if not path.is_file():
        errors.append(f"Missing file: {origin} -> {url}")
        return None
    return path.relative_to(ROOT).as_posix()


def scan(relative):
    if relative in visited:
        return
    visited.add(relative)
    path = ROOT / relative
    if path.suffix not in (".html", ".css", ".js", ".svg"):
        return
    text = path.read_text()
    if local_machine.search(text):
        errors.append(f"Local machine path or preview URL in runtime file: {relative}")
    if path.suffix in (".html", ".svg"):
        document = Document(relative)
        document.feed(text)
        if relative == "index.html":
            if document.h1_count != 1:
                errors.append(f"Expected one h1, found {document.h1_count}")
            for anchor in document.anchors:
                if anchor not in document.ids:
                    errors.append(f"Missing anchor: #{anchor}")
            for row in document.rows:
                for method in ("observed", "gt", "objectforesight", "cahmp", "transformer", "ours"):
                    for extension in ("mp4", "webm", "webp"):
                        references.append((relative, f"media/figure5/replay/sample-{row}/{method}.{extension}"))
    elif path.suffix == ".js":
        for match in local_string.finditer(text):
            if "${" not in match[1]:
                references.append((relative, match[1]))
    if path.suffix in (".css", ".svg", ".html"):
        for match in css_url.finditer(text):
            references.append((relative, match[1].strip()))


scan("index.html")
offset = 0
while offset < len(references):
    origin, url = references[offset]
    offset += 1
    target = resolve(origin, url)
    if target:
        scan(target)

entries = []
for parent, directories, filenames in os.walk(ROOT):
    directories[:] = [name for name in directories if name not in (".git", "node_modules", "__pycache__")]
    entries.extend(Path(parent) / name for name in directories + filenames if name != ".git")
files = [path for path in entries if path.is_file()]
for path in entries:
    if path.is_symlink():
        errors.append(f"Symlink must be replaced with a real file: {path.relative_to(ROOT)}")
for path in files:
    if path.stat().st_size >= 100 * 1024 * 1024:
        errors.append(f"File at or above 100 MiB: {path.relative_to(ROOT)}")
if not (ROOT / ".nojekyll").is_file():
    errors.append("Missing .nojekyll")

node = shutil.which("node")
scripts = sorted(path for path in visited if path.endswith(".js"))
if node:
    for script in scripts:
        result = subprocess.run([node, "--check", str(ROOT / script)], capture_output=True, text=True)
        if result.returncode:
            errors.append(f"JavaScript syntax: {script}\n{result.stderr}")

summary = {
    "ok": not errors,
    "runtime_files": len(visited),
    "local_references_checked": len(references),
    "runtime_bytes": sum((ROOT / path).stat().st_size for path in visited),
    "javascript_files_checked": len(scripts) if node else 0,
    "javascript_note": "Node syntax checks passed" if node else "Node unavailable; run node --check on JS files separately",
    "external_urls": sorted(external),
    "errors": errors,
}
print(json.dumps(summary, ensure_ascii=False, indent=2))
sys.exit(bool(errors))
