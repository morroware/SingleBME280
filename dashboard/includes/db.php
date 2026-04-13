<?php
/**
 * Database connection helper.
 * Returns a singleton PDO instance configured for the dashboard MySQL database.
 */

require_once __DIR__ . '/../config.php';

function get_db(): PDO {
    static $pdo = null;

    if ($pdo === null) {
        $dsn = 'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4';
        $options = [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ];
        $pdo = new PDO($dsn, DB_USER, DB_PASS, $options);
    }

    return $pdo;
}

/**
 * Ensure the dashboard_layout table exists.
 *
 * Lazy migration for installs that predate the layout-persistence feature
 * (install.php is locked after first run, so we can't rely on it for
 * upgrades). Safe to call on every request — MySQL no-ops the CREATE IF
 * NOT EXISTS and a static flag guarantees it only runs once per process.
 */
function ensure_layout_table(): void {
    static $ensured = false;
    if ($ensured) return;
    try {
        $db = get_db();
        $db->exec("
            CREATE TABLE IF NOT EXISTS dashboard_layout (
                scope       VARCHAR(64) NOT NULL PRIMARY KEY,
                layout_json LONGTEXT    NOT NULL,
                updated_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP
                                        ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        ");
        $ensured = true;
    } catch (Exception $e) {
        // Don't repeatedly retry if the DB is misconfigured — surface via
        // the API's own error handling instead.
        $ensured = true;
        error_log('ensure_layout_table error: ' . $e->getMessage());
    }
}

/**
 * Probabilistic cleanup – runs roughly once every 100 calls.
 * Deletes readings older than RETENTION_DAYS.
 */
function maybe_cleanup(): void {
    if (mt_rand(1, 100) !== 1) {
        return;
    }
    try {
        $db = get_db();
        $stmt = $db->prepare("DELETE FROM readings WHERE recorded_at < DATE_SUB(NOW(), INTERVAL :days DAY)");
        $stmt->execute([':days' => (int)RETENTION_DAYS]);
    } catch (Exception $e) {
        // Silently ignore cleanup failures – they'll retry next time.
    }
}
