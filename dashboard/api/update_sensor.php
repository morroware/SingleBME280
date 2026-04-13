<?php
/**
 * POST /api/update_sensor.php
 *
 * Updates editable fields for a sensor (currently ip_address).
 * Requires API key authentication.
 *
 * Expected JSON body:
 * {
 *   "sensor_id":   "kitchen",
 *   "ip_address":  "192.168.1.42"   // or "" to clear
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

    // Validate ip_address if provided
    $ipAddress = null;
    if (array_key_exists('ip_address', $data)) {
        $ip = trim($data['ip_address']);
        if ($ip === '') {
            $ipAddress = null; // clear it
        } elseif (filter_var($ip, FILTER_VALIDATE_IP)) {
            $ipAddress = substr($ip, 0, 45);
        } else {
            http_response_code(400);
            echo json_encode(['status' => 'error', 'message' => 'Invalid IP address']);
            exit;
        }
    }

    $stmt = $db->prepare("UPDATE sensors SET ip_address = :ip WHERE sensor_id = :sid");
    $stmt->execute([':ip' => $ipAddress, ':sid' => $sensorId]);

    if ($stmt->rowCount() === 0) {
        // Check if sensor exists (rowCount=0 could mean no change or not found)
        $check = $db->prepare("SELECT 1 FROM sensors WHERE sensor_id = :sid");
        $check->execute([':sid' => $sensorId]);
        if (!$check->fetch()) {
            http_response_code(404);
            echo json_encode(['status' => 'error', 'message' => 'Sensor not found']);
            exit;
        }
    }

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
