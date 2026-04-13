/**
 * Sensor Dashboard — client-side layout state + persistence.
 *
 * Shape:
 *   {
 *     editMode: false,
 *     panels: {
 *       [sensorId]: {
 *         collapsed: false,
 *         order: <int>,
 *         feeds: {
 *           temp: { chartType: 'line'|'area'|'bar'|'gauge', order: <int>, hidden: false },
 *           hum:  { ... },
 *           co2:  { ... }
 *         }
 *       }
 *     }
 *   }
 *
 * Only the `panels` slice is persisted — edit mode is session-scoped.
 */

import { FEED_DEFS } from './utils.js';

const STORAGE_KEY = 'sensor_dashboard_layout_v1';
const VALID_CHART_TYPES = ['line', 'area', 'bar', 'gauge'];
const DEFAULT_FEED_TYPES = { temp: 'line', hum: 'line', co2: 'line' };

const state = {
    editMode: false,
    panels: {},
};

let nextPanelOrder = 0;

// -------------------------------------------------------------------------
// Persistence
// -------------------------------------------------------------------------
function safeParse(json) {
    try { return JSON.parse(json); } catch (e) { return null; }
}

export function loadState() {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    const parsed = raw ? safeParse(raw) : null;
    if (parsed && parsed.panels && typeof parsed.panels === 'object') {
        // Sanitize
        for (const sid in parsed.panels) {
            const p = parsed.panels[sid];
            if (!p || typeof p !== 'object') continue;
            const feeds = {};
            for (const fdef of FEED_DEFS) {
                const incoming = p.feeds && p.feeds[fdef.key];
                feeds[fdef.key] = sanitizeFeed(incoming, fdef.key);
            }
            state.panels[sid] = {
                collapsed: !!p.collapsed,
                order: Number.isFinite(p.order) ? p.order : nextPanelOrder++,
                feeds,
            };
            if (Number.isFinite(p.order) && p.order >= nextPanelOrder) {
                nextPanelOrder = p.order + 1;
            }
        }
    }
}

function sanitizeFeed(incoming, feedKey) {
    const defaultType = DEFAULT_FEED_TYPES[feedKey] || 'line';
    const feedIndex = FEED_DEFS.findIndex(f => f.key === feedKey);
    if (!incoming || typeof incoming !== 'object') {
        return { chartType: defaultType, order: feedIndex, hidden: false };
    }
    const chartType = VALID_CHART_TYPES.indexOf(incoming.chartType) !== -1
        ? incoming.chartType
        : defaultType;
    return {
        chartType,
        order: Number.isFinite(incoming.order) ? incoming.order : feedIndex,
        hidden: !!incoming.hidden,
    };
}

export function saveState() {
    if (typeof localStorage === 'undefined') return;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ panels: state.panels }));
    } catch (e) {
        // Quota exceeded / disabled — fail silent.
    }
}

export function resetState() {
    state.panels = {};
    nextPanelOrder = 0;
    if (typeof localStorage !== 'undefined') {
        try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
    }
}

// -------------------------------------------------------------------------
// Edit mode
// -------------------------------------------------------------------------
export function isEditMode() { return state.editMode; }
export function setEditMode(on) { state.editMode = !!on; }
export function toggleEditMode() { state.editMode = !state.editMode; return state.editMode; }

// -------------------------------------------------------------------------
// Panel / feed accessors (auto-initialize on first access)
// -------------------------------------------------------------------------
export function getPanelState(sid) {
    if (!state.panels[sid]) {
        const feeds = {};
        for (let i = 0; i < FEED_DEFS.length; i++) {
            const fdef = FEED_DEFS[i];
            feeds[fdef.key] = {
                chartType: DEFAULT_FEED_TYPES[fdef.key] || 'line',
                order: i,
                hidden: false,
            };
        }
        state.panels[sid] = {
            collapsed: false,
            order: nextPanelOrder++,
            feeds,
        };
    }
    return state.panels[sid];
}

export function getFeedState(sid, feedKey) {
    const panel = getPanelState(sid);
    if (!panel.feeds[feedKey]) {
        const idx = FEED_DEFS.findIndex(f => f.key === feedKey);
        panel.feeds[feedKey] = {
            chartType: DEFAULT_FEED_TYPES[feedKey] || 'line',
            order: idx === -1 ? 99 : idx,
            hidden: false,
        };
    }
    return panel.feeds[feedKey];
}

export function removePanelState(sid) {
    if (state.panels[sid]) delete state.panels[sid];
    saveState();
}

// -------------------------------------------------------------------------
// Mutations (all persist)
// -------------------------------------------------------------------------
export function setPanelCollapsed(sid, collapsed) {
    getPanelState(sid).collapsed = !!collapsed;
    saveState();
}

export function setFeedChartType(sid, feedKey, chartType) {
    if (VALID_CHART_TYPES.indexOf(chartType) === -1) return;
    getFeedState(sid, feedKey).chartType = chartType;
    saveState();
}

export function setFeedHidden(sid, feedKey, hidden) {
    getFeedState(sid, feedKey).hidden = !!hidden;
    saveState();
}

export function setPanelOrder(orderedSids) {
    for (let i = 0; i < orderedSids.length; i++) {
        getPanelState(orderedSids[i]).order = i;
    }
    saveState();
}

export function setFeedOrder(sid, orderedFeedKeys) {
    const panel = getPanelState(sid);
    for (let i = 0; i < orderedFeedKeys.length; i++) {
        const feed = panel.feeds[orderedFeedKeys[i]];
        if (feed) feed.order = i;
    }
    saveState();
}

// -------------------------------------------------------------------------
// Sorted views
// -------------------------------------------------------------------------
export function sortSensors(sensors) {
    const copy = sensors.slice();
    copy.sort((a, b) => {
        const oa = getPanelState(a.sensor_id).order;
        const ob = getPanelState(b.sensor_id).order;
        if (oa === ob) return a.location_name.localeCompare(b.location_name);
        return oa - ob;
    });
    // Normalize orders so 0..n
    for (let i = 0; i < copy.length; i++) {
        getPanelState(copy[i].sensor_id).order = i;
    }
    return copy;
}

export function sortFeeds(sid, feedDefs) {
    const panel = getPanelState(sid);
    const copy = feedDefs.slice();
    copy.sort((a, b) => {
        const oa = panel.feeds[a.key] ? panel.feeds[a.key].order : 99;
        const ob = panel.feeds[b.key] ? panel.feeds[b.key].order : 99;
        return oa - ob;
    });
    return copy;
}
