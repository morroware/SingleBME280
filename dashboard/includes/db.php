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
