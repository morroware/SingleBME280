<?php
/**
 * Login page for the Sensor Dashboard.
 */

require_once __DIR__ . '/includes/auth.php';

/**
 * Return $redirect only if it is a safe, same-origin path; otherwise
 * fall back to index.php. Blocks protocol-relative URLs (//evil.com),
 * absolute URLs (https://evil.com), and backslash/encoded-slash tricks.
 */
function safe_redirect(?string $redirect): string {
    if (!is_string($redirect) || $redirect === '') {
        return 'index.php';
    }
    // Reject protocol-relative and absolute URLs.
    if (str_starts_with($redirect, '//') || str_starts_with($redirect, '\\\\')) {
        return 'index.php';
    }
    // Reject any scheme (http:, javascript:, data:, etc.)
    if (preg_match('#^[a-z][a-z0-9+.-]*:#i', $redirect)) {
        return 'index.php';
    }
    // Only allow a conservative character set typical of relative URLs.
    if (!preg_match('#^/?[a-zA-Z0-9_./?=&%-]*$#', $redirect)) {
        return 'index.php';
    }
    return $redirect;
}

auth_start_session();

// If already logged in, go straight to the dashboard
if (auth_is_logged_in()) {
    $redirect = safe_redirect($_GET['redirect'] ?? null);
    header('Location: ' . $redirect);
    exit;
}

$error = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $password = isset($_POST['password']) ? (string)$_POST['password'] : '';
    if ($password === '') {
        $error = 'Password is required.';
    } elseif (auth_verify_password($password)) {
        auth_login();
        $redirect = safe_redirect($_POST['redirect'] ?? null);
        header('Location: ' . $redirect);
        exit;
    } else {
        // Small delay to slow brute-force attempts
        usleep(500000); // 0.5s
        $error = 'Incorrect password.';
    }
}

$redirectParam = isset($_GET['redirect']) ? $_GET['redirect'] : '';
?><!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sign in – Sensor Dashboard</title>
    <link rel="stylesheet" href="assets/css/style.css">
    <style>
        .login-wrap {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
            box-sizing: border-box;
        }
        .login-card {
            width: 100%;
            max-width: 360px;
            background: var(--card-bg, #ffffff);
            border: 1px solid var(--border-color, #e0e0e0);
            border-radius: 8px;
            padding: 28px 28px 24px;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.06);
        }
        .login-card h1 {
            margin: 0 0 4px;
            font-size: 20px;
        }
        .login-sub {
            margin: 0 0 20px;
            color: var(--text-muted, #666);
            font-size: 13px;
        }
        .login-field {
            display: block;
            margin-bottom: 14px;
        }
        .login-field label {
            display: block;
            font-size: 13px;
            margin-bottom: 6px;
            color: var(--text-muted, #555);
        }
        .login-field input {
            width: 100%;
            box-sizing: border-box;
            padding: 10px 12px;
            font-size: 14px;
            border: 1px solid var(--border-color, #ccc);
            border-radius: 4px;
            background: #fff;
        }
        .login-field input:focus {
            outline: none;
            border-color: #2962ff;
            box-shadow: 0 0 0 2px rgba(41, 98, 255, 0.15);
        }
        .login-btn {
            width: 100%;
            padding: 10px 12px;
            font-size: 14px;
            font-weight: 600;
            border: none;
            border-radius: 4px;
            background: #2962ff;
            color: #fff;
            cursor: pointer;
        }
        .login-btn:hover { background: #1e4fd1; }
        .login-error {
            margin: 0 0 14px;
            padding: 10px 12px;
            background: #fdecea;
            border: 1px solid #f5c2c0;
            color: #b3261e;
            border-radius: 4px;
            font-size: 13px;
        }
    </style>
</head>
<body>
    <div class="login-wrap">
        <div class="login-card">
            <h1>Sensor Dashboard</h1>
            <p class="login-sub">Enter the password to continue.</p>

            <?php if ($error !== ''): ?>
                <div class="login-error"><?= htmlspecialchars($error) ?></div>
            <?php endif; ?>

            <form method="post" autocomplete="off">
                <input type="hidden" name="redirect" value="<?= htmlspecialchars($redirectParam) ?>">
                <div class="login-field">
                    <label for="password">Password</label>
                    <input type="password" id="password" name="password" required autofocus>
                </div>
                <button type="submit" class="login-btn">Sign in</button>
            </form>
        </div>
    </div>
</body>
</html>
