#!/usr/bin/env bash
# Invoked by GitHub Actions; all stdin-consuming commands run with /dev/null.
set -euo pipefail
staging="${1:?release staging directory required}"
root="${UK_DEPLOY_ROOT:-/opt}"
target="$root/upravlenie-v3"
rollback_root="$root/upravlenie-rollback"
previous="$rollback_root/previous"
legacy="$root/property-owner-pwa"
compose_file=docker-compose.production.yml
switched=0
had_current=0
previous_image=''

rollback() {
  local result=$?
  trap - EXIT
  if [ "$switched" = 1 ] && [ "$result" != 0 ]; then
    printf '%s\n' 'Release failed; restoring the previous application image and configuration.'
    if [ -f "$target/$compose_file" ]; then
      docker compose -p upravlenie-v3 -f "$target/$compose_file" down </dev/null || true
    fi
    if [ "$had_current" = 1 ]; then
      rm -rf -- "$target"
      mv "$previous" "$target"
      docker tag "$previous_image" upravlenie-v3-app:local
      docker compose -p upravlenie-v3 -f "$target/$compose_file" up -d --no-build --force-recreate </dev/null
    else
      docker compose -p property-owner -f "$legacy/docker-compose.ip.yml" up -d --no-build </dev/null
    fi
    local recovered=0
    for attempt in $(seq 1 30); do
      if curl --max-time 5 -fsS http://127.0.0.1:8787/healthz >/dev/null; then
        if [ "$had_current" = 0 ] || curl --max-time 5 -fsS http://127.0.0.1:8787/version.json | cmp -s - "$target/public/version.json"; then recovered=1;break;fi
      fi
      sleep 2
    done
    if [ "$recovered" = 1 ]; then printf '%s\n' ROLLBACK_VERIFIED;else printf '%s\n' 'ROLLBACK_FAILED: previous service did not become healthy.' >&2;fi
  fi
  if [ "$result" != 0 ] && [ "$switched" = 0 ] && [ -n "$previous_image" ]; then docker tag "$previous_image" upravlenie-v3-app:local || true;fi
  exit "$result"
}
trap rollback EXIT

if [ -f "$target/$compose_file" ]; then
  had_current=1
  current_container="$(docker compose -p upravlenie-v3 -f "$target/$compose_file" ps -q app </dev/null)"
  [ -n "$current_container" ] || { printf '%s\n' 'Current application is not running; refusing to replace the recovery point.' >&2;exit 1; }
  previous_image="$(docker inspect "$current_container" --format '{{.Image}}')"
  curl --max-time 5 -fsS http://127.0.0.1:8787/healthz >/dev/null
  curl --max-time 5 -fsS http://127.0.0.1:8787/version.json | cmp -s - "$target/public/version.json"
  cp "$target/.env" "$staging/.env"
else
  previous_image="$(docker inspect property-owner-app-1 --format '{{.Image}}')"
  cp "$legacy/.env" "$staging/.env"
fi
chmod 600 "$staging/.env"
# A stable tag keeps the exact running image available even after building :local.
docker tag "$previous_image" upravlenie-v3-app:rollback
cp "$staging/deploy/docker-compose.production.yml" "$staging/$compose_file"
docker build --pull=false --build-arg BASE_IMAGE=upravlenie-v3-app:rollback -f "$staging/deploy/Dockerfile.production" -t upravlenie-v3-app:local "$staging" </dev/null
# Never switch without a verified database-and-photos snapshot.
docker compose -p upravlenie-v3 -f "$staging/$compose_file" run -T --rm --no-deps backup node --no-warnings scripts/backup.js --once </dev/null

if [ "$had_current" = 1 ]; then
  install -m 700 -d "$rollback_root"
  rm -rf -- "$previous"
  mv "$target" "$previous"
  switched=1
else
  switched=1
  docker compose -p property-owner -f "$legacy/docker-compose.ip.yml" down </dev/null
  # Initial migration only: keep an existing non-running source directory aside.
  if [ -d "$target" ]; then mv "$target" "$root/upravlenie-before-migration-$(date +%s)";fi
fi
mv "$staging" "$target"
docker compose -p upravlenie-v3 -f "$target/$compose_file" up -d --no-build </dev/null

for attempt in $(seq 1 30); do
  if curl --max-time 5 -fsS http://127.0.0.1:8787/healthz | grep -q '"ok":true' && curl --max-time 5 -fsS http://127.0.0.1:8787/version.json | cmp -s - "$target/public/version.json"; then
    docker compose -p upravlenie-v3 -f "$target/$compose_file" ps --status running --services </dev/null | grep -qx backup
    printf 'Published version: '
    curl --max-time 5 -fsS http://127.0.0.1:8787/version.json
    printf '\n%s\n' RELEASE_VERIFIED
    switched=0
    exit 0
  fi
  sleep 2
done
exit 1
