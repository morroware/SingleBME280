/**
 * Sensor Dashboard — layout state + persistence.
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
 *
 * Persistence is two-tier:
 *   1. localStorage — synchronous, used for instant first paint and as an
 *      offline-tolerant cache.
 *   2. Server (`/api/layout.php`) — authoritative, so customizations follow
 *      the user across devices, browsers and sessions. Writes are debounced
 *      (~500 ms) so a drag-reorder produces one POST, not dozens.
 */

import { FEED_DEFS } from './utils.js';
import { fetchLayout, saveLayout, deleteLayout } from './api.js';

const STORAGE_KEY = 'sensor_dashboard_layout_v1';
const VALID_CHART_TYPES = ['line', 'area', 'bar', 'gauge'];
const DEFAULT_FEED_TYPES = { temp: 'line', hum: 'line', co2: 'line' };
const SERVER_SAVE_DEBOUNCE_MS = 500;

const state = {
    editMode: false,
    panels: {},
};

let nextPanelOrder = 0;
let serverSaveTimer = null;
// JSON snapshot of the panels object as of the last successful server
// save. Used to skip redundant POSTs on auto-refresh ticks.
let lastSavedSnapshot = null;
// Server writes are gated until the first successful hydrate. Otherwise a
// newly-opened device would auto-initialize panels locally and POST them
// before the authoritative server copy arrives, clobbering customizations
// made on another device. Set by hydrateStateFromServer on completion.
let serverWritesEnabled = false;
// Set to true by any mutation that happened before hydrate finished, so
// the hydrate path knows to flush those local changes once it unblocks.
let pendingLocalMutation = false;

// -------------------------------------------------------------------------
// Persistence
// -------------------------------------------------------------------------
function safeParse(json) {
    try { return JSON.parse(json); } catch (e) { return null; }
}

/**
 * Reset in-memory state and replace it with the given `panels` object,
 * sanitizing every field. Used by both loadState (localStorage) and
 * hydrateStateFromServer (API).
 */
function applyPanels(panels) {
    state.panels = {};
    nextPanelOrder = 0;
    if (!panels || typeof panels !== 'object') return;

    for (const sid in panels) {
        const p = panels[sid];
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

export function loadState() {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    const parsed = raw ? safeParse(raw) : null;
    if (parsed && parsed.panels && typeof parsed.panels === 'object') {
        applyPanels(parsed.panels);
    }
}

/**
 * Pull the authoritative layout from the server and overlay it on the
 * in-memory state. Call this once after `loadState()` on page boot so
 * customizations roam across devices/sessions.
 *
 * Returns true if the server copy differed from what was loaded locally
 * (so the caller can re-render). Falls back silently on network errors —
 * the localStorage-loaded state continues to work offline.
 */
export async function hydrateStateFromServer() {
    let res;
    try {
        res = await fetchLayout();
    } catch (e) {
        // Network or auth error — keep the localStorage-loaded state.
        // Leave serverWritesEnabled=false so we don't clobber a server
        // copy we weren't able to read.
        return false;
    }

    const serverPanels = res && res.layout && res.layout.panels;

    // Empty object => no saved layout on the server yet. Whatever we
    // have locally becomes the new server baseline.
    if (!serverPanels || Object.keys(serverPanels).length === 0) {
        lastSavedSnapshot = JSON.stringify({ panels: {} });
        serverWritesEnabled = true;
        if (Object.keys(state.panels).length > 0 || pendingLocalMutation) {
            scheduleServerSave();
        }
        pendingLocalMutation = false;
        return false;
    }

    const before = JSON.stringify({ panels: state.panels });

    if (pendingLocalMutation) {
        // The user started editing this device before the server copy
        // came back. Respect their in-flight changes — their mutations
        // become the new baseline. We still merge in any server panels
        // they haven't touched so nothing is lost.
        for (const sid in serverPanels) {
            if (state.panels[sid]) continue;
            const p = serverPanels[sid];
            if (!p || typeof p !== 'object') continue;
            const feeds = {};
            for (const fdef of FEED_DEFS) {
                feeds[fdef.key] = sanitizeFeed(p.feeds && p.feeds[fdef.key], fdef.key);
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
    } else {
        applyPanels(serverPanels);
    }

    const after = JSON.stringify({ panels: state.panels });
    writeLocalStorage();

    // Mark the server copy we just read as the baseline. If we also
    // merged in local mutations, schedule a save to push the merged
    // state up.
    lastSavedSnapshot = JSON.stringify({ panels: serverPanels });
    serverWritesEnabled = true;
    if (pendingLocalMutation || after !== lastSavedSnapshot) {
        scheduleServerSave();
    }
    pendingLocalMutation = false;

    return before !== after;
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

function writeLocalStorage() {
    if (typeof localStorage === 'undefined') return;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ panels: state.panels }));
    } catch (e) {
        // Quota exceeded / disabled — fail silent.
    }
}

function scheduleServerSave() {
    if (!serverWritesEnabled) return;
    if (serverSaveTimer) clearTimeout(serverSaveTimer);
    serverSaveTimer = setTimeout(() => {
        serverSaveTimer = null;
        // Snapshot the current state at flush time so rapid edits
        // (e.g. during a drag) collapse into a single request.
        const snapshot = JSON.stringify({ panels: state.panels });
        // Skip the POST if nothing actually changed since the last save —
        // saveState() gets called on every 60s auto-refresh to commit any
        // newly-initialized panels, and most of those ticks are no-ops.
        if (snapshot === lastSavedSnapshot) return;
        saveLayout({ panels: state.panels }).then(() => {
            lastSavedSnapshot = snapshot;
        }).catch((e) => {
            // Leave localStorage as a fallback; the next mutation will
            // schedule another attempt.
            if (e && e.message !== 'unauthenticated') {
                console.warn('Layout save failed:', e);
            }
        });
    }, SERVER_SAVE_DEBOUNCE_MS);
}

export function saveState() {
    writeLocalStorage();
    if (!serverWritesEnabled) {
        // Remember that a mutation happened pre-hydrate so the hydrate
        // path can flush it instead of overwriting.
        pendingLocalMutation = true;
        return;
    }
    scheduleServerSave();
}

export function resetState() {
    state.panels = {};
    nextPanelOrder = 0;
    lastSavedSnapshot = JSON.stringify({ panels: {} });
    pendingLocalMutation = false;
    if (typeof localStorage !== 'undefined') {
        try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
    }
    // Cancel any pending server save — the DELETE supersedes it.
    if (serverSaveTimer) {
        clearTimeout(serverSaveTimer);
        serverSaveTimer = null;
    }
    // Explicit user action — once we've told the server to clear, we
    // can accept future writes even if the initial hydrate never
    // succeeded on this page load.
    serverWritesEnabled = true;
    deleteLayout().catch((e) => {
        if (e && e.message !== 'unauthenticated') {
            console.warn('Layout reset failed:', e);
        }
    });
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
