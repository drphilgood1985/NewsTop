#!/usr/bin/env bash
set -euo pipefail

# Setup script: installs deps and enables a systemd user timer to run the wallpaper generator

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
UNIT_DIR="$HOME/.config/systemd/user"
SERVICE_NAME="mint-news-wallpaper"
SERVICE_FILE="$UNIT_DIR/${SERVICE_NAME}.service"
TIMER_FILE="$UNIT_DIR/${SERVICE_NAME}.timer"
LOG_DIR="$PROJECT_DIR/logs"

echo "[setup] Project: $PROJECT_DIR"
mkdir -p "$LOG_DIR" "$UNIT_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "[setup] Node.js is required (>=18). Please install Node and re-run." >&2
  exit 1
fi

NODE_VER="$(node -v | sed 's/^v//')"
NODE_MAJOR="${NODE_VER%%.*}"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "[setup] Node $NODE_VER found; please upgrade to >= 18." >&2
  exit 1
fi

echo "[setup] Installing npm dependencies..."
(cd "$PROJECT_DIR" && npm install --silent)

# .env bootstrap
if [ ! -f "$PROJECT_DIR/.env" ]; then
  if [ -f "$PROJECT_DIR/.env.example" ]; then
    cp "$PROJECT_DIR/.env.example" "$PROJECT_DIR/.env"
    echo "[setup] Created .env from .env.example. Please edit and add your API keys."
  else
    touch "$PROJECT_DIR/.env"
    echo "[setup] Created empty .env."
  fi
fi

WORKING_DIR_ESCAPED="$(printf '%q' "$PROJECT_DIR")"

echo "[setup] Writing systemd user service to $SERVICE_FILE"
cat >"$SERVICE_FILE" <<EOF
[Unit]
Description=Mint News Wallpaper (run once)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=$PROJECT_DIR
EnvironmentFile=$PROJECT_DIR/.env
ExecStart=/usr/bin/env bash -lc 'source .env 2>/dev/null || true; node src/run-once.js'
StandardOutput=append:$PROJECT_DIR/logs/systemd.log
StandardError=append:$PROJECT_DIR/logs/systemd.log

[Install]
WantedBy=default.target
EOF

echo "[setup] Writing systemd user timer to $TIMER_FILE"
cat >"$TIMER_FILE" <<EOF
[Unit]
Description=Run Mint News Wallpaper at 04:00, 12:00, 19:00

[Timer]
OnCalendar=*-*-* 04:00:00
OnCalendar=*-*-* 12:00:00
OnCalendar=*-*-* 19:00:00
Persistent=true

[Install]
WantedBy=timers.target
EOF

echo "[setup] Enabling and starting timer..."
systemctl --user daemon-reload
systemctl --user enable --now ${SERVICE_NAME}.timer

echo "[setup] Done. View timers: systemctl --user list-timers --all | grep ${SERVICE_NAME}"
echo "[setup] Run now: systemctl --user start ${SERVICE_NAME}.service"
echo "[setup] Logs: journalctl --user -u ${SERVICE_NAME} --since today -f"

