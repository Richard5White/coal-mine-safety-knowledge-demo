#!/usr/bin/env python3
"""Local demo server for the coal-mine risk knowledge graph prototype.

This server intentionally uses only Python's standard library so the demo can
run offline on a clean Windows machine with Python 3 installed.
"""

from __future__ import annotations

import json
import mimetypes
import webbrowser
import argparse
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parent
DATA_FILE = ROOT / "data" / "scenarios.json"


def load_data() -> dict:
    with DATA_FILE.open("r", encoding="utf-8") as handle:
        return json.load(handle)


class DemoHandler(SimpleHTTPRequestHandler):
    """Serve static files and a small read-only JSON API."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):  # noqa: N802 - required by BaseHTTPRequestHandler
        path = urlparse(self.path).path

        if path == "/api/health":
            return self.send_json({"status": "ok", "mode": "offline-demo"})

        if path == "/api/scenarios":
            payload = load_data()
            return self.send_json(
                {
                    "project": payload["project"],
                    "scenarios": [
                        {
                            "id": item["id"],
                            "title": item["title"],
                            "question": item["question"],
                            "riskLevel": item["riskLevel"],
                            "visible": item.get("visible", True),
                            "keywords": item.get("keywords", []),
                            "domain": item.get("domain", "gas"),
                        }
                        for item in payload["scenarios"]
                    ],
                }
            )

        if path.startswith("/api/scenarios/"):
            scenario_id = path.rsplit("/", 1)[-1]
            payload = load_data()
            scenario = next(
                (item for item in payload["scenarios"] if item["id"] == scenario_id),
                None,
            )
            if scenario is None:
                return self.send_json(
                    {"error": "scenario_not_found"}, HTTPStatus.NOT_FOUND
                )
            return self.send_json(scenario)

        if path in {"", "/"}:
            self.path = "/index.html"

        return super().do_GET()

    def end_headers(self):
        """Keep the offline demo from reusing stale HTML, CSS or JavaScript."""
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def send_json(self, payload: dict, status: HTTPStatus = HTTPStatus.OK):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        print(f"[demo] {self.address_string()} - {format % args}")


class DemoServer(ThreadingHTTPServer):
    """Bind exclusively so an old demo process cannot serve stale assets."""

    allow_reuse_address = False
    allow_reuse_port = False


def main():
    parser = argparse.ArgumentParser(description="Coal-mine knowledge graph demo server")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    mimetypes.add_type("application/javascript", ".js")
    host = "127.0.0.1"
    port = args.port
    try:
        server = DemoServer((host, port), DemoHandler)
    except OSError:
        print(f"启动失败：端口 {port} 已被旧版演示服务占用。")
        print("请关闭之前打开的“煤矿安全风险知识图谱”命令窗口后再运行。")
        input("按回车键退出……")
        return
    print("煤矿安全风险知识图谱演示系统已启动")
    print(f"浏览器访问：http://{host}:{port}")
    print("按 Ctrl+C 停止服务")
    if not args.no_browser:
        webbrowser.open(f"http://{host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n正在停止服务……")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
