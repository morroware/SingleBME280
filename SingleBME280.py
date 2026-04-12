#!/usr/bin/env python3
"""
SingleSensor - Temperature/Humidity/CO2 monitoring for Raspberry Pi Zero.
Supports BME280 (temp + humidity) and SCD40 (temp + humidity + CO2) sensors.
Posts readings to a self-hosted PHP dashboard and sends Slack alerts.
"""

from flask import Flask, request, render_template, redirect, jsonify
import time
import configparser
from threading import Thread, Event
import os
import socket
import sys
import logging
import traceback
import signal
import json
from logging.handlers import RotatingFileHandler

# Pin working directory to the script's own folder so relative paths work
# regardless of how the process is launched (cron, systemd, etc.)
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
os.chdir(_SCRIPT_DIR)

# Conditional imports for sensors - only loaded when needed
smbus2 = None
bme280 = None
board = None
adafruit_scd4x = None

# ---------------------------------------------------------------------------
# Flask app
# ---------------------------------------------------------------------------
app = Flask(__name__)

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
handler = RotatingFileHandler('app.log', maxBytes=5 * 1024 * 1024, backupCount=3)
handler.setLevel(logging.DEBUG)
formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
handler.setFormatter(formatter)

logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)
logger.addHandler(handler)
logger.addHandler(logging.StreamHandler())

LOG_FILE = "sensor_readings.log"
ERROR_LOG_FILE = "error_log.log"

# Rotating file handlers for the two data/error logs so they don't fill the SD card.
# 2 MB each, 2 backups = max ~6 MB per log.
_readings_handler = RotatingFileHandler(LOG_FILE, maxBytes=2 * 1024 * 1024, backupCount=2)
_readings_handler.setFormatter(logging.Formatter('%(message)s'))
_readings_logger = logging.getLogger('readings')
_readings_logger.setLevel(logging.INFO)
_readings_logger.addHandler(_readings_handler)

_error_handler = RotatingFileHandler(ERROR_LOG_FILE, maxBytes=2 * 1024 * 1024, backupCount=2)
_error_handler.setFormatter(logging.Formatter('%(message)s'))
_error_logger = logging.getLogger('errors')
_error_logger.setLevel(logging.ERROR)
_error_logger.addHandler(_error_handler)

# ---------------------------------------------------------------------------
# Global state
# ---------------------------------------------------------------------------
shutdown_event = Event()
monitoring_error = None  # Set by monitoring thread if init fails

alert_states = {
    'high_temp': False,
    'low_temp': False,
}
alert_counters = {
    'high_temp': 0,
    'low_temp': 0,
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def log_error(message):
    """Log error messages to rotating error log and console."""
    timestamp = time.strftime('%Y-%m-%d %H:%M:%S')
    _error_logger.error(f"{timestamp} - ERROR: {message}")
    logger.error(message)


def celsius_to_fahrenheit(celsius):
    return (celsius * 9 / 5) + 32


def get_local_ip():
    """Return this device's LAN IP (e.g. 192.168.x.x) without sending traffic."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return None


def find_available_port(start_port=5000, max_attempts=100):
    for port in range(start_port, start_port + max_attempts):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(('', port))
                return port
        except OSError:
            continue
    raise RuntimeError("No available ports found")


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
CONF_FILE = 'SingleSensorSettings.conf'

# Keys required regardless of sensor type
_REQUIRED_KEYS = [
    'SENSOR_LOCATION_NAME', 'SENSOR_TYPE', 'MINUTES_BETWEEN_READS',
    'SENSOR_THRESHOLD_TEMP', 'SENSOR_LOWER_THRESHOLD_TEMP',
    'THRESHOLD_COUNT', 'SLACK_API_TOKEN', 'SLACK_CHANNEL',
    'DASHBOARD_URL', 'DASHBOARD_API_KEY',
]

_FLOAT_KEYS = {'SENSOR_THRESHOLD_TEMP', 'SENSOR_LOWER_THRESHOLD_TEMP'}
_INT_KEYS = {'MINUTES_BETWEEN_READS', 'THRESHOLD_COUNT'}


def read_settings_from_conf(conf_file):
    """Read and validate settings from configuration file."""
    config = configparser.ConfigParser()
    config.read(conf_file)
    settings = {}

    try:
        for key in _REQUIRED_KEYS:
            if key in _FLOAT_KEYS:
                settings[key] = config.getfloat('General', key)
            elif key in _INT_KEYS:
                settings[key] = config.getint('General', key)
            else:
                settings[key] = config.get('General', key)
    except configparser.NoOptionError as e:
        log_error(f"Missing {key} in configuration file.")
        raise ValueError(f"Missing {key} in configuration file.") from e
    except Exception as e:
        log_error(f"Error reading configuration: {e}")
        raise ValueError(f"Error reading configuration: {e}") from e

    # Optional key: BME280 address (hex string like '0x76')
    try:
        settings['BME280_ADDRESS'] = config.get('General', 'BME280_ADDRESS')
    except configparser.NoOptionError:
        settings['BME280_ADDRESS'] = '0x76'

    # Validate critical values
    if settings['MINUTES_BETWEEN_READS'] < 1:
        settings['MINUTES_BETWEEN_READS'] = 1
        logger.warning("MINUTES_BETWEEN_READS was < 1, clamped to 1.")

    if not settings['SENSOR_LOCATION_NAME'].strip():
        raise ValueError("SENSOR_LOCATION_NAME must not be empty.")

    return settings


# ---------------------------------------------------------------------------
# Slack alerts
# ---------------------------------------------------------------------------
def send_slack_alert(message, settings):
    """Send alert to Slack channel. Fails silently on import/network errors."""
    try:
        from slack_sdk import WebClient

        token = settings['SLACK_API_TOKEN']
        channel = settings['SLACK_CHANNEL']

        # Skip if placeholder values
        if not token or token.startswith('xoxb-slack'):
            logger.debug("Slack token is placeholder, skipping alert.")
            return False

        client = WebClient(token=token)
        client.chat_postMessage(channel=channel, text=message)
        logger.info(f"Slack alert sent: {message}")
        return True
    except Exception as e:
        log_error(f"Failed to send Slack alert: {e}")
        return False


# ---------------------------------------------------------------------------
# Dashboard API submission (replaces Adafruit IO)
# ---------------------------------------------------------------------------
def send_to_dashboard(settings, temperature_f, temperature_c, humidity, co2=None,
                      detected_type='bme280'):
    """POST sensor reading to the self-hosted dashboard API.

    Uses urllib from stdlib so we don't require the 'requests' package.
    Retries up to 3 times with back-off on failure.
    """
    import urllib.request
    import urllib.error

    url = settings['DASHBOARD_URL']
    api_key = settings['DASHBOARD_API_KEY']

    if not url or url == 'https://yourdomain.com/dashboard/api/submit.php':
        logger.debug("Dashboard URL is placeholder, skipping submission.")
        return False

    payload = {
        'sensor_id': settings['SENSOR_LOCATION_NAME'],
        'sensor_type': detected_type,
        'temperature_f': round(temperature_f, 2),
        'temperature_c': round(temperature_c, 2),
        'humidity': round(humidity, 2) if humidity is not None else None,
        'co2': int(co2) if co2 is not None else None,
        'local_ip': get_local_ip(),
    }

    data = json.dumps(payload).encode('utf-8')
    headers = {
        'Content-Type': 'application/json',
        'X-API-Key': api_key,
    }

    max_retries = 3
    for attempt in range(max_retries):
        try:
            req = urllib.request.Request(url, data=data, headers=headers, method='POST')
            with urllib.request.urlopen(req, timeout=15) as resp:
                body = resp.read().decode('utf-8')
                logger.debug(f"Dashboard response: {body}")
                return True
        except urllib.error.HTTPError as e:
            log_error(f"Dashboard HTTP {e.code} on attempt {attempt + 1}: {e.reason}")
        except Exception as e:
            log_error(f"Dashboard send error on attempt {attempt + 1}: {e}")

        if attempt < max_retries - 1:
            time.sleep(2 * (attempt + 1))

    return False


# ---------------------------------------------------------------------------
# Sensor initialisation & reading
# ---------------------------------------------------------------------------
def _init_bme280(address_str='0x76'):
    """Initialise BME280 sensor. Returns (bus, address, calibration_params)."""
    global smbus2, bme280
    import smbus2 as _smbus2
    import bme280 as _bme280
    smbus2 = _smbus2
    bme280 = _bme280

    address = int(address_str, 16)
    bus = smbus2.SMBus(1)

    # Try the configured address first, then the alternate
    for addr in [address, 0x77 if address == 0x76 else 0x76]:
        try:
            cal = bme280.load_calibration_params(bus, addr)
            logger.info(f"BME280 initialised at address {hex(addr)}")
            return bus, addr, cal
        except Exception:
            continue

    raise RuntimeError("BME280 not found at 0x76 or 0x77")


def _init_scd40():
    """Initialise SCD40 sensor. Returns the scd4x object."""
    global board, adafruit_scd4x
    import board as _board
    import adafruit_scd4x as _scd4x
    board = _board
    adafruit_scd4x = _scd4x

    i2c = board.I2C()
    scd = adafruit_scd4x.SCD4X(i2c)
    scd.start_periodic_measurement()
    logger.info("SCD40 initialised and periodic measurement started")
    # Give the sensor time to produce its first reading
    time.sleep(6)
    return scd


def init_sensor(sensor_type, bme280_address='0x76'):
    """Detect and initialise the configured sensor.

    sensor_type: 'auto', 'bme280', or 'scd40'
    Returns: ('bme280', bus, address, cal) or ('scd40', scd_obj)
    """
    if sensor_type in ('auto', 'bme280'):
        try:
            bus, addr, cal = _init_bme280(bme280_address)
            return ('bme280', bus, addr, cal)
        except Exception as e:
            if sensor_type == 'bme280':
                raise RuntimeError(f"BME280 init failed: {e}") from e
            logger.info(f"BME280 not found ({e}), trying SCD40...")

    if sensor_type in ('auto', 'scd40'):
        try:
            scd = _init_scd40()
            return ('scd40', scd)
        except Exception as e:
            if sensor_type == 'scd40':
                raise RuntimeError(f"SCD40 init failed: {e}") from e
            logger.info(f"SCD40 not found ({e})")

    raise RuntimeError("No supported sensor detected. Check wiring and I2C.")


def read_sensor(sensor_info):
    """Read current values from the initialised sensor.

    Returns dict with keys: temperature_c, temperature_f, humidity, co2 (or None).
    """
    sensor_type = sensor_info[0]

    if sensor_type == 'bme280':
        _, bus, addr, cal = sensor_info
        data = bme280.sample(bus, addr, cal)
        temp_c = data.temperature
        temp_f = celsius_to_fahrenheit(temp_c)
        humidity = data.humidity
        return {
            'temperature_c': temp_c,
            'temperature_f': temp_f,
            'humidity': humidity,
            'co2': None,
        }

    elif sensor_type == 'scd40':
        scd = sensor_info[1]
        # Wait for data to be ready (up to 10 seconds)
        deadline = time.time() + 10
        while not scd.data_ready:
            if time.time() > deadline:
                raise RuntimeError("SCD40 data not ready within timeout")
            time.sleep(0.5)

        temp_c = scd.temperature
        temp_f = celsius_to_fahrenheit(temp_c)
        humidity = scd.relative_humidity
        co2 = scd.CO2
        return {
            'temperature_c': temp_c,
            'temperature_f': temp_f,
            'humidity': humidity,
            'co2': co2,
        }

    raise RuntimeError(f"Unknown sensor type: {sensor_type}")


# ---------------------------------------------------------------------------
# Flask routes
# ---------------------------------------------------------------------------
@app.route('/')
def home():
    return redirect('/settings')


@app.route('/status')
def status_route():
    """Quick health check – shows whether monitoring is running."""
    if monitoring_error:
        return jsonify(status='error', message=monitoring_error), 503
    return jsonify(status='ok'), 200


@app.route('/settings', methods=['GET', 'POST'])
def settings_route():
    conf_file = CONF_FILE
    if request.method == 'POST':
        try:
            action = request.form.get('action')
            current_settings = read_settings_from_conf(conf_file)
            new_settings = {}

            for key, value in request.form.items():
                if key == 'action':
                    continue
                try:
                    if key in _FLOAT_KEYS:
                        new_settings[key] = float(value)
                    elif key in _INT_KEYS:
                        new_settings[key] = int(value)
                    else:
                        new_settings[key] = value.strip()
                except (ValueError, KeyError):
                    return jsonify(error=f'Invalid value for {key}'), 400

            config = configparser.ConfigParser()
            config['General'] = {str(k): str(v) for k, v in new_settings.items()}
            with open(conf_file, 'w') as f:
                config.write(f)

            if action == "reboot":
                return reboot_system()

            return jsonify(message='Settings updated successfully!'), 200
        except Exception as e:
            log_error(f"Settings update error: {e}")
            return jsonify(error=f'Error updating settings: {e}'), 500
    else:
        try:
            current_settings = read_settings_from_conf(conf_file)
            return render_template('settings.html', settings=current_settings)
        except Exception as e:
            log_error(f"Error loading settings: {e}")
            return jsonify(error=f'Error loading settings: {e}'), 500


def reboot_system():
    try:
        logger.info("System reboot requested")
        os.system('sudo shutdown -r now')
        return jsonify(message='System is rebooting...'), 200
    except Exception as e:
        log_error(f"Reboot failed: {e}")
        return jsonify(error='Failed to reboot system'), 500


# ---------------------------------------------------------------------------
# Main monitoring loop
# ---------------------------------------------------------------------------
def run_monitoring():
    global alert_states, alert_counters, monitoring_error

    # Read settings
    try:
        settings = read_settings_from_conf(CONF_FILE)
    except Exception as e:
        log_error(f"Failed to read settings: {e}")
        monitoring_error = str(e)
        return

    # Initialise sensor
    try:
        sensor_type_cfg = settings.get('SENSOR_TYPE', 'auto').lower().strip()
        bme_addr = settings.get('BME280_ADDRESS', '0x76')
        sensor_info = init_sensor(sensor_type_cfg, bme_addr)
        detected_type = sensor_info[0]
        logger.info(f"Sensor active: {detected_type}")
    except Exception as e:
        log_error(f"Failed to initialise sensor: {e}")
        monitoring_error = str(e)
        return

    minutes_between_reads = settings['MINUTES_BETWEEN_READS']
    last_read_time = 0

    while not shutdown_event.is_set():
        try:
            current_time = time.time()
            if current_time - last_read_time >= (minutes_between_reads * 60):
                # Re-read settings each cycle so live changes take effect
                try:
                    settings = read_settings_from_conf(CONF_FILE)
                    minutes_between_reads = settings['MINUTES_BETWEEN_READS']
                except Exception:
                    pass  # Use previous settings on read failure

                try:
                    reading = read_sensor(sensor_info)
                    temp_f = reading['temperature_f']
                    temp_c = reading['temperature_c']
                    humidity = reading['humidity']
                    co2 = reading['co2']

                    co2_str = f", CO2: {co2} ppm" if co2 is not None else ""
                    logger.info(
                        f"Read - Temp: {temp_f:.1f}F ({temp_c:.1f}C), "
                        f"Humidity: {humidity:.1f}%{co2_str}"
                    )

                    # --- High temperature alert ---
                    if temp_f >= settings['SENSOR_THRESHOLD_TEMP']:
                        alert_counters['high_temp'] += 1
                        if (alert_counters['high_temp'] >= settings['THRESHOLD_COUNT']
                                and not alert_states['high_temp']):
                            msg = (
                                f"High temp alert at {settings['SENSOR_LOCATION_NAME']}: "
                                f"{temp_f:.1f}F ({temp_c:.1f}C)"
                            )
                            send_slack_alert(msg, settings)
                            alert_states['high_temp'] = True
                    else:
                        alert_counters['high_temp'] = 0
                        if alert_states['high_temp']:
                            msg = (
                                f"Temp normal at {settings['SENSOR_LOCATION_NAME']}: "
                                f"{temp_f:.1f}F ({temp_c:.1f}C)"
                            )
                            send_slack_alert(msg, settings)
                            alert_states['high_temp'] = False

                    # --- Low temperature alert ---
                    if temp_f <= settings['SENSOR_LOWER_THRESHOLD_TEMP']:
                        alert_counters['low_temp'] += 1
                        if (alert_counters['low_temp'] >= settings['THRESHOLD_COUNT']
                                and not alert_states['low_temp']):
                            msg = (
                                f"Low temp alert at {settings['SENSOR_LOCATION_NAME']}: "
                                f"{temp_f:.1f}F ({temp_c:.1f}C)"
                            )
                            send_slack_alert(msg, settings)
                            alert_states['low_temp'] = True
                    else:
                        alert_counters['low_temp'] = 0
                        if alert_states['low_temp']:
                            msg = (
                                f"Temp normal at {settings['SENSOR_LOCATION_NAME']}: "
                                f"{temp_f:.1f}F ({temp_c:.1f}C)"
                            )
                            send_slack_alert(msg, settings)
                            alert_states['low_temp'] = False

                    # --- Log locally (rotating) ---
                    ts = time.strftime('%Y-%m-%d %H:%M:%S')
                    hum_str = f", Humidity: {humidity:.1f}%" if humidity is not None else ""
                    _readings_logger.info(
                        f"{ts} - {settings['SENSOR_LOCATION_NAME']} - "
                        f"Temp: {temp_f:.2f}F{hum_str}{co2_str}"
                    )

                    # --- Send to dashboard ---
                    send_to_dashboard(settings, temp_f, temp_c, humidity, co2,
                                      detected_type=detected_type)

                    last_read_time = current_time

                except Exception as e:
                    log_error(f"Error reading/sending data: {e}\n{traceback.format_exc()}")

            time.sleep(5)
        except Exception as e:
            log_error(f"Error in monitoring loop: {e}")
            time.sleep(5)


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------
def signal_handler(signum, frame):
    logger.info("Shutdown signal received. Cleaning up...")
    shutdown_event.set()
    # Raise SystemExit so Flask's serving loop actually stops.
    # Without this, Flask keeps running even though the event is set.
    raise SystemExit(0)


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)

    try:
        monitoring_thread = Thread(target=run_monitoring, daemon=True)
        monitoring_thread.start()

        port = find_available_port(5000)
        logger.info(f"Starting Flask on port {port}...")
        app.run(host='0.0.0.0', port=port, debug=False)
    except SystemExit:
        pass  # Expected from signal_handler
    except Exception as e:
        log_error(f"Error starting server: {e}")
    finally:
        shutdown_event.set()
        monitoring_thread.join(timeout=10)
        logger.info("Application shut down.")
