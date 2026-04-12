#!/usr/bin/env bash
# install.sh — Install SingleBME280 as a systemd service on Raspberry Pi
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICE_NAME="singlebme280"
SERVICE_FILE="${SCRIPT_DIR}/${SERVICE_NAME}.service"
DEST="/etc/systemd/system/${SERVICE_NAME}.service"
CURRENT_USER="$(whoami)"

# Must run as root
if [ "$(id -u)" -ne 0 ]; then
    echo "Error: This script must be run with sudo."
    echo "  sudo bash ${0}"
    exit 1
fi

if [ ! -f "$SERVICE_FILE" ]; then
    echo "Error: ${SERVICE_FILE} not found."
    exit 1
fi

# Detect the actual user (the one who called sudo, not root)
REAL_USER="${SUDO_USER:-$CURRENT_USER}"
REAL_HOME=$(eval echo "~${REAL_USER}")

echo "Installing ${SERVICE_NAME} service..."
echo "  User:      ${REAL_USER}"
echo "  Directory: ${SCRIPT_DIR}"
echo "  Log file:  ${REAL_HOME}/sensor.log"
echo ""

# Generate the service file with the correct user and paths
cat > "$DEST" <<EOF
[Unit]
Description=SingleBME280 Sensor Monitoring
After=multi-user.target network.target

[Service]
Type=simple
User=${REAL_USER}
WorkingDirectory=${SCRIPT_DIR}
ExecStartPre=/bin/sleep 15
ExecStart=/usr/bin/python3 ${SCRIPT_DIR}/SingleBME280.py
Restart=on-failure
RestartSec=10
StandardOutput=append:${REAL_HOME}/sensor.log
StandardError=append:${REAL_HOME}/sensor.log

[Install]
WantedBy=multi-user.target
EOF

# Remove old @reboot cron entry if it exists
if crontab -u "$REAL_USER" -l 2>/dev/null | grep -q "SingleBME280"; then
    echo "Removing old @reboot cron entry..."
    crontab -u "$REAL_USER" -l 2>/dev/null | grep -v "SingleBME280" | crontab -u "$REAL_USER" -
    echo "  Done."
fi

# Also check root's crontab
if crontab -l 2>/dev/null | grep -q "SingleBME280"; then
    echo "Removing old @reboot cron entry from root crontab..."
    crontab -l 2>/dev/null | grep -v "SingleBME280" | crontab -
    echo "  Done."
fi

# Enable and start
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"

echo ""
echo "Service installed and started."
echo ""
echo "Useful commands:"
echo "  sudo systemctl status ${SERVICE_NAME}    # check status"
echo "  sudo systemctl restart ${SERVICE_NAME}   # restart"
echo "  sudo systemctl stop ${SERVICE_NAME}      # stop"
echo "  journalctl -u ${SERVICE_NAME} -f         # follow logs"
echo "  tail -f ${REAL_HOME}/sensor.log          # follow sensor log"
