#!/usr/bin/env python3
"""带严格 CSP 头的静态服务器 —— 用于验证主世界注入能否绕过页面 CSP。

用法：
    python tools/csp_server.py            # 默认 8878 端口，script-src 'self'
    python tools/csp_server.py 8878 none  # 极端：script-src 'none'
"""
import os
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8878
MODE = sys.argv[2] if len(sys.argv) > 2 else 'self'

POLICY = {
    # 只允许同源脚本：既没有 unsafe-inline，也没有 chrome-extension:
    'self': "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self' data:",
    # 最严格：任何脚本都不许执行
    'none': "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:",
}[MODE]


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Content-Security-Policy', POLICY)
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    srv = ThreadingHTTPServer(('127.0.0.1', PORT), partial(Handler, directory=ROOT))
    print(f'serving csp[{MODE}] on http://127.0.0.1:{PORT}')
    print(f'policy: {POLICY}')
    srv.serve_forever()
