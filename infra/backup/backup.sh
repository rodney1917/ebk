#!/bin/sh
# Nightly logical backup with retention. Copy /backups off-server (encrypted) — see DEPLOYMENT.md.
set -eu
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
FILE="/backups/ebk-${STAMP}.dump"
pg_dump --format=custom --compress=9 --no-owner --file="${FILE}.partial"
mv "${FILE}.partial" "${FILE}"
sha256sum "${FILE}" > "${FILE}.sha256"
# Prove the dump is readable (catalogue listing) before counting it as a backup.
pg_restore --list "${FILE}" > /dev/null
find /backups -name 'ebk-*.dump*' -mtime +"${BACKUP_RETENTION_DAYS:-14}" -delete
echo "$(date -u) backup ok: ${FILE}"
