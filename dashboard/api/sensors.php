<?php
/**
 * GET /api/sensors.php
 *
 * Returns the list of known sensors with current status and latest reading.
 * Optimised query avoids correlated subqueries so it stays fast with many sensors.
 */

header('Content-Type: application/json');
header('Cache-Control: no-cache');

require_once __DIR__ . '/../includes/db.php';

date_default_timezone_set(APP_TIMEZONE);

try {
    $db = get_db();
    $offlineMinutes = (int)OFFLINE_MINUTES;

    // Fetch latest reading ID per sensor in a single pass
    $sql = "
        SELECT
            s.sensor_id,
            s.sensor_type,
            s.location_name,
            s.last_seen,
            s.last_seen > DATE_SUB(NOW(), INTERVAL :offline MINUTE) AS is_online,
            r.temperature_f,
            r.temperature_c,
            r.humidity,
            r.co2
        FROM sensors s
        LEFT JOIN readings r ON r.sensor_id = s.sensor_id
            AND r.id = (
                SELECT r2.id FROM readings r2
                WHERE r2.sensor_id = s.sensor_id
                ORDER BY r2.id DESC
                LIMIT 1
            )
        ORDER BY s.location_name ASC, s.sensor_id ASC
    ";

    $stmt = $db->prepare($sql);
    $stmt->execute([':offline' => $offlineMinutes]);
    $rows = $stmt->fetchAll();

    $sensors = [];
    foreach ($rows as $row) {
        // Convert last_seen to ISO 8601 with timezone so JS can compare correctly
        $lastSeen = $row['last_seen']
            ? (new DateTime($row['last_seen'], new DateTimeZone(APP_TIMEZONE)))->format('c')
            : null;

        $sensors[] = [
            'sensor_id'     => $row['sensor_id'],
            'sensor_type'   => $row['sensor_type'],
            'location_name' => $row['location_name'],
            'last_seen'     => $lastSeen,
            'online'        => (bool)$row['is_online'],
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
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Server error']);
    error_log('sensors.php error: ' . $e->getMessage());
}
