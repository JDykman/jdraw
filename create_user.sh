#!/usr/bin/env bash
set -euo pipefail

read -rp "Username (email): " USERNAME

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

node --input-type=module <<EOF
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

const db = new Database('./jdraw.db');
const hash = await bcrypt.hash('${PASSWORD}', 12);
try {
  db.prepare('INSERT INTO users (id, username, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?, ?)').run(
    randomUUID(), '${USERNAME}', hash, ${IS_ADMIN}, Date.now()
  );
  console.log('User "${USERNAME}" created successfully.');
} catch (e) {
  if (e.message.includes('UNIQUE')) {
    console.error('Error: Username already exists.');
    process.exit(1);
  }
  throw e;
}
EOF
