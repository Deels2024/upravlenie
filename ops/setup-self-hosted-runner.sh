#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/Deels2024/upravlenie"
RUNNER_USER="actions-runner"
RUNNER_HOME="/opt/actions-runner/upravlenie"
RUNNER_VERSION="${RUNNER_VERSION:-2.336.0}"
RUNNER_NAME="${RUNNER_NAME:-upravlenie-prod-$(hostname -s)}"
RUNNER_LABELS="${RUNNER_LABELS:-upravlenie-prod}"
RUNNER_TOKEN="${RUNNER_TOKEN:-}"

[[ "${EUID:-$(id -u)}" -eq 0 ]] || { echo "Run as root" >&2; exit 1; }
[[ -n "$RUNNER_TOKEN" ]] || { echo "Set RUNNER_TOKEN from GitHub Settings > Actions > Runners > New self-hosted runner" >&2; exit 1; }

command -v curl >/dev/null || { apt-get update; apt-get install -y curl; }
command -v git >/dev/null || { apt-get update; apt-get install -y git; }

if ! id "$RUNNER_USER" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir /home/$RUNNER_USER --shell /bin/bash "$RUNNER_USER"
fi

repo_dir=""
while IFS= read -r gitdir; do
  dir="${gitdir%/.git}"
  remote="$(git -C "$dir" remote get-url origin 2>/dev/null || true)"
  case "$remote" in
    *Deels2024/upravlenie*) repo_dir="$dir"; break ;;
  esac
done < <(find /root /opt /srv /var/www /home -maxdepth 5 -type d -name .git 2>/dev/null)
[[ -n "$repo_dir" ]] || { echo "Repository Deels2024/upravlenie not found on server" >&2; exit 1; }

install -d -o "$RUNNER_USER" -g "$RUNNER_USER" "$RUNNER_HOME"
cd "$RUNNER_HOME"
if [[ ! -x ./config.sh ]]; then
  curl -fsSLo actions-runner.tar.gz "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz"
  tar xzf actions-runner.tar.gz
  rm -f actions-runner.tar.gz
  chown -R "$RUNNER_USER:$RUNNER_USER" "$RUNNER_HOME"
fi

cat >/usr/local/sbin/deploy-upravlenie <<EOF
#!/usr/bin/env bash
set -euo pipefail
cd $(printf '%q' "$repo_dir")
git fetch origin main
git checkout main
git pull --ff-only origin main
chmod +x install.sh install-v2.4.sh install-v2.5.sh install-v2.6.sh 2>/dev/null || true
./install.sh
for attempt in \$(seq 1 30); do
  body="\$(curl --silent --show-error --max-time 10 http://127.0.0.1:8787/healthz || true)"
  if printf '%s' "\$body" | grep -q '"version":"2.6.0"'; then
    echo "Deployment healthy: \$body"
    exit 0
  fi
  echo "Health attempt \$attempt/30: \${body:-unavailable}"
  sleep 3
done
echo 'Healthcheck did not reach v2.6.0' >&2
exit 1
EOF
chmod 0755 /usr/local/sbin/deploy-upravlenie
chown root:root /usr/local/sbin/deploy-upravlenie
printf '%s ALL=(root) NOPASSWD: /usr/local/sbin/deploy-upravlenie\n' "$RUNNER_USER" >/etc/sudoers.d/upravlenie-runner
chmod 0440 /etc/sudoers.d/upravlenie-runner
visudo -cf /etc/sudoers.d/upravlenie-runner >/dev/null

if [[ -f .runner ]]; then
  sudo -u "$RUNNER_USER" ./config.sh remove --token "$RUNNER_TOKEN" || true
fi
sudo -u "$RUNNER_USER" ./config.sh --url "$REPO_URL" --token "$RUNNER_TOKEN" --name "$RUNNER_NAME" --labels "$RUNNER_LABELS" --unattended --replace
./svc.sh install "$RUNNER_USER"
./svc.sh start
./svc.sh status

echo "Self-hosted runner configured: $RUNNER_NAME [$RUNNER_LABELS]"
echo "Repository: $repo_dir"
