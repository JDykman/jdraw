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

# Determine if running against container (production) or local DB (dev)
if podman container exists jdraw 2>/dev/null; then
  EXEC="podman exec jdraw node_modules/.bin/tsx"
  DB_PATH="/data/jdraw.db"
else
  EXEC="node"
  DB_PATH="./jdraw.db"
fi

$EXEC --input-type=module <<EOF
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

const db = new Database('${DB_PATH}');
const hash = await bcrypt.hash('${PASSWORD}', 12);
try {
  db.prepare('INSERT INTO users (id, username, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?, ?)').run(
    randomUUID(), '${USERNAME}', hash, ${IS_ADMIN}, Date.now()
  );
  console.log('User "${USERNAME}" created successfully.');
} catch (e) {
  if (e.message?.includes('UNIQUE')) {
    console.error('Error: Username already exists.');
    process.exit(1);
  }
  throw e;
}
EOF
