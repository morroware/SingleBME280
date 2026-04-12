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

// --- Data retention (days) – readings older than this are auto-purged ---
define('RETENTION_DAYS', 90);

// --- Timezone ---
define('APP_TIMEZONE', 'America/New_York');

// --- Sensor offline threshold (minutes with no data = offline) ---
define('OFFLINE_MINUTES', 15);
