#!/usr/bin/env bash
set -euo pipefail
[[ $(id -u) -eq 0 ]] || { printf 'Run with sudo -n bash.\n'; exit 1; }
HERE=$(cd "$(dirname "$0")" && pwd)
CHECKPOINT="/root/niral-upgrade-checkpoints/$(date -u +%Y%m%dT%H%M%SZ)-ec2"
mkdir -p "$CHECKPOINT"
chmod 700 "$CHECKPOINT"
tar -czf "$CHECKPOINT/system-config.tgz" /etc/systemd/system /etc/apt/sources.list.d
if [[ -d /etc/ufw ]]; then cp -a /etc/ufw "$CHECKPOINT/ufw"; fi
if [[ -d /etc/nginx ]]; then cp -a /etc/nginx "$CHECKPOINT/nginx"; fi
for target in /opt/niral /opt/niral-demo; do
    if [[ -d "$target" ]]; then tar -czf "$CHECKPOINT/$(basename "$target").tgz" "$target"; fi
done
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl gnupg nginx ufw rsync openssl
if ! command -v node >/dev/null || [[ $(node -p 'process.versions.node.split(".")[0]') -lt 22 ]]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x -o "$CHECKPOINT/nodesource-setup.sh"
    bash "$CHECKPOINT/nodesource-setup.sh"
    apt-get install -y nodejs
fi
if ! id niral >/dev/null 2>&1; then useradd --system --home-dir /opt/niral-demo --shell /usr/sbin/nologin niral; fi
install -d -o ubuntu -g ubuntu /opt/niral /opt/niral-demo
install -d -o niral -g niral -m 750 /opt/niral-demo/data
if [[ ! -f /opt/niral-demo/app.env ]]; then
    (umask 077; printf 'NIRAL_SECRET=%s\nNODE_ENV=production\nNIRAL_SECURE=0\n' "$(openssl rand -hex 32)" > /opt/niral-demo/app.env)
fi
chown root:niral /opt/niral-demo/app.env
chmod 640 /opt/niral-demo/app.env
install -m 644 "$HERE/niral-demo.service" /etc/systemd/system/niral-demo.service
install -m 644 "$HERE/niral-demo-watchdog.service" /etc/systemd/system/niral-demo-watchdog.service
install -m 644 "$HERE/nginx.conf" /etc/nginx/sites-available/niral-demo
ln -sfn /etc/nginx/sites-available/niral-demo /etc/nginx/sites-enabled/niral-demo
nginx -t
systemctl daemon-reload
systemctl enable nginx niral-demo niral-demo-watchdog
ufw allow 22/tcp
ufw allow 80/tcp
ufw default deny incoming
ufw default allow outgoing
ufw --force enable
printf 'Checkpoint: %s\nNode: ' "$CHECKPOINT"
node --version