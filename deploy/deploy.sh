#!/usr/bin/env bash
# Builds, tests and installs NVDA Remote Web on this server.
# Usage: deploy/deploy.sh [--skip-tests]
set -euo pipefail

cd "$(dirname "$0")/.."
TARGET=/opt/nvremote-web

npm ci
npm run typecheck
if [[ "${1:-}" != "--skip-tests" ]]; then
	npm test
fi
npm run build

sudo mkdir -p "$TARGET"
sudo rsync -a --delete dist/web/ "$TARGET/public/"
sudo rsync -a --delete dist/gateway/ "$TARGET/gateway/"
sudo cp package.json package-lock.json "$TARGET/"
(cd "$TARGET" && sudo npm ci --omit=dev --ignore-scripts --no-audit --no-fund)
sudo chmod -R a+rX "$TARGET"

if [[ ! -f /etc/nvremote-web.env ]]; then
	sudo install -m 644 deploy/nvremote-web.env /etc/nvremote-web.env
fi
sudo install -m 644 deploy/nvremote-web-gateway.service /etc/systemd/system/nvremote-web-gateway.service
sudo install -m 644 deploy/nginx-nvremote.conf /etc/nginx/sites-available/nvremote.conf
sudo ln -sfn /etc/nginx/sites-available/nvremote.conf /etc/nginx/sites-enabled/nvremote.conf

sudo systemctl daemon-reload
sudo systemctl enable nvremote-web-gateway >/dev/null
sudo systemctl restart nvremote-web-gateway
sudo nginx -t
sudo systemctl reload nginx

for _ in $(seq 1 20); do
	if curl -fsS http://127.0.0.1:39870/healthz >/dev/null; then
		echo "Deployed. Gateway healthy."
		exit 0
	fi
	sleep 0.5
done
echo "Gateway did not become healthy; see: journalctl -u nvremote-web-gateway" >&2
exit 1
