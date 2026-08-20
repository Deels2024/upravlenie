#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

install_docker_debian() {
  if [ "$(id -u)" -ne 0 ]; then
    echo "Docker не найден. Запустите установщик через sudo: sudo ./install.sh" >&2
    exit 1
  fi
  if ! command -v apt-get >/dev/null 2>&1; then
    echo "Docker не найден, а автоустановка поддерживается только на Ubuntu/Debian." >&2
    exit 1
  fi
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y ca-certificates curl openssl docker.io
  # Compose v2 package differs by distro; try both common names.
  apt-get install -y docker-compose-v2 2>/dev/null || apt-get install -y docker-compose-plugin 2>/dev/null || true
  systemctl enable --now docker 2>/dev/null || service docker start 2>/dev/null || true
}

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker не найден — устанавливаю автоматически..."
  install_docker_debian
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose plugin не найден — пытаюсь установить..."
  if [ "$(id -u)" -eq 0 ] && command -v apt-get >/dev/null 2>&1; then
    apt-get update
    apt-get install -y docker-compose-v2 2>/dev/null || apt-get install -y docker-compose-plugin
  fi
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "Не удалось установить Docker Compose plugin автоматически." >&2
  exit 1
fi

umask 077
mkdir -p backups
chmod 700 backups
if [ ! -f .env ]; then
  if command -v openssl >/dev/null 2>&1; then
    OWNER_PASSWORD="$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 28)Aa7!"
  else
    OWNER_PASSWORD="$(head -c 64 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 28)Aa7!"
  fi
  cat > .env <<ENV
OWNER_LOGIN=owner
OWNER_PASSWORD=${OWNER_PASSWORD}
COOKIE_SECURE=0
ENV
  chmod 600 .env
else
  # shellcheck disable=SC1091
  source ./.env
fi

docker compose build --pull
docker compose up -d --remove-orphans

for i in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:8787/healthz >/dev/null 2>&1; then break; fi
  sleep 1
  if [ "$i" -eq 60 ]; then
    echo "Сервис не прошёл healthcheck. Смотрите: docker compose logs" >&2
    exit 1
  fi
done

IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
echo
echo "=============================================="
echo "Owner Property успешно запущен"
echo "URL: http://${IP:-SERVER_IP}:8787/"
echo "Логин владельца: ${OWNER_LOGIN:-owner}"
echo "Пароль владельца: ${OWNER_PASSWORD}"
echo "=============================================="
echo
echo "Сохраните пароль в менеджере паролей. Для внешнего доступа рекомендуется привязать домен и включить HTTPS."
