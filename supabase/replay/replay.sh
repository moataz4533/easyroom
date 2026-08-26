#!/bin/bash
#
# Replay the whole migration history onto a clean Postgres 16, then run the
# behaviour suites against it as a real `authenticated` user.
#
# This exists because the isolation model is three SQL functions, and a
# mistake in any of them is invisible until somebody reads another hotel's
# guest register. Changing them without replaying first is not a thing to do.
#
#   supabase/replay/replay.sh            # replay only
#   supabase/replay/replay.sh --check    # replay, seed, and run the suites
#
# Needs postgresql-16 installed and a `postgres` system user (initdb refuses
# to run as root). Everything lives under $PGDIR and is thrown away each run.
set -e

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
PGDIR="${PGDIR:-/var/tmp/easyroom-replay}"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PORT="${PGPORT:-5433}"
PSQL="psql -h $PGDIR -p $PORT -U postgres -q -v ON_ERROR_STOP=1"

# The one hardcoded user id in an old verification migration, which expects a
# profile that only ever existed in production.
SEEDED_UID=e1b95522-e72c-4bf2-9aac-1554ae85f71f

as_postgres() { su postgres -s /bin/bash -c "PATH=$PGBIN:\$PATH $1"; }

as_postgres "pg_ctl -D $PGDIR/data -o '-p $PORT -k $PGDIR' stop" >/dev/null 2>&1 || true
rm -rf "$PGDIR"
mkdir -p "$PGDIR"
chown -R postgres "$PGDIR"
chmod 700 "$PGDIR"

as_postgres "initdb -D $PGDIR/data -U postgres --auth=trust" >/dev/null
as_postgres "pg_ctl -D $PGDIR/data -o '-p $PORT -k $PGDIR' -l $PGDIR/log start" >/dev/null
sleep 2

$PSQL -f "$HERE/bootstrap.sql"
$PSQL -c "insert into auth.users (id, email) values ('$SEEDED_UID', 'owner@example.com')"

count=0
for f in "$REPO"/supabase/migrations/*.sql; do
  case "$(basename "$f")" in
    20260812204753_*)
      $PSQL -c "insert into profiles (id, full_name) values ('$SEEDED_UID', 'Seed Owner') on conflict do nothing" ;;
  esac
  if ! $PSQL -f "$f" >/dev/null 2>"$PGDIR/err"; then
    echo "FAILED: $(basename "$f")"
    head -6 "$PGDIR/err"
    exit 1
  fi
  count=$((count + 1))
done
echo "replayed $count migrations"

if [ "$1" = "--check" ]; then
  $PSQL -f "$HERE/seed.sql"
  echo
  echo "--- isolation: nobody may see another hotel ---"
  psql -h "$PGDIR" -p "$PORT" -U postgres -f "$HERE/isolation.sql" 2>&1 | grep "="
  echo
  echo "--- suspension: a suspended hotel stops, and comes back ---"
  psql -h "$PGDIR" -p "$PORT" -U postgres -f "$HERE/suspension.sql" 2>&1 | grep "="
  echo
  echo "--- discounts: a night is sold at its own price, less the discount ---"
  psql -h "$PGDIR" -p "$PORT" -U postgres -f "$HERE/discounts.sql" 2>&1 | grep "="
  echo
  echo "--- companies: an agency's rooms price themselves, and stay its own ---"
  psql -h "$PGDIR" -p "$PORT" -U postgres -f "$HERE/accounts.sql" 2>&1 | grep "="
  echo
  echo "--- dates: a stay moved instead of cancelled and taken again ---"
  psql -h "$PGDIR" -p "$PORT" -U postgres -f "$HERE/dates.sql" 2>&1 | grep "="
  echo
  echo "--- reset: one hotel's register emptied, its setup and neighbours left ---"
  psql -h "$PGDIR" -p "$PORT" -U postgres -f "$HERE/reset.sql" 2>&1 | grep "="
fi

echo
echo "still running on $PGDIR (port $PORT). To stop it:"
echo "  su postgres -s /bin/bash -c \"$PGBIN/pg_ctl -D $PGDIR/data -o '-p $PORT -k $PGDIR' stop\""
