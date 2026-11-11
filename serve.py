#!/usr/bin/env python3
"""Serve Horizon over HTTP so YouTube embeds get a proper Referer (avoids error 153)."""
from __future__ import annotations

import functools
import http.server
import os
import socketserver

PORT = int(os.environ.get("HORIZON_PORT", "8766"))
ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path: str) -> str:
        full = super().translate_path(path)
        # Never expose cookies / extract logs.
        rel = os.path.relpath(full, ROOT)
        if rel == "private" or rel.startswith("private" + os.sep):
            return os.path.join(ROOT, ".")  # force 404 via missing file below
        return full

    def do_GET(self) -> None:  # noqa: N802
        if self.path.rstrip("/").endswith("/private") or "/private/" in self.path:
            self.send_error(404, "Not found")
            return
        super().do_GET()

    def end_headers(self) -> None:
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("Cross-Origin-Resource-Policy", "cross-origin")
        self.send_header("Access-Control-Allow-Origin", "*")
        # App JS changes often after reorg — never serve a stale sets.js.
        if self.path.split("?", 1)[0].endswith((".js", ".html")):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main() -> None:
    os.chdir(ROOT)
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", PORT), functools.partial(Handler, directory=ROOT)) as httpd:
        print(f"Horizon → http://127.0.0.1:{PORT}/index.html", flush=True)
        httpd.serve_forever()


if __name__ == "__main__":
    main()
