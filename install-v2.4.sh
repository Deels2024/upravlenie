#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$BASE_DIR/app"
APP_DIR="$APP_ROOT/property-owner-pwa"
STAGE_DIR="$APP_ROOT/.v2.4-stage"
V24="$BASE_DIR/overlays/v2.4"
VERIFY_ONLY="${VERIFY_ONLY:-0}"

log(){ printf '\n[Owner Property] %s\n' "$*"; }
fail(){ printf '\n[Owner Property] ERROR: %s\n' "$*" >&2; exit 1; }

V24_PUBLIC=(v24-media.js v24-offline.js v24-followups.js v24-notifications.js v24-field.css)
for f in "${V24_PUBLIC[@]}" field-tools.js; do
  [[ -f "$V24/$f" ]] || fail "Не найден модуль v2.4: $f"
done

command -v node >/dev/null 2>&1 || fail "Node.js нужен для проверки v2.4"
node --check "$V24/field-tools.js" >/dev/null
for f in "${V24_PUBLIC[@]}"; do
  [[ "$f" == *.js ]] && node --check "$V24/$f" >/dev/null
done

if [[ "$VERIFY_ONLY" == "1" ]]; then
  grep -q 'followup' "$V24/field-tools.js" || fail "Follow-up backend не найден"
  grep -q 'offline' "$V24/v24-offline.js" || fail "Offline-модуль не найден"
  grep -q 'image' "$V24/v24-media.js" || fail "Media-модуль не найден"
  log "VERIFY_ONLY успешно: v2.4 modules validated"
  exit 0
fi

[[ "${EUID:-$(id -u)}" -eq 0 ]] || fail "Запустите через sudo: sudo ./install.sh"
[[ -d "$APP_DIR" && -f "$APP_DIR/server.js" && -f "$APP_DIR/public/index.html" ]] || fail "Для безопасного обновления v2.4 нужна установленная v2.3 в app/property-owner-pwa. Рабочая версия не изменена."

log "Создаю staging-копию установленной v2.3..."
rm -rf "$STAGE_DIR"
mkdir -p "$APP_ROOT"
cp -a "$APP_DIR" "$STAGE_DIR"

log "Подключаю полевые инструменты v2.4..."
for f in "${V24_PUBLIC[@]}"; do cp "$V24/$f" "$STAGE_DIR/public/$f"; done
mkdir -p "$STAGE_DIR/src/routes"
cp "$V24/field-tools.js" "$STAGE_DIR/src/routes/field-tools.js"

# Подключаем CSS/JS идемпотентно.
grep -q '/v24-field.css' "$STAGE_DIR/public/index.html" || sed -i '/<\/head>/i\  <link rel="stylesheet" href="/v24-field.css" />' "$STAGE_DIR/public/index.html"
for f in v24-media.js v24-offline.js v24-followups.js v24-notifications.js; do
  grep -q "/$f" "$STAGE_DIR/public/index.html" || sed -i "/<\/body>/i\  <script src=\"/$f\" defer></script>" "$STAGE_DIR/public/index.html"
done

# Backend route: добавляем один раз.
if ! grep -q "routes/field-tools" "$STAGE_DIR/src/router.js"; then
  sed -i "/const admin=require('.\/routes\/admin');/i const fieldTools=require('./routes/field-tools');" "$STAGE_DIR/src/router.js"
  sed -i 's/const protectedRoutes=\[common,buildings,utilities,operations,admin\];/const protectedRoutes=[common,buildings,utilities,operations,fieldTools,admin];/' "$STAGE_DIR/src/router.js"
fi

# Версия и PWA cache.
sed -i -E 's/"version": "2\.[0-9]+\.[0-9]+"/"version": "2.4.0"/' "$STAGE_DIR/package.json"
sed -i -E "s/version:'2\.[0-9]+\.[0-9]+'/version:'2.4.0'/" "$STAGE_DIR/server.js"
sed -i -E 's/owner-property-shell-v[0-9A-Za-z._-]+/owner-property-shell-v24-field/g' "$STAGE_DIR/public/sw.js" || true

# Добавляем новые статические ресурсы в cache-list, если список в старой версии имеет ожидаемый формат.
if ! grep -q "'/v24-field.css'" "$STAGE_DIR/public/sw.js"; then
  sed -i "s#'/premium.css'#'/premium.css','/v24-field.css'#" "$STAGE_DIR/public/sw.js" || true
fi
if ! grep -q "'/v24-media.js'" "$STAGE_DIR/public/sw.js"; then
  sed -i "s#'/forms.js'#'/forms.js','/v24-media.js','/v24-offline.js','/v24-followups.js','/v24-notifications.js'#" "$STAGE_DIR/public/sw.js" || true
fi

log "Проверяю staging-сборку v2.4..."
(cd "$STAGE_DIR" && npm run check >/dev/null)
node --check "$STAGE_DIR/src/routes/field-tools.js" >/dev/null
for f in v24-media.js v24-offline.js v24-followups.js v24-notifications.js; do node --check "$STAGE_DIR/public/$f" >/dev/null; done
grep -q '"version": "2.4.0"' "$STAGE_DIR/package.json" || fail "Версия staging не 2.4.0"
grep -q 'routes/field-tools' "$STAGE_DIR/src/router.js" || fail "Backend v2.4 не подключён"
grep -q '/v24-offline.js' "$STAGE_DIR/public/index.html" || fail "Frontend v2.4 не подключён"

log "Переключаю рабочую версию на v2.4..."
rm -rf "$APP_DIR.previous"
mv "$APP_DIR" "$APP_DIR.previous"
mv "$STAGE_DIR" "$APP_DIR"
chmod +x "$APP_DIR"/*.sh 2>/dev/null || true

log "Запускаю Owner Property v2.4..."
cd "$APP_DIR"
exec ./install.sh
