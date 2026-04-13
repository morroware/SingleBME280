/**
 * Sensor Dashboard — shared utilities
 */

export const SENSOR_PORT = 5000;

export const CHART_COLORS = {
    temperature_f: '#fbbf24',
    humidity:      '#4a9eff',
    co2:           '#a78bfa',
};

/** Feed metadata. Keeps render/state/drag layers in sync. */
export const FEED_DEFS = [
    {
        key: 'temp',
        title: 'Temperature',
        field: 'temperature_f',
        unit: '\u00B0F',
        unitSm: '\u00B0',
        color: CHART_COLORS.temperature_f,
        decimals: 1,
        gaugeMin: 30,
        gaugeMax: 120,
        availableFor: ['bme280', 'scd40'],
    },
    {
        key: 'hum',
        title: 'Humidity',
        field: 'humidity',
        unit: '%',
        unitSm: '%',
        color: CHART_COLORS.humidity,
        decimals: 0,
        gaugeMin: 0,
        gaugeMax: 100,
        availableFor: ['bme280', 'scd40'],
    },
    {
        key: 'co2',
        title: 'CO\u2082',
        field: 'co2',
        unit: ' ppm',
        unitSm: '',
        color: CHART_COLORS.co2,
        decimals: 0,
        gaugeMin: 400,
        gaugeMax: 2000,
        availableFor: ['scd40'],
    },
];

export function feedsForSensor(sensor) {
    const type = sensor.sensor_type || 'bme280';
    return FEED_DEFS.filter(f => f.availableFor.indexOf(type) !== -1);
}

export function getFeedDef(key) {
    return FEED_DEFS.find(f => f.key === key) || null;
}

export function esc(str) {
    const d = document.createElement('div');
    d.textContent = str == null ? '' : String(str);
    return d.innerHTML;
}

export function timeAgo(dateStr) {
    if (!dateStr) return 'Never';
    const diff = Math.floor((new Date() - new Date(dateStr)) / 1000);
    if (isNaN(diff) || diff < 0) return 'Just now';
    if (diff < 60)    return diff + 's ago';
    if (diff < 3600)  return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
}

export function fmt(v, decimals, unit) {
    if (v === null || v === undefined || isNaN(v)) return '--';
    return v.toFixed(decimals !== undefined ? decimals : 1) + (unit || '');
}

export function calcStats(values) {
    const nums = [];
    for (let i = 0; i < values.length; i++) {
        const v = values[i];
        if (v !== null && v !== undefined && !isNaN(v)) nums.push(v);
    }
    if (nums.length === 0) return null;
    let min = nums[0], max = nums[0], sum = 0;
    for (let j = 0; j < nums.length; j++) {
        if (nums[j] < min) min = nums[j];
        if (nums[j] > max) max = nums[j];
        sum += nums[j];
    }
    return { current: nums[nums.length - 1], min, max, avg: sum / nums.length };
}

export function sensorUrl(sensor) {
    if (!sensor || !sensor.ip_address) return null;
    return 'http://' + sensor.ip_address + ':' + SENSOR_PORT;
}

/** Extract a feed's numeric series + {x,y} points from raw readings. */
export function extractFeedSeries(data, feedKey) {
    const def = getFeedDef(feedKey);
    if (!def) return { values: [], points: [] };
    const values = [];
    const points = [];
    for (let i = 0; i < data.length; i++) {
        const row = data[i];
        const v = row[def.field];
        values.push(v);
        if (v !== null && v !== undefined && !isNaN(v)) {
            points.push({ x: new Date(row.time), y: v });
        }
    }
    return { values, points };
}
