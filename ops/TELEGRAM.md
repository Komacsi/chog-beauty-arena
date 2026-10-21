# Owner's Telegram alerts

The owner selected Telegram on 22 October 2026. This is notification delivery,
not a bot that administers matches, revokes keepers or signs wallet transactions.
The monitor never receives keeper credentials. Its separate systemd credential
contains only the notification bot token and the owner's private chat ID.

## Owner setup

Create a dedicated bot using https://t.me/BotFather and /newbot. An existing bot
is suitable only if it is dedicated to these alerts and has no active webhook or
other getUpdates consumer. Do not send its token to chat, put it in shell commands
or open a token-bearing API URL in the browser. Telegram's official instructions:
https://core.telegram.org/bots/features#botfather .

From an ordinary Windows PowerShell terminal, after the helper is installed, run:

`ssh -tt -i "$env:USERPROFILE\.ssh\chog-beauty-arena-vps-72.56.98.23" -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes root@72.56.98.23 python3 /root/chog-keeper-import/set-telegram-alerts.py`

Paste the bot token into the hidden prompt. The helper validates getMe, refuses
to alter an existing webhook and prints the bot's link and a random one-time code.
Open the bot in Telegram, press Start and send that exact code within five minutes.
Only a private human chat with the matching code is accepted; the first arbitrary
/start message is not enough. The helper sends one explicit notification test and
exclusively creates /etc/chog-arena/telegram.json as root:root 0600. It does not
overwrite existing files, start the monitor or enable a live release. Report only
that setup succeeded and the test arrived; no token, config or pairing code in chat.

The helper is run by the owner, not by agent tools. API request errors are generic:
no token-bearing URL, remote response or traceback is printed. A failed attempt
may need repeating. A successful existing config requires an intentional rotation
procedure rather than running the helper again. API reference:
https://core.telegram.org/bots/api#getupdates and /bots/api#sendmessage .

## Runtime and limits

The prepared chog-monitor.service loads telegram.json through systemd LoadCredential,
with a separate private StateDirectory for delivery deduplication. Enable the timer
only once credentials, a real arena and release conditions are ready; it is currently
disabled. On a check, a changed nonempty set of conditions sends one bounded plain
text message. Unchanged conditions repeat once an hour. Recovery sends once; initial
healthy checks send nothing. Only recognized public condition codes and round IDs
are forwarded, never RPC errors, journal data, signed bytes or arbitrary log fields.
Delivery has an eight-second timeout, rejects redirects, bounds the response and
persists success only after a matching Telegram acknowledgement. Failure exits 2
without advancing notification state; the next scheduled check retries. A lost
acknowledgement can still produce a duplicate. The state directory must be writable.

The server must be running and able to reach Telegram. This cannot detect/report
the total failure of that same VPS or its entire network. A separate external
uptime/heartbeat monitor and a real received-alert test remain launch requirements.
Notification delivery failure is visible in journalctl as TELEGRAM_NOTIFICATION_FAILED;
it cannot reliably report its own broken channel through that channel. Public demo
availability does not establish production keeper throughput or close SEC-03/04.

Tests use fake tokens/transport only. They cover exact private-chat pairing,
exclusive 0600 config, deduplication across independent calls, reminders, recovery,
API/network failure retry, sanitized errors, bounded messages and unknown-field
exclusion. They do not claim actual delivery to the owner's Telegram.

## Installed state, 22 October 2026

The owner received the helper's test notification and supplied a screenshot.
Read-only SSH metadata checks confirmed the Telegram config as root:root 0600;
its contents were not read by the agent. This proves setup delivery, not a live
monitor alert or healthy keeper.

ops/configure-telegram.sh stages only the already-reviewed notification module,
monitor script and service template. It validates credential metadata without
reading contents, requires inactive services/a disabled timer and a closed release
guard, takes a consistent private SQLite backup, creates a new root-owned release,
substitutes the actual Node path, validates the unit and restarts only the demo web
service. A failure during activation rolls back the unit/release. It never starts
monitor/keeper, reads signing files or changes financial release settings.

The patch is installed at /opt/chog-releases/telegram-20261021T231121Z with backup
/var/backups/chog-telegram/20261021T231121Z. Installed code hashes matched, systemd
validation passed, the website/API responded in demo mode with live deployment
rejected, and game records/existing users matched the backup. Both keeper and the
monitor timer remain disabled/inactive. See security/telegram-staging.json.
