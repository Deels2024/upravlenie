#!/usr/bin/env bash
set -euo pipefail
export HOST="${HOST:-127.0.0.1}"
export PORT="${PORT:-8787}"
node server.js
