#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELEASE_DIR="$BASE_DIR/release-v1.1"
PATCH_V12="$BASE_DIR/patches/v1.2-ui.patch"
PATCH_V13_B64="$BASE_DIR/patches/v1.3-operations.patch.gz.b64"
PATCH_V14_B64="$BASE_DIR/patches/v1.4-tenants-staff.patch.xz.b64"
APP_ROOT="$BASE_DIR/app"
APP_DIR="$APP_ROOT/property-owner-pwa"
TMP_DIR="$APP_ROOT/.v1.4-unpack"
PATCH_V13_TMP="$TMP_DIR/v1.3-operations.patch"
PATCH_V14_TMP="$TMP_DIR/v1.4-tenants-staff.patch"
ARCHIVE="$BASE_DIR/.owner-property-pwa-v1.1-production.zip"
EXPECTED_BASE_SHA256="9cf82a181a5ddb3f6ef204b8265395a19391cb644e8254d6bdda2e4437ecef24"
EXPECTED_V13_PATCH_SHA256="b3dcbd8ef75114d53163c5f8d22cfa819f540c610bfdd42984d97ee497ef4485"
EXPECTED_V14_PATCH_SHA256="9f5af48e2618198d02501af29672d9179bda3b77fb1e745c4586f613b5c2a117"

log() { printf '\n[Owner Property] %s\n' "$*"; }
fail() { printf '\n[Owner Property] ERROR: %s\n' "$*" >&2; exit 1; }

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  fail "Запустите установку через sudo: sudo ./install.sh"
fi

for cmd in base64 sha256sum unzip patch gzip xz; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    if command -v apt-get >/dev/null 2>&1; then
      log "Устанавливаю базовые системные утилиты..."
      apt-get update -y
      DEBIAN_FRONTEND=noninteractive apt-get install -y coreutils ca-certificates unzip patch gzip xz-utils
      break
    else
      fail "Нужны base64, sha256sum, unzip, patch, gzip и xz. Автоустановка рассчитана на Ubuntu/Debian."
    fi
  fi
done

mapfile -t PARTS < <(find "$RELEASE_DIR" -maxdepth 1 -type f -name 'part-*.b64' | sort)
[[ ${#PARTS[@]} -eq 7 ]] || fail "Ожидалось 7 частей базового релиза v1.1, найдено: ${#PARTS[@]}"
[[ -f "$PATCH_V12" ]] || fail "Не найден UI-патч v1.2: $PATCH_V12"
[[ -f "$PATCH_V13_B64" ]] || fail "Не найден UI/UX-патч v1.3: $PATCH_V13_B64"
[[ -f "$PATCH_V14_B64" ]] || fail "Не найден UI/UX-патч v1.4: $PATCH_V14_B64"

log "Восстанавливаю проверенную production-базу v1.1..."
cat "${PARTS[@]}" | tr -d '\r\n' | base64 -d > "$ARCHIVE"

log "Проверяю целостность базового релиза SHA-256..."
printf '%s  %s\n' "$EXPECTED_BASE_SHA256" "$ARCHIVE" | sha256sum -c - >/dev/null || fail "Контрольная сумма базового релиза не совпала. Установка остановлена."

mkdir -p "$APP_ROOT"
rm -rf "$TMP_DIR"
mkdir -p "$TMP_DIR"
unzip -q "$ARCHIVE" -d "$TMP_DIR"
[[ -d "$TMP_DIR/property-owner-pwa" ]] || fail "В релизе не найдена папка property-owner-pwa"

log "Применяю интерфейс Owner Property v1.2..."
(
  cd "$TMP_DIR/property-owner-pwa"
  patch -p1 --batch --forward < "$PATCH_V12"
)

log "Проверяю и применяю Owner Property v1.3 — Проблемы и Осмотры..."
tr -d '\r\n' < "$PATCH_V13_B64" | base64 -d | gzip -dc > "$PATCH_V13_TMP"
printf '%s  %s\n' "$EXPECTED_V13_PATCH_SHA256" "$PATCH_V13_TMP" | sha256sum -c - >/dev/null || fail "Контрольная сумма UI/UX-патча v1.3 не совпала. Установка остановлена."
(
  cd "$TMP_DIR/property-owner-pwa"
  patch -p1 --batch --forward < "$PATCH_V13_TMP"
)
rm -f "$PATCH_V13_TMP"

log "Проверяю и применяю Owner Property v1.4 — Арендаторы и Сотрудники..."
tr -d '\r\n' < "$PATCH_V14_B64" | base64 -d | xz -dc > "$PATCH_V14_TMP"
printf '%s  %s\n' "$EXPECTED_V14_PATCH_SHA256" "$PATCH_V14_TMP" | sha256sum -c - >/dev/null || fail "Контрольная сумма UI/UX-патча v1.4 не совпала. Установка остановлена."
(
  cd "$TMP_DIR/property-owner-pwa"
  patch -p1 --batch --forward < "$PATCH_V14_TMP"
)
rm -f "$PATCH_V14_TMP"

# Проверяем синтаксис изменённого frontend/backend до замены рабочей версии.
if command -v node >/dev/null 2>&1; then
  node --check "$TMP_DIR/property-owner-pwa/public/app.js" >/dev/null
  node --check "$TMP_DIR/property-owner-pwa/server.js" >/dev/null
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

log "Запускаю production-установщик приложения v1.4..."
cd "$APP_DIR"
exec ./install.sh
