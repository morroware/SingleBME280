/**
 * Sensor Dashboard — Chart.js factories + gauge renderer.
 *
 * Chart.js is loaded as a global (`window.Chart`) from the CDN via index.php.
 */

import { fmt, CHART_COLORS } from './utils.js';

const CHART_INSTANCES = [];

export function destroyAllCharts() {
    while (CHART_INSTANCES.length) {
        const c = CHART_INSTANCES.pop();
        try { c.destroy(); } catch (e) { /* ignore */ }
    }
}

function colorFor(field) {
    return CHART_COLORS[field] || '#4a9eff';
}

function makeGradient(ctx, canvas, color, strong) {
    const h = (canvas.parentElement && canvas.parentElement.clientHeight) || 200;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, color + (strong ? '55' : '30'));
    g.addColorStop(1, color + '02');
    return g;
}

function baseOptions(field, unit) {
    return {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        animation: { duration: 400 },
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
                    label(ctx) {
                        const v = ctx.parsed.y;
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
                    callback(v) { return v + unit; },
                },
                grid: { color: 'rgba(42,47,58,0.4)' },
            },
        },
    };
}

export function createLineChart(canvas, dataPoints, field, unit, opts) {
    if (!window.Chart) return null;
    const color = colorFor(field);
    const ctx = canvas.getContext('2d');
    const filled = opts && opts.filled;
    const gradient = filled ? makeGradient(ctx, canvas, color, true) : makeGradient(ctx, canvas, color, false);

    const chart = new window.Chart(ctx, {
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
                tension: filled ? 0.35 : 0.3,
                fill: true,
            }],
        },
        options: baseOptions(field, unit),
    });
    CHART_INSTANCES.push(chart);
    return chart;
}

export function createAreaChart(canvas, dataPoints, field, unit) {
    // Same as a line chart but with a more prominent fill gradient.
    return createLineChart(canvas, dataPoints, field, unit, { filled: true });
}

export function createBarChart(canvas, dataPoints, field, unit) {
    if (!window.Chart) return null;
    const color = colorFor(field);
    const ctx = canvas.getContext('2d');
    const gradient = makeGradient(ctx, canvas, color, true);

    // Chart.js time-scale bar charts need a reasonable barThickness to avoid
    // 1px slivers on wide ranges; clamp thickness based on point count.
    const target = Math.max(2, Math.min(18, Math.floor(260 / Math.max(1, dataPoints.length))));

    const chart = new window.Chart(ctx, {
        type: 'bar',
        data: {
            datasets: [{
                data: dataPoints,
                backgroundColor: gradient,
                borderColor: color,
                borderWidth: 1,
                borderRadius: 2,
                barThickness: target,
                maxBarThickness: 18,
            }],
        },
        options: baseOptions(field, unit),
    });
    CHART_INSTANCES.push(chart);
    return chart;
}

/**
 * Draws a half-circle gauge directly onto a canvas and writes the current
 * value into an adjacent `.gauge-value-display` element if present.
 */
export function drawGauge(canvasId, value, min, max, color, unit) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h - 10;
    const r = Math.min(cx, cy) - 10;

    ctx.clearRect(0, 0, w, h);

    // Background arc
    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.PI, 0, false);
    ctx.lineWidth = 14;
    ctx.strokeStyle = 'rgba(42,47,58,0.6)';
    ctx.lineCap = 'round';
    ctx.stroke();

    // Value arc
    let pct = (value - min) / (max - min);
    pct = Math.max(0, Math.min(1, pct));
    const endAngle = Math.PI + (pct * Math.PI);
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

    // Value text (on adjacent element)
    const valDisplay = canvas.parentElement && canvas.parentElement.querySelector('.gauge-value-display');
    if (valDisplay) {
        valDisplay.style.color = color;
        valDisplay.textContent = fmt(value, unit === ' ppm' ? 0 : 1, unit);
    }
}
