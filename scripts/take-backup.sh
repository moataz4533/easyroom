#!/bin/bash
# Take a backup of the live hotel from a terminal, so it can be put on a
# schedule instead of remembered.
#
# It signs in as the owner and calls the same function the button in the app
# calls, so what lands on disk is byte for byte what the app would download.
#
#   EASYROOM_EMAIL=you@example.com EASYROOM_PASSWORD='…' \
#     scripts/take-backup.sh ~/easyroom-backups
#
# A cron line taking one every night at 3am:
#   0 3 * * * EASYROOM_EMAIL=… EASYROOM_PASSWORD=… /path/scripts/take-backup.sh ~/easyroom-backups
set -euo pipefail

URL="${EASYROOM_URL:-https://huvbguyvgptmplqbcbdp.supabase.co}"
KEY="${EASYROOM_KEY:-sb_publishable_77yb6RoRzX8tzkTiHw0LlA_uo3r-ft3}"
SLUG="${EASYROOM_SLUG:-greek-club-dahab}"
DIR="${1:-.}"
: "${EASYROOM_EMAIL:?set EASYROOM_EMAIL}"
: "${EASYROOM_PASSWORD:?set EASYROOM_PASSWORD}"

mkdir -p "$DIR"
OUT="$DIR/$SLUG-$(date -u +%Y-%m-%d-%H%M).json"

TOKEN=$(curl -sS -X POST "$URL/auth/v1/token?grant_type=password" \
  -H "apikey: $KEY" -H "Content-Type: application/json" \
  -d "{\"email\":\"$EASYROOM_EMAIL\",\"password\":\"$EASYROOM_PASSWORD\"}" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin).get("access_token",""))')
[ -n "$TOKEN" ] || { echo "sign-in failed" >&2; exit 1; }

PROPERTY=$(curl -sS "$URL/rest/v1/properties?select=id&slug=eq.$SLUG" \
  -H "apikey: $KEY" -H "Authorization: Bearer $TOKEN" \
  | python3 -c 'import json,sys; rows=json.load(sys.stdin); print(rows[0]["id"] if rows else "")')
[ -n "$PROPERTY" ] || { echo "hotel $SLUG not found for this account" >&2; exit 1; }

curl -sS -X POST "$URL/rest/v1/rpc/export_property_data" \
  -H "apikey: $KEY" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"p_property\":\"$PROPERTY\"}" > "$OUT"

# A file that is not a backup must not be left sitting there looking like one.
python3 - "$OUT" <<'PY'
import json, sys, os
path = sys.argv[1]
try:
    f = json.load(open(path, encoding="utf-8"))
except Exception as e:
    os.remove(path); sys.exit(f"not valid JSON, deleted: {e}")
if f.get("format") != "easyroom-backup":
    os.remove(path); sys.exit("not an Easyroom backup, deleted")
d = f["data"]
if not d.get("rooms"):
    os.remove(path); sys.exit("no rooms in it, deleted rather than left as false cover")
blob = json.dumps(f)
for secret in ("action_pin_hash", "encrypted_password"):
    if secret in blob:
        os.remove(path); sys.exit(f"carries {secret}, deleted")
print(f"{path}  ({os.path.getsize(path)} bytes, taken {f['taken_at']})")
for table in sorted(d):
    rows = d[table]
    print(f"  {table}: {len(rows) if isinstance(rows, list) else 1}")
PY
