<?php
/**
 * One-time database installer for the Sensor Dashboard.
 *
 * Access this file in a browser once to create the required MySQL tables.
 * After successful installation a lock file is written so it cannot run again
 * accidentally. Delete install.lock to re-run if needed.
 */

require_once __DIR__ . '/config.php';

$lockFile = __DIR__ . '/install.lock';

// Prevent re-running
if (file_exists($lockFile)) {
    http_response_code(403);
    echo "<h2>Installation already completed.</h2>";
    echo "<p>Delete <code>install.lock</code> on the server to re-run.</p>";
    exit;
}

date_default_timezone_set(APP_TIMEZONE);

$errors = [];
$success = [];

try {
    $dsn = 'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4';
    $pdo = new PDO($dsn, DB_USER, DB_PASS, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    ]);

    // --- sensors table ---
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS sensors (
            id            INT AUTO_INCREMENT PRIMARY KEY,
            sensor_id     VARCHAR(100) NOT NULL UNIQUE,
            sensor_type   VARCHAR(20)  NOT NULL DEFAULT 'bme280',
            location_name VARCHAR(255) NOT NULL DEFAULT '',
            last_seen     DATETIME     NULL,
            created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
    $success[] = 'Created table: sensors';

    // --- readings table ---
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS readings (
            id            BIGINT AUTO_INCREMENT PRIMARY KEY,
            sensor_id     VARCHAR(100)  NOT NULL,
            temperature_f DECIMAL(7,2)  NULL,
            temperature_c DECIMAL(7,2)  NULL,
            humidity      DECIMAL(6,2)  NULL,
            co2           INT           NULL,
            recorded_at   DATETIME      NOT NULL,
            created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_sensor_time (sensor_id, recorded_at),
            INDEX idx_recorded_at (recorded_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
    $success[] = 'Created table: readings';

    // Write lock file
    file_put_contents($lockFile, date('Y-m-d H:i:s') . " - Install completed\n");
    $success[] = 'Lock file written – install will not run again.';

} catch (PDOException $e) {
    $errors[] = 'Database error: ' . $e->getMessage();
} catch (Exception $e) {
    $errors[] = 'Error: ' . $e->getMessage();
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Sensor Dashboard - Install</title>
    <style>
        body { font-family: sans-serif; max-width: 600px; margin: 40px auto; padding: 0 20px; }
        .ok  { color: #2e7d32; }
        .err { color: #c62828; }
        code { background: #f5f5f5; padding: 2px 6px; border-radius: 3px; }
    </style>
</head>
<body>
    <h1>Sensor Dashboard Installer</h1>

    <?php if ($errors): ?>
        <h2 class="err">Errors</h2>
        <ul>
        <?php foreach ($errors as $e): ?>
            <li class="err"><?= htmlspecialchars($e) ?></li>
        <?php endforeach; ?>
        </ul>
        <p>Fix the issues above (check <code>config.php</code>) and reload this page.</p>
    <?php endif; ?>

    <?php if ($success): ?>
        <h2 class="ok">Success</h2>
        <ul>
        <?php foreach ($success as $s): ?>
            <li class="ok"><?= htmlspecialchars($s) ?></li>
        <?php endforeach; ?>
        </ul>
        <p><a href="index.php">Go to Dashboard</a></p>
    <?php endif; ?>
</body>
</html>
