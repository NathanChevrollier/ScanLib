#!/bin/sh
# Sauvegarde de la base ScanLib, avec rotation.
#
#   ./infra/backup.sh              # sauvegarde ponctuelle
#   0 4 * * * /chemin/infra/backup.sh   # via cron, tous les jours a 4h
#
# Restauration :
#   gunzip -c infra/backups/scanlib-2026-09-07.sql.gz \
#     | docker compose -f infra/docker-compose.yml exec -T postgres \
#       psql -U scanlib -d scanlib

set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# On lit le .env pour reprendre l'utilisateur et la base reellement configures :
# sans cela, un POSTGRES_USER personnalise ferait echouer le dump.
if [ -f "$ROOT/.env" ]; then
	. "$ROOT/.env"
fi

COMPOSE="docker compose -f $ROOT/infra/docker-compose.yml --env-file $ROOT/.env"
BACKUP_DIR="$ROOT/infra/backups"
KEEP_DAYS="${KEEP_DAYS:-30}"
STAMP="$(date +%F)"

mkdir -p "$BACKUP_DIR"

# --clean --if-exists : le dump se rejoue sur une base existante sans conflit.
$COMPOSE exec -T postgres pg_dump \
	--username "${POSTGRES_USER:-scanlib}" \
	--dbname "${POSTGRES_DB:-scanlib}" \
	--clean --if-exists --no-owner \
	| gzip -9 > "$BACKUP_DIR/scanlib-$STAMP.sql.gz"

echo "Sauvegarde : $BACKUP_DIR/scanlib-$STAMP.sql.gz ($(du -h "$BACKUP_DIR/scanlib-$STAMP.sql.gz" | cut -f1))"

find "$BACKUP_DIR" -name 'scanlib-*.sql.gz' -mtime "+$KEEP_DAYS" -delete
echo "Sauvegardes de plus de $KEEP_DAYS jours supprimees."
