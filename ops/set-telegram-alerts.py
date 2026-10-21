#!/usr/bin/env python3
"""Owner-run root TTY setup. Never provide token in argv, environment or chat."""
import getpass
import json
import os
from pathlib import Path
import re
import secrets
import sys
import time
import urllib.request

TARGET = Path('/etc/chog-arena/telegram.json')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def telegram(token, method, payload):
    # URL contains the token by Telegram's API design. Exceptions are never printed.
    request = urllib.request.Request('https://api.telegram.org/bot' + token + '/' + method,
                                     data=json.dumps(payload).encode('utf-8'),
                                     headers={'Content-Type': 'application/json'})
    with urllib.request.build_opener(NoRedirect()).open(request, timeout=30) as response:
        data = response.read(65537)
    if len(data) > 65536:
        raise ValueError()
    reply = json.loads(data)
    if reply.get('ok') is not True:
        raise ValueError()
    return reply['result']


def paired_chat(updates, code):
    for update in updates:
        message = update.get('message', {})
        chat, sender = message.get('chat', {}), message.get('from', {})
        chat_id = chat.get('id')
        if (message.get('text') == code and chat.get('type') == 'private'
                and type(chat_id) is int and chat_id > 0 and sender.get('id') == chat_id
                and sender.get('is_bot') is False):
            return str(chat_id)
    return None


def save_credentials(path, token, chat_id):
    # Atomic exclusive creation: never replace existing destination or follow a symlink.
    with open(path, 'x', encoding='utf-8', opener=lambda p, f: os.open(p, f, 0o600)) as out:
        os.fchmod(out.fileno(), 0o600) if os.name == 'posix' else None
        out.write(json.dumps({'token': token, 'chatId': chat_id}) + '\n')
        out.flush()
        os.fsync(out.fileno())


def main():
    if not sys.platform.startswith('linux') or os.geteuid() != 0 or not sys.stdin.isatty() or not sys.stderr.isatty():
        raise ValueError()
    if TARGET.exists() or TARGET.is_symlink() or not TARGET.parent.is_dir() or TARGET.parent.is_symlink():
        raise ValueError()
    token = getpass.getpass('Dedicated Telegram bot token (hidden): ')
    if not re.fullmatch(r'\d{5,20}:[A-Za-z0-9_-]{20,200}', token):
        raise ValueError()
    bot = telegram(token, 'getMe', {})
    username = bot.get('username', '')
    if not re.fullmatch(r'[A-Za-z0-9_]{5,64}', username) or str(bot.get('id')) != token.split(':')[0]:
        raise ValueError()
    if telegram(token, 'getWebhookInfo', {}).get('url'):
        raise ValueError()  # Do not alter an existing bot's webhook.
    code = 'chog-alerts-' + secrets.token_hex(16)
    print('Open https://t.me/' + username + ', press Start, then send this exact pairing code:')
    print(code, flush=True)
    print('Pairing expires in 5 minutes. A single test notification will be sent to the paired private chat.', flush=True)
    offset, chat_id, deadline = 0, None, time.monotonic() + 300
    while time.monotonic() < deadline:
        updates = telegram(token, 'getUpdates', {'offset': offset, 'timeout': 20, 'limit': 100, 'allowed_updates': ['message']})
        chat_id = paired_chat(updates, code)
        if chat_id:
            break
        for update in updates:
            if type(update.get('update_id')) is int:
                offset = max(offset, update['update_id'] + 1)
    if not chat_id:
        raise ValueError()
    sent = telegram(token, 'sendMessage', {'chat_id': chat_id, 'text': 'CHOG Arena: Telegram alerts connected. This notification test does not confirm keeper health.'})
    if str(sent.get('chat', {}).get('id')) != chat_id:
        raise ValueError()
    save_credentials(TARGET, token, chat_id)
    print('Telegram configuration saved root-only (0600). Monitor and keeper were not started.')


if __name__ == '__main__':
    try:
        main()
    except (Exception, KeyboardInterrupt):
        # Never emit URL, API response, token or traceback.
        print('Telegram setup did not complete. Check the token, dedicated bot, connection and pairing. Existing files are never overwritten.', file=sys.stderr)
        sys.exit(1)
