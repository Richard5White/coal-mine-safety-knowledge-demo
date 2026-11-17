#!/usr/bin/env python3
"""Receive local PNG captures from the browser automation runtime."""

from __future__ import annotations

import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "video_output" / "captures"
OUTPUT.mkdir(parents=True, exist_ok=True)


class CaptureHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):  # noqa: N802
        self.send_response(204)
        self.send_headers()

    def do_POST(self):  # noqa: N802
        query = parse_qs(urlparse(self.path).query)
        name = query.get("name", [""])[0]
        if not re.fullmatch(r"[0-9]{2}_[a-z0-9_-]+\.png", name):
            self.send_response(400)
            self.end_headers()
            return
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        if not body.startswith(b"\x89PNG\r\n\x1a\n"):
            self.send_response(415)
            self.end_headers()
            return
        target = OUTPUT / name
        target.write_bytes(body)
        self.send_response(201)
        self.send_headers()
        self.wfile.write(str(target).encode("utf-8"))

    def send_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def log_message(self, format, *args):
        print(f"[capture] {format % args}", flush=True)


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 8022), CaptureHandler)
    print("capture receiver: http://127.0.0.1:8022", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
