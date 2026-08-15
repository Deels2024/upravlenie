#!/usr/bin/env bash
set -euo pipefail
BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$BASE_DIR/v2-source"; PATCH_DIR="$BASE_DIR/patches/v2.1"; V22="$BASE_DIR/overlays/v2.2"; V23="$BASE_DIR/overlays/v2.3"; V24="$BASE_DIR/overlays/v2.4"
APP_ROOT="$BASE_DIR/app"; APP_DIR="$APP_ROOT/property-owner-pwa"; VERIFY_ONLY="${VERIFY_ONLY:-0}"; TMP_DIR="${VERIFY_OUTPUT_DIR:-$APP_ROOT/.v2.4-unpack}"
ARCHIVE="$BASE_DIR/.owner-property-pwa-v2.0.zip"; PATCH_FILE="$APP_ROOT/.owner-property-v2.1.patch"
BASE_SHA="19fbf4fe1e6eca3fefc86b66a34395f6b1b9e19d5c7c1b6bad99d4abc8862717"; PATCH_SHA="f0d8637b7451d17e7c0f9d600db9e3d4f91c14f8662a7db3e85aa04717a7efa8"
BASE_PARTS=("$SOURCE_DIR/part-00.b64" "$SOURCE_DIR/part-01.b64" "$SOURCE_DIR/part-02.b64" "$SOURCE_DIR/part-03.b64" "$SOURCE_DIR/part-05.b64" "$SOURCE_DIR/part-07.b64" "$SOURCE_DIR/part-09.b64" "$SOURCE_DIR/part-10-11.b64" "$SOURCE_DIR/part-12.b64" "$SOURCE_DIR/part-13.b64" "$SOURCE_DIR/part-14.b64")
V21_PARTS=("$PATCH_DIR/part-00.b64" "$PATCH_DIR/part-01.b64" "$PATCH_DIR/part-02.b64" "$PATCH_DIR/part-03.b64" "$PATCH_DIR/part-04.b64" "$PATCH_DIR/part-05.b64")
V22_FILES=(object-management-ui.js object-card-actions.js object-management.css)
V23_FILES=(v23-core.js v23-attention.js v23-calendar.js v23-workspace.js v23-fixes.js v23-polish.css)
V24_PUBLIC=(v24-media.js v24-offline.js v24-followups.js v24-notifications.js v24-field.css)
log(){ printf '\n[Owner Property] %s\n' "$*"; }; fail(){ printf '\n[Owner Property] ERROR: %s\n' "$*" >&2; exit 1; }
[[ "$VERIFY_ONLY" == 1 || "${EUID:-$(id -u)}" -eq 0 ]] || fail "Запустите через sudo: sudo ./install.sh"
for cmd in base64 sha256sum unzip xz patch sed; do command -v "$cmd" >/dev/null || fail "Не найдена системная утилита: $cmd"; done
for f in "${BASE_PARTS[@]}" "${V21_PARTS[@]}"; do [[ -f "$f" ]] || fail "Не найден release-файл: $f"; done
for f in "${V22_FILES[@]}"; do [[ -f "$V22/$f" ]] || fail "Не найден v2.2/$f"; done
for f in "${V23_FILES[@]}"; do [[ -f "$V23/$f" ]] || fail "Не найден v2.3/$f"; done
for f in "${V24_PUBLIC[@]}" field-tools.js; do [[ -f "$V24/$f" ]] || fail "Не найден v2.4/$f"; done
mkdir -p "$APP_ROOT"; rm -rf "$TMP_DIR"; mkdir -p "$TMP_DIR"
log "Собираю и проверяю baseline v2.0..."; cat "${BASE_PARTS[@]}" | tr -d '\r\n' | base64 --ignore-garbage -d > "$ARCHIVE"; printf '%s  %s\n' "$BASE_SHA" "$ARCHIVE" | sha256sum -c - >/dev/null || fail "SHA baseline v2.0 не совпал"
unzip -q "$ARCHIVE" -d "$TMP_DIR"; [[ -f "$TMP_DIR/server.js" ]] || fail "Baseline распакован некорректно"
log "Применяю проверенный premium UI v2.1..."; cat "${V21_PARTS[@]}" | tr -d '\r\n' | base64 --ignore-garbage -d | xz -dc > "$PATCH_FILE"; printf '%s  %s\n' "$PATCH_SHA" "$PATCH_FILE" | sha256sum -c - >/dev/null || fail "SHA v2.1 не совпал"; (cd "$TMP_DIR" && patch -p1 --batch --forward < "$PATCH_FILE"); rm -f "$PATCH_FILE"
log "Подключаю v2.2, v2.3 и v2.4..."; for f in "${V22_FILES[@]}"; do cp "$V22/$f" "$TMP_DIR/public/$f"; done; for f in "${V23_FILES[@]}"; do cp "$V23/$f" "$TMP_DIR/public/$f"; done; for f in "${V24_PUBLIC[@]}"; do cp "$V24/$f" "$TMP_DIR/public/$f"; done; cp "$V24/field-tools.js" "$TMP_DIR/src/routes/field-tools.js"
printf '\n.property-crud-actions [data-building-delete]{display:none!important}\n.sidebar .brand:after{content:"v2.4"!important}\n' >> "$TMP_DIR/public/object-management.css"
sed -i '/premium.css/a\  <link rel="stylesheet" href="/object-management.css" />\n  <link rel="stylesheet" href="/v23-polish.css" />\n  <link rel="stylesheet" href="/v24-field.css" />' "$TMP_DIR/public/index.html"
sed -i '/<script src="\/forms.js" defer><\/script>/a\  <script src="/object-management-ui.js" defer></script>\n  <script src="/object-card-actions.js" defer></script>\n  <script src="/v23-core.js" defer></script>\n  <script src="/v23-attention.js" defer></script>\n  <script src="/v23-calendar.js" defer></script>\n  <script src="/v23-workspace.js" defer></script>\n  <script src="/v23-fixes.js" defer></script>\n  <script src="/v24-media.js" defer></script>\n  <script src="/v24-offline.js" defer></script>\n  <script src="/v24-followups.js" defer></script>\n  <script src="/v24-notifications.js" defer></script>' "$TMP_DIR/public/index.html"
sed -i 's/"version": "2.1.0"/"version": "2.4.0"/' "$TMP_DIR/package.json"; sed -i "s/version:'2.1.0'/version:'2.4.0'/" "$TMP_DIR/server.js"
sed -i "/const admin=require('.\/routes\/admin');/i const fieldTools=require('./routes/field-tools');" "$TMP_DIR/src/router.js"; sed -i 's/const protectedRoutes=\[common,buildings,utilities,operations,admin\];/const protectedRoutes=[common,buildings,utilities,operations,fieldTools,admin];/' "$TMP_DIR/src/router.js"
sed -i 's/owner-property-shell-v21-premium/owner-property-shell-v24-field/' "$TMP_DIR/public/sw.js"; sed -i "s#'/premium.css'#'/premium.css','/object-management.css','/v23-polish.css','/v24-field.css'#" "$TMP_DIR/public/sw.js"; sed -i "s#'/forms.js'#'/forms.js','/object-management-ui.js','/object-card-actions.js','/v23-core.js','/v23-attention.js','/v23-calendar.js','/v23-workspace.js','/v23-fixes.js','/v24-media.js','/v24-offline.js','/v24-followups.js','/v24-notifications.js'#" "$TMP_DIR/public/sw.js"
grep -q '"version": "2.4.0"' "$TMP_DIR/package.json" || fail "Version не 2.4.0"; grep -q 'fieldTools' "$TMP_DIR/src/router.js" || fail "Backend v2.4 не подключён"; grep -q 'v24-offline.js' "$TMP_DIR/public/index.html" || fail "Frontend v2.4 не подключён"
if command -v node >/dev/null; then (cd "$TMP_DIR" && npm run check >/dev/null); node --check "$TMP_DIR/src/routes/field-tools.js" >/dev/null; for f in "${V22_FILES[@]}" "${V23_FILES[@]}" "${V24_PUBLIC[@]}"; do [[ "$f" == *.js ]] && node --check "$TMP_DIR/public/$f" >/dev/null; done; else fail "Node.js нужен для проверки сборки"; fi
if [[ "$VERIFY_ONLY" == 1 ]]; then log "VERIFY_ONLY успешно: $TMP_DIR"; exit 0; fi
if [[ -d "$APP_DIR" ]]; then log "Сохраняю production-настройки и прошлую версию..."; [[ -f "$APP_DIR/.env" ]] && cp -a "$APP_DIR/.env" "$TMP_DIR/.env"; [[ -f "$APP_DIR/Caddyfile" ]] && cp -a "$APP_DIR/Caddyfile" "$TMP_DIR/Caddyfile"; rm -rf "$APP_DIR.previous"; mv "$APP_DIR" "$APP_DIR.previous"; fi
mv "$TMP_DIR" "$APP_DIR"; chmod +x "$APP_DIR"/*.sh 2>/dev/null || true; log "Запускаю Owner Property v2.4..."; cd "$APP_DIR"; exec ./install.sh
