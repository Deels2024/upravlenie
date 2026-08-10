#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELEASE_DIR="$BASE_DIR/release"
APP_ROOT="$BASE_DIR/app"
APP_DIR="$APP_ROOT/property-owner-pwa"
ARCHIVE="$BASE_DIR/.owner-property-pwa-v1.0-production.zip"
EXPECTED_SHA256="d49c2dbd5c78209d9b036298c644987fb05480db1ae9b16f26d2bb8de0ef0f80"

log() { printf '\n[Owner Property] %s\n' "$*"; }
fail() { printf '\n[Owner Property] ERROR: %s\n' "$*" >&2; exit 1; }

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  fail "Запустите установку через sudo: sudo ./install.sh"
fi

if ! command -v base64 >/dev/null 2>&1 || ! command -v sha256sum >/dev/null 2>&1 || ! command -v unzip >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    log "Устанавливаю базовые системные утилиты..."
    apt-get update -y
    DEBIAN_FRONTEND=noninteractive apt-get install -y coreutils ca-certificates unzip
  else
    fail "Нужны base64, sha256sum и unzip. Автоустановка рассчитана на Ubuntu/Debian."
  fi
fi

mapfile -t PARTS < <(find "$RELEASE_DIR" -maxdepth 1 -type f -name 'part-*.b64' | sort)
[[ ${#PARTS[@]} -eq 10 ]] || fail "Ожидалось 10 частей релиза, найдено: ${#PARTS[@]}"

log "Восстанавливаю production-релиз..."
cat "${PARTS[@]}" | tr -d '\r\n' | base64 -d > "$ARCHIVE"

log "Проверяю целостность SHA-256..."
printf '%s  %s\n' "$EXPECTED_SHA256" "$ARCHIVE" | sha256sum -c - >/dev/null || fail "Контрольная сумма не совпала. Установка остановлена."

if [[ -d "$APP_DIR" ]]; then
  log "Рабочая папка приложения уже существует — сохраняю её и использую текущую версию."
else
  mkdir -p "$APP_ROOT"
  unzip -q "$ARCHIVE" -d "$APP_ROOT"
fi

[[ -d "$APP_DIR" ]] || fail "После распаковки не найдена папка $APP_DIR"
chmod +x "$APP_DIR"/*.sh 2>/dev/null || true

log "Запускаю production-установщик приложения..."
cd "$APP_DIR"
exec ./install.sh
