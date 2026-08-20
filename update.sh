#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
docker compose build --pull
docker compose up -d --remove-orphans
for i in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:8787/healthz | grep -q '"version":"3.0.0"'; then
    echo "Owner Property v3.0.0 обновлён успешно"
    exit 0
  fi
  sleep 1
done
echo "Healthcheck v3.0.0 не пройден" >&2
exit 1
