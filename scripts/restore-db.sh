#!/bin/bash
# Usage: ./scripts/restore-db.sh <backup_file>
# Requires DATABASE_URL environment variable to be set.
set -euo pipefail

BACKUP_FILE="${1:?Backup file required}"

if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "Error: File not found: $BACKUP_FILE"
  exit 1
fi

gunzip -c "$BACKUP_FILE" | psql "$DATABASE_URL"

echo "Restore complete from: $BACKUP_FILE"
