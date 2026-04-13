# SingleSensor – BME280 / SCD40 Monitoring with Self-Hosted Dashboard

Raspberry Pi Zero sensor monitoring system with a self-hosted PHP dashboard. Supports **BME280** (temperature + humidity) and **SCD40** (temperature + humidity + CO2) sensors. Designed for deploying many Pi Zeros across different locations, all reporting to a single dashboard hosted on shared cPanel hosting.

## Architecture

```
┌──────────────┐     HTTPS POST      ┌─────────────────────┐
│  Pi Zero #1  │ ──────────────────>  │                     │
│  (BME280)    │                      │  cPanel Dashboard   │
├──────────────┤                      │  (PHP + MySQL)      │
│  Pi Zero #2  │ ──────────────────>  │                     │
│  (SCD40)     │                      │  - Chart.js UI      │
├──────────────┤                      │  - REST API         │
│  Pi Zero #N  │ ──────────────────>  │  - Auto-purge       │
│  (BME280)    │                      │                     │
└──────────────┘                      └─────────────────────┘
```

Each Pi Zero runs `SingleBME280.py`, which:
- Auto-detects the connected sensor (BME280 or SCD40)
- Reads temperature, humidity, and CO2 (SCD40 only) on a configurable interval
- POSTs JSON to the dashboard API over HTTPS
- Sends Slack alerts when temperature thresholds are exceeded
- Serves a local settings page on port 5000

## Prerequisites

- **Per Pi Zero**: Raspberry Pi Zero W with either a BME280 or SCD40 sensor
- **Dashboard server**: Any cPanel shared hosting account with PHP 7.4+ and MySQL

## Hardware Setup

### BME280 Wiring (I2C)

| BME280 Pin | Pi GPIO |
|------------|---------|
| VCC        | 3.3V    |
| GND        | GND     |
| SDA        | GPIO 2  |
| SCL        | GPIO 3  |

### SCD40 Wiring (I2C)

| SCD40 Pin | Pi GPIO |
|-----------|---------|
| VCC       | 3.3V    |
| GND       | GND     |
| SDA       | GPIO 2  |
| SCL       | GPIO 3  |

Enable I2C on your Pi if not already done:
```bash
sudo raspi-config   # Interface Options → I2C → Enable
```

## Pi Zero Setup

### 1. Install dependencies

```bash
sudo apt update && sudo apt install -y python3-pip

# For BME280 sensors:
pip3 install flask smbus2 RPi.bme280 slack_sdk configparser

# For SCD40 sensors:
pip3 install flask adafruit-circuitpython-scd4x slack_sdk configparser
```

### 2. Clone and configure

```bash
git clone https://github.com/morroware/SingleBME280.git
cd SingleBME280
```

Edit `SingleSensorSettings.conf`:
```ini
[General]
sensor_location_name = kitchen        # Unique name for this sensor
sensor_type = auto                    # auto | bme280 | scd40
minutes_between_reads = 5
sensor_threshold_temp = 88.0          # High temp alert (°F)
sensor_lower_threshold_temp = 40.0    # Low temp alert (°F)
threshold_count = 3                   # Consecutive readings before alert
slack_channel = alerts
slack_api_token = xoxb-your-token
dashboard_url = https://yourdomain.com/dashboard/api/submit.php
dashboard_api_key = your-secret-api-key
bme280_address = 0x76                 # 0x76 or 0x77
```

### 3. Run on boot (systemd)

```bash
sudo bash install.sh
```

The install script automatically detects your user and install path, generates the systemd service, removes any old `@reboot` cron entries, and starts the service.

Check status:
```bash
sudo systemctl status singlebme280
journalctl -u singlebme280 -f
```

> **Note:** The service waits 15 seconds before starting to ensure I2C and networking are ready.

### 4. Test

```bash
python3 SingleBME280.py
```
Access settings at `http://<pi_ip>:5000/settings`.

## Dashboard Setup (cPanel)

### 1. Create a MySQL database

In cPanel → MySQL Databases:
- Create a database (e.g., `youruser_sensors`)
- Create a user with a strong password
- Assign the user to the database with ALL PRIVILEGES

### 2. Upload dashboard files

Upload the entire `dashboard/` folder to your cPanel account, for example to `public_html/dashboard/`.

### 3. Configure

Edit `dashboard/config.php`:
```php
define('DB_HOST', 'localhost');
define('DB_NAME', 'youruser_sensors');
define('DB_USER', 'youruser_dbuser');
define('DB_PASS', 'your_db_password');
define('API_KEY', 'your-secret-api-key');  // Must match sensor configs
define('RETENTION_DAYS', 90);
define('APP_TIMEZONE', 'America/New_York');
define('OFFLINE_MINUTES', 15);

// Optional – Slack offline alerts. Leave SLACK_API_TOKEN blank to disable.
define('SLACK_API_TOKEN', '');           // xoxb- bot token (same one used by sensors)
define('SLACK_CHANNEL', '');             // e.g. alerts
define('OFFLINE_ALERT_MINUTES', 60);
```

### 3a. (Optional) Slack offline alerts

The dashboard can post to Slack when a sensor has not reported for more than
`OFFLINE_ALERT_MINUTES` (default 60). It uses the same `chat.postMessage`
endpoint the Pi scripts use, so if you point it at the existing bot token and
channel, offline alerts land in the same place as temperature alerts.

- Fill in `SLACK_API_TOKEN` and `SLACK_CHANNEL` in `config.php`.
- The checks piggyback on existing sensor traffic and dashboard refreshes, so
  no cron is required. If you prefer an explicit cron, hit
  `api/check_offline.php` with the `X-API-Key` header.
- Leaving `SLACK_API_TOKEN` blank disables the feature entirely (drop-in safe).
- On upgrade, either re-run `install.php` (after removing `install.lock`) or
  let the helper add the `sensors.offline_alerted` column on its first run.

### 4. Install database tables

Visit `https://yourdomain.com/dashboard/install.php` once in your browser. This creates the required MySQL tables and writes a lock file so it cannot be re-run accidentally.

### 5. Access the dashboard

Visit `https://yourdomain.com/dashboard/` to see the live dashboard.

## Dashboard Features

- **Sensor cards**: Current temperature, humidity, and CO2 for each sensor with online/offline status
- **Temperature chart**: Line chart of all sensors over time (Chart.js)
- **Humidity chart**: Line chart of all sensors over time
- **CO2 chart**: Shown automatically when SCD40 sensors are present
- **Time ranges**: 1H, 6H, 24H, 7D, 30D with automatic downsampling for large ranges
- **Auto-refresh**: Dashboard updates every 60 seconds
- **Data retention**: Automatically purges readings older than the configured retention period
- **Dark theme**: Professional monitoring interface, responsive on mobile

## API Reference

### POST `/api/submit.php`

Ingest a sensor reading.

**Headers**: `X-API-Key: <your-key>`, `Content-Type: application/json`

```json
{
    "sensor_id": "kitchen",
    "sensor_type": "bme280",
    "temperature_f": 72.5,
    "temperature_c": 22.5,
    "humidity": 45.2,
    "co2": null
}
```

### GET `/api/sensors.php`

Returns all sensors with their latest reading and online status.

### GET `/api/readings.php`

Returns time-series data for charts.

| Parameter   | Default | Description |
|-------------|---------|-------------|
| `sensor_id` | `all`   | Comma-separated IDs or `all` |
| `range`     | `24h`   | `1h`, `6h`, `24h`, `7d`, `30d` |
| `start`     | —       | Custom start (ISO date) |
| `end`       | —       | Custom end (ISO date) |

## File Structure

```
SingleBME280/
├── SingleBME280.py              # Pi Zero sensor script
├── SingleSensorSettings.conf    # Pi Zero config
├── singlebme280.service         # systemd unit for auto-start on boot
├── install.sh                   # One-command installer for the systemd service
├── templates/
│   └── settings.html            # Pi Zero web settings UI (Flask template)
├── readme.md
└── dashboard/                   # Self-hosted on cPanel
    ├── index.php                # Dashboard UI
    ├── config.php               # Server configuration
    ├── install.php              # One-time DB setup
    ├── .htaccess                # Security rules
    ├── api/
    │   ├── submit.php           # Data ingestion endpoint
    │   ├── readings.php         # Chart data endpoint
    │   └── sensors.php          # Sensor listing endpoint
    ├── includes/
    │   └── db.php               # Database connection
    └── assets/
        ├── css/
        │   └── style.css
        └── js/
            └── dashboard.js     # Chart.js frontend logic
```

## Security Notes

- The API key is a shared secret between all sensors and the dashboard. Use a long random string.
- The `.htaccess` file blocks direct access to `config.php`, `includes/`, and lock files.
- Sensor settings (including Slack tokens) are stored in plaintext on each Pi. Secure physical access to your Pis.
- The Pi settings web interface has no authentication. It is only accessible on your local network.
