/**
 * Sensor Dashboard – Per-Sensor Chart.js Frontend
 *
 * Each sensor gets its own panel with dedicated Temperature, Humidity,
 * and (for SCD40) CO2 charts – similar to Adafruit IO feed dashboards.
 */

(function () {
    'use strict';

    // -----------------------------------------------------------------------
    // Config
    // -----------------------------------------------------------------------
    var AUTO_REFRESH_MS = 60000;

    // One distinct colour per sensor – consistent across refreshes
    var PALETTE = [
        '#fbbf24', '#4a9eff', '#34d399', '#f87171', '#a78bfa',
        '#fb923c', '#38bdf8', '#e879f9', '#84cc16', '#f472b6',
        '#22d3ee', '#facc15', '#c084fc', '#2dd4bf', '#fb7185',
        '#a3e635', '#818cf8', '#fca5a5', '#67e8f9', '#d946ef',
    ];

    var CHART_COLORS = {
        temperature_f: '#fbbf24',
        humidity:      '#4a9eff',
        co2:           '#a78bfa',
    };

    var CHART_GRADIENT_COLORS = {
        temperature_f: 'rgba(251,191,36,0.10)',
        humidity:      'rgba(74,158,255,0.10)',
        co2:           'rgba(167,139,250,0.10)',
    };

    // -----------------------------------------------------------------------
    // State
    // -----------------------------------------------------------------------
    var currentRange    = '24h';
    var autoRefreshTimer = null;
    var chartInstances  = [];       // all Chart objects for cleanup
    var sensorColorMap  = {};       // sensor_id -> colour
    var colorIndex      = 0;

    // -----------------------------------------------------------------------
    // DOM refs
    // -----------------------------------------------------------------------
    var mainContent   = document.getElementById('mainContent');
    var globalLoading = document.getElementById('globalLoading');
    var refreshBtn    = document.getElementById('refreshBtn');
    var rangeButtons  = document.querySelectorAll('.range-btn');

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------
    function escapeHtml(str) {
        var d = document.createElement('div');
        d.textContent = str || '';
        return d.innerHTML;
    }

    function timeAgo(dateStr) {
        if (!dateStr) return 'Never';
        var now  = new Date();
        var then = new Date(dateStr.replace(' ', 'T'));
        var diff = Math.floor((now - then) / 1000);
        if (isNaN(diff) || diff < 0) return 'Just now';
        if (diff < 60)    return diff + 's ago';
        if (diff < 3600)  return Math.floor(diff / 60) + 'm ago';
        if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
        return Math.floor(diff / 86400) + 'd ago';
    }

    function sensorColor(sid) {
        if (!sensorColorMap[sid]) {
            sensorColorMap[sid] = PALETTE[colorIndex % PALETTE.length];
            colorIndex++;
        }
        return sensorColorMap[sid];
    }

    function fmt(v, decimals, unit) {
        if (v === null || v === undefined || isNaN(v)) return '--';
        return v.toFixed(decimals !== undefined ? decimals : 1) + (unit || '');
    }

    // Compute stats from an array of numeric values (ignoring nulls)
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
        return {
            current: nums[nums.length - 1],
            min:     min,
            max:     max,
            avg:     sum / nums.length,
        };
    }

    // -----------------------------------------------------------------------
    // Chart factory
    // -----------------------------------------------------------------------
    function destroyAllCharts() {
        for (var i = 0; i < chartInstances.length; i++) {
            chartInstances[i].destroy();
        }
        chartInstances = [];
    }

    function createChart(canvas, dataPoints, field, unit) {
        var color    = CHART_COLORS[field] || '#4a9eff';
        var gradBase = CHART_GRADIENT_COLORS[field] || 'rgba(74,158,255,0.10)';

        var ctx = canvas.getContext('2d');
        var gradient = ctx.createLinearGradient(0, 0, 0, canvas.parentElement.clientHeight || 220);
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
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: '#2a2e38',
                        titleColor: '#e8eaed',
                        bodyColor: '#e8eaed',
                        borderColor: '#363b47',
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
                            displayFormats: {
                                minute: 'HH:mm',
                                hour:   'HH:mm',
                                day:    'MMM d',
                            },
                        },
                        ticks: { color: '#6b7280', maxTicksLimit: 8, font: { size: 11 } },
                        grid:  { color: 'rgba(54,59,71,0.3)' },
                    },
                    y: {
                        ticks: {
                            color: '#6b7280',
                            font: { size: 11 },
                            callback: function (v) { return v + unit; },
                        },
                        grid: { color: 'rgba(54,59,71,0.3)' },
                    },
                },
            },
        });

        chartInstances.push(chart);
        return chart;
    }

    // -----------------------------------------------------------------------
    // Overview strip (quick-glance cards at top)
    // -----------------------------------------------------------------------
    function buildOverviewStrip(sensors) {
        if (!sensors || sensors.length === 0) return '';

        var html = '<div class="overview-strip">';
        for (var i = 0; i < sensors.length; i++) {
            var s = sensors[i];
            var onClass   = s.online ? 'status-online'  : 'status-offline';
            var onText    = s.online ? 'Online' : 'Offline';
            var offClass  = s.online ? '' : ' offline';
            var badgeClass = s.sensor_type === 'scd40' ? 'badge-scd40' : 'badge-bme280';
            var temp = s.latest.temperature_f !== null ? fmt(s.latest.temperature_f, 1, '\u00B0F') : '--';
            var hum  = s.latest.humidity !== null      ? fmt(s.latest.humidity, 1, '%') : '--';
            var co2  = s.latest.co2 !== null           ? fmt(s.latest.co2, 0, '') : null;

            html += '<div class="overview-card' + offClass + '">' +
                '<div class="overview-header">' +
                    '<span class="overview-name">' + escapeHtml(s.location_name) + '</span>' +
                    '<span class="sensor-badge ' + badgeClass + '">' + escapeHtml(s.sensor_type).toUpperCase() + '</span>' +
                '</div>' +
                '<div class="overview-values">' +
                    '<span class="ov-temp">' + temp + '</span>' +
                    '<span class="ov-hum">' + hum + '</span>' +
                    (co2 !== null ? '<span class="ov-co2">' + co2 + ' ppm</span>' : '') +
                '</div>' +
                '<div class="overview-status">' +
                    '<span class="status-dot ' + onClass + '"></span>' +
                    onText + ' \u00B7 ' + timeAgo(s.last_seen) +
                '</div>' +
            '</div>';
        }
        html += '</div>';
        return html;
    }

    // -----------------------------------------------------------------------
    // Per-sensor panel HTML
    // -----------------------------------------------------------------------
    function buildPanelHTML(sensor, sensorReadings) {
        var sid   = sensor.sensor_id;
        var isSCD = sensor.sensor_type === 'scd40';
        var onClass  = sensor.online ? 'status-online' : 'status-offline';
        var onText   = sensor.online ? 'Online' : 'Offline';
        var badgeClass = isSCD ? 'badge-scd40' : 'badge-bme280';

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

        var html = '<div class="sensor-panel" id="panel-' + sid + '">';

        // Header
        html += '<div class="panel-header">' +
            '<span class="panel-name">' + escapeHtml(sensor.location_name) + '</span>' +
            '<span class="sensor-badge ' + badgeClass + '">' + escapeHtml(sensor.sensor_type).toUpperCase() + '</span>' +
            '<span class="panel-status"><span class="status-dot ' + onClass + '"></span>' + onText + '</span>' +
            '<span class="panel-last-seen">' + timeAgo(sensor.last_seen) + '</span>' +
        '</div>';

        // Charts row
        html += '<div class="panel-charts">';

        // --- Temperature block ---
        html += '<div class="chart-block">' +
            '<div class="chart-block-title">Temperature</div>';
        if (tempStats) {
            html += '<div class="chart-stats">' +
                '<div class="stat stat-temp"><span class="stat-value">' + fmt(tempStats.current, 1, '\u00B0F') + '</span><span class="stat-label">Current</span></div>' +
                '<div class="stat stat-temp"><span class="stat-value-sm">' + fmt(tempStats.min, 1, '\u00B0') + '</span><span class="stat-label">Min</span></div>' +
                '<div class="stat stat-temp"><span class="stat-value-sm">' + fmt(tempStats.max, 1, '\u00B0') + '</span><span class="stat-label">Max</span></div>' +
                '<div class="stat stat-temp"><span class="stat-value-sm">' + fmt(tempStats.avg, 1, '\u00B0') + '</span><span class="stat-label">Avg</span></div>' +
            '</div>';
            html += '<div class="chart-container"><canvas id="chart-temp-' + sid + '"></canvas></div>';
        } else {
            html += '<div class="chart-nodata">No temperature data for this range</div>';
        }
        html += '</div>';

        // --- Humidity block ---
        html += '<div class="chart-block">' +
            '<div class="chart-block-title">Humidity</div>';
        if (humStats) {
            html += '<div class="chart-stats">' +
                '<div class="stat stat-hum"><span class="stat-value">' + fmt(humStats.current, 1, '%') + '</span><span class="stat-label">Current</span></div>' +
                '<div class="stat stat-hum"><span class="stat-value-sm">' + fmt(humStats.min, 1, '%') + '</span><span class="stat-label">Min</span></div>' +
                '<div class="stat stat-hum"><span class="stat-value-sm">' + fmt(humStats.max, 1, '%') + '</span><span class="stat-label">Max</span></div>' +
                '<div class="stat stat-hum"><span class="stat-value-sm">' + fmt(humStats.avg, 1, '%') + '</span><span class="stat-label">Avg</span></div>' +
            '</div>';
            html += '<div class="chart-container"><canvas id="chart-hum-' + sid + '"></canvas></div>';
        } else {
            html += '<div class="chart-nodata">No humidity data for this range</div>';
        }
        html += '</div>';

        // --- CO2 block (SCD40 only) ---
        if (isSCD) {
            html += '<div class="chart-block">' +
                '<div class="chart-block-title">CO\u2082</div>';
            if (co2Stats) {
                html += '<div class="chart-stats">' +
                    '<div class="stat stat-co2"><span class="stat-value">' + fmt(co2Stats.current, 0, ' ppm') + '</span><span class="stat-label">Current</span></div>' +
                    '<div class="stat stat-co2"><span class="stat-value-sm">' + fmt(co2Stats.min, 0, '') + '</span><span class="stat-label">Min</span></div>' +
                    '<div class="stat stat-co2"><span class="stat-value-sm">' + fmt(co2Stats.max, 0, '') + '</span><span class="stat-label">Max</span></div>' +
                    '<div class="stat stat-co2"><span class="stat-value-sm">' + fmt(co2Stats.avg, 0, '') + '</span><span class="stat-label">Avg</span></div>' +
                '</div>';
                html += '<div class="chart-container"><canvas id="chart-co2-' + sid + '"></canvas></div>';
            } else {
                html += '<div class="chart-nodata">No CO\u2082 data for this range</div>';
            }
            html += '</div>';
        }

        html += '</div>'; // .panel-charts
        html += '</div>'; // .sensor-panel
        return html;
    }

    // -----------------------------------------------------------------------
    // Render everything
    // -----------------------------------------------------------------------
    function render(sensors, readingsData) {
        destroyAllCharts();

        if (!sensors || sensors.length === 0) {
            mainContent.innerHTML = '<div class="empty-state">' +
                '<p style="font-size:1.1rem;margin-bottom:8px;">No sensors registered yet.</p>' +
                '<p>Data will appear here once a Pi Zero posts its first reading.</p>' +
            '</div>';
            return;
        }

        var readings = readingsData.sensors || {};

        // Build full page HTML
        var html = buildOverviewStrip(sensors);

        for (var i = 0; i < sensors.length; i++) {
            var sid = sensors[i].sensor_id;
            var sensorReadings = readings[sid] || null;
            html += buildPanelHTML(sensors[i], sensorReadings);
        }

        mainContent.innerHTML = html;

        // Now instantiate Chart.js on each canvas
        for (var j = 0; j < sensors.length; j++) {
            var s   = sensors[j];
            var sid2 = s.sensor_id;
            var rd  = readings[sid2];
            if (!rd || !rd.data || rd.data.length === 0) continue;

            var data = rd.data;

            // Temperature
            var tempCanvas = document.getElementById('chart-temp-' + sid2);
            if (tempCanvas) {
                var tempPts = [];
                for (var k = 0; k < data.length; k++) {
                    if (data[k].temperature_f !== null) {
                        tempPts.push({ x: new Date(data[k].time.replace(' ', 'T')), y: data[k].temperature_f });
                    }
                }
                if (tempPts.length > 0) createChart(tempCanvas, tempPts, 'temperature_f', '\u00B0F');
            }

            // Humidity
            var humCanvas = document.getElementById('chart-hum-' + sid2);
            if (humCanvas) {
                var humPts = [];
                for (var m = 0; m < data.length; m++) {
                    if (data[m].humidity !== null) {
                        humPts.push({ x: new Date(data[m].time.replace(' ', 'T')), y: data[m].humidity });
                    }
                }
                if (humPts.length > 0) createChart(humCanvas, humPts, 'humidity', '%');
            }

            // CO2
            if (s.sensor_type === 'scd40') {
                var co2Canvas = document.getElementById('chart-co2-' + sid2);
                if (co2Canvas) {
                    var co2Pts = [];
                    for (var n = 0; n < data.length; n++) {
                        if (data[n].co2 !== null) {
                            co2Pts.push({ x: new Date(data[n].time.replace(' ', 'T')), y: data[n].co2 });
                        }
                    }
                    if (co2Pts.length > 0) createChart(co2Canvas, co2Pts, 'co2', ' ppm');
                }
            }
        }
    }

    // -----------------------------------------------------------------------
    // Data fetching
    // -----------------------------------------------------------------------
    function fetchAll() {
        refreshBtn.classList.add('spinning');

        var sensorsReq  = fetch('api/sensors.php')
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
            })
            .catch(function (err) {
                console.error('Dashboard fetch error:', err);
                // Only overwrite if still showing loading spinner
                if (globalLoading && globalLoading.parentNode === mainContent) {
                    mainContent.innerHTML = '<div class="empty-state">' +
                        '<p style="font-size:1.1rem;margin-bottom:8px;">Unable to load sensor data.</p>' +
                        '<p>Check your database settings in <code>config.php</code> and ensure <code>install.php</code> has been run.</p>' +
                    '</div>';
                }
            })
            .finally(function () {
                refreshBtn.classList.remove('spinning');
            });
    }

    // -----------------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------------
    rangeButtons.forEach(function (btn) {
        btn.addEventListener('click', function () {
            rangeButtons.forEach(function (b) { b.classList.remove('active'); });
            btn.classList.add('active');
            currentRange = btn.dataset.range;
            fetchAll();
        });
    });

    refreshBtn.addEventListener('click', fetchAll);

    // -----------------------------------------------------------------------
    // Init
    // -----------------------------------------------------------------------
    fetchAll();
    autoRefreshTimer = setInterval(fetchAll, AUTO_REFRESH_MS);
})();
