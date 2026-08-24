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
#   scripts/submit-for-verification.sh --video <URL|FILE.mp4>
#       Attach the demo video. Only works while the record is at
#       manual:awaiting-video. A URL is sent as-is (n8n accepts a link, e.g.
#       Loom); a local file is uploaded to n8n's media store first and both the
#       returned id and its absolute URL are sent, which is exactly what the
#       creators portal does.
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
    BODY=$(printf '%s' "$RESP" | sed '$d')
    printf '%s' "$BODY" | python3 -m json.tool 2>/dev/null || printf '%s\n' "$BODY"
    echo "HTTP $CODE"

    # The endpoint answers 200 even when it refuses the token, so the status code
    # alone would report a failure as a success. The body is what decides.
    OK=$(printf '%s' "$BODY" | python3 -c '
import json, sys
try:
    print("yes" if json.load(sys.stdin).get("success") is True else "no")
except Exception:
    print("no")
')
    echo
    echo "Verification record now:"
    show_record
    if [ "$OK" != "yes" ]; then
      echo
      echo "SUBMISSION DID NOT GO THROUGH — the token was refused. Ask for a fresh one:"
      echo "  $0 --request"
      exit 1
    fi
    echo
    echo "SUBMITTED."
    ;;

  --video)
    ARG="${2:-}"
    [ -n "$ARG" ] || die "usage: $0 --video <URL|FILE.mp4>"
    login

    STAGE=$(curl -s -H "Authorization: Bearer $JWT" -H 'X-Skip-Cache: 1' \
      "$API/api/package-cloud-verifications?filters%5BpackageName%5D%5B%24eq%5D=$PACKAGE" \
      | python3 -c 'import json,sys
d=json.load(sys.stdin).get("data") or [{}]
print(d[0].get("pipelineStage",""))' 2>/dev/null)
    echo "Current stage: ${STAGE:-unknown}"
    if [ "$STAGE" != "manual:awaiting-video" ]; then
      echo "n8n only accepts a video at manual:awaiting-video. Not sending." >&2
      exit 1
    fi

    MEDIA_ID="null"
    if [ -f "$ARG" ]; then
      echo "Uploading $(basename "$ARG") ($(du -h "$ARG" | cut -f1)) to n8n's media store …"
      UP=$(curl -s -X POST "$API/api/upload" -H "Authorization: Bearer $JWT" -F "files=@$ARG")
      MEDIA_ID=$(printf '%s' "$UP" | python3 -c 'import json,sys
try:
    print(json.load(sys.stdin)[0]["id"])
except Exception:
    print("")' 2>/dev/null)
      URL=$(printf '%s' "$UP" | python3 -c 'import json,sys
try:
    print(json.load(sys.stdin)[0]["url"])
except Exception:
    print("")' 2>/dev/null)
      [ -n "$MEDIA_ID" ] || die "upload failed: $(printf '%s' "$UP" | head -c 400)"
      case "$URL" in
        http*) ;;
        *) URL="https://n8niostorageaccount.blob.core.windows.net${URL}" ;;
      esac
      echo "Uploaded: id=$MEDIA_ID url=$URL"
    else
      URL="$ARG"
      case "$URL" in
        http*) ;;
        *) die "not a file and not a URL: $ARG" ;;
      esac
      MEDIA_ID="null"
    fi

    BODY=$(curl -s -X POST "$API/api/package-cloud-verifications/submit-video" \
      -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' -H 'X-Skip-Cache: 1' \
      -d "$(python3 -c 'import json,sys
mid = sys.argv[3]
print(json.dumps({"packageName": sys.argv[1], "recordingUrl": sys.argv[2],
                  "recordingMediaId": (None if mid in ("", "null") else int(mid))}))' "$PACKAGE" "$URL" "$MEDIA_ID")")

    # Same trap as the token step: this endpoint answers 200 on refusal too, so
    # the body decides, not the status code.
    OK=$(printf '%s' "$BODY" | python3 -c '
import json, sys
try:
    print("yes" if json.load(sys.stdin).get("success") is True else "no")
except Exception:
    print("no")
')
    echo
    echo "Verification record now:"
    show_record
    if [ "$OK" != "yes" ]; then
      echo
      echo "VIDEO WAS NOT ACCEPTED. Response:"
      printf '%s\n' "$BODY" | head -c 600
      exit 1
    fi
    echo
    echo "VIDEO SUBMITTED."
    ;;

  *) die "unknown option: $1  (try --status, --request, --confirm <TOKEN>, --video <URL|FILE>)" ;;
esac
