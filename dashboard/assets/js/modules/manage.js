/**
 * Sensor Dashboard — "Manage Sensors" modal.
 *
 * Owns: edit IP addresses, delete sensors, confirm-delete flow.
 * Does NOT own: top-level fetching or re-rendering — it asks the host
 * (dashboard.js) for those via the callbacks passed in init().
 */

import { esc, timeAgo, sensorUrl, SENSOR_PORT } from './utils.js';
import { removePanelState } from './state.js';
import { updateSensorIp, updateSensorLocation, deleteSensor } from './api.js';

let ctx = null;
let pendingDeleteId = null;

export function initManageModal(options) {
    ctx = options; // { getSensors, onSensorDeleted }

    const manageBtn        = document.getElementById('manageBtn');
    const manageModal      = document.getElementById('manageModal');
    const manageModalClose = document.getElementById('manageModalClose');
    const deleteModal      = document.getElementById('deleteModal');
    const deleteModalClose = document.getElementById('deleteModalClose');
    const deleteCancelBtn  = document.getElementById('deleteCancelBtn');
    const deleteConfirmBtn = document.getElementById('deleteConfirmBtn');

    if (manageBtn) manageBtn.addEventListener('click', openManageModal);
    if (manageModalClose) manageModalClose.addEventListener('click', closeManageModal);
    if (manageModal) manageModal.addEventListener('click', (e) => {
        if (e.target === manageModal) closeManageModal();
    });

    if (deleteModalClose) deleteModalClose.addEventListener('click', closeDeleteModal);
    if (deleteCancelBtn)  deleteCancelBtn.addEventListener('click', closeDeleteModal);
    if (deleteConfirmBtn) deleteConfirmBtn.addEventListener('click', () => confirmDelete(deleteConfirmBtn));
    if (deleteModal) deleteModal.addEventListener('click', (e) => {
        if (e.target === deleteModal) closeDeleteModal();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (deleteModal && deleteModal.classList.contains('visible')) closeDeleteModal();
        else if (manageModal && manageModal.classList.contains('visible')) closeManageModal();
    });
}

function openManageModal() {
    const manageModal     = document.getElementById('manageModal');
    const manageModalBody = document.getElementById('manageModalBody');
    if (!manageModal || !manageModalBody) return;

    const sensors = (ctx && typeof ctx.getSensors === 'function') ? ctx.getSensors() : [];
    if (!sensors || sensors.length === 0) {
        manageModalBody.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:20px;">No sensors registered.</p>';
    } else {
        manageModalBody.innerHTML = buildManageHtml(sensors);
        bindManageInteractions(manageModalBody);
    }
    manageModal.classList.add('visible');
}

function closeManageModal() {
    const m = document.getElementById('manageModal');
    if (m) m.classList.remove('visible');
}

function closeDeleteModal() {
    const m = document.getElementById('deleteModal');
    if (m) m.classList.remove('visible');
    pendingDeleteId = null;
}

function buildManageHtml(sensors) {
    let html = '';
    for (let i = 0; i < sensors.length; i++) {
        const s = sensors[i];
        const onClass = s.online ? 'status-online' : 'status-offline';
        const onText  = s.online ? 'Online' : 'Offline';
        const url = sensorUrl(s);
        html += '<div class="manage-sensor-item">';
        html += '<div class="manage-sensor-info">';
        html += '<div class="manage-sensor-name">' + esc(s.location_name) + '</div>';
        html += '<div class="manage-sensor-meta">';
        html += '<span class="status-dot ' + onClass + '" style="display:inline-block;margin-right:4px;"></span>';
        html += esc(onText) + ' \u00B7 ' + esc((s.sensor_type || '').toUpperCase()) + ' \u00B7 ID: ' + esc(s.sensor_id) + ' \u00B7 Last seen ' + esc(timeAgo(s.last_seen));
        html += '</div>';
        html += '<div class="manage-sensor-ip">';
        html += '<label class="ip-label">Display name</label>';
        html += '<input type="text" class="ip-input" data-sensor-loc="' + esc(s.sensor_id) + '" value="' + esc(s.location_name || '') + '" placeholder="' + esc(s.sensor_id) + '" maxlength="255">';
        html += '<button class="btn btn-sm btn-secondary loc-save-btn" data-save-loc="' + esc(s.sensor_id) + '">Save</button>';
        html += '</div>';
        html += '<div class="manage-sensor-ip">';
        html += '<label class="ip-label">Local IP</label>';
        html += '<input type="text" class="ip-input" data-sensor-ip="' + esc(s.sensor_id) + '" value="' + esc(s.ip_address || '') + '" placeholder="192.168.1.x">';
        html += '<button class="btn btn-sm btn-secondary ip-save-btn" data-save-ip="' + esc(s.sensor_id) + '">Save</button>';
        if (url) html += '<a class="btn-link" href="' + esc(url) + '" target="_blank">Open</a>';
        html += '</div>';
        html += '</div>';
        html += '<div class="manage-sensor-actions">';
        html += '<button class="btn btn-danger btn-sm" data-delete-sensor="' + esc(s.sensor_id) + '" data-delete-name="' + esc(s.location_name) + '">Remove</button>';
        html += '</div>';
        html += '</div>';
    }
    return html;
}

function bindManageInteractions(root) {
    root.querySelectorAll('[data-delete-sensor]').forEach(btn => {
        btn.addEventListener('click', () => {
            pendingDeleteId = btn.getAttribute('data-delete-sensor');
            const name = btn.getAttribute('data-delete-name') || '';
            const label = document.getElementById('deleteSensorName');
            if (label) label.textContent = name;
            const modal = document.getElementById('deleteModal');
            if (modal) modal.classList.add('visible');
        });
    });

    root.querySelectorAll('[data-save-ip]').forEach(btn => {
        btn.addEventListener('click', () => {
            const sid = btn.getAttribute('data-save-ip');
            const input = root.querySelector('[data-sensor-ip="' + sid + '"]');
            const ip = input ? input.value.trim() : '';
            saveIp(sid, ip, btn);
        });
    });

    root.querySelectorAll('[data-save-loc]').forEach(btn => {
        btn.addEventListener('click', () => {
            const sid = btn.getAttribute('data-save-loc');
            const input = root.querySelector('[data-sensor-loc="' + sid + '"]');
            const loc = input ? input.value.trim() : '';
            saveLocation(sid, loc, btn);
        });
    });

    root.querySelectorAll('.ip-input').forEach(inp => {
        inp.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            const ipSid = inp.getAttribute('data-sensor-ip');
            const locSid = inp.getAttribute('data-sensor-loc');
            const sid = ipSid || locSid;
            if (!sid) return;
            const selector = ipSid ? '[data-save-ip="' + sid + '"]' : '[data-save-loc="' + sid + '"]';
            const saveBtn = root.querySelector(selector);
            if (saveBtn) saveBtn.click();
        });
    });
}

function saveIp(sensorId, ip, btn) {
    const origText = btn.textContent;
    btn.textContent = 'Saving...';
    btn.disabled = true;

    updateSensorIp(sensorId, ip)
        .then(() => {
            btn.textContent = 'Saved!';
            btn.style.color = 'var(--accent-green)';
            // Update cached sensor so Open links reflect new IP immediately
            const sensors = (ctx && typeof ctx.getSensors === 'function') ? ctx.getSensors() : [];
            for (let i = 0; i < sensors.length; i++) {
                if (sensors[i].sensor_id === sensorId) {
                    sensors[i].ip_address = ip || null;
                    break;
                }
            }
            setTimeout(() => {
                btn.textContent = origText;
                btn.style.color = '';
                btn.disabled = false;
                const row = btn.closest('.manage-sensor-ip');
                if (!row) return;
                const existingLink = row.querySelector('.btn-link');
                const newUrl = ip ? 'http://' + ip + ':' + SENSOR_PORT : null;
                if (existingLink && !newUrl) existingLink.remove();
                else if (newUrl && !existingLink) {
                    const a = document.createElement('a');
                    a.className = 'btn-link';
                    a.href = newUrl;
                    a.target = '_blank';
                    a.textContent = 'Open';
                    row.appendChild(a);
                } else if (existingLink && newUrl) {
                    existingLink.href = newUrl;
                }
            }, 1500);
        })
        .catch((err) => {
            console.error('Save IP error:', err);
            btn.textContent = 'Error';
            btn.style.color = 'var(--accent-red)';
            setTimeout(() => {
                btn.textContent = origText;
                btn.style.color = '';
                btn.disabled = false;
            }, 2000);
        });
}

function saveLocation(sensorId, locationName, btn) {
    const origText = btn.textContent;
    btn.textContent = 'Saving...';
    btn.disabled = true;

    updateSensorLocation(sensorId, locationName)
        .then(() => {
            btn.textContent = 'Saved!';
            btn.style.color = 'var(--accent-green)';
            const effective = locationName || sensorId;
            const sensors = (ctx && typeof ctx.getSensors === 'function') ? ctx.getSensors() : [];
            for (let i = 0; i < sensors.length; i++) {
                if (sensors[i].sensor_id === sensorId) {
                    sensors[i].location_name = effective;
                    break;
                }
            }
            // Update the title displayed in the modal so the user sees the
            // change stick without re-opening.
            const row = btn.closest('.manage-sensor-item');
            if (row) {
                const nameEl = row.querySelector('.manage-sensor-name');
                if (nameEl) nameEl.textContent = effective;
            }
            setTimeout(() => {
                btn.textContent = origText;
                btn.style.color = '';
                btn.disabled = false;
            }, 1500);
        })
        .catch((err) => {
            console.error('Save location error:', err);
            btn.textContent = 'Error';
            btn.style.color = 'var(--accent-red)';
            setTimeout(() => {
                btn.textContent = origText;
                btn.style.color = '';
                btn.disabled = false;
            }, 2000);
        });
}

function confirmDelete(deleteConfirmBtn) {
    if (!pendingDeleteId) return;
    const sid = pendingDeleteId;

    deleteConfirmBtn.textContent = 'Removing...';
    deleteConfirmBtn.disabled = true;

    deleteSensor(sid)
        .then(() => {
            removePanelState(sid);
            closeDeleteModal();
            closeManageModal();
            if (ctx && typeof ctx.onSensorDeleted === 'function') ctx.onSensorDeleted(sid);
        })
        .catch((err) => {
            console.error('Delete error:', err);
            alert('Failed to remove sensor. Check that API_KEY is configured in config.php.');
        })
        .finally(() => {
            deleteConfirmBtn.textContent = 'Remove Sensor';
            deleteConfirmBtn.disabled = false;
        });
}
