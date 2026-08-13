#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$BASE_DIR/v2-source"
PATCH_DIR="$BASE_DIR/patches/v2.1"
OVERLAY_DIR="$BASE_DIR/overlays/v2.2"
APP_ROOT="$BASE_DIR/app"
APP_DIR="$APP_ROOT/property-owner-pwa"
TMP_DIR="$APP_ROOT/.v2.2-unpack"
ARCHIVE="$BASE_DIR/.owner-property-pwa-v2.0.zip"
PATCH_FILE="$APP_ROOT/.owner-property-v2.1.patch"
EXPECTED_BASE_SHA256="19fbf4fe1e6eca3fefc86b66a34395f6b1b9e19d5c7c1b6bad99d4abc8862717"
EXPECTED_PATCH_SHA256="f0d8637b7451d17e7c0f9d600db9e3d4f91c14f8662a7db3e85aa04717a7efa8"

BASE_PARTS=(
  "$SOURCE_DIR/part-00.b64"
  "$SOURCE_DIR/part-01.b64"
  "$SOURCE_DIR/part-02.b64"
  "$SOURCE_DIR/part-03.b64"
  "$SOURCE_DIR/part-05.b64"
  "$SOURCE_DIR/part-07.b64"
  "$SOURCE_DIR/part-09.b64"
  "$SOURCE_DIR/part-10-11.b64"
  "$SOURCE_DIR/part-12.b64"
  "$SOURCE_DIR/part-13.b64"
  "$SOURCE_DIR/part-14.b64"
)

V21_PARTS=(
  "$PATCH_DIR/part-00.b64"
  "$PATCH_DIR/part-01.b64"
  "$PATCH_DIR/part-02.b64"
  "$PATCH_DIR/part-03.b64"
  "$PATCH_DIR/part-04.b64"
  "$PATCH_DIR/part-05.b64"
)

log() { printf '\n[Owner Property] %s\n' "$*"; }
fail() { printf '\n[Owner Property] ERROR: %s\n' "$*" >&2; exit 1; }

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  fail "Запустите установку через sudo: sudo ./install.sh"
fi

for cmd in base64 sha256sum unzip xz patch sed; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    if command -v apt-get >/dev/null 2>&1; then
      log "Устанавливаю базовые системные утилиты..."
      apt-get update -y
      DEBIAN_FRONTEND=noninteractive apt-get install -y coreutils ca-certificates unzip xz-utils patch sed
      break
    else
      fail "Нужны base64, sha256sum, unzip, xz, patch и sed. Автоустановка рассчитана на Ubuntu/Debian."
    fi
  fi
done

for part in "${BASE_PARTS[@]}"; do
  [[ -f "$part" ]] || fail "Не найдена часть baseline v2.0: $part"
done
for part in "${V21_PARTS[@]}"; do
  [[ -f "$part" ]] || fail "Не найдена часть UI-патча v2.1: $part"
done
for file in object-management-ui.js object-card-actions.js object-management.css; do
  [[ -f "$OVERLAY_DIR/$file" ]] || fail "Не найден overlay v2.2: $file"
done

log "Собираю проверенную baseline Owner Property v2.0..."
cat "${BASE_PARTS[@]}" | tr -d '\r\n' | base64 -d > "$ARCHIVE"
printf '%s  %s\n' "$EXPECTED_BASE_SHA256" "$ARCHIVE" | sha256sum -c - >/dev/null || fail "Контрольная сумма baseline v2.0 не совпала. Рабочая версия не изменена."

mkdir -p "$APP_ROOT"
rm -rf "$TMP_DIR"
mkdir -p "$TMP_DIR"
unzip -q "$ARCHIVE" -d "$TMP_DIR"
[[ -f "$TMP_DIR/install.sh" && -f "$TMP_DIR/docker-compose.yml" && -f "$TMP_DIR/server.js" ]] || fail "Baseline v2.0 распакован некорректно."

log "Применяю проверенный premium UI v2.1..."
cat "${V21_PARTS[@]}" | tr -d '\r\n' | base64 -d | xz -dc > "$PATCH_FILE"
printf '%s  %s\n' "$EXPECTED_PATCH_SHA256" "$PATCH_FILE" | sha256sum -c - >/dev/null || fail "Контрольная сумма UI-патча v2.1 не совпала. Рабочая версия не изменена."
(
  cd "$TMP_DIR"
  patch -p1 --batch --forward < "$PATCH_FILE"
)
rm -f "$PATCH_FILE"

log "Подключаю удобное управление объектами v2.2..."
cp "$OVERLAY_DIR/object-management-ui.js" "$TMP_DIR/public/object-management-ui.js"
cp "$OVERLAY_DIR/object-card-actions.js" "$TMP_DIR/public/object-card-actions.js"
cp "$OVERLAY_DIR/object-management.css" "$TMP_DIR/public/object-management.css"
printf '\n.property-crud-actions [data-building-delete]{display:none!important}\n.sidebar .brand:after{content:"v2.2"!important}\n' >> "$TMP_DIR/public/object-management.css"

sed -i '/premium.css/a\  <link rel="stylesheet" href="/object-management.css" />' "$TMP_DIR/public/index.html"
sed -i '/<script src="\/forms.js" defer><\/script>/a\  <script src="/object-management-ui.js" defer></script>\n  <script src="/object-card-actions.js" defer></script>' "$TMP_DIR/public/index.html"
sed -i 's/"version": "2.1.0"/"version": "2.2.0"/' "$TMP_DIR/package.json"
sed -i "s/version:'2.1.0'/version:'2.2.0'/" "$TMP_DIR/server.js"
sed -i "s/owner-property-shell-v21-premium/owner-property-shell-v22-objects/" "$TMP_DIR/public/sw.js"
sed -i "s#'/premium.css'#'/premium.css','/object-management.css'#" "$TMP_DIR/public/sw.js"
sed -i "s#'/forms.js'#'/forms.js','/object-management-ui.js','/object-card-actions.js'#" "$TMP_DIR/public/sw.js"

[[ -f "$TMP_DIR/public/object-management.css" ]] || fail "Не подключены стили управления объектами v2.2"
grep -q 'object-management-ui.js' "$TMP_DIR/public/index.html" || fail "UI управления объектами v2.2 не подключён"
grep -q '"version": "2.2.0"' "$TMP_DIR/package.json" || fail "Версия приложения после обновления не 2.2.0"

if command -v node >/dev/null 2>&1; then
  log "Проверяю синтаксис v2.2..."
  (cd "$TMP_DIR" && npm run check >/dev/null)
  node --check "$TMP_DIR/public/object-management-ui.js" >/dev/null
  node --check "$TMP_DIR/public/object-card-actions.js" >/dev/null
fi

# Сохраняем production-секреты и HTTPS-конфигурацию существующей установки.
if [[ -d "$APP_DIR" ]]; then
  log "Мигрирую существующую установку без потери данных и настроек..."
  [[ -f "$APP_DIR/.env" ]] && cp -a "$APP_DIR/.env" "$TMP_DIR/.env"
  [[ -f "$APP_DIR/Caddyfile" ]] && cp -a "$APP_DIR/Caddyfile" "$TMP_DIR/Caddyfile"
  rm -rf "$APP_DIR.previous"
  mv "$APP_DIR" "$APP_DIR.previous"
fi

mv "$TMP_DIR" "$APP_DIR"
chmod +x "$APP_DIR"/*.sh 2>/dev/null || true

log "Запускаю Owner Property v2.2 Object Management..."
cd "$APP_DIR"
exec ./install.sh
