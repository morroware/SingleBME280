/**
 * Sensor Dashboard – Professional IoT Dashboard
 *
 * Features:
 *  - At-a-glance overview cards
 *  - Collapsible per-sensor panels
 *  - Chart type selector (Line / Gauge)
 *  - Sensor management (delete outdated sensors)
 *  - Direct links to each sensor's local interface
 */

(function () {
    'use strict';

    // -----------------------------------------------------------------------
    // Config
    // -----------------------------------------------------------------------
    var AUTO_REFRESH_MS = 60000;
    var SENSOR_PORT = 5000; // Flask port on each Pi Zero

    var CHART_COLORS = {
        temperature_f: '#fbbf24',
        humidity:      '#4a9eff',
        co2:           '#a78bfa',
    };

    // -----------------------------------------------------------------------
    // State
    // -----------------------------------------------------------------------
    var currentRange      = '24h';
    var autoRefreshTimer  = null;
    var chartInstances    = [];
    var panelStates       = {};       // sensor_id -> { collapsed: bool, chartType: 'line'|'gauge' }
    var cachedSensors     = null;
    var cachedReadings    = null;
    var pendingDeleteId   = null;

    // -----------------------------------------------------------------------
    // DOM refs
    // -----------------------------------------------------------------------
    var mainContent      = document.getElementById('mainContent');
    var globalLoading    = document.getElementById('globalLoading');
    var refreshBtn       = document.getElementById('refreshBtn');
    var rangeButtons     = document.querySelectorAll('.range-btn');
    var collapseAllBtn   = document.getElementById('collapseAllBtn');
    var expandAllBtn     = document.getElementById('expandAllBtn');
    var manageBtn        = document.getElementById('manageBtn');
    var sensorCountEl    = document.getElementById('sensorCount');

    // Modals
    var manageModal      = document.getElementById('manageModal');
    var manageModalBody  = document.getElementById('manageModalBody');
    var manageModalClose = document.getElementById('manageModalClose');
    var deleteModal      = document.getElementById('deleteModal');
    var deleteModalClose = document.getElementById('deleteModalClose');
    var deleteSensorName = document.getElementById('deleteSensorName');
    var deleteCancelBtn  = document.getElementById('deleteCancelBtn');
    var deleteConfirmBtn = document.getElementById('deleteConfirmBtn');

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------
    function esc(str) {
        var d = document.createElement('div');
        d.textContent = str || '';
        return d.innerHTML;
    }

    function timeAgo(dateStr) {
        if (!dateStr) return 'Never';
        var diff = Math.floor((new Date() - new Date(dateStr)) / 1000);
        if (isNaN(diff) || diff < 0) return 'Just now';
        if (diff < 60)    return diff + 's ago';
        if (diff < 3600)  return Math.floor(diff / 60) + 'm ago';
        if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
        return Math.floor(diff / 86400) + 'd ago';
    }

    function fmt(v, decimals, unit) {
        if (v === null || v === undefined || isNaN(v)) return '--';
        return v.toFixed(decimals !== undefined ? decimals : 1) + (unit || '');
    }

    function calcStats(values) {
        var nums = [];
        for (var i = 0; i < values.length; i++) {
            if (values[i] !== null && values[i] !== undefined && !isNaN(values[i])) {
                nums.push(values[i]);
            }
        }
        if (nums.length === 0) return null;
        var min = nums[0], max = nums[0], sum = 0;
        for (var j = 0; j < nums.length; j++) {
            if (nums[j] < min) min = nums[j];
            if (nums[j] > max) max = nums[j];
            sum += nums[j];
        }
        return { current: nums[nums.length - 1], min: min, max: max, avg: sum / nums.length };
    }

    function getPanelState(sid) {
        if (!panelStates[sid]) {
            panelStates[sid] = { collapsed: false, chartType: 'line' };
        }
        return panelStates[sid];
    }

    function sensorUrl(sensor) {
        if (!sensor.ip_address) return null;
        return 'http://' + sensor.ip_address + ':' + SENSOR_PORT;
    }

    // -----------------------------------------------------------------------
    // Error banner
    // -----------------------------------------------------------------------
    function showError(msg) {
        var el = document.getElementById('errorBanner');
        if (!el) {
            el = document.createElement('div');
            el.id = 'errorBanner';
            el.style.cssText = 'background:#7f1d1d;color:#fca5a5;padding:8px 16px;text-align:center;' +
                'font-size:0.85rem;position:sticky;top:56px;z-index:99;';
            mainContent.parentNode.insertBefore(el, mainContent);
        }
        el.textContent = msg;
        el.style.display = '';
    }

    function clearError() {
        var el = document.getElementById('errorBanner');
        if (el) el.style.display = 'none';
    }

    // -----------------------------------------------------------------------
    // Chart factories
    // -----------------------------------------------------------------------
    function destroyAllCharts() {
        for (var i = 0; i < chartInstances.length; i++) {
            chartInstances[i].destroy();
        }
        chartInstances = [];
    }

    function createLineChart(canvas, dataPoints, field, unit) {
        var color = CHART_COLORS[field] || '#4a9eff';
        var ctx = canvas.getContext('2d');
        var h = canvas.parentElement.clientHeight || 200;
        var gradient = ctx.createLinearGradient(0, 0, 0, h);
        gradient.addColorStop(0, color + '30');
        gradient.addColorStop(1, color + '02');

        var chart = new Chart(ctx, {
            type: 'line',
            data: {
                datasets: [{
                    data: dataPoints,
                    borderColor: color,
                    backgroundColor: gradient,
                    borderWidth: 2,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    pointHoverBackgroundColor: color,
                    tension: 0.3,
                    fill: true,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: '#1e222b',
                        titleColor: '#e8eaed',
                        bodyColor: '#e8eaed',
                        borderColor: '#2a2f3a',
                        borderWidth: 1,
                        padding: 10,
                        displayColors: false,
                        callbacks: {
                            label: function (ctx) {
                                var v = ctx.parsed.y;
                                if (v === null || v === undefined) return null;
                                return v.toFixed(field === 'co2' ? 0 : 1) + unit;
                            },
                        },
                    },
                },
                scales: {
                    x: {
                        type: 'time',
                        time: {
                            tooltipFormat: 'MMM d, yyyy HH:mm',
                            displayFormats: { minute: 'HH:mm', hour: 'HH:mm', day: 'MMM d' },
                        },
                        ticks: { color: '#5f6672', maxTicksLimit: 8, font: { size: 10 } },
                        grid: { color: 'rgba(42,47,58,0.4)' },
                    },
                    y: {
                        ticks: {
                            color: '#5f6672',
                            font: { size: 10 },
                            callback: function (v) { return v + unit; },
                        },
                        grid: { color: 'rgba(42,47,58,0.4)' },
                    },
                },
            },
        });
        chartInstances.push(chart);
        return chart;
    }

    function drawGauge(canvasId, value, min, max, color, unit) {
        var canvas = document.getElementById(canvasId);
        if (!canvas) return;
        var ctx = canvas.getContext('2d');
        var w = canvas.width;
        var h = canvas.height;
        var cx = w / 2;
        var cy = h - 10;
        var r = Math.min(cx, cy) - 10;

        ctx.clearRect(0, 0, w, h);

        // Background arc
        ctx.beginPath();
        ctx.arc(cx, cy, r, Math.PI, 0, false);
        ctx.lineWidth = 14;
        ctx.strokeStyle = 'rgba(42,47,58,0.6)';
        ctx.lineCap = 'round';
        ctx.stroke();

        // Value arc
        var pct = (value - min) / (max - min);
        pct = Math.max(0, Math.min(1, pct));
        var endAngle = Math.PI + (pct * Math.PI);
        ctx.beginPath();
        ctx.arc(cx, cy, r, Math.PI, endAngle, false);
        ctx.lineWidth = 14;
        ctx.strokeStyle = color;
        ctx.lineCap = 'round';
        ctx.stroke();

        // Center dot
        ctx.beginPath();
        ctx.arc(cx, cy, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#5f6672';
        ctx.fill();

        // Value text
        var valDisplay = canvas.parentElement.querySelector('.gauge-value-display');
        if (valDisplay) {
            valDisplay.style.color = color;
            valDisplay.textContent = fmt(value, unit === ' ppm' ? 0 : 1, unit);
        }
    }

    // -----------------------------------------------------------------------
    // At-a-Glance section
    // -----------------------------------------------------------------------
    function buildGlanceSection(sensors) {
        if (!sensors || sensors.length === 0) return '';

        var onlineCount = 0;
        for (var i = 0; i < sensors.length; i++) {
            if (sensors[i].online) onlineCount++;
        }

        var html = '<div class="glance-section">';
        html += '<div class="glance-header">';
        html += '<span class="glance-title">At a Glance</span>';
        html += '</div>';
        html += '<div class="glance-grid">';

        for (var i = 0; i < sensors.length; i++) {
            var s = sensors[i];
            var onClass  = s.online ? 'status-online' : 'status-offline';
            var onText   = s.online ? 'Online' : 'Offline';
            var offClass = s.online ? '' : ' offline';
            var badgeClass = s.sensor_type === 'scd40' ? 'badge-scd40' : 'badge-bme280';
            var temp = s.latest.temperature_f !== null ? fmt(s.latest.temperature_f, 1, '\u00B0') : '--';
            var hum  = s.latest.humidity !== null ? fmt(s.latest.humidity, 0, '%') : '--';
            var co2  = s.latest.co2 !== null ? fmt(s.latest.co2, 0, '') : null;
            var url  = sensorUrl(s);

            html += '<div class="glance-card' + offClass + '" data-scroll="panel-' + esc(s.sensor_id) + '">';
            html += '<div class="glance-card-top">';
            html += '<span class="glance-name">' + esc(s.location_name) + '</span>';
            html += '<span class="glance-badge ' + badgeClass + '">' + esc(s.sensor_type).toUpperCase() + '</span>';
            html += '</div>';
            html += '<div class="glance-values">';
            html += '<span class="gv-temp">' + temp + '</span>';
            html += '<span class="gv-hum">' + hum + '</span>';
            if (co2 !== null) html += '<span class="gv-co2">' + co2 + ' ppm</span>';
            html += '</div>';
            html += '<div class="glance-footer">';
            html += '<span class="glance-status"><span class="status-dot ' + onClass + '"></span>' + onText + ' \u00B7 ' + timeAgo(s.last_seen) + '</span>';
            if (url) {
                html += '<a class="glance-link" href="' + esc(url) + '" target="_blank" onclick="event.stopPropagation()">Open</a>';
            }
            html += '</div>';
            html += '</div>';
        }
        html += '</div></div>';
        return html;
    }

    // -----------------------------------------------------------------------
    // Per-sensor panel
    // -----------------------------------------------------------------------
    function buildPanelHTML(sensor, sensorReadings) {
        var sid   = sensor.sensor_id;
        var isSCD = sensor.sensor_type === 'scd40';
        var state = getPanelState(sid);
        var onClass   = sensor.online ? 'status-online' : 'status-offline';
        var onText    = sensor.online ? 'Online' : 'Offline';
        var badgeClass = isSCD ? 'badge-scd40' : 'badge-bme280';
        var collClass  = state.collapsed ? ' collapsed' : '';
        var url = sensorUrl(sensor);

        // Extract arrays for stats
        var data = (sensorReadings && sensorReadings.data) ? sensorReadings.data : [];
        var temps = [], hums = [], co2s = [];
        for (var i = 0; i < data.length; i++) {
            temps.push(data[i].temperature_f);
            hums.push(data[i].humidity);
            if (isSCD) co2s.push(data[i].co2);
        }

        var tempStats = calcStats(temps);
        var humStats  = calcStats(hums);
        var co2Stats  = isSCD ? calcStats(co2s) : null;

        var html = '<div class="sensor-panel" id="panel-' + esc(sid) + '">';

        // Header (clickable to collapse)
        html += '<div class="panel-header" data-toggle="' + esc(sid) + '">';
        html += '<svg class="panel-chevron' + collClass + '" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6l4 4 4-4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        html += '<span class="panel-name">' + esc(sensor.location_name) + '</span>';
        html += '<span class="glance-badge ' + badgeClass + '">' + esc(sensor.sensor_type).toUpperCase() + '</span>';
        html += '<div class="panel-meta">';
        html += '<span class="panel-status"><span class="status-dot ' + onClass + '"></span>' + onText + '</span>';
        html += '<span class="panel-last-seen">' + timeAgo(sensor.last_seen) + '</span>';
        if (url) {
            html += '<a class="panel-link" href="' + esc(url) + '" target="_blank" onclick="event.stopPropagation()" title="Open sensor settings">Settings</a>';
        }
        html += '</div>';
        html += '</div>';

        // Body (collapsible)
        html += '<div class="panel-body' + collClass + '" id="body-' + esc(sid) + '">';

        // Chart type bar
        html += '<div class="chart-type-bar">';
        html += '<span class="chart-type-label">View</span>';
        html += '<button class="chart-type-btn' + (state.chartType === 'line' ? ' active' : '') + '" data-sensor="' + esc(sid) + '" data-chart-type="line">Line</button>';
        html += '<button class="chart-type-btn' + (state.chartType === 'gauge' ? ' active' : '') + '" data-sensor="' + esc(sid) + '" data-chart-type="gauge">Gauge</button>';
        html += '</div>';

        // Charts
        html += '<div class="panel-charts">';

        if (state.chartType === 'gauge') {
            // Gauge view
            html += buildGaugeBlock('Temperature', 'temp', sid, tempStats, '\u00B0F', 'temperature_f', 30, 120);
            html += buildGaugeBlock('Humidity', 'hum', sid, humStats, '%', 'humidity', 0, 100);
            if (isSCD) {
                html += buildGaugeBlock('CO\u2082', 'co2', sid, co2Stats, ' ppm', 'co2', 400, 2000);
            }
        } else {
            // Line chart view
            html += buildLineBlock('Temperature', 'temp', sid, tempStats, '\u00B0F', '\u00B0');
            html += buildLineBlock('Humidity', 'hum', sid, humStats, '%', '%');
            if (isSCD) {
                html += buildLineBlock('CO\u2082', 'co2', sid, co2Stats, ' ppm', '');
            }
        }

        html += '</div>'; // .panel-charts
        html += '</div>'; // .panel-body
        html += '</div>'; // .sensor-panel
        return html;
    }

    function buildLineBlock(title, key, sid, stats, unit, unitSm) {
        var statClass = 'stat-' + key;
        var html = '<div class="chart-block">';
        html += '<div class="chart-block-title">' + title + '</div>';
        if (stats) {
            var dec = key === 'co2' ? 0 : 1;
            html += '<div class="chart-stats">';
            html += '<div class="stat ' + statClass + '"><span class="stat-value">' + fmt(stats.current, dec, unit) + '</span><span class="stat-label">Current</span></div>';
            html += '<div class="stat ' + statClass + '"><span class="stat-value-sm">' + fmt(stats.min, dec, unitSm) + '</span><span class="stat-label">Min</span></div>';
            html += '<div class="stat ' + statClass + '"><span class="stat-value-sm">' + fmt(stats.max, dec, unitSm) + '</span><span class="stat-label">Max</span></div>';
            html += '<div class="stat ' + statClass + '"><span class="stat-value-sm">' + fmt(stats.avg, dec, unitSm) + '</span><span class="stat-label">Avg</span></div>';
            html += '</div>';
            html += '<div class="chart-container"><canvas id="chart-' + key + '-' + esc(sid) + '"></canvas></div>';
        } else {
            html += '<div class="chart-nodata">No ' + title.toLowerCase() + ' data for this range</div>';
        }
        html += '</div>';
        return html;
    }

    function buildGaugeBlock(title, key, sid, stats, unit, field, gaugeMin, gaugeMax) {
        var statClass = 'stat-' + key;
        var color = CHART_COLORS[field] || '#4a9eff';
        var html = '<div class="chart-block">';
        html += '<div class="chart-block-title">' + title + '</div>';
        if (stats) {
            html += '<div class="gauge-container">';
            html += '<div class="gauge-wrap">';
            html += '<canvas class="gauge-canvas" id="gauge-' + key + '-' + esc(sid) + '" width="160" height="100"></canvas>';
            html += '<span class="gauge-value-display" style="color:' + color + '">' + fmt(stats.current, key === 'co2' ? 0 : 1, unit) + '</span>';
            html += '</div>';
            html += '</div>';
            html += '<div class="chart-stats" style="justify-content:center;">';
            var dec = key === 'co2' ? 0 : 1;
            html += '<div class="stat ' + statClass + '"><span class="stat-value-sm">' + fmt(stats.min, dec, '') + '</span><span class="stat-label">Min</span></div>';
            html += '<div class="stat ' + statClass + '"><span class="stat-value-sm">' + fmt(stats.avg, dec, '') + '</span><span class="stat-label">Avg</span></div>';
            html += '<div class="stat ' + statClass + '"><span class="stat-value-sm">' + fmt(stats.max, dec, '') + '</span><span class="stat-label">Max</span></div>';
            html += '</div>';
        } else {
            html += '<div class="chart-nodata">No ' + title.toLowerCase() + ' data for this range</div>';
        }
        html += '</div>';
        return html;
    }

    // -----------------------------------------------------------------------
    // Render everything
    // -----------------------------------------------------------------------
    function render(sensors, readingsData) {
        destroyAllCharts();
        cachedSensors  = sensors;
        cachedReadings = readingsData;

        if (!sensors || sensors.length === 0) {
            mainContent.innerHTML = '<div class="empty-state">' +
                '<p style="font-size:1.1rem;margin-bottom:8px;">No sensors registered yet.</p>' +
                '<p>Data will appear here once a Pi Zero posts its first reading.</p>' +
            '</div>';
            sensorCountEl.textContent = '';
            return;
        }

        var onlineCount = 0;
        for (var i = 0; i < sensors.length; i++) {
            if (sensors[i].online) onlineCount++;
        }
        sensorCountEl.textContent = onlineCount + '/' + sensors.length + ' online';

        var readings = readingsData.sensors || {};

        // Build full page
        var html = buildGlanceSection(sensors);

        for (var i = 0; i < sensors.length; i++) {
            var sid = sensors[i].sensor_id;
            html += buildPanelHTML(sensors[i], readings[sid] || null);
        }

        mainContent.innerHTML = html;

        // Instantiate charts / gauges
        for (var j = 0; j < sensors.length; j++) {
            var s   = sensors[j];
            var sid2 = s.sensor_id;
            var state = getPanelState(sid2);
            var rd  = readings[sid2];

            if (state.collapsed) continue; // skip hidden panels

            if (!rd || !rd.data || rd.data.length === 0) continue;
            var data = rd.data;

            if (state.chartType === 'gauge') {
                renderGauges(s, data);
            } else {
                renderLineCharts(s, data);
            }
        }

        // Bind glance card clicks -> scroll to panel
        bindGlanceClicks();
        // Bind collapse toggles
        bindPanelToggles();
        // Bind chart type buttons
        bindChartTypeButtons();
    }

    function renderLineCharts(sensor, data) {
        var sid = sensor.sensor_id;
        var isSCD = sensor.sensor_type === 'scd40';

        // Temperature
        var tempCanvas = document.getElementById('chart-temp-' + sid);
        if (tempCanvas) {
            var pts = [];
            for (var k = 0; k < data.length; k++) {
                if (data[k].temperature_f !== null) pts.push({ x: new Date(data[k].time), y: data[k].temperature_f });
            }
            if (pts.length > 0) createLineChart(tempCanvas, pts, 'temperature_f', '\u00B0F');
        }

        // Humidity
        var humCanvas = document.getElementById('chart-hum-' + sid);
        if (humCanvas) {
            var pts2 = [];
            for (var m = 0; m < data.length; m++) {
                if (data[m].humidity !== null) pts2.push({ x: new Date(data[m].time), y: data[m].humidity });
            }
            if (pts2.length > 0) createLineChart(humCanvas, pts2, 'humidity', '%');
        }

        // CO2
        if (isSCD) {
            var co2Canvas = document.getElementById('chart-co2-' + sid);
            if (co2Canvas) {
                var pts3 = [];
                for (var n = 0; n < data.length; n++) {
                    if (data[n].co2 !== null) pts3.push({ x: new Date(data[n].time), y: data[n].co2 });
                }
                if (pts3.length > 0) createLineChart(co2Canvas, pts3, 'co2', ' ppm');
            }
        }
    }

    function renderGauges(sensor, data) {
        var sid = sensor.sensor_id;
        var isSCD = sensor.sensor_type === 'scd40';

        var temps = [], hums = [], co2s = [];
        for (var i = 0; i < data.length; i++) {
            temps.push(data[i].temperature_f);
            hums.push(data[i].humidity);
            if (isSCD) co2s.push(data[i].co2);
        }

        var ts = calcStats(temps);
        var hs = calcStats(hums);
        var cs = isSCD ? calcStats(co2s) : null;

        if (ts) drawGauge('gauge-temp-' + sid, ts.current, 30, 120, CHART_COLORS.temperature_f, '\u00B0F');
        if (hs) drawGauge('gauge-hum-' + sid, hs.current, 0, 100, CHART_COLORS.humidity, '%');
        if (cs) drawGauge('gauge-co2-' + sid, cs.current, 400, 2000, CHART_COLORS.co2, ' ppm');
    }

    // -----------------------------------------------------------------------
    // Event binding
    // -----------------------------------------------------------------------
    function bindGlanceClicks() {
        var cards = document.querySelectorAll('.glance-card[data-scroll]');
        for (var i = 0; i < cards.length; i++) {
            cards[i].addEventListener('click', function () {
                var target = document.getElementById(this.getAttribute('data-scroll'));
                if (target) {
                    // Expand if collapsed
                    var sid = this.getAttribute('data-scroll').replace('panel-', '');
                    var state = getPanelState(sid);
                    if (state.collapsed) {
                        state.collapsed = false;
                        reRender();
                    }
                    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            });
        }
    }

    function bindPanelToggles() {
        var headers = document.querySelectorAll('.panel-header[data-toggle]');
        for (var i = 0; i < headers.length; i++) {
            headers[i].addEventListener('click', function (e) {
                // Don't toggle when clicking links
                if (e.target.closest('a')) return;
                var sid = this.getAttribute('data-toggle');
                var state = getPanelState(sid);
                state.collapsed = !state.collapsed;

                // Animate
                var body = document.getElementById('body-' + sid);
                var chevron = this.querySelector('.panel-chevron');
                if (body) body.classList.toggle('collapsed', state.collapsed);
                if (chevron) chevron.classList.toggle('collapsed', state.collapsed);

                // If expanding, need to render charts
                if (!state.collapsed) reRender();
            });
        }
    }

    function bindChartTypeButtons() {
        var btns = document.querySelectorAll('.chart-type-btn[data-sensor]');
        for (var i = 0; i < btns.length; i++) {
            btns[i].addEventListener('click', function (e) {
                e.stopPropagation();
                var sid = this.getAttribute('data-sensor');
                var type = this.getAttribute('data-chart-type');
                var state = getPanelState(sid);
                if (state.chartType === type) return;
                state.chartType = type;
                reRender();
            });
        }
    }

    function reRender() {
        if (cachedSensors && cachedReadings) {
            render(cachedSensors, cachedReadings);
        }
    }

    // -----------------------------------------------------------------------
    // Sensor management modal
    // -----------------------------------------------------------------------
    function openManageModal() {
        if (!cachedSensors || cachedSensors.length === 0) {
            manageModalBody.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:20px;">No sensors registered.</p>';
        } else {
            var html = '';
            for (var i = 0; i < cachedSensors.length; i++) {
                var s = cachedSensors[i];
                var onClass = s.online ? 'status-online' : 'status-offline';
                var onText  = s.online ? 'Online' : 'Offline';
                var url = sensorUrl(s);
                html += '<div class="manage-sensor-item">';
                html += '<div class="manage-sensor-info">';
                html += '<div class="manage-sensor-name">' + esc(s.location_name) + '</div>';
                html += '<div class="manage-sensor-meta">';
                html += '<span class="status-dot ' + onClass + '" style="display:inline-block;margin-right:4px;"></span>';
                html += onText + ' \u00B7 ' + esc(s.sensor_type).toUpperCase() + ' \u00B7 Last seen ' + timeAgo(s.last_seen);
                html += '</div>';
                // Editable IP row
                html += '<div class="manage-sensor-ip">';
                html += '<label class="ip-label">Local IP</label>';
                html += '<input type="text" class="ip-input" data-sensor-ip="' + esc(s.sensor_id) + '" value="' + esc(s.ip_address || '') + '" placeholder="192.168.1.x">';
                html += '<button class="btn btn-sm btn-secondary ip-save-btn" data-save-ip="' + esc(s.sensor_id) + '">Save</button>';
                if (url) {
                    html += '<a class="btn-link" href="' + esc(url) + '" target="_blank">Open</a>';
                }
                html += '</div>';
                html += '</div>';
                html += '<div class="manage-sensor-actions">';
                html += '<button class="btn btn-danger btn-sm" data-delete-sensor="' + esc(s.sensor_id) + '" data-delete-name="' + esc(s.location_name) + '">Remove</button>';
                html += '</div>';
                html += '</div>';
            }
            manageModalBody.innerHTML = html;

            // Bind delete buttons
            var delBtns = manageModalBody.querySelectorAll('[data-delete-sensor]');
            for (var j = 0; j < delBtns.length; j++) {
                delBtns[j].addEventListener('click', function () {
                    pendingDeleteId = this.getAttribute('data-delete-sensor');
                    deleteSensorName.textContent = this.getAttribute('data-delete-name');
                    deleteModal.classList.add('visible');
                });
            }

            // Bind IP save buttons
            var saveBtns = manageModalBody.querySelectorAll('[data-save-ip]');
            for (var k = 0; k < saveBtns.length; k++) {
                saveBtns[k].addEventListener('click', function () {
                    var sid = this.getAttribute('data-save-ip');
                    var input = manageModalBody.querySelector('[data-sensor-ip="' + sid + '"]');
                    var ip = input ? input.value.trim() : '';
                    var btn = this;
                    saveIpAddress(sid, ip, btn);
                });
            }

            // Also allow Enter key in IP inputs
            var ipInputs = manageModalBody.querySelectorAll('.ip-input');
            for (var m = 0; m < ipInputs.length; m++) {
                ipInputs[m].addEventListener('keydown', function (e) {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        var sid = this.getAttribute('data-sensor-ip');
                        var saveBtn = manageModalBody.querySelector('[data-save-ip="' + sid + '"]');
                        if (saveBtn) saveBtn.click();
                    }
                });
            }
        }
        manageModal.classList.add('visible');
    }

    function saveIpAddress(sensorId, ip, btn) {
        var origText = btn.textContent;
        btn.textContent = 'Saving...';
        btn.disabled = true;

        fetch('api/update_sensor.php', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': getApiKey(),
            },
            body: JSON.stringify({ sensor_id: sensorId, ip_address: ip }),
        })
        .then(function (r) {
            if (!r.ok) throw new Error('Update failed: ' + r.status);
            return r.json();
        })
        .then(function () {
            btn.textContent = 'Saved!';
            btn.style.color = 'var(--accent-green)';
            // Update cached data so links update immediately
            for (var i = 0; i < cachedSensors.length; i++) {
                if (cachedSensors[i].sensor_id === sensorId) {
                    cachedSensors[i].ip_address = ip || null;
                    break;
                }
            }
            setTimeout(function () {
                btn.textContent = origText;
                btn.style.color = '';
                btn.disabled = false;
                // Re-render the "Open" link in the modal row
                var row = btn.closest('.manage-sensor-ip');
                var existingLink = row.querySelector('.btn-link');
                var newUrl = ip ? 'http://' + ip + ':' + SENSOR_PORT : null;
                if (existingLink && !newUrl) existingLink.remove();
                else if (newUrl && !existingLink) {
                    var a = document.createElement('a');
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
        .catch(function (err) {
            console.error('Save IP error:', err);
            btn.textContent = 'Error';
            btn.style.color = 'var(--accent-red)';
            setTimeout(function () {
                btn.textContent = origText;
                btn.style.color = '';
                btn.disabled = false;
            }, 2000);
        });
    }

    function closeManageModal() {
        manageModal.classList.remove('visible');
    }

    function closeDeleteModal() {
        deleteModal.classList.remove('visible');
        pendingDeleteId = null;
    }

    function confirmDeleteSensor() {
        if (!pendingDeleteId) return;
        var sid = pendingDeleteId;

        deleteConfirmBtn.textContent = 'Removing...';
        deleteConfirmBtn.disabled = true;

        fetch('api/delete_sensor.php', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': getApiKey(),
            },
            body: JSON.stringify({ sensor_id: sid }),
        })
        .then(function (r) {
            if (!r.ok) throw new Error('Delete failed: ' + r.status);
            return r.json();
        })
        .then(function () {
            // Remove from panel states
            delete panelStates[sid];
            closeDeleteModal();
            closeManageModal();
            fetchAll(); // refresh dashboard
        })
        .catch(function (err) {
            console.error('Delete error:', err);
            alert('Failed to remove sensor. Check that API_KEY is configured in config.php.');
        })
        .finally(function () {
            deleteConfirmBtn.textContent = 'Remove Sensor';
            deleteConfirmBtn.disabled = false;
        });
    }

    function getApiKey() {
        // Allow passing API key via meta tag or prompt
        var meta = document.querySelector('meta[name="api-key"]');
        if (meta) return meta.getAttribute('content');
        // Fall back to prompting (cached in sessionStorage)
        var key = sessionStorage.getItem('dashboard_api_key');
        if (!key) {
            key = prompt('Enter your API key to manage sensors:');
            if (key) sessionStorage.setItem('dashboard_api_key', key);
        }
        return key || '';
    }

    // -----------------------------------------------------------------------
    // Data fetching
    // -----------------------------------------------------------------------
    function fetchAll() {
        refreshBtn.classList.add('spinning');

        var sensorsReq = fetch('api/sensors.php')
            .then(function (r) {
                if (!r.ok) throw new Error('sensors API ' + r.status);
                return r.json();
            });
        var readingsReq = fetch('api/readings.php?range=' + encodeURIComponent(currentRange) + '&sensor_id=all')
            .then(function (r) {
                if (!r.ok) throw new Error('readings API ' + r.status);
                return r.json();
            });

        Promise.all([sensorsReq, readingsReq])
            .then(function (results) {
                render(results[0], results[1]);
                clearError();
            })
            .catch(function (err) {
                console.error('Dashboard fetch error:', err);
                if (globalLoading && globalLoading.parentNode === mainContent) {
                    mainContent.innerHTML = '<div class="empty-state">' +
                        '<p style="font-size:1.1rem;margin-bottom:8px;">Unable to load sensor data.</p>' +
                        '<p>Check your database settings in <code>config.php</code> and ensure <code>install.php</code> has been run.</p>' +
                    '</div>';
                } else {
                    showError('Failed to refresh data. Retrying in 60s\u2026');
                }
            })
            .finally(function () {
                refreshBtn.classList.remove('spinning');
            });
    }

    // -----------------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------------

    // Range buttons
    rangeButtons.forEach(function (btn) {
        btn.addEventListener('click', function () {
            rangeButtons.forEach(function (b) { b.classList.remove('active'); });
            btn.classList.add('active');
            currentRange = btn.dataset.range;
            fetchAll();
        });
    });

    // Refresh
    refreshBtn.addEventListener('click', fetchAll);

    // Collapse / Expand all
    collapseAllBtn.addEventListener('click', function () {
        if (!cachedSensors) return;
        for (var i = 0; i < cachedSensors.length; i++) {
            getPanelState(cachedSensors[i].sensor_id).collapsed = true;
        }
        reRender();
    });

    expandAllBtn.addEventListener('click', function () {
        if (!cachedSensors) return;
        for (var i = 0; i < cachedSensors.length; i++) {
            getPanelState(cachedSensors[i].sensor_id).collapsed = false;
        }
        reRender();
    });

    // Manage modal
    manageBtn.addEventListener('click', openManageModal);
    manageModalClose.addEventListener('click', closeManageModal);
    manageModal.addEventListener('click', function (e) {
        if (e.target === manageModal) closeManageModal();
    });

    // Delete modal
    deleteModalClose.addEventListener('click', closeDeleteModal);
    deleteCancelBtn.addEventListener('click', closeDeleteModal);
    deleteConfirmBtn.addEventListener('click', confirmDeleteSensor);
    deleteModal.addEventListener('click', function (e) {
        if (e.target === deleteModal) closeDeleteModal();
    });

    // Keyboard: Escape closes modals
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            if (deleteModal.classList.contains('visible')) closeDeleteModal();
            else if (manageModal.classList.contains('visible')) closeManageModal();
        }
    });

    // -----------------------------------------------------------------------
    // Init
    // -----------------------------------------------------------------------
    fetchAll();
    autoRefreshTimer = setInterval(fetchAll, AUTO_REFRESH_MS);
})();
