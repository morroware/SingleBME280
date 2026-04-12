<?php
/**
 * DELETE /api/delete_sensor.php?sensor_id=xxx
 *
 * Removes a sensor and all its readings from the database.
 * Requires API key authentication.
 */

header('Content-Type: application/json');

require_once __DIR__ . '/../includes/db.php';

// --- Auth ---
$apiKey = isset($_SERVER['HTTP_X_API_KEY']) ? $_SERVER['HTTP_X_API_KEY'] : '';
if (!hash_equals(API_KEY, $apiKey)) {
    http_response_code(401);
    echo json_encode(['status' => 'error', 'message' => 'Invalid API key']);
    exit;
}

// --- Method check ---
if ($_SERVER['REQUEST_METHOD'] !== 'DELETE' && $_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['status' => 'error', 'message' => 'DELETE or POST required']);
    exit;
}

// --- Get sensor_id ---
$sensorId = '';
if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
    $sensorId = isset($_GET['sensor_id']) ? trim($_GET['sensor_id']) : '';
} else {
    $raw = file_get_contents('php://input');
    $data = json_decode($raw, true);
    $sensorId = isset($data['sensor_id']) ? trim($data['sensor_id']) : '';
}

if ($sensorId === '') {
    http_response_code(400);
    echo json_encode(['status' => 'error', 'message' => 'sensor_id is required']);
    exit;
}

date_default_timezone_set(APP_TIMEZONE);

try {
    $db = get_db();

    // Delete readings first (foreign key safety)
    $stmt = $db->prepare("DELETE FROM readings WHERE sensor_id = :sid");
    $stmt->execute([':sid' => $sensorId]);
    $deletedReadings = $stmt->rowCount();

    // Delete sensor record
    $stmt = $db->prepare("DELETE FROM sensors WHERE sensor_id = :sid");
    $stmt->execute([':sid' => $sensorId]);
    $deletedSensor = $stmt->rowCount();

    if ($deletedSensor === 0) {
        http_response_code(404);
        echo json_encode(['status' => 'error', 'message' => 'Sensor not found']);
        exit;
    }

    echo json_encode([
        'status' => 'ok',
        'deleted_readings' => $deletedReadings,
    ]);

} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['status' => 'error', 'message' => 'Database error']);
    error_log('delete_sensor.php DB error: ' . $e->getMessage());
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['status' => 'error', 'message' => 'Server error']);
    error_log('delete_sensor.php error: ' . $e->getMessage());
}
