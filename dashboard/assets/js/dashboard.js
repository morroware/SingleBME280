/**
 * Sensor Dashboard – Chart.js Frontend
 *
 * Fetches sensor data from the PHP API and renders interactive
 * temperature, humidity, and CO2 charts.
 */

(function () {
    'use strict';

    // -----------------------------------------------------------------------
    // State
    // -----------------------------------------------------------------------
    let currentRange = '24h';
    let autoRefreshTimer = null;
    const AUTO_REFRESH_MS = 60000; // 60 seconds

    // Chart instances
    let tempChart = null;
    let humChart  = null;
    let co2Chart  = null;

    // Distinct colours for up to 20 sensors
    const COLORS = [
        '#4a9eff', '#34d399', '#fbbf24', '#f87171', '#a78bfa',
        '#fb923c', '#38bdf8', '#e879f9', '#84cc16', '#f472b6',
        '#22d3ee', '#facc15', '#c084fc', '#2dd4bf', '#fb7185',
        '#a3e635', '#818cf8', '#fca5a5', '#67e8f9', '#d946ef',
    ];

    // -----------------------------------------------------------------------
    // DOM refs
    // -----------------------------------------------------------------------
    const sensorGrid = document.getElementById('sensorGrid');
    const co2Panel   = document.getElementById('co2Panel');
    const refreshBtn = document.getElementById('refreshBtn');
    const rangeButtons = document.querySelectorAll('.range-btn');

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------
    function getColor(index) {
        return COLORS[index % COLORS.length];
    }

    function formatTime(range) {
        // Pick a readable time format based on the active range
        if (range === '1h' || range === '6h') return 'HH:mm';
        if (range === '24h') return 'HH:mm';
        if (range === '7d')  return 'MMM d HH:mm';
        return 'MMM d';
    }

    function makeChartConfig(label, yUnit, datasets, range) {
        return {
            type: 'line',
            data: { datasets: datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                plugins: {
                    legend: {
                        labels: {
                            color: '#9aa0a9',
                            usePointStyle: true,
                            pointStyle: 'circle',
                            padding: 16,
                            font: { size: 12 },
                        },
                    },
                    tooltip: {
                        backgroundColor: '#2a2e38',
                        titleColor: '#e8eaed',
                        bodyColor: '#e8eaed',
                        borderColor: '#363b47',
                        borderWidth: 1,
                        padding: 10,
                        callbacks: {
                            label: function (ctx) {
                                let val = ctx.parsed.y;
                                if (val === null || val === undefined) return null;
                                return ctx.dataset.label + ': ' + val.toFixed(1) + yUnit;
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
                                hour: 'HH:mm',
                                day: 'MMM d',
                            },
                        },
                        ticks: { color: '#9aa0a9', maxTicksLimit: 12 },
                        grid:  { color: 'rgba(54,59,71,0.5)' },
                    },
                    y: {
                        ticks: {
                            color: '#9aa0a9',
                            callback: function (v) { return v + yUnit; },
                        },
                        grid: { color: 'rgba(54,59,71,0.5)' },
                    },
                },
            },
        };
    }

    // -----------------------------------------------------------------------
    // Sensor cards
    // -----------------------------------------------------------------------
    function renderSensorCards(sensors) {
        if (!sensors || sensors.length === 0) {
            sensorGrid.innerHTML = '<div class="empty-state">No sensors registered yet. Data will appear once a sensor posts its first reading.</div>';
            return;
        }

        sensorGrid.innerHTML = sensors.map(function (s) {
            var onlineClass = s.online ? 'status-online' : 'status-offline';
            var onlineText  = s.online ? 'Online' : 'Offline';
            var badgeClass  = s.sensor_type === 'scd40' ? 'badge-scd40' : 'badge-bme280';
            var temp = s.latest.temperature_f !== null ? s.latest.temperature_f.toFixed(1) + '\u00B0F' : '--';
            var hum  = s.latest.humidity !== null ? s.latest.humidity.toFixed(1) + '%' : '--';
            var co2  = s.latest.co2 !== null ? s.latest.co2 + ' ppm' : null;
            var lastSeen = s.last_seen ? timeAgo(s.last_seen) : 'Never';

            var co2Row = '';
            if (co2 !== null) {
                co2Row = '<div class="reading-row"><span class="reading-label">CO\u2082</span><span class="reading-value reading-co2">' + co2 + '</span></div>';
            }

            return '<div class="sensor-card">' +
                '<div class="sensor-card-header">' +
                    '<span class="sensor-name">' + escapeHtml(s.location_name) + '</span>' +
                    '<span class="sensor-badge ' + badgeClass + '">' + s.sensor_type.toUpperCase() + '</span>' +
                '</div>' +
                '<div class="sensor-readings">' +
                    '<div class="reading-row"><span class="reading-label">Temp</span><span class="reading-value reading-temp">' + temp + '</span></div>' +
                    '<div class="reading-row"><span class="reading-label">Humidity</span><span class="reading-value reading-hum">' + hum + '</span></div>' +
                    co2Row +
                '</div>' +
                '<div class="sensor-status">' +
                    '<span class="status-dot ' + onlineClass + '"></span>' +
                    onlineText + ' &middot; ' + lastSeen +
                '</div>' +
            '</div>';
        }).join('');
    }

    function escapeHtml(str) {
        var d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }

    function timeAgo(dateStr) {
        var now = new Date();
        var then = new Date(dateStr.replace(' ', 'T'));
        var diff = Math.floor((now - then) / 1000);
        if (diff < 60) return diff + 's ago';
        if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
        if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
        return Math.floor(diff / 86400) + 'd ago';
    }

    // -----------------------------------------------------------------------
    // Charts
    // -----------------------------------------------------------------------
    function buildDatasets(readingsData, field) {
        var datasets = [];
        var i = 0;
        var sensorIds = Object.keys(readingsData.sensors || {});

        sensorIds.forEach(function (sid) {
            var sensorInfo = readingsData.sensors[sid];
            var points = sensorInfo.data
                .filter(function (d) { return d[field] !== null; })
                .map(function (d) {
                    return { x: new Date(d.time.replace(' ', 'T')), y: d[field] };
                });

            if (points.length > 0) {
                var color = getColor(i);
                datasets.push({
                    label: sid,
                    data: points,
                    borderColor: color,
                    backgroundColor: color + '20',
                    borderWidth: 2,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    tension: 0.3,
                    fill: false,
                });
            }
            i++;
        });

        return datasets;
    }

    function hasCO2Data(readingsData) {
        var sensorIds = Object.keys(readingsData.sensors || {});
        for (var j = 0; j < sensorIds.length; j++) {
            var data = readingsData.sensors[sensorIds[j]].data;
            for (var k = 0; k < data.length; k++) {
                if (data[k].co2 !== null) return true;
            }
        }
        return false;
    }

    function renderCharts(readingsData) {
        // Temperature
        var tempDs = buildDatasets(readingsData, 'temperature_f');
        if (tempChart) tempChart.destroy();
        tempChart = new Chart(
            document.getElementById('tempChart'),
            makeChartConfig('Temperature', '\u00B0F', tempDs, currentRange)
        );

        // Humidity
        var humDs = buildDatasets(readingsData, 'humidity');
        if (humChart) humChart.destroy();
        humChart = new Chart(
            document.getElementById('humChart'),
            makeChartConfig('Humidity', '%', humDs, currentRange)
        );

        // CO2
        if (hasCO2Data(readingsData)) {
            co2Panel.style.display = '';
            var co2Ds = buildDatasets(readingsData, 'co2');
            if (co2Chart) co2Chart.destroy();
            co2Chart = new Chart(
                document.getElementById('co2Chart'),
                makeChartConfig('CO\u2082', ' ppm', co2Ds, currentRange)
            );
        } else {
            co2Panel.style.display = 'none';
        }
    }

    // -----------------------------------------------------------------------
    // Data fetching
    // -----------------------------------------------------------------------
    function fetchAll() {
        refreshBtn.classList.add('spinning');

        var sensorsReq  = fetch('api/sensors.php').then(function (r) { return r.json(); });
        var readingsReq = fetch('api/readings.php?range=' + encodeURIComponent(currentRange) + '&sensor_id=all')
            .then(function (r) { return r.json(); });

        Promise.all([sensorsReq, readingsReq])
            .then(function (results) {
                renderSensorCards(results[0]);
                renderCharts(results[1]);
            })
            .catch(function (err) {
                console.error('Fetch error:', err);
                sensorGrid.innerHTML = '<div class="empty-state">Error loading data. Check your connection and config.php settings.</div>';
            })
            .finally(function () {
                refreshBtn.classList.remove('spinning');
            });
    }

    // -----------------------------------------------------------------------
    // Event listeners
    // -----------------------------------------------------------------------
    rangeButtons.forEach(function (btn) {
        btn.addEventListener('click', function () {
            rangeButtons.forEach(function (b) { b.classList.remove('active'); });
            btn.classList.add('active');
            currentRange = btn.dataset.range;
            fetchAll();
        });
    });

    refreshBtn.addEventListener('click', function () {
        fetchAll();
    });

    // -----------------------------------------------------------------------
    // Init
    // -----------------------------------------------------------------------
    fetchAll();

    autoRefreshTimer = setInterval(fetchAll, AUTO_REFRESH_MS);
})();
