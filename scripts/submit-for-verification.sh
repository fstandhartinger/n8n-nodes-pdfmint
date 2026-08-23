#!/usr/bin/env bash
#
# Submits n8n-nodes-pdfmint for verification at creators.n8n.io.
#
# n8n's flow is two steps: asking for verification emails a one-time JWT to the
# author, and that JWT is what actually creates the verification record. The JWT
# is valid for FIFTEEN MINUTES, which is why this exists — so the second step is
# one command and a paste, not a browser session.
#
#   scripts/submit-for-verification.sh --status
#       Show whether a verification record exists, and its stage.
#
#   scripts/submit-for-verification.sh --request
#       Ask n8n to email a fresh token. Do this immediately before confirming.
#
#   scripts/submit-for-verification.sh --confirm <TOKEN>
#       Consume the token and create the verification record. This is the step
#       that makes the submission real.
#
# Credentials come from the environment:
#   N8N_CREATOR_EMAIL, N8N_CREATOR_PASSWORD
#
set -uo pipefail

API="https://api.n8n.io"
PACKAGE="n8n-nodes-pdfmint"
VERSION="latest"
OFFICIAL="true"

EMAIL="${N8N_CREATOR_EMAIL:-florian.standhartinger@gmail.com}"
PASSWORD="${N8N_CREATOR_PASSWORD:-}"

die() { printf '%s\n' "$*" >&2; exit 1; }

login() {
  [ -n "$PASSWORD" ] || die "N8N_CREATOR_PASSWORD is not set."
  local body
  body=$(curl -s -X POST "$API/api/auth/local/login" \
    -H 'Content-Type: application/json' \
    -d "$(python3 -c 'import json,sys; print(json.dumps({"identifier":sys.argv[1],"password":sys.argv[2]}))' "$EMAIL" "$PASSWORD")")
  JWT=$(printf '%s' "$body" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("jwt",""))' 2>/dev/null)
  [ -n "$JWT" ] || die "login failed: $(printf '%s' "$body" | head -c 300)"
}

show_record() {
  local out
  out=$(curl -s -H "Authorization: Bearer $JWT" -H 'X-Skip-Cache: 1' \
    "$API/api/package-cloud-verifications?filters%5BpackageName%5D%5B%24eq%5D=$PACKAGE")
  printf '%s' "$out" | python3 -c '
import json, sys
d = json.load(sys.stdin)
rows = d.get("data", [])
if not rows:
    print("  no verification record for this package yet")
    raise SystemExit
for r in rows:
    a = r.get("attributes", r)
    keep = {k: v for k, v in a.items() if not isinstance(v, (dict, list)) and v not in (None, "")}
    for k in sorted(keep):
        print(f"  {k}: {keep[k]}")
'
}

# Decode the JWT payload so an expired token is caught before it is spent.
inspect_token() {
  python3 - "$1" <<'PY'
import base64, json, sys, time
tok = sys.argv[1].strip()
parts = tok.split('.')
if len(parts) != 3:
    print("  token does not look like a JWT (expected three dot-separated parts)")
    raise SystemExit(2)
pad = lambda s: s + '=' * (-len(s) % 4)
try:
    payload = json.loads(base64.urlsafe_b64decode(pad(parts[1])))
except Exception as e:
    print(f"  could not decode the token payload: {e}")
    raise SystemExit(2)
now = int(time.time())
exp = payload.get('exp')
for k in ('packageName', 'packageVersion', 'official', 'authorEmail', 'userEmail'):
    if k in payload:
        print(f"  {k}: {payload[k]}")
if exp:
    left = exp - now
    print(f"  expires: {time.strftime('%H:%M:%SZ', time.gmtime(exp))} ({left}s from now)")
    if left <= 0:
        print("  EXPIRED — ask for a fresh one, this will be rejected")
        raise SystemExit(3)
    if left < 30:
        print("  WARNING: under 30 seconds left")
PY
}

case "${1:---status}" in
  --status)
    login
    echo "Verification record for $PACKAGE:"
    show_record
    ;;

  --request)
    login
    echo "Asking n8n to email a one-time token to $EMAIL …"
    curl -s -X POST "$API/api/package-cloud-verifications/submit-for-verification" \
      -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' -H 'X-Skip-Cache: 1' \
      -d "{\"packageName\":\"$PACKAGE\",\"packageVersion\":\"$VERSION\",\"official\":$OFFICIAL}" \
      | python3 -m json.tool
    echo
    echo "The token is valid for 15 minutes. Confirm it with:"
    echo "  scripts/submit-for-verification.sh --confirm <TOKEN>"
    ;;

  --confirm)
    TOKEN="${2:-}"
    [ -n "$TOKEN" ] || die "usage: $0 --confirm <TOKEN>"
    echo "Token contents:"
    inspect_token "$TOKEN" || die "refusing to send an expired or malformed token."
    login
    echo
    echo "Confirming …"
    RESP=$(curl -s -w '\n%{http_code}' -X POST "$API/api/package-cloud-verifications/confirm-package-submission" \
      -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' -H 'X-Skip-Cache: 1' \
      -d "$(python3 -c 'import json,sys; print(json.dumps({"packageName":sys.argv[1],"packageVersion":sys.argv[2],"official":sys.argv[3]=="true","token":sys.argv[4]}))' "$PACKAGE" "$VERSION" "$OFFICIAL" "$TOKEN")")
    CODE=$(printf '%s' "$RESP" | tail -1)
    printf '%s' "$RESP" | sed '$d' | python3 -m json.tool 2>/dev/null || printf '%s\n' "$RESP" | sed '$d'
    echo "HTTP $CODE"
    echo
    echo "Verification record now:"
    show_record
    ;;

  *) die "unknown option: $1  (try --status, --request, --confirm <TOKEN>)" ;;
esac
