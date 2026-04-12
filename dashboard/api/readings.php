<?php
/**
 * GET /api/readings.php
 *
 * Returns sensor readings as JSON for the Chart.js frontend.
 *
 * Query parameters:
 *   sensor_id  – comma-separated sensor IDs, or "all" (default: all)
 *   range      – "1h", "6h", "24h", "7d", "30d" (default: 24h)
 *   start      – ISO date for custom range (overrides range)
 *   end        – ISO date for custom range (overrides range)
 *
 * Large ranges are automatically downsampled to keep response sizes manageable.
 *
 * Response format:
 * {
 *   "sensors": {
 *     "kitchen": {
 *       "sensor_type": "bme280",
 *       "data": [
 *         {"time": "2024-01-15 14:30:00", "temperature_f": 72.5, "temperature_c": 22.5, "humidity": 45.2, "co2": null},
 *         ...
 *       ]
 *     }
 *   }
 * }
 */

header('Content-Type: application/json');
header('Cache-Control: no-cache');

require_once __DIR__ . '/../includes/db.php';

date_default_timezone_set(APP_TIMEZONE);

// --- Parse parameters ---
$sensorParam = $_GET['sensor_id'] ?? 'all';
$range       = $_GET['range'] ?? '24h';
$startParam  = $_GET['start'] ?? null;
$endParam    = $_GET['end'] ?? null;

// Determine time window
if ($startParam && $endParam) {
    $startTime = $startParam;
    $endTime   = $endParam;
} else {
    $endTime = date('Y-m-d H:i:s');
    switch ($range) {
        case '1h':  $startTime = date('Y-m-d H:i:s', strtotime('-1 hour'));  break;
        case '6h':  $startTime = date('Y-m-d H:i:s', strtotime('-6 hours')); break;
        case '7d':  $startTime = date('Y-m-d H:i:s', strtotime('-7 days'));  break;
        case '30d': $startTime = date('Y-m-d H:i:s', strtotime('-30 days')); break;
        case '24h':
        default:    $startTime = date('Y-m-d H:i:s', strtotime('-24 hours'));
    }
}

// Determine downsampling interval based on range span
$spanSeconds = strtotime($endTime) - strtotime($startTime);
if ($spanSeconds > 7 * 86400) {
    // > 7 days: average per 4 hours
    $groupInterval = 4 * 3600;
    $groupExpr = "FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(recorded_at) / 14400) * 14400)";
} elseif ($spanSeconds > 86400) {
    // > 1 day: average per hour
    $groupInterval = 3600;
    $groupExpr = "FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(recorded_at) / 3600) * 3600)";
} else {
    // Raw data
    $groupExpr = null;
}

try {
    $db = get_db();

    // Build sensor filter
    $sensorFilter = '';
    $params = [':start' => $startTime, ':end' => $endTime];

    if ($sensorParam !== 'all') {
        $ids = array_map('trim', explode(',', $sensorParam));
        $placeholders = [];
        foreach ($ids as $i => $id) {
            $key = ":sid{$i}";
            $placeholders[] = $key;
            $params[$key] = $id;
        }
        $sensorFilter = 'AND r.sensor_id IN (' . implode(',', $placeholders) . ')';
    }

    if ($groupExpr) {
        // Downsampled query
        $sql = "
            SELECT
                r.sensor_id,
                {$groupExpr}                            AS time,
                ROUND(AVG(r.temperature_f), 2)          AS temperature_f,
                ROUND(AVG(r.temperature_c), 2)          AS temperature_c,
                ROUND(AVG(r.humidity), 2)               AS humidity,
                ROUND(AVG(r.co2))                       AS co2
            FROM readings r
            WHERE r.recorded_at BETWEEN :start AND :end
            {$sensorFilter}
            GROUP BY r.sensor_id, {$groupExpr}
            ORDER BY r.sensor_id, time
        ";
    } else {
        // Raw query
        $sql = "
            SELECT
                r.sensor_id,
                r.recorded_at AS time,
                r.temperature_f,
                r.temperature_c,
                r.humidity,
                r.co2
            FROM readings r
            WHERE r.recorded_at BETWEEN :start AND :end
            {$sensorFilter}
            ORDER BY r.sensor_id, r.recorded_at
        ";
    }

    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll();

    // Fetch sensor types
    $typeStmt = $db->query("SELECT sensor_id, sensor_type FROM sensors");
    $types = [];
    foreach ($typeStmt->fetchAll() as $row) {
        $types[$row['sensor_id']] = $row['sensor_type'];
    }

    // Group by sensor
    $result = [];
    foreach ($rows as $row) {
        $sid = $row['sensor_id'];
        if (!isset($result[$sid])) {
            $result[$sid] = [
                'sensor_type' => $types[$sid] ?? 'unknown',
                'data' => [],
            ];
        }
        $result[$sid]['data'][] = [
            'time'          => $row['time'],
            'temperature_f' => $row['temperature_f'] !== null ? (float)$row['temperature_f'] : null,
            'temperature_c' => $row['temperature_c'] !== null ? (float)$row['temperature_c'] : null,
            'humidity'      => $row['humidity'] !== null ? (float)$row['humidity'] : null,
            'co2'           => $row['co2'] !== null ? (int)$row['co2'] : null,
        ];
    }

    echo json_encode(['sensors' => $result]);

} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Database error']);
    error_log('readings.php DB error: ' . $e->getMessage());
}
