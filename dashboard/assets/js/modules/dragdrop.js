/**
 * Sensor Dashboard — HTML5 drag & drop for panels and feed blocks.
 *
 * Keeps state in sync with the DOM via state.js, then notifies the caller
 * (dashboard.js) so it can re-render and rebind interactions.
 */

import { setPanelOrder, setFeedOrder, isEditMode } from './state.js';

// ------------------------------------------------------------------
// Panel reordering
// ------------------------------------------------------------------
export function bindPanelDragAndDrop(root, onReorder) {
    if (!isEditMode()) return;
    const container = root.querySelector('#sensorPanels');
    if (!container) return;

    const panels = container.querySelectorAll('.sensor-panel[draggable="true"]');
    for (let i = 0; i < panels.length; i++) {
        bindPanelHandlers(panels[i], container, onReorder);
    }
}

function bindPanelHandlers(panel, container, onReorder) {
    panel.addEventListener('dragstart', (e) => {
        // Only start drag from the drag handle OR the header (but not feed blocks)
        const feedBlock = e.target.closest && e.target.closest('.chart-block');
        if (feedBlock) { e.preventDefault(); return; }
        panel.classList.add('dragging');
        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            // Firefox needs data to trigger drag
            try { e.dataTransfer.setData('text/plain', panel.dataset.sensorId || ''); } catch (err) { /* ignore */ }
        }
    });

    panel.addEventListener('dragend', () => {
        panel.classList.remove('dragging');
        container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        commitPanelOrder(container, onReorder);
    });

    panel.addEventListener('dragover', (e) => {
        e.preventDefault();
        const dragging = container.querySelector('.sensor-panel.dragging');
        if (!dragging || dragging === panel) return;
        const rect = panel.getBoundingClientRect();
        const before = (e.clientY - rect.top) < rect.height / 2;
        container.insertBefore(dragging, before ? panel : panel.nextSibling);
    });
}

function commitPanelOrder(container, onReorder) {
    const sids = [];
    const panels = container.querySelectorAll('.sensor-panel[data-sensor-id]');
    for (let i = 0; i < panels.length; i++) sids.push(panels[i].dataset.sensorId);
    setPanelOrder(sids);
    if (typeof onReorder === 'function') onReorder();
}

// ------------------------------------------------------------------
// Feed (chart-block) reordering — scoped per panel
// ------------------------------------------------------------------
export function bindFeedDragAndDrop(root, onReorder) {
    if (!isEditMode()) return;
    const containers = root.querySelectorAll('.panel-charts[data-sensor-id]');
    for (let i = 0; i < containers.length; i++) {
        bindFeedsInContainer(containers[i], onReorder);
    }
}

function bindFeedsInContainer(container, onReorder) {
    const sid = container.dataset.sensorId;
    const blocks = container.querySelectorAll('.chart-block[draggable="true"]');
    for (let i = 0; i < blocks.length; i++) {
        bindFeedHandlers(blocks[i], container, sid, onReorder);
    }
}

function bindFeedHandlers(block, container, sid, onReorder) {
    block.addEventListener('dragstart', (e) => {
        // Don't start a drag from an interactive control inside the block
        if (e.target.closest('button') || e.target.closest('a')) {
            e.preventDefault();
            return;
        }
        e.stopPropagation(); // don't trigger panel drag
        block.classList.add('dragging');
        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            try { e.dataTransfer.setData('text/plain', block.dataset.feedKey || ''); } catch (err) { /* ignore */ }
        }
    });

    block.addEventListener('dragend', (e) => {
        e.stopPropagation();
        block.classList.remove('dragging');
        commitFeedOrder(container, sid, onReorder);
    });

    block.addEventListener('dragover', (e) => {
        const dragging = container.querySelector('.chart-block.dragging');
        if (!dragging || dragging === block) return;
        e.preventDefault();
        e.stopPropagation();
        const rect = block.getBoundingClientRect();
        // Use horizontal midpoint on wide screens, vertical on narrow
        const isHorizontal = container.clientWidth > 600;
        const before = isHorizontal
            ? (e.clientX - rect.left) < rect.width / 2
            : (e.clientY - rect.top) < rect.height / 2;
        container.insertBefore(dragging, before ? block : block.nextSibling);
    });
}

function commitFeedOrder(container, sid, onReorder) {
    const keys = [];
    const blocks = container.querySelectorAll('.chart-block[data-feed-key]');
    for (let i = 0; i < blocks.length; i++) keys.push(blocks[i].dataset.feedKey);
    setFeedOrder(sid, keys);
    if (typeof onReorder === 'function') onReorder();
}
