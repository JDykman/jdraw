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

if podman container exists jdraw 2>/dev/null; then
  podman exec -e USERNAME="$USERNAME" -e PASSWORD="$PASSWORD" -e IS_ADMIN="$IS_ADMIN" \
    jdraw node_modules/.bin/tsx scripts/create_user.mjs
else
  USERNAME="$USERNAME" PASSWORD="$PASSWORD" IS_ADMIN="$IS_ADMIN" DB_PATH=./jdraw.db \
    node --input-type=module < scripts/create_user.mjs
fi
