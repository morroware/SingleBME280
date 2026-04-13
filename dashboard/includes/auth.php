<?php
/**
 * Authentication helper for the Sensor Dashboard.
 *
 * Provides session-based password protection for the dashboard UI and its
 * browser-facing API endpoints. External sensors continue to use the
 * X-API-Key header auth for submit.php.
 */

require_once __DIR__ . '/../config.php';

/**
 * Start (or resume) the session with secure cookie settings.
 * Safe to call multiple times.
 */
function auth_start_session(): void {
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }

    $lifetime = defined('SESSION_LIFETIME') ? (int)SESSION_LIFETIME : 0;
    $secure   = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
              || (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https');

    // Configure session cookie BEFORE starting the session
    session_set_cookie_params([
        'lifetime' => $lifetime,
        'path'     => '/',
        'secure'   => $secure,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);

    session_name('sensor_dashboard_session');
    session_start();

    // Enforce absolute session lifetime (regardless of activity)
    if ($lifetime > 0 && isset($_SESSION['auth_login_time'])) {
        if (time() - (int)$_SESSION['auth_login_time'] > $lifetime) {
            auth_logout();
            auth_start_session();
        }
    }
}

/**
 * Returns true if the current session is authenticated.
 */
function auth_is_logged_in(): bool {
    auth_start_session();
    return !empty($_SESSION['auth_authenticated']) && $_SESSION['auth_authenticated'] === true;
}

/**
 * Verifies a password against the configured hash.
 */
function auth_verify_password(string $password): bool {
    if (!defined('DASHBOARD_PASSWORD_HASH') || DASHBOARD_PASSWORD_HASH === '') {
        return false;
    }
    return password_verify($password, DASHBOARD_PASSWORD_HASH);
}

/**
 * Marks the current session as authenticated.
 * Regenerates the session ID to prevent fixation attacks.
 */
function auth_login(): void {
    auth_start_session();
    session_regenerate_id(true);
    $_SESSION['auth_authenticated'] = true;
    $_SESSION['auth_login_time']    = time();
}

/**
 * Destroys the current session (logout).
 */
function auth_logout(): void {
    if (session_status() !== PHP_SESSION_ACTIVE) {
        auth_start_session();
    }
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(
            session_name(),
            '',
            time() - 42000,
            $params['path'],
            $params['domain'] ?? '',
            $params['secure'],
            $params['httponly']
        );
    }
    session_destroy();
}

/**
 * Require an authenticated session for page access.
 * Redirects to login.php if not logged in.
 *
 * @param string $loginPath Relative path to login.php from the calling file
 */
function auth_require_login(string $loginPath = 'login.php'): void {
    if (auth_is_logged_in()) {
        return;
    }
    // Preserve the original request for post-login redirect
    $redirect = isset($_SERVER['REQUEST_URI']) ? $_SERVER['REQUEST_URI'] : '';
    $qs = $redirect !== '' ? ('?redirect=' . urlencode($redirect)) : '';
    header('Location: ' . $loginPath . $qs);
    exit;
}

/**
 * Require authentication for JSON API endpoints.
 *
 * Accepts EITHER a valid session OR a valid X-API-Key header. This keeps
 * external callers (sensors) and browser callers (dashboard JS) both working.
 * Responds with 401 JSON and exits on failure.
 */
function auth_require_api(): void {
    // API-key header path (external sensors, and frontend calls that supply it)
    $apiKey = isset($_SERVER['HTTP_X_API_KEY']) ? $_SERVER['HTTP_X_API_KEY'] : '';
    if ($apiKey !== '' && defined('API_KEY') && hash_equals(API_KEY, $apiKey)) {
        return;
    }

    // Session-based path (dashboard logged-in user)
    if (auth_is_logged_in()) {
        return;
    }

    http_response_code(401);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Authentication required']);
    exit;
}
