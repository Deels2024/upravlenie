#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
docker compose run --rm backup node --no-warnings scripts/backup.js --once
