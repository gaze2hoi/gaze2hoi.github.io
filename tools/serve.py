"""Serve this standalone website locally, with byte-range video support."""
import argparse
from urllib.parse import urlsplit
from functools import partial
from datetime import timezone
from email.utils import parsedate_to_datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import os
import re


class PreviewHandler(SimpleHTTPRequestHandler):
    base_path = "/"

    def translate_path(self, path):
        path = urlsplit(path).path
        if self.base_path != "/" and path.startswith(self.base_path):
            path = "/" + path[len(self.base_path):]
        return super().translate_path(path)

    media_extensions = {
        ".avif", ".gif", ".ico", ".jpeg", ".jpg", ".png", ".svg", ".webp",
        ".mp4", ".webm", ".mp3", ".ogg", ".wav",
        ".otf", ".ttf", ".woff", ".woff2", ".pdf",
    }

    def send_response(self, code, message=None):
        self.response_code = code
        super().send_response(code, message)

    def end_headers(self):
        path = Path(self.translate_path(getattr(self, "path", "")))
        cacheable = path.suffix.lower() in self.media_extensions and getattr(self, "response_code", None) in (200, 206, 304)
        # Keep media bytes locally, but revalidate so same-name asset edits are
        # visible immediately. The base handler answers unchanged files with 304.
        self.send_header("Cache-Control", "private, max-age=0, must-revalidate" if cacheable else "no-store")
        self.send_header("Accept-Ranges", "bytes")
        super().end_headers()

    def send_head(self):
        self.bytes_remaining = None
        requested_path = urlsplit(self.path).path
        if self.base_path != "/":
            if requested_path in ("/", self.base_path.rstrip("/")):
                self.send_response(302)
                self.send_header("Location", self.base_path)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return None
            if not requested_path.startswith(self.base_path):
                self.send_error(404, "Outside site base path")
                return None
        requested_range = self.headers.get("Range", "")
        match = re.fullmatch(r"bytes=(\d*)-(\d*)", requested_range.strip())
        path = Path(self.translate_path(self.path))
        if not match or not any(match.groups()) or path.is_dir():
            return super().send_head()
        try:
            source = path.open("rb")
        except OSError:
            self.send_error(404, "File not found")
            return None
        stat = os.fstat(source.fileno())
        if_range = self.headers.get("If-Range")
        if if_range:
            try:
                validator = parsedate_to_datetime(if_range)
                if validator.tzinfo is None:
                    validator = validator.replace(tzinfo=timezone.utc)
                unchanged = int(validator.timestamp()) == int(stat.st_mtime)
            except (ValueError, TypeError, OverflowError):
                unchanged = False
            if not unchanged:
                # A cached range from an older file must not mix with new bytes.
                source.close()
                return super().send_head()
        size = stat.st_size
        first, last = match.groups()
        if first:
            start = int(first)
            end = min(int(last), size - 1) if last else size - 1
        else:
            start = max(0, size - int(last))
            end = size - 1
        if start >= size or end < start:
            source.close()
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return None
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(str(path)))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Last-Modified", self.date_time_string(stat.st_mtime))
        self.end_headers()
        source.seek(start)
        self.bytes_remaining = end - start + 1
        return source

    def copyfile(self, source, outputfile):
        if self.bytes_remaining is None:
            return super().copyfile(source, outputfile)
        while self.bytes_remaining:
            chunk = source.read(min(64 * 1024, self.bytes_remaining))
            if not chunk:
                break
            outputfile.write(chunk)
            self.bytes_remaining -= len(chunk)



def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8380)
    parser.add_argument("--base-path", default="/", help="Optional GitHub project path, e.g. /gaze2hoi-website/")
    args = parser.parse_args()
    if any(char in args.base_path for char in ("..", "?", "#", "\\")):
        parser.error("base path must be a simple URL directory")
    PreviewHandler.base_path = "/" + args.base_path.strip("/") + "/" if args.base_path.strip("/") else "/"
    root = Path(__file__).resolve().parents[1]
    handler = partial(PreviewHandler, directory=str(root))
    with ThreadingHTTPServer(("127.0.0.1", args.port), handler) as server:
        print(f"Website: http://127.0.0.1:{args.port}{PreviewHandler.base_path}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
