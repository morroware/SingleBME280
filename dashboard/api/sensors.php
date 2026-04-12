<?php
/**
 * GET /api/sensors.php
 *
 * Returns the list of known sensors with current status.
 *
 * Response:
 * [
 *   {
 *     "sensor_id": "kitchen",
 *     "sensor_type": "bme280",
 *     "location_name": "Kitchen",
 *     "last_seen": "2024-01-15 14:30:00",
 *     "online": true,
 *     "latest": {
 *       "temperature_f": 72.5,
 *       "temperature_c": 22.5,
 *       "humidity": 45.2,
 *       "co2": null
 *     }
 *   }
 * ]
 */

header('Content-Type: application/json');
header('Cache-Control: no-cache');

require_once __DIR__ . '/../includes/db.php';

date_default_timezone_set(APP_TIMEZONE);

try {
    $db = get_db();
    $offlineMinutes = (int)OFFLINE_MINUTES;

    // Get all sensors with their latest reading
    $sql = "
        SELECT
            s.sensor_id,
            s.sensor_type,
            s.location_name,
            s.last_seen,
            s.last_seen > DATE_SUB(NOW(), INTERVAL {$offlineMinutes} MINUTE) AS online,
            r.temperature_f,
            r.temperature_c,
            r.humidity,
            r.co2
        FROM sensors s
        LEFT JOIN readings r ON r.sensor_id = s.sensor_id
            AND r.recorded_at = (
                SELECT MAX(r2.recorded_at)
                FROM readings r2
                WHERE r2.sensor_id = s.sensor_id
            )
        ORDER BY s.location_name
    ";

    $stmt = $db->query($sql);
    $rows = $stmt->fetchAll();

    $sensors = [];
    foreach ($rows as $row) {
        $sensors[] = [
            'sensor_id'     => $row['sensor_id'],
            'sensor_type'   => $row['sensor_type'],
            'location_name' => $row['location_name'],
            'last_seen'     => $row['last_seen'],
            'online'        => (bool)$row['online'],
            'latest' => [
                'temperature_f' => $row['temperature_f'] !== null ? (float)$row['temperature_f'] : null,
                'temperature_c' => $row['temperature_c'] !== null ? (float)$row['temperature_c'] : null,
                'humidity'      => $row['humidity'] !== null ? (float)$row['humidity'] : null,
                'co2'           => $row['co2'] !== null ? (int)$row['co2'] : null,
            ],
        ];
    }

    echo json_encode($sensors);

} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Database error']);
    error_log('sensors.php DB error: ' . $e->getMessage());
}
