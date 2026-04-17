<?php
/**
 * Slack offline-sensor alerts.
 *
 * Drop-in module: if SLACK_API_TOKEN or SLACK_CHANNEL is blank, every function
 * here is a no-op, so adding this file to an existing install has no effect
 * until the admin fills in the Slack config.
 *
 * Behaviour:
 *   - When a sensor's last_seen is older than OFFLINE_ALERT_MINUTES, post a
 *     single Slack message and flip sensors.offline_alerted = 1.
 *   - When that sensor sends a new reading (submit.php), offline_alerted is
 *     reset to 0 so it can alert again on its next outage.
 *
 * All DB / HTTP errors are swallowed so the caller (submit.php, sensors.php)
 * never breaks because of this module.
 */

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/db.php';

/**
 * True only when Slack alerting is fully configured.
 */
function offline_alerts_enabled(): bool {
    if (!defined('SLACK_API_TOKEN') || !defined('SLACK_CHANNEL')) {
        return false;
    }
    $token   = (string)SLACK_API_TOKEN;
    $channel = (string)SLACK_CHANNEL;
    if ($token === '' || $channel === '') {
        return false;
    }
    // Treat placeholder tokens as disabled (mirrors SingleSensor.py)
    if (strpos($token, 'xoxb-slack') === 0) {
        return false;
    }
    return true;
}

/**
 * Ensure the sensors.offline_alerted column exists. Safe to call repeatedly;
 * runs the ALTER at most once per PHP process.
 */
function offline_alerts_ensure_schema(PDO $db): bool {
    static $done = false;
    if ($done) {
        return true;
    }
    try {
        $db->exec("ALTER TABLE sensors ADD COLUMN offline_alerted TINYINT(1) NOT NULL DEFAULT 0");
    } catch (PDOException $e) {
        // Column already exists, or table doesn't exist yet. Both are fine;
        // the feature just won't trigger until install.php has been run.
    }
    $done = true;
    return true;
}

/**
 * Post a plain-text message to Slack via chat.postMessage.
 * Returns true on success, false on any failure.
 */
function offline_alerts_post_slack(string $text): bool {
    if (!offline_alerts_enabled()) {
        return false;
    }
    $token   = (string)SLACK_API_TOKEN;
    $channel = (string)SLACK_CHANNEL;

    $payload = json_encode(['channel' => $channel, 'text' => $text]);
    if ($payload === false) {
        return false;
    }

    // Prefer cURL when available; fall back to stream context.
    if (function_exists('curl_init')) {
        $ch = curl_init('https://slack.com/api/chat.postMessage');
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $payload,
            CURLOPT_HTTPHEADER     => [
                'Content-Type: application/json; charset=utf-8',
                'Authorization: Bearer ' . $token,
            ],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 10,
            CURLOPT_CONNECTTIMEOUT => 5,
        ]);
        $resp = curl_exec($ch);
        $err  = curl_error($ch);
        curl_close($ch);
        if ($resp === false) {
            error_log('offline_alerts Slack curl error: ' . $err);
            return false;
        }
        $decoded = json_decode($resp, true);
        if (!is_array($decoded) || empty($decoded['ok'])) {
            error_log('offline_alerts Slack API error: ' . $resp);
            return false;
        }
        return true;
    }

    // Stream fallback
    $ctx = stream_context_create([
        'http' => [
            'method'        => 'POST',
            'header'        => "Content-Type: application/json; charset=utf-8\r\n"
                             . 'Authorization: Bearer ' . $token . "\r\n",
            'content'       => $payload,
            'timeout'       => 10,
            'ignore_errors' => true,
        ],
    ]);
    $resp = @file_get_contents('https://slack.com/api/chat.postMessage', false, $ctx);
    if ($resp === false) {
        return false;
    }
    $decoded = json_decode($resp, true);
    return is_array($decoded) && !empty($decoded['ok']);
}

/**
 * Check all sensors; for each that has been offline longer than the configured
 * threshold and has not yet been alerted for this outage, post a Slack message
 * and flag it so we don't spam.
 *
 * @return int Number of alerts sent.
 */
function offline_alerts_check(): int {
    if (!offline_alerts_enabled()) {
        return 0;
    }

    $thresholdMin = defined('OFFLINE_ALERT_MINUTES') ? (int)OFFLINE_ALERT_MINUTES : 60;
    if ($thresholdMin < 1) {
        $thresholdMin = 60;
    }

    $sent = 0;
    try {
        $db = get_db();
        offline_alerts_ensure_schema($db);

        // Candidate sensors: offline past the threshold and not yet alerted.
        $stmt = $db->prepare("
            SELECT sensor_id, location_name, last_seen
            FROM sensors
            WHERE last_seen IS NOT NULL
              AND last_seen < DATE_SUB(NOW(), INTERVAL :mins MINUTE)
              AND (offline_alerted = 0 OR offline_alerted IS NULL)
        ");
        $stmt->execute([':mins' => $thresholdMin]);
        $rows = $stmt->fetchAll();

        if (!$rows) {
            return 0;
        }

        // Atomically claim the row BEFORE posting to Slack. If two PHP
        // workers race here, only one will see rowCount()==1 and post the
        // alert — the other's UPDATE is a no-op because the flag is already
        // set. Prevents duplicate Slack messages under concurrent traffic.
        $claim  = $db->prepare(
            "UPDATE sensors SET offline_alerted = 1
             WHERE sensor_id = :sid AND (offline_alerted = 0 OR offline_alerted IS NULL)"
        );
        $rollback = $db->prepare(
            "UPDATE sensors SET offline_alerted = 0 WHERE sensor_id = :sid"
        );

        foreach ($rows as $row) {
            $sid      = $row['sensor_id'];
            $label    = ($row['location_name'] !== null && $row['location_name'] !== '')
                        ? $row['location_name'] : $sid;
            $lastSeen = $row['last_seen'];

            try {
                $claim->execute([':sid' => $sid]);
            } catch (PDOException $e) {
                error_log('offline_alerts claim failed: ' . $e->getMessage());
                continue;
            }
            if ($claim->rowCount() === 0) {
                // Another worker beat us to it.
                continue;
            }

            $msg = sprintf(
                ":warning: Sensor *%s* offline for more than %d minutes (last seen %s).",
                $label,
                $thresholdMin,
                $lastSeen
            );

            if (offline_alerts_post_slack($msg)) {
                $sent++;
            } else {
                // Slack post failed — roll back the claim so we try again
                // on the next check instead of silently losing the alert.
                try {
                    $rollback->execute([':sid' => $sid]);
                } catch (PDOException $e) {
                    error_log('offline_alerts rollback failed: ' . $e->getMessage());
                }
            }
        }
    } catch (PDOException $e) {
        error_log('offline_alerts DB error: ' . $e->getMessage());
    } catch (Exception $e) {
        error_log('offline_alerts error: ' . $e->getMessage());
    }

    return $sent;
}

/**
 * Probabilistic wrapper – runs roughly once every N calls so that busy
 * endpoints (submit.php, sensors.php) only pay the cost occasionally.
 */
function maybe_offline_alerts_check(int $oneIn = 10): void {
    if (!offline_alerts_enabled()) {
        return;
    }
    if (mt_rand(1, max(1, $oneIn)) !== 1) {
        return;
    }
    try {
        offline_alerts_check();
    } catch (Exception $e) {
        // Never let this break the caller.
        error_log('maybe_offline_alerts_check error: ' . $e->getMessage());
    }
}

/**
 * Clear a sensor's offline_alerted flag. Called by submit.php when a sensor
 * reports a fresh reading, so it can alert again on its next outage.
 */
function offline_alerts_clear_flag(PDO $db, string $sensorId): void {
    if (!offline_alerts_enabled()) {
        return;
    }
    try {
        offline_alerts_ensure_schema($db);
        $stmt = $db->prepare("UPDATE sensors SET offline_alerted = 0 WHERE sensor_id = :sid AND offline_alerted = 1");
        $stmt->execute([':sid' => $sensorId]);
    } catch (PDOException $e) {
        // Non-fatal.
        error_log('offline_alerts_clear_flag error: ' . $e->getMessage());
    }
}
