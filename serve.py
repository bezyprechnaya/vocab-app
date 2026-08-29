#!/usr/bin/env python3
"""Локальный сервер разработки без кеша браузера.

Отдаёт статику из папки скрипта на порту 8000 и добавляет ко всем ответам
заголовки, запрещающие кэширование (иначе браузеры, в частности Safari,
могут бесконечно отдавать старые версии файлов).

Запуск:  python3 serve.py
"""
import http.server
import os

PORT = 8000
DIRECTORY = os.path.dirname(os.path.abspath(__file__))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    handler = lambda *args, **kwargs: NoCacheHandler(
        *args, directory=DIRECTORY, **kwargs
    )
    with http.server.ThreadingHTTPServer(("0.0.0.0", PORT), handler) as httpd:
        print("Serving %s on http://localhost:%d (cache disabled)" % (DIRECTORY, PORT))
        httpd.serve_forever()
