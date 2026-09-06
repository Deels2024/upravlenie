#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
docker compose build --pull
docker compose up -d --remove-orphans
for i in $(seq 1 60); do
  if curl --max-time 5 -fsS http://127.0.0.1:8787/healthz >/dev/null && curl --max-time 5 -fsS http://127.0.0.1:8787/version.json | cmp -s - public/version.json; then
    echo "Owner Property обновлён, опубликованная версия проверена:"
    cat public/version.json
    exit 0
  fi
  sleep 1
done
echo "Проверка приложения или опубликованной версии не пройдена" >&2
exit 1

