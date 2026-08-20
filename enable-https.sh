#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
DOMAIN="${1:-}"
if [ -z "$DOMAIN" ]; then
  echo "Использование: sudo ./enable-https.sh portal.example.com" >&2
  exit 1
fi
cat > Caddyfile <<CFG
${DOMAIN} {
    encode zstd gzip
    request_body { max_size 30MB }
    reverse_proxy app:8787
    header {
        -Server
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
        Referrer-Policy no-referrer
    }
}
CFG
sed -i.bak 's/^COOKIE_SECURE=.*/COOKIE_SECURE=1/' .env
python3 - <<'PY'
from pathlib import Path
p=Path('docker-compose.yml')
s=p.read_text()
s=s.replace('      - "80:80"','      - "80:80"\n      - "443:443"')
if 'caddy_data:/data' not in s:
    s=s.replace('      - ./Caddyfile:/etc/caddy/Caddyfile:ro','      - ./Caddyfile:/etc/caddy/Caddyfile:ro\n      - caddy_data:/data\n      - caddy_config:/config')
    s=s.replace('volumes:\n  app_data:', 'volumes:\n  caddy_data:\n  caddy_config:\n  app_data:')
p.write_text(s)
PY
docker compose up -d --force-recreate web app
echo "HTTPS включён для https://${DOMAIN}"
