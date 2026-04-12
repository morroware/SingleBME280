<?php
/**
 * POST /api/submit.php
 *
 * Receives sensor readings from Pi Zero devices.
 *
 * Expected headers:
 *   X-API-Key: <shared secret>
 *   Content-Type: application/json
 *
 * Expected JSON body:
 * {
 *   "sensor_id":     "kitchen",
 *   "sensor_type":   "bme280",        // bme280 | scd40
 *   "temperature_f": 72.5,
 *   "temperature_c": 22.5,
 *   "humidity":      45.2,            // nullable
 *   "co2":           null             // nullable – only SCD40
 * }
 *
 * Response: {"status":"ok"} or {"status":"error","message":"..."}
 */

header('Content-Type: application/json');

require_once __DIR__ . '/../includes/db.php';

// --- Auth ---
$apiKey = $_SERVER['HTTP_X_API_KEY'] ?? '';
if ($apiKey !== API_KEY) {
    http_response_code(401);
    echo json_encode(['status' => 'error', 'message' => 'Invalid API key']);
    exit;
}

// --- Method check ---
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['status' => 'error', 'message' => 'POST required']);
    exit;
}

// --- Parse body ---
$raw = file_get_contents('php://input');
$data = json_decode($raw, true);

if (!$data || empty($data['sensor_id'])) {
    http_response_code(400);
    echo json_encode(['status' => 'error', 'message' => 'Missing or invalid JSON body']);
    exit;
}

$sensorId     = substr(trim($data['sensor_id']), 0, 100);
$sensorType   = in_array($data['sensor_type'] ?? '', ['bme280', 'scd40']) ? $data['sensor_type'] : 'bme280';
$temperatureF = isset($data['temperature_f']) ? (float)$data['temperature_f'] : null;
$temperatureC = isset($data['temperature_c']) ? (float)$data['temperature_c'] : null;
$humidity     = isset($data['humidity'])      ? (float)$data['humidity']      : null;
$co2          = isset($data['co2'])           ? (int)$data['co2']            : null;

// Basic range validation
if ($temperatureF !== null && ($temperatureF < -60 || $temperatureF > 200)) {
    http_response_code(400);
    echo json_encode(['status' => 'error', 'message' => 'Temperature out of range']);
    exit;
}

date_default_timezone_set(APP_TIMEZONE);

try {
    $db = get_db();
    $now = date('Y-m-d H:i:s');

    // Upsert sensor record
    $stmt = $db->prepare("
        INSERT INTO sensors (sensor_id, sensor_type, location_name, last_seen)
        VALUES (:sid, :type, :loc, :seen)
        ON DUPLICATE KEY UPDATE
            sensor_type   = VALUES(sensor_type),
            location_name = VALUES(location_name),
            last_seen     = VALUES(last_seen)
    ");
    $stmt->execute([
        ':sid'  => $sensorId,
        ':type' => $sensorType,
        ':loc'  => $sensorId,
        ':seen' => $now,
    ]);

    // Insert reading
    $stmt = $db->prepare("
        INSERT INTO readings (sensor_id, temperature_f, temperature_c, humidity, co2, recorded_at)
        VALUES (:sid, :tf, :tc, :hum, :co2, :at)
    ");
    $stmt->execute([
        ':sid' => $sensorId,
        ':tf'  => $temperatureF,
        ':tc'  => $temperatureC,
        ':hum' => $humidity,
        ':co2' => $co2,
        ':at'  => $now,
    ]);

    // Probabilistic cleanup of old data
    maybe_cleanup();

    echo json_encode(['status' => 'ok']);

} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['status' => 'error', 'message' => 'Database error']);
    error_log('submit.php DB error: ' . $e->getMessage());
}
