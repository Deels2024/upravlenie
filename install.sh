#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$BASE_DIR/v2-source"
APP_ROOT="$BASE_DIR/app"
APP_DIR="$APP_ROOT/property-owner-pwa"
TMP_DIR="$APP_ROOT/.v2-unpack"
ARCHIVE="$BASE_DIR/.owner-property-pwa-v2.0.zip"
EXPECTED_SHA256="19fbf4fe1e6eca3fefc86b66a34395f6b1b9e19d5c7c1b6bad99d4abc8862717"

log() { printf '\n[Owner Property] %s\n' "$*"; }
fail() { printf '\n[Owner Property] ERROR: %s\n' "$*" >&2; exit 1; }

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  fail "Запустите установку через sudo: sudo ./install.sh"
fi

for cmd in base64 sha256sum unzip; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    if command -v apt-get >/dev/null 2>&1; then
      log "Устанавливаю базовые системные утилиты..."
      apt-get update -y
      DEBIAN_FRONTEND=noninteractive apt-get install -y coreutils ca-certificates unzip
      break
    else
      fail "Нужны base64, sha256sum и unzip. Автоустановка рассчитана на Ubuntu/Debian."
    fi
  fi
done

mapfile -t PARTS < <(find "$SOURCE_DIR" -maxdepth 1 -type f -name 'part-*.b64' | sort)
[[ ${#PARTS[@]} -eq 11 ]] || fail "Ожидалось 11 частей baseline v2.0, найдено: ${#PARTS[@]}"

log "Собираю единый Owner Property v2.0 baseline..."
cat "${PARTS[@]}" | tr -d '\r\n' | base64 -d > "$ARCHIVE"

log "Проверяю SHA-256 baseline v2.0..."
printf '%s  %s\n' "$EXPECTED_SHA256" "$ARCHIVE" | sha256sum -c - >/dev/null || fail "Контрольная сумма v2.0 не совпала. Рабочая версия не изменена."

mkdir -p "$APP_ROOT"
rm -rf "$TMP_DIR"
mkdir -p "$TMP_DIR"
unzip -q "$ARCHIVE" -d "$TMP_DIR"
[[ -f "$TMP_DIR/install.sh" && -f "$TMP_DIR/docker-compose.yml" && -f "$TMP_DIR/server.js" ]] || fail "Baseline v2.0 распакован некорректно."

# Сохраняем production-секреты и HTTPS-конфигурацию существующей установки.
if [[ -d "$APP_DIR" ]]; then
  log "Мигрирую существующую установку v1.x/v2.x без потери данных..."
  [[ -f "$APP_DIR/.env" ]] && cp -a "$APP_DIR/.env" "$TMP_DIR/.env"
  [[ -f "$APP_DIR/Caddyfile" ]] && cp -a "$APP_DIR/Caddyfile" "$TMP_DIR/Caddyfile"
  rm -rf "$APP_DIR.previous"
  mv "$APP_DIR" "$APP_DIR.previous"
fi

mv "$TMP_DIR" "$APP_DIR"
chmod +x "$APP_DIR"/*.sh 2>/dev/null || true

log "Запускаю модульный Owner Property v2.0..."
cd "$APP_DIR"
exec ./install.sh
