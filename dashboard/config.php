<?php
/**
 * Dashboard Configuration
 *
 * Copy this file and update the values for your cPanel hosting environment.
 * The API_KEY here must match the dashboard_api_key in each sensor's
 * SingleSensorSettings.conf file.
 */

// --- Database (MySQL on cPanel) ---
define('DB_HOST', 'localhost');
define('DB_NAME', 'your_db_name');       // e.g. cpaneluser_sensors
define('DB_USER', 'your_db_user');       // e.g. cpaneluser_dbuser
define('DB_PASS', 'your_db_password');

// --- API authentication ---
define('API_KEY', 'change-me-to-a-secure-random-key');

// --- Dashboard password protection ---
// bcrypt hash of the dashboard password. Generate a new hash with:
//   php -r 'echo password_hash("your-password", PASSWORD_DEFAULT), "\n";'
// Default hash below corresponds to password: 109Brookside01!
define('DASHBOARD_PASSWORD_HASH', '$2y$12$AtxQ9ovY5g4E.oTboGvaE.eRHoYNadUnoP/R9qAcX.Ed6Mc9uJcRu');

// Session lifetime in seconds (default: 7 days)
define('SESSION_LIFETIME', 7 * 24 * 60 * 60);

// --- Data retention (days) – readings older than this are auto-purged ---
define('RETENTION_DAYS', 90);

// --- Timezone ---
define('APP_TIMEZONE', 'America/New_York');

// --- Sensor offline threshold (minutes with no data = offline) ---
define('OFFLINE_MINUTES', 15);

// --- Slack offline alerts (optional) ---
// When a sensor has not reported for more than OFFLINE_ALERT_MINUTES,
// the dashboard will post a message to the configured Slack channel.
// Leave SLACK_API_TOKEN blank to disable this feature entirely.
// Use the same bot token and channel as the per-sensor alerts so
// offline notifications land in the same place as temp alerts.
define('SLACK_API_TOKEN', '');               // e.g. xoxb-xxxxx (blank = disabled)
define('SLACK_CHANNEL', '');                 // e.g. alerts
define('OFFLINE_ALERT_MINUTES', 60);         // minutes offline before alert
