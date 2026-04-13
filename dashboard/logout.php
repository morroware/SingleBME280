<?php
/**
 * Logout endpoint for the Sensor Dashboard.
 * Destroys the session and redirects to the login page.
 */

require_once __DIR__ . '/includes/auth.php';

auth_logout();

header('Location: login.php');
exit;
