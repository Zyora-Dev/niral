/**
 * niral deploy — generate a complete production deployment kit.
 *
 * Writes deploy/ into the project:
 *   setup.sh            ONE-TIME Linux server provisioning (node, systemd, nginx)
 *   deploy.sh           rsync app + framework to a server, build there, restart
 *   niral-app.service   systemd unit (auto-restart, env file, health-checked)
 *   niral-watchdog.service  independent guardian (separate process from the app)
 *   nginx.conf          reverse proxy w/ WebSocket upgrade for live channels
 *   Dockerfile          container alternative (node:22-slim, build + start)
 *   app.env             environment template (NIRAL_SECRET etc.)
 *
 * Everything is a TEMPLATE you own — edit hosts/paths/domains and run
 * ./deploy/deploy.sh. No magic, no lock-in.
 */

import { writeFileSync, mkdirSync, existsSync, chmodSync } from "node:fs";
import { join, resolve, basename } from "node:path";

const DEPLOY_SH = (name) => `#!/usr/bin/env bash
# ── ${name}: build-on-server deploy ──────────────────────────────
# Edit these three lines, then: ./deploy/deploy.sh
SERVER="user@your-server"
APP_DIR="/opt/${name}"            # the app lives here (data/ SURVIVES deploys)
NIRAL_DIR="/opt/niral"            # the framework checkout on the server

set -euo pipefail
echo "→ syncing app to \$SERVER:\$APP_DIR"
# data/ and env files are NEVER synced — production data and secrets live on
# the server and only on the server. A deploy must not be able to clobber them.
rsync -az --delete \\
  --exclude 'dist/' --exclude 'data/' --exclude '.niral/' --exclude 'node_modules/' \\
  --exclude '.env' --exclude '*.env' --exclude 'app.env' \\
  ./ "\$SERVER:\$APP_DIR/"

echo "→ snapshotting databases before deploy (instant undo if this goes wrong)"
ssh "\$SERVER" "node \$NIRAL_DIR/bin/niral.js snapshot \$APP_DIR" || true

echo "→ building release on the server (atomic — a failed build changes nothing)"
ssh "\$SERVER" "node \$NIRAL_DIR/bin/niral.js build \$APP_DIR"

echo "→ restarting"
ssh "\$SERVER" "sudo systemctl restart ${name} && sleep 1 && systemctl is-active ${name}"
ssh "\$SERVER" "sudo systemctl restart ${name}-watchdog" || true  # guardian picks up new framework code

echo "→ health check"
# node is the one tool GUARANTEED on a niral server — curl/wget may not exist
ssh "\$SERVER" "node -e 'fetch(\\"http://localhost:8199/@niral/health\\").then(r=>{if(!r.ok)process.exit(1);return r.text()}).then(t=>console.log(t))'"
echo "✓ deployed"
`;

const SETUP_SH = (name) => `#!/usr/bin/env bash
# ── ${name}: ONE-TIME server setup (Ubuntu/Debian) ──────────────────
# Copy the deploy/ folder to a fresh server and run this ONCE as a
# sudo-capable user:   bash deploy/setup.sh
# After it finishes, every deploy is just ./deploy/deploy.sh from your machine.

APP_NAME="${name}"
APP_DIR="/opt/${name}"
NIRAL_DIR="/opt/niral"          # rsync/clone your framework checkout here

set -euo pipefail
HERE="\$(cd "\$(dirname "\$0")" && pwd)"

# 1. Node 22+ (skipped when already installed)
if ! command -v node >/dev/null 2>&1 || [ "\$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  command -v apt-get >/dev/null 2>&1 || { echo "! node 22+ missing and apt-get unavailable — install Node 22 manually first"; exit 1; }
  echo "→ installing Node 22 (NodeSource)"
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
echo "✓ node \$(node -v)"

# 2. the framework — niral is a checkout, not an npm install
if [ ! -d "\$NIRAL_DIR" ]; then
  echo "! \$NIRAL_DIR missing — rsync your niral checkout there first:"
  echo "    rsync -az /path/to/niral/ \$USER@this-server:\$NIRAL_DIR/"
  exit 1
fi
echo "✓ framework at \$NIRAL_DIR"

# 3. app dir + production env — the secret is GENERATED, never committed
sudo mkdir -p "\$APP_DIR/data"
if [ ! -f "\$APP_DIR/app.env" ]; then
  sudo tee "\$APP_DIR/app.env" >/dev/null <<EOF
NIRAL_SECRET=\$(openssl rand -hex 32)
NIRAL_SECURE=1
EOF
  echo "✓ app.env created with a generated NIRAL_SECRET"
else
  echo "✓ app.env already present — untouched"
fi

# 4. systemd unit (auto-restart, drains gracefully on deploys)
sudo cp "\$HERE/niral-app.service" "/etc/systemd/system/\$APP_NAME.service"
sudo systemctl daemon-reload
sudo systemctl enable "\$APP_NAME"
echo "✓ systemd unit installed + enabled"

# 4b. watchdog — the independent guardian (separate process from the app)
sudo cp "\$HERE/niral-watchdog.service" "/etc/systemd/system/\$APP_NAME-watchdog.service"
sudo systemctl daemon-reload
sudo systemctl enable "\$APP_NAME-watchdog"
echo "✓ watchdog installed + enabled (guards health, integrity, audit)"

# 5. nginx reverse proxy (WebSocket upgrade for live channels)
if ! command -v nginx >/dev/null 2>&1; then
  command -v apt-get >/dev/null 2>&1 || { echo "! nginx missing and apt-get unavailable — install nginx manually first"; exit 1; }
  sudo apt-get install -y nginx
fi
sudo cp "\$HERE/nginx.conf" "/etc/nginx/sites-available/\$APP_NAME"
sudo ln -sf "/etc/nginx/sites-available/\$APP_NAME" "/etc/nginx/sites-enabled/\$APP_NAME"
sudo nginx -t && sudo systemctl reload nginx
echo "✓ nginx wired (edit server_name in /etc/nginx/sites-available/\$APP_NAME)"

echo ""
echo "✓ server ready — from your machine run:  ./deploy/deploy.sh"
echo "  (then start once:  sudo systemctl start \$APP_NAME)"
`;

const SERVICE = (name) => `# /etc/systemd/system/${name}.service
# sudo systemctl daemon-reload && sudo systemctl enable --now ${name}
[Unit]
Description=${name} (niral)
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/${name}
ExecStart=/usr/bin/node /opt/niral/bin/niral.js start /opt/${name} -p 8199
EnvironmentFile=/opt/${name}/app.env
Restart=always
RestartSec=2
# hardening
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/opt/${name}/data /opt/${name}/dist

[Install]
WantedBy=multi-user.target
`;

const WATCHDOG_SERVICE = (name) => `# /etc/systemd/system/${name}-watchdog.service
# The independent guardian — a SEPARATE process from the app, so if the app is
# killed or compromised the watchdog survives to notice, alert and recover.
# sudo systemctl daemon-reload && sudo systemctl enable --now ${name}-watchdog
[Unit]
Description=${name} watchdog (niral)
After=network.target ${name}.service

[Service]
Type=simple
WorkingDirectory=/opt/${name}
# NIRAL_RESTART_CMD lets the watchdog restart the app after an auto-rollback.
Environment="NIRAL_RESTART_CMD=/usr/bin/systemctl restart ${name}"
ExecStart=/usr/bin/node /opt/niral/bin/niral.js watchdog /opt/${name} -p 8199
EnvironmentFile=/opt/${name}/app.env
Restart=always
RestartSec=5
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
`;

const NGINX = (name) => `# /etc/nginx/sites-available/${name}
# ln -s into sites-enabled, then: sudo nginx -t && sudo systemctl reload nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:8199;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # live channels + HMR are WebSockets
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 1h;
    }
}
`;

const CLUSTER_SERVICE = (name) => `# /etc/systemd/system/${name}@.service — TEMPLATED unit for horizontal scaling.
# Run one instance per port (all on one box, or copy to N boxes):
#   sudo systemctl daemon-reload
#   sudo systemctl enable --now ${name}@8201 ${name}@8202 ${name}@8203
# Requires NIRAL_CLUSTER=1 + NIRAL_DATABASE_URL in app.env so real-time channels
# fan out across every instance via Postgres LISTEN/NOTIFY. Sessions stay in the
# signed cookie (stateless) so any instance can serve any request — no stickiness.
[Unit]
Description=${name} instance on port %i (niral cluster)
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/${name}
ExecStart=/usr/bin/node /opt/niral/bin/niral.js start /opt/${name} -p %i
EnvironmentFile=/opt/${name}/app.env
Restart=always
RestartSec=2
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/opt/${name}/data /opt/${name}/dist

[Install]
WantedBy=multi-user.target
`;

const NGINX_CLUSTER = (name) => `# /etc/nginx/sites-available/${name} — load-balanced across N niral instances.
# Start the instances first (niral-cluster@.service), then symlink this + reload.
upstream ${name}_cluster {
    least_conn;                 # route each request to the least-busy instance
    server 127.0.0.1:8201;
    server 127.0.0.1:8202;
    server 127.0.0.1:8203;
    keepalive 32;
}

server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://${name}_cluster;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # live channels + HMR are WebSockets. No sticky sessions needed: the
        # Postgres backplane fans messages to whichever instance holds the client.
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 1h;
    }
}
`;

const DOCKERFILE = (name) => `# Container alternative to the systemd unit.
#   docker build -t ${name} .   &&   docker run -p 8199:8199 -v ${name}-data:/app/data --env-file app.env ${name}
FROM node:22-slim
WORKDIR /app
# the framework (clone it next to the app, or COPY a checkout)
COPY --from=niral . /niral
COPY . .
RUN node /niral/bin/niral.js build /app
EXPOSE 8199
CMD ["node", "/niral/bin/niral.js", "start", "/app", "-p", "8199"]
`;

const APP_ENV = `# environment for production — loaded by the systemd unit / --env-file
NIRAL_SECRET=change-me-to-a-long-random-string
NIRAL_SECURE=1
# NIRAL_SESSION_STORE=db
# NIRAL_AI_URL=
# NIRAL_SMTP_URL=
# NIRAL_MAIL_FROM=
#
# ── scale to multiple servers/instances (optional) ──
# Set both, then run instances via niral-cluster@.service behind nginx-cluster.conf.
# Real-time channels fan out across every instance via Postgres LISTEN/NOTIFY.
# NIRAL_CLUSTER=1
# NIRAL_DATABASE_URL=postgres://user:pass@host:5432/db?sslmode=require
# Share the background-job queue across nodes too (any node enqueues + works it):
# NIRAL_JOBS_STORE=pg
`;

export function initDeploy({ root }) {
  const dir = resolve(root);
  const name = basename(dir).replace(/[^\w-]/g, "-");
  const out = join(dir, "deploy");
  if (existsSync(out)) {
    console.log("niral · deploy/ already exists — leaving it alone (delete it to regenerate)");
    return out;
  }
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "setup.sh"), SETUP_SH(name));
  chmodSync(join(out, "setup.sh"), 0o755);
  writeFileSync(join(out, "deploy.sh"), DEPLOY_SH(name));
  chmodSync(join(out, "deploy.sh"), 0o755);
  writeFileSync(join(out, "niral-app.service"), SERVICE(name));
  writeFileSync(join(out, "niral-watchdog.service"), WATCHDOG_SERVICE(name));
  writeFileSync(join(out, "nginx.conf"), NGINX(name));
  writeFileSync(join(out, "niral-cluster@.service"), CLUSTER_SERVICE(name));
  writeFileSync(join(out, "nginx-cluster.conf"), NGINX_CLUSTER(name));
  writeFileSync(join(out, "Dockerfile"), DOCKERFILE(name));
  writeFileSync(join(dir, "app.env"), APP_ENV, { flag: "wx" });

  console.log(`niral · deployment kit ready — deploy/
  one-time server setup (Ubuntu/Debian — automated):
    1. rsync your niral checkout to the server:  /opt/niral
    2. copy deploy/ to the server and run:       bash deploy/setup.sh
       (installs node 22 + nginx, systemd unit, generates NIRAL_SECRET)
  every deploy after that:
    ./deploy/deploy.sh          (rsync → build on server → restart → health check)
  scale out later (optional):
    set NIRAL_CLUSTER=1 + NIRAL_DATABASE_URL in app.env, run niral-cluster@.service
    instances behind nginx-cluster.conf — see docs /docs/scaling`);
  return out;
}
