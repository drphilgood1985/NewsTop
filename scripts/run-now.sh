#!/usr/bin/env bash
set -euo pipefail

systemctl --user start mint-news-wallpaper.service
echo "Triggered immediate run. Check logs: journalctl --user -u mint-news-wallpaper -f"

