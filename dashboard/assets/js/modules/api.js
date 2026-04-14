/**
 * Sensor Dashboard — API wrappers.
 */

function getApiKey() {
    const meta = document.querySelector('meta[name="api-key"]');
    if (meta) return meta.getAttribute('content');
    try { return sessionStorage.getItem('dashboard_api_key') || ''; }
    catch (e) { return ''; }
}

function handle401() {
    window.location.href = 'login.php';
    throw new Error('unauthenticated');
}

async function jsonFetch(url, opts) {
    const res = await fetch(url, opts);
    if (res.status === 401) handle401();
    if (!res.ok) throw new Error(url + ' ' + res.status);
    return res.json();
}

export function fetchSensors() {
    return jsonFetch('api/sensors.php');
}

export function fetchReadings(range) {
    return jsonFetch('api/readings.php?range=' + encodeURIComponent(range) + '&sensor_id=all');
}

export function updateSensorIp(sensorId, ip) {
    return jsonFetch('api/update_sensor.php', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-API-Key': getApiKey(),
        },
        body: JSON.stringify({ sensor_id: sensorId, ip_address: ip }),
    });
}

export function deleteSensor(sensorId) {
    return jsonFetch('api/delete_sensor.php', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-API-Key': getApiKey(),
        },
        body: JSON.stringify({ sensor_id: sensorId }),
    });
}

// -------------------------------------------------------------------------
// Dashboard layout persistence
// -------------------------------------------------------------------------
export function fetchLayout() {
    return jsonFetch('api/layout.php');
}

export function saveLayout(layout) {
    return jsonFetch('api/layout.php', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-API-Key': getApiKey(),
        },
        body: JSON.stringify(layout),
    });
}

export function deleteLayout() {
    return jsonFetch('api/layout.php', {
        method: 'DELETE',
        headers: { 'X-API-Key': getApiKey() },
    });
}
