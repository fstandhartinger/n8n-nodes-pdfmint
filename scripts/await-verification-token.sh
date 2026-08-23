#!/usr/bin/env bash
#
# Closes the n8n verification loop without a human in the middle on this side.
#
# n8n emails the author a JWT that lives for fifteen minutes. Every relay hop
# eats that budget, and the first token expired in transit. This watches Telegram
# and acts the moment Florian replies:
#
#   he sends "GO"          -> request a fresh token, so the clock starts while
#                             he is already looking at his inbox
#   he sends the JWT       -> confirm it immediately and report the outcome back
#
# Requires: TG_BOT_TOKEN, TG_CHAT_ID, N8N_CREATOR_PASSWORD
#
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SUBMIT="$HERE/submit-for-verification.sh"
CHAT="${TG_CHAT_ID:?TG_CHAT_ID is not set}"
STATE="${TMPDIR:-/tmp}/pdfmint-verify-offset"
[ -f "$STATE" ] || echo 0 > "$STATE"

say() {
  curl -s -X POST "https://api.telegram.org/bot$TG_BOT_TOKEN/sendMessage" \
    -d chat_id="$CHAT" --data-urlencode text="$1" -o /dev/null
}

log() { printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }

log "watching Telegram. GO requests a token; a JWT gets confirmed immediately."

while :; do
  OFFSET=$(cat "$STATE")
  RESP=$(curl -s --max-time 40 "https://api.telegram.org/bot$TG_BOT_TOKEN/getUpdates?offset=$((OFFSET+1))&timeout=30" || true)
  [ -n "$RESP" ] || { sleep 3; continue; }

  # One line per human message: "<update_id>\t<text>"
  MSGS=$(printf '%s' "$RESP" | CHAT="$CHAT" python3 -c '
import json, os, sys

chat = int(os.environ["CHAT"])
try:
    data = json.load(sys.stdin)
except Exception:
    raise SystemExit

for update in data.get("result", []):
    message = update.get("message") or update.get("edited_message") or {}
    if message.get("chat", {}).get("id") != chat:
        continue
    # Advance past our own messages too, so the offset never sticks.
    text = "" if message.get("from", {}).get("is_bot") else (message.get("text") or "")
    text = text.strip().replace("\t", " ").replace("\n", " ")
    print("%d\t%s" % (update["update_id"], text))
' 2>/dev/null)

  [ -n "$MSGS" ] || { sleep 2; continue; }

  while IFS=$'\t' read -r ID TEXT; do
    [ -n "$ID" ] || continue
    echo "$ID" > "$STATE"
    [ -n "${TEXT:-}" ] || continue

    # A JWT anywhere in the message wins, whatever else was typed around it.
    TOKEN=$(printf '%s' "$TEXT" | grep -oE '[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}' | head -1)

    if [ -n "$TOKEN" ]; then
      log "token received, confirming"
      OUT=$("$SUBMIT" --confirm "$TOKEN" 2>&1)
      RC=$?
      printf '%s\n' "$OUT"
      if [ $RC -eq 0 ]; then
        say "Token angekommen und sofort abgesetzt. Die Einreichung ist durch. Details:

$(printf '%s' "$OUT" | tail -20)"
        log "SUBMITTED — exiting"
        exit 0
      fi
      say "Der Token wurde abgelehnt. Wahrscheinlich abgelaufen, er lebt nur 15 Minuten. Schreib nochmal GO, dann schicke ich sofort einen neuen und du hast die vollen 15 Minuten.

$(printf '%s' "$OUT" | tail -12)"
      continue
    fi

    if printf '%s' "$TEXT" | grep -qiE '(^|[^a-z])go([^a-z]|$)'; then
      log "GO received, requesting a fresh token"
      OUT=$("$SUBMIT" --request 2>&1)
      printf '%s\n' "$OUT"
      say "Mail ist raus an florian.standhartinger@gmail.com. Oeffne die neueste Mail von n8n, kopier den Token und schick ihn mir einfach hier rein, egal mit welchem Text drumherum. Ich erkenne ihn selbst und setze die Einreichung sofort ab. Du hast ab jetzt 15 Minuten."
      continue
    fi
  done <<< "$MSGS"
done
