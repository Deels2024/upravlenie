#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELEASE_DIR="$BASE_DIR/release-v1.1"
PATCH_FILE="$BASE_DIR/patches/v1.2-ui.patch"
APP_ROOT="$BASE_DIR/app"
APP_DIR="$APP_ROOT/property-owner-pwa"
TMP_DIR="$APP_ROOT/.v1.2-unpack"
ARCHIVE="$BASE_DIR/.owner-property-pwa-v1.1-production.zip"
EXPECTED_SHA256="9cf82a181a5ddb3f6ef204b8265395a19391cb644e8254d6bdda2e4437ecef24"

log() { printf '\n[Owner Property] %s\n' "$*"; }
fail() { printf '\n[Owner Property] ERROR: %s\n' "$*" >&2; exit 1; }

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  fail "Запустите установку через sudo: sudo ./install.sh"
fi

if ! command -v base64 >/dev/null 2>&1 || ! command -v sha256sum >/dev/null 2>&1 || ! command -v unzip >/dev/null 2>&1 || ! command -v patch >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    log "Устанавливаю базовые системные утилиты..."
    apt-get update -y
    DEBIAN_FRONTEND=noninteractive apt-get install -y coreutils ca-certificates unzip patch
  else
    fail "Нужны base64, sha256sum, unzip и patch. Автоустановка рассчитана на Ubuntu/Debian."
  fi
fi

mapfile -t PARTS < <(find "$RELEASE_DIR" -maxdepth 1 -type f -name 'part-*.b64' | sort)
[[ ${#PARTS[@]} -eq 7 ]] || fail "Ожидалось 7 частей базового релиза v1.1, найдено: ${#PARTS[@]}"
[[ -f "$PATCH_FILE" ]] || fail "Не найден UI-патч v1.2: $PATCH_FILE"

log "Восстанавливаю проверенную production-базу v1.1..."
cat "${PARTS[@]}" | tr -d '\r\n' | base64 -d > "$ARCHIVE"

log "Проверяю целостность базового релиза SHA-256..."
printf '%s  %s\n' "$EXPECTED_SHA256" "$ARCHIVE" | sha256sum -c - >/dev/null || fail "Контрольная сумма базового релиза не совпала. Установка остановлена."

mkdir -p "$APP_ROOT"
rm -rf "$TMP_DIR"
mkdir -p "$TMP_DIR"
unzip -q "$ARCHIVE" -d "$TMP_DIR"
[[ -d "$TMP_DIR/property-owner-pwa" ]] || fail "В релизе не найдена папка property-owner-pwa"

log "Применяю интерфейс Owner Property v1.2..."
(
  cd "$TMP_DIR/property-owner-pwa"
  patch -p1 --batch --forward < "$PATCH_FILE"
)

# Проверяем синтаксис изменённого frontend до замены рабочей версии.
if command -v node >/dev/null 2>&1; then
  node --check "$TMP_DIR/property-owner-pwa/public/app.js" >/dev/null
fi

# Сохраняем production-секреты и доменную конфигурацию при обновлении.
if [[ -d "$APP_DIR" ]]; then
  log "Обновляю код приложения с сохранением production-настроек..."
  [[ -f "$APP_DIR/.env" ]] && cp -a "$APP_DIR/.env" "$TMP_DIR/property-owner-pwa/.env"
  [[ -f "$APP_DIR/Caddyfile" ]] && cp -a "$APP_DIR/Caddyfile" "$TMP_DIR/property-owner-pwa/Caddyfile"
  rm -rf "$APP_DIR.previous"
  mv "$APP_DIR" "$APP_DIR.previous"
fi

mv "$TMP_DIR/property-owner-pwa" "$APP_DIR"
rm -rf "$TMP_DIR"
chmod +x "$APP_DIR"/*.sh 2>/dev/null || true

log "Запускаю production-установщик приложения v1.2..."
cd "$APP_DIR"
exec ./install.sh
