#!/usr/bin/env bash
set -euo pipefail

# Installs user-level systemd service and timer to run wallpapers at 04:00, 12:00, 19:00.

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
UNIT_DIR="$HOME/.config/systemd/user"
mkdir -p "$UNIT_DIR"

cp -f "$PROJECT_DIR/systemd/user/mint-news-wallpaper.service" "$UNIT_DIR/"
cp -f "$PROJECT_DIR/systemd/user/mint-news-wallpaper.timer" "$UNIT_DIR/"

systemctl --user daemon-reload
systemctl --user enable --now mint-news-wallpaper.timer

echo "Systemd timer enabled. View logs: journalctl --user -u mint-news-wallpaper --since today -f"

