#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="mint-news-wallpaper"
UNIT_DIR="$HOME/.config/systemd/user"

echo "[uninstall] Disabling and stopping timer/service..."
systemctl --user disable --now ${SERVICE_NAME}.timer || true
systemctl --user stop ${SERVICE_NAME}.service || true

echo "[uninstall] Removing unit files..."
rm -f "$UNIT_DIR/${SERVICE_NAME}.timer" "$UNIT_DIR/${SERVICE_NAME}.service"
systemctl --user daemon-reload

echo "[uninstall] Removed."

