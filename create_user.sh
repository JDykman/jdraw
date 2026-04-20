#!/usr/bin/env bash
set -euo pipefail

read -rp "Username: " USERNAME

while true; do
  read -rsp "Password: " PASSWORD; echo
  read -rsp "Retype password: " PASSWORD2; echo
  if [[ "$PASSWORD" == "$PASSWORD2" ]]; then
    break
  fi
  echo "Passwords do not match. Try again."
done

read -rp "Is admin? (y/n): " IS_ADMIN_INPUT
if [[ "$IS_ADMIN_INPUT" =~ ^[Yy]$ ]]; then
  IS_ADMIN=1
else
  IS_ADMIN=0
fi

SCRIPT="
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

const db = new Database('DB_PATH_PLACEHOLDER');
const hash = await bcrypt.hash('${PASSWORD}', 12);
try {
  db.prepare('INSERT INTO users (id, username, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?, ?)').run(
    randomUUID(), '${USERNAME}', hash, ${IS_ADMIN}, Date.now()
  );
  console.log('User created successfully.');
} catch (e) {
  if (e.message?.includes('UNIQUE')) {
    console.error('Error: Username already exists.');
    process.exit(1);
  }
  throw e;
}
"

if podman container exists jdraw 2>/dev/null; then
  echo "${SCRIPT/DB_PATH_PLACEHOLDER//data/jdraw.db}" | podman exec -i jdraw sh -c 'cat > /app/_cu.mjs && node_modules/.bin/tsx /app/_cu.mjs; RC=$?; rm -f /app/_cu.mjs; exit $RC'
else
  echo "${SCRIPT/DB_PATH_PLACEHOLDER/./jdraw.db}" | node --input-type=module
fi
