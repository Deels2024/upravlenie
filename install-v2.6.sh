#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$BASE_DIR/app"
APP_DIR="$APP_ROOT/property-owner-pwa"
STAGE_DIR="$APP_ROOT/.v2.6-stage"
V24="$BASE_DIR/overlays/v2.4"
V25="$BASE_DIR/overlays/v2.5"
V26="$BASE_DIR/overlays/v2.6"
VERIFY_ONLY="${VERIFY_ONLY:-0}"

log(){ printf '\n[Owner Property] %s\n' "$*"; }
fail(){ printf '\n[Owner Property] ERROR: %s\n' "$*" >&2; exit 1; }

V24_PUBLIC=(v24-media.js v24-offline.js v24-followups.js v24-notifications.js v24-field.css)
V26_PUBLIC=(pwa-mobile.js pwa-mobile.css manifest.webmanifest sw.js)
for f in "${V24_PUBLIC[@]}" field-tools.js; do [[ -f "$V24/$f" ]] || fail "Не найден модуль v2.4: $f"; done
[[ -f "$V25/production-clean-start.js" ]] || fail "Не найден production cleanup v2.5"
for f in "${V26_PUBLIC[@]}"; do [[ -f "$V26/$f" ]] || fail "Не найден PWA-модуль v2.6: $f"; done

command -v node >/dev/null 2>&1 || fail "Node.js нужен для проверки обновления"
node --check "$V24/field-tools.js" >/dev/null
for f in "${V24_PUBLIC[@]}"; do [[ "$f" == *.js ]] && node --check "$V24/$f" >/dev/null; done
node --check "$V25/production-clean-start.js" >/dev/null
node --check "$V26/pwa-mobile.js" >/dev/null
node --check "$V26/sw.js" >/dev/null

if [[ "$VERIFY_ONLY" == "1" ]]; then
  grep -q 'productionCleanStartAt' "$V25/production-clean-start.js" || fail "Маркер production cleanup не найден"
  grep -q 'display.*standalone' "$V26/manifest.webmanifest" || fail "PWA standalone manifest не найден"
  grep -q 'pwaMore' "$V26/pwa-mobile.js" || fail "Мобильное меню «Ещё» не найдено"
  grep -q 'owner-property-shell-v26-mobile' "$V26/sw.js" || fail "Service worker v2.6 не найден"
  log "VERIFY_ONLY успешно: v2.6 Mobile PWA validated"
  exit 0
fi

[[ "${EUID:-$(id -u)}" -eq 0 ]] || fail "Запустите через sudo: sudo ./install.sh"
[[ -d "$APP_DIR" && -f "$APP_DIR/server.js" && -f "$APP_DIR/public/index.html" ]] || fail "Для безопасного обновления нужна установленная версия приложения. Рабочая версия не изменена."

log "Создаю staging-копию текущей рабочей версии..."
rm -rf "$STAGE_DIR"
mkdir -p "$APP_ROOT"
cp -a "$APP_DIR" "$STAGE_DIR"

log "Сохраняю production-модули v2.4/v2.5 и подключаю Mobile PWA v2.6..."
for f in "${V24_PUBLIC[@]}"; do cp "$V24/$f" "$STAGE_DIR/public/$f"; done
mkdir -p "$STAGE_DIR/src/routes"
cp "$V24/field-tools.js" "$STAGE_DIR/src/routes/field-tools.js"
cp "$V25/production-clean-start.js" "$STAGE_DIR/src/production-clean-start.js"
cp "$V26/pwa-mobile.js" "$STAGE_DIR/public/pwa-mobile.js"
cp "$V26/pwa-mobile.css" "$STAGE_DIR/public/pwa-mobile.css"
cp "$V26/manifest.webmanifest" "$STAGE_DIR/public/manifest.webmanifest"
cp "$V26/sw.js" "$STAGE_DIR/public/sw.js"

# Сохраняем backend v2.4 и одноразовый production clean start v2.5.
if ! grep -q "routes/field-tools" "$STAGE_DIR/src/router.js"; then
  sed -i "/const admin=require('.\/routes\/admin');/i const fieldTools=require('./routes/field-tools');" "$STAGE_DIR/src/router.js"
  sed -i 's/const protectedRoutes=\[common,buildings,utilities,operations,admin\];/const protectedRoutes=[common,buildings,utilities,operations,fieldTools,admin];/' "$STAGE_DIR/src/router.js"
fi
if ! grep -q "production-clean-start" "$STAGE_DIR/server.js"; then
  sed -i "/const api=createRouter(ctx);/i const productionCleanStart=require('./src/production-clean-start');" "$STAGE_DIR/server.js"
  sed -i 's/ctx.initStorage();ctx.ensureDataShape();server.listen/ctx.initStorage();ctx.ensureDataShape();productionCleanStart(ctx);server.listen/' "$STAGE_DIR/server.js"
fi

# PWA metadata и мобильные стили.
grep -q 'mobile-web-app-capable' "$STAGE_DIR/public/index.html" || sed -i '/<meta name="theme-color"/a\  <meta name="mobile-web-app-capable" content="yes" />\n  <meta name="apple-mobile-web-app-capable" content="yes" />\n  <meta name="apple-mobile-web-app-status-bar-style" content="default" />\n  <meta name="apple-mobile-web-app-title" content="Owner Property" />\n  <meta name="application-name" content="Owner Property" />' "$STAGE_DIR/public/index.html"
grep -q '/pwa-mobile.css' "$STAGE_DIR/public/index.html" || sed -i '/<\/head>/i\  <link rel="stylesheet" href="/pwa-mobile.css" />' "$STAGE_DIR/public/index.html"
if ! grep -q '/pwa-mobile.js' "$STAGE_DIR/public/index.html"; then
  sed -i '/<script src="\/bootstrap.js" defer><\/script>/i\  <script src="/pwa-mobile.js" defer></script>' "$STAGE_DIR/public/index.html"
fi

# Production presentation cleanup remains idempotent.
sed -i 's/name="email" value="owner@local"/name="email" value=""/' "$STAGE_DIR/public/core.js" || true
sed -i 's/placeholder="Например: Ленинский 136"/placeholder="Название объекта"/' "$STAGE_DIR/public/forms.js" || true
if [[ -f "$STAGE_DIR/public/object-management.css" ]]; then
  grep -q 'production.*brand' "$STAGE_DIR/public/object-management.css" || printf '\n/* production brand */\n.sidebar .brand:after{content:""!important;display:none!important}\n' >> "$STAGE_DIR/public/object-management.css"
fi
if [[ -f "$STAGE_DIR/src/access.js" ]]; then
  sed -i "s/const planDefaults={b1:'2026-08-14',b2:'2026-08-14',b3:'2026-08-15'};/const planDefaults={};/" "$STAGE_DIR/src/access.js" || true
  sed -i "s/inspectorUserId:'u-inspector'/inspectorUserId:''/g" "$STAGE_DIR/src/access.js" || true
fi

sed -i -E 's/"version": "2\.[0-9]+\.[0-9]+"/"version": "2.6.0"/' "$STAGE_DIR/package.json"
sed -i -E "s/version:'2\.[0-9]+\.[0-9]+'/version:'2.6.0'/" "$STAGE_DIR/server.js"

log "Проверяю staging-сборку v2.6..."
(cd "$STAGE_DIR" && npm run check >/dev/null)
node --check "$STAGE_DIR/src/routes/field-tools.js" >/dev/null
node --check "$STAGE_DIR/src/production-clean-start.js" >/dev/null
node --check "$STAGE_DIR/public/pwa-mobile.js" >/dev/null
node --check "$STAGE_DIR/public/sw.js" >/dev/null
for f in v24-media.js v24-offline.js v24-followups.js v24-notifications.js; do node --check "$STAGE_DIR/public/$f" >/dev/null; done
grep -q '"version": "2.6.0"' "$STAGE_DIR/package.json" || fail "Версия staging не 2.6.0"
grep -q 'display.*standalone' "$STAGE_DIR/public/manifest.webmanifest" || fail "Manifest PWA не подключён"
grep -q '/pwa-mobile.css' "$STAGE_DIR/public/index.html" || fail "Мобильные стили не подключены"
grep -q '/pwa-mobile.js' "$STAGE_DIR/public/index.html" || fail "Мобильная логика не подключена"
grep -q 'productionCleanStart(ctx)' "$STAGE_DIR/server.js" || fail "Production cleanup v2.5 потерян"

log "Переключаю рабочую версию на v2.6 Mobile PWA..."
rm -rf "$APP_DIR.previous"
mv "$APP_DIR" "$APP_DIR.previous"
mv "$STAGE_DIR" "$APP_DIR"
chmod +x "$APP_DIR"/*.sh 2>/dev/null || true

log "Запускаю Owner Property v2.6 Mobile PWA..."
cd "$APP_DIR"
exec ./install.sh
