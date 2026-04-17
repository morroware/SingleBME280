<?php
/**
 * POST /api/update_sensor.php
 *
 * Updates editable fields for a sensor (ip_address, location_name).
 * Requires API key or dashboard session authentication.
 *
 * Expected JSON body (all fields optional except sensor_id):
 * {
 *   "sensor_id":     "kitchen",
 *   "ip_address":    "192.168.1.42",   // or "" to clear
 *   "location_name": "Kitchen Sensor"  // display label
 * }
 */

header('Content-Type: application/json');

require_once __DIR__ . '/../includes/db.php';
require_once __DIR__ . '/../includes/auth.php';

// --- Auth: accept either a logged-in dashboard session or a valid X-API-Key ---
auth_require_api();

// --- Method check ---
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['status' => 'error', 'message' => 'POST required']);
    exit;
}

// --- Parse body ---
$raw = file_get_contents('php://input');
$data = json_decode($raw, true);

if (!is_array($data) || empty($data['sensor_id'])) {
    http_response_code(400);
    echo json_encode(['status' => 'error', 'message' => 'sensor_id is required']);
    exit;
}

$sensorId = trim($data['sensor_id']);

// --- Build update ---
date_default_timezone_set(APP_TIMEZONE);

try {
    $db = get_db();

    // Require the sensor to exist before building any UPDATE.
    $check = $db->prepare("SELECT 1 FROM sensors WHERE sensor_id = :sid");
    $check->execute([':sid' => $sensorId]);
    if (!$check->fetch()) {
        http_response_code(404);
        echo json_encode(['status' => 'error', 'message' => 'Sensor not found']);
        exit;
    }

    $sets = [];
    $params = [':sid' => $sensorId];

    // ip_address (optional; "" clears it)
    if (array_key_exists('ip_address', $data)) {
        $ip = trim((string)$data['ip_address']);
        if ($ip === '') {
            $sets[] = 'ip_address = NULL';
        } elseif (filter_var($ip, FILTER_VALIDATE_IP)) {
            $sets[] = 'ip_address = :ip';
            $params[':ip'] = substr($ip, 0, 45);
        } else {
            http_response_code(400);
            echo json_encode(['status' => 'error', 'message' => 'Invalid IP address']);
            exit;
        }
    }

    // location_name (optional; "" resets to sensor_id)
    if (array_key_exists('location_name', $data)) {
        $loc = trim((string)$data['location_name']);
        if ($loc === '') {
            $loc = $sensorId;
        }
        $sets[] = 'location_name = :loc';
        $params[':loc'] = substr($loc, 0, 255);
    }

    if (!$sets) {
        // Nothing to update – treat as success rather than 400 so the UI can
        // call this idempotently.
        echo json_encode(['status' => 'ok']);
        exit;
    }

    $sql = 'UPDATE sensors SET ' . implode(', ', $sets) . ' WHERE sensor_id = :sid';
    $stmt = $db->prepare($sql);
    $stmt->execute($params);

    echo json_encode(['status' => 'ok']);

} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['status' => 'error', 'message' => 'Database error']);
    error_log('update_sensor.php DB error: ' . $e->getMessage());
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['status' => 'error', 'message' => 'Server error']);
    error_log('update_sensor.php error: ' . $e->getMessage());
}
