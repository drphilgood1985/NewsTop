#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="mint-news-wallpaper"

echo "> Timer status"
systemctl --user list-timers --all | (grep "$SERVICE_NAME" || true)
echo
echo "> Service status"
systemctl --user status ${SERVICE_NAME}.service --no-pager || true
echo
echo "> Recent logs"
journalctl --user -u ${SERVICE_NAME} --since "-2h" -n 200 --no-pager || true

