#!/usr/bin/env bash
# Copies Railway's database into Supabase, for the move in
# docs/plans/2026-10-25-azure-supabase-move.md. Reads both connection strings
# from secrets/migration.env (git-ignored) and never prints either.
#
#   bin/copy-to-supabase.sh check     connect to both; versions, and whether Supabase is empty
#   bin/copy-to-supabase.sh copy      take a fresh dump of Railway, restore it into an empty
#                                     Supabase, compare every table's row count
#   bin/copy-to-supabase.sh replace   the same, but empties Supabase's public schema first
#                                     (the switch-over, over the trial's data)
#
# secrets/migration.env holds:
#   RAILWAY_DATABASE_URL=   Railway → Postgres service → Variables → DATABASE_PUBLIC_URL
#   SUPABASE_DATABASE_URL=  Supabase → Connect → Connection String → Session pooler,
#                           with the database password in place of [YOUR-PASSWORD]
#
# Railway is only read. Railway runs Postgres 18, so the dump (npm run db:backup)
# and the restore use postgres:18-alpine in Docker; Docker has to be running. A
# local psql of any recent version does the queries. Supabase runs 17: 18's dump
# restored into it without trouble on 11-01. Afterwards run the migrations
# against Supabase (the plan says how), which also locks out its Data API roles.
set -euo pipefail
cd "$(dirname "$0")/.."
MODE=${1:-check}
IMAGE=postgres:18-alpine
ENV_FILE=secrets/migration.env

command -v psql >/dev/null || { echo "psql is not on PATH (it comes with Postgres)."; exit 1; }
command -v docker >/dev/null || { echo "docker is not on PATH. Start Docker Desktop, or add its bin folder to PATH."; exit 1; }
[ -f "$ENV_FILE" ] || { echo "$ENV_FILE is missing."; exit 1; }

read_env() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\r" '; }
RAILWAY_DATABASE_URL=$(read_env RAILWAY_DATABASE_URL)
SUPABASE_DATABASE_URL=$(read_env SUPABASE_DATABASE_URL)
[ -n "$RAILWAY_DATABASE_URL" ] || { echo "RAILWAY_DATABASE_URL is empty in $ENV_FILE"; exit 1; }
[ -n "$SUPABASE_DATABASE_URL" ] || { echo "SUPABASE_DATABASE_URL is empty in $ENV_FILE"; exit 1; }
# The direct connection is IPv6 only, and the transaction pooler (6543) can't restore.
case "$SUPABASE_DATABASE_URL" in *pooler.supabase.com:5432*) ;; *) echo "SUPABASE_DATABASE_URL is not the session pooler (pooler.supabase.com:5432)"; exit 1;; esac

rw() { PGCONNECT_TIMEOUT=15 psql "$RAILWAY_DATABASE_URL" -X -At -v ON_ERROR_STOP=1 "$@"; }
sb() { PGSSLMODE=require PGCONNECT_TIMEOUT=15 psql "$SUPABASE_DATABASE_URL" -X -At -v ON_ERROR_STOP=1 "$@"; }

COUNT_ROWS="select string_agg(t.relname || '=' || (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', t.relname), false, true, '')))[1]::text, E'\n' order by t.relname) from pg_class t join pg_namespace n on n.oid = t.relnamespace where n.nspname = 'public' and t.relkind in ('r','p')"

RW_VERSION=$(rw -c 'show server_version') || { echo "Railway refused the connection; stopping."; exit 1; }
echo "Railway:  $RW_VERSION  tables: $(rw -c "select count(*) from pg_tables where schemaname = 'public'")  last migration: $(rw -c 'select max(name) from _migrations' 2>/dev/null || echo none)"
# One try: repeated wrong passwords can get this machine blocked for a while.
SB_VERSION=$(sb -c 'show server_version') || { echo "Supabase refused the connection; stopping. A wrong password is the usual cause."; exit 1; }
echo "Supabase: $SB_VERSION  tables: $(sb -c "select count(*) from pg_tables where schemaname = 'public'")"
[ "$MODE" = check ] && exit 0
[ "$MODE" = copy ] || [ "$MODE" = replace ] || { echo "Usage: bin/copy-to-supabase.sh check | copy | replace"; exit 1; }

if [ "$MODE" = replace ]; then
  echo "Emptying Supabase's public schema"
  sb -c "drop schema public cascade; create schema public; grant usage, create on schema public to postgres;"
elif [ "$(sb -c "select count(*) from pg_tables where schemaname = 'public'")" != 0 ]; then
  echo "Supabase already has tables in public. Use 'replace' to empty it first."; exit 1
fi

echo "Dumping Railway"
BACKUP_DATABASE_URL="$RAILWAY_DATABASE_URL" npm run -s db:backup
DUMP=$(ls -1 backups/accounting-*.dump | sort | tail -1)
echo "Using $DUMP"

# Supabase owns its extensions, so the dump's own CREATE/COMMENT EXTENSION lines
# would fail there. The two the schema needs are made in public first; pgcrypto
# is unused by the schema and stays where Supabase keeps it.
sb -c "create extension if not exists citext with schema public; create extension if not exists btree_gist with schema public;"
echo "Restoring into Supabase"
PGURL="$SUPABASE_DATABASE_URL"
DUMPFILE=$(basename "$DUMP")
export PGURL DUMPFILE
BACKUPS_DIR="$(pwd -W 2>/dev/null || pwd)/backups"
MSYS_NO_PATHCONV=1 docker run --rm -e PGURL -e DUMPFILE -e PGSSLMODE=require \
  -v "$BACKUPS_DIR:/b:ro" "$IMAGE" sh -c '
    pg_restore -l "/b/$DUMPFILE" | grep -vE " EXTENSION - | COMMENT - EXTENSION | SCHEMA - public | COMMENT - SCHEMA public" > /tmp/list &&
    pg_restore --no-owner --no-acl --exit-on-error -L /tmp/list -d "$PGURL" "/b/$DUMPFILE"'

echo "Comparing row counts with Railway now (a table used since the dump may differ by a few rows)"
if diff <(rw -c "$COUNT_ROWS") <(sb -c "$COUNT_ROWS") > /dev/null; then
  echo "Row counts match: $(rw -c "$COUNT_ROWS" | wc -l) tables"
else
  echo "Row counts differ (< Railway, > Supabase):"; diff <(rw -c "$COUNT_ROWS") <(sb -c "$COUNT_ROWS") | head -20
fi
