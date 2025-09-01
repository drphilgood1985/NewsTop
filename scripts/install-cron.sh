#!/usr/bin/env bash
set -euo pipefail

# Installs a crontab entry to run the wallpaper generator at 04:00, 12:00, and 19:00 daily.

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE_BIN="$(command -v node || true)"

if [[ -z "$NODE_BIN" ]]; then
  echo "Node.js not found in PATH. Please install Node 18+ and re-run." >&2
  exit 1
fi

LOG_DIR="$PROJECT_DIR/logs"
mkdir -p "$LOG_DIR"

CRON_LINE="0 4,12,19 * * * cd $PROJECT_DIR && /usr/bin/env bash -lc 'source .env 2>/dev/null || true; $NODE_BIN src/run-once.js >> $LOG_DIR/cron.log 2>&1'"

# Preserve existing crontab and append/update our line
(crontab -l 2>/dev/null | grep -v 'mint-news-wallpaper' || true; echo "$CRON_LINE # mint-news-wallpaper") | crontab -

echo "Cron job installed. It will run at 04:00, 12:00, and 19:00 daily."

