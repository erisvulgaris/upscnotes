#!/usr/bin/env python3
"""GitHub auto-deploy webhook for upscnotes.

Registers a POST /webhook listener (port 9001) that pulls the latest code and
rebuilds the container. Wire it up as a systemd unit (see README-DOKPLOY.md).

Usage:  python3 /opt/upscotes/webhook.py
"""
from http.server import HTTPServer, BaseHTTPRequestHandler
import subprocess
import sys

WEBHOOK_PORT = 9001


class WebhookHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length) if length else b'{}'
        event = self.headers.get('X-GitHub-Event', 'push')
        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.end_headers()
        self.wfile.write(b'{"status": "building"}')
        print(f'GitHub {event} received! Rebuilding upscotes...')
        subprocess.Popen(
            ['bash', '-c',
             'cd /opt/upscotes && git pull && '
             'docker compose -f docker-compose.prod.yml up -d --build'],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def log_message(self, fmt, *args):
        sys.stderr.write('[webhook] ' + (fmt % args) + '\n')


if __name__ == '__main__':
    print(f'[webhook] listening on :{WEBHOOK_PORT}/webhook')
    HTTPServer(('0.0.0.0', WEBHOOK_PORT), WebhookHandler).serve_forever()