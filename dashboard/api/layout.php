<?php
/**
 * /api/layout.php
 *
 * GET  → returns the saved dashboard layout JSON (or an empty object if
 *        no layout has been saved yet).
 * POST → upserts the dashboard layout JSON sent in the body.
 * DELETE → clears the saved layout (used by the "Reset layout" button).
 *
 * The dashboard uses shared-password auth, so the layout is stored as a
 * single shared record keyed by scope='global'. This keeps customizations
 * (panel order, chart-type choices, collapsed/hidden state) in sync across
 * every browser, device and session that signs in.
 *
 * Body for POST (JSON):
 *   { "panels": { "<sensor_id>": { "collapsed": bool, "order": int,
 *                                  "feeds": { ... } }, ... } }
 *
 * Response: { "status": "ok", "layout": { ... } }
 */

header('Content-Type: application/json');
header('Cache-Control: no-store');

require_once __DIR__ . '/../includes/db.php';
require_once __DIR__ . '/../includes/auth.php';

auth_require_api();
ensure_layout_table();

// Cap request body size — a layout for even a very busy dashboard is a
// few kilobytes. Anything larger is almost certainly malformed/abuse.
const LAYOUT_MAX_BYTES = 65536;
const LAYOUT_SCOPE     = 'global';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

try {
    $db = get_db();

    if ($method === 'GET') {
        $stmt = $db->prepare("SELECT layout_json FROM dashboard_layout WHERE scope = :scope");
        $stmt->execute([':scope' => LAYOUT_SCOPE]);
        $row = $stmt->fetch();

        if (!$row) {
            echo json_encode(['status' => 'ok', 'layout' => new stdClass()]);
            exit;
        }

        $decoded = json_decode($row['layout_json'], true);
        if (!is_array($decoded)) $decoded = [];
        echo json_encode(['status' => 'ok', 'layout' => $decoded]);
        exit;
    }

    if ($method === 'DELETE') {
        $stmt = $db->prepare("DELETE FROM dashboard_layout WHERE scope = :scope");
        $stmt->execute([':scope' => LAYOUT_SCOPE]);
        echo json_encode(['status' => 'ok']);
        exit;
    }

    if ($method === 'POST') {
        $raw = file_get_contents('php://input');
        if ($raw === false) {
            http_response_code(400);
            echo json_encode(['status' => 'error', 'message' => 'Unable to read body']);
            exit;
        }
        if (strlen($raw) > LAYOUT_MAX_BYTES) {
            http_response_code(413);
            echo json_encode(['status' => 'error', 'message' => 'Layout payload too large']);
            exit;
        }

        $data = json_decode($raw, true);
        if (!is_array($data) || !isset($data['panels']) || !is_array($data['panels'])) {
            http_response_code(400);
            echo json_encode(['status' => 'error', 'message' => 'Invalid layout payload']);
            exit;
        }

        // Re-encode through the server to normalize whitespace and strip
        // anything that isn't plain JSON-serializable.
        $normalized = json_encode(['panels' => $data['panels']]);
        if ($normalized === false) {
            http_response_code(400);
            echo json_encode(['status' => 'error', 'message' => 'Unable to serialize layout']);
            exit;
        }

        $sql = "INSERT INTO dashboard_layout (scope, layout_json)
                VALUES (:scope, :json)
                ON DUPLICATE KEY UPDATE layout_json = VALUES(layout_json)";
        $stmt = $db->prepare($sql);
        $stmt->execute([
            ':scope' => LAYOUT_SCOPE,
            ':json'  => $normalized,
        ]);

        echo json_encode(['status' => 'ok']);
        exit;
    }

    http_response_code(405);
    header('Allow: GET, POST, DELETE');
    echo json_encode(['status' => 'error', 'message' => 'Method not allowed']);

} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['status' => 'error', 'message' => 'Database error']);
    error_log('layout.php DB error: ' . $e->getMessage());
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['status' => 'error', 'message' => 'Server error']);
    error_log('layout.php error: ' . $e->getMessage());
}
