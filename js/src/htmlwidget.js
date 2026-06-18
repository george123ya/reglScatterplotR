// ============================================================================
// Local dependency bundling (NO CDN at runtime).
// These were previously loaded from esm.sh / cdnjs via dynamic import() and
// <script>/<link> injection. They are now bundled by esbuild and pre-assigned
// to the same globals the widget body checks, so every `typeof X === 'undefined'`
// / `if (!window.X)` guard below short-circuits and the rendering logic is
// unchanged - it just never touches the network.
// ============================================================================
import * as d3 from 'd3';
import * as reglScatterplotMod from 'regl-scatterplot';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

window.d3 = d3;
window.__reglScatterplotMod = reglScatterplotMod;
window.html2canvas = html2canvas;
window.jspdf = { jsPDF };

// ============================================================================
// reglScatterplot widget
// Wrapped in an IIFE so re-loading the script (which Jupyter / IRkernel do
// on every cell render) doesn't throw "Identifier already declared" for the
// top-level `const` bindings. Shared state lives on `window.__myScatterplotRegistry`.
// ============================================================================
(function () {
'use strict';

// ============================================================================
// MULTI-SYNC REGISTRY (COMMITTEE MODEL)
// ============================================================================
if (!window.__myScatterplotRegistry) {
  window.__myScatterplotRegistry = new Map();
  window.__myScatterplotRegistry.globalSyncEnabled = false; 
  window.__myScatterplotRegistry.currentSyncGroupSet = null; 

  window.__myScatterplotRegistry.isSyncing = false;       
  window.__myScatterplotRegistry.syncLeader = null;       
  window.__myScatterplotRegistry.leaderTimeout = null;
  // Filter / legend-selection state is stored per-plot on each registry entry
  // (entry.activeStrainers / indexFilters / categorySelections), so independent
  // plots sharing one page never affect each other.
  window.__myScatterplotRegistry.n_points = 0; // placeholder set per render
}

if (!window.__spUnsubscribers) { window.__spUnsubscribers = {}; }

const globalRegistry = window.__myScatterplotRegistry;

const cloneCamera = (cam) => {
    if (!cam) return null;
    if (cam instanceof Float32Array) return new Float32Array(cam);
    if (Array.isArray(cam)) return [...cam];
    return JSON.parse(JSON.stringify(cam));
};

const decodeBase64 = (base64Str) => {
    if (!base64Str) return null;
    if (typeof base64Str !== 'string') return new Float32Array(base64Str);

    // Helper: base64 string -> Uint8Array.
    const _b64ToBytes = (s) => {
        const raw = atob(s);
        const len = raw.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = raw.charCodeAt(i);
        return bytes;
    };

    // Bipolar Uint16 -> [-1, 1] Float32 (X / Y coordinates).
    if (base64Str.startsWith('base64u16:')) {
        const bytes = _b64ToBytes(base64Str.slice(10));
        const u16 = new Uint16Array(bytes.buffer);
        const out = new Float32Array(u16.length);
        const inv = 1 / 32767.5;
        for (let i = 0; i < u16.length; i++) out[i] = u16[i] * inv - 1;
        return out;
    }
    // Unit Uint16 -> [0, 1] Float32 (continuous colour z).
    if (base64Str.startsWith('base64u16u:')) {
        const bytes = _b64ToBytes(base64Str.slice(11));
        const u16 = new Uint16Array(bytes.buffer);
        const out = new Float32Array(u16.length);
        const inv = 1 / 65535;
        for (let i = 0; i < u16.length; i++) out[i] = u16[i] * inv;
        return out;
    }
    // Integer Uint16 -> Float32 (categorical colour / group indices).
    if (base64Str.startsWith('base64u16i:')) {
        const bytes = _b64ToBytes(base64Str.slice(11));
        const u16 = new Uint16Array(bytes.buffer);
        return Float32Array.from(u16);
    }
    // Float32 payload (legacy / non-normalised channels like filter ranges).
    if (base64Str.startsWith('base64:')) {
        const bytes = _b64ToBytes(base64Str.slice(7));
        return new Float32Array(bytes.buffer);
    }
    return new Float32Array(base64Str);
};

// Convert a #rrggbb (or shorthand/already-rgba) colour to an rgba() string at
// the given alpha. Used for the frosted-glass legend background.
function hexToRgba(hex, alpha) {
    if (typeof hex !== 'string' || hex[0] !== '#') return hex; // pass through non-hex
    let h = hex.slice(1);
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// --- GARBAGE COLLECTOR ---
const cleanUpZombies = () => {
    globalRegistry.forEach((entry, pid) => {
        if (entry.canvas && !entry.canvas.isConnected) {
            // Detached canvas: persist its camera and free the WebGL context.
            if (entry.plot && !entry.plot._destroyed) {
                try {
                    entry.savedCameraView = cloneCamera(entry.plot.get('cameraView'));
                } catch(e) {}
            }
            if (entry.plot) {
                try { entry.plot.destroy(); } catch(e) {}
            }
            entry.plot = null;
            entry.canvas = null;
            entry.isInitializing = false;
            if (window.__spUnsubscribers[pid]) {
                window.__spUnsubscribers[pid].forEach(u => { if(typeof u === 'function') u(); });
                window.__spUnsubscribers[pid] = [];
            }
        }
    });
};

// --- CORE FILTER LOGIC (INTERSECTION) ---
function recalcAndApplyFilters(entry) {
    if (!entry || !entry.plot) return;

    const n = entry.n_points;
    // Filter state is per-plot so independent plots on the same page (e.g.
    // several widgets in one Jupyter notebook, which all share `window`) do not
    // affect each other when you toggle a legend category or drag a filter.
    const strainers = entry.activeStrainers || (entry.activeStrainers = {});
    const strainerKeys = Object.keys(strainers);
    const hasStrainers = (strainerKeys.length > 0);
    const hasServerFilter = (entry.serverIndices && entry.serverIndices.length > 0);

    // 1. Active categorical (legend) filters for this plot
    if (!entry.indexFilters) entry.indexFilters = new Map();
    const activeVarFilters = Array.from(entry.indexFilters.values());
    const hasCatFilters = (activeVarFilters.length > 0);

    // If NO constraints anywhere, unfilter
    if (!hasServerFilter && !hasStrainers && !hasCatFilters) {
        entry.plot.unfilter({ transition: 0 }); 
        if (window.Shiny && entry.plotId === 'p1') window.Shiny.setInputValue("filtered_count", n);
        return;
    }

    const indices = [];
    const filterBuffers = entry.filterData; 

    // OPTIMIZATION: Intersection Strategy
    let candidates = null;

    if (hasCatFilters) {
        let smallestSet = activeVarFilters[0];
        for (let i = 1; i < activeVarFilters.length; i++) {
            if (activeVarFilters[i].size < smallestSet.size) smallestSet = activeVarFilters[i];
        }
        candidates = Array.from(smallestSet);
    } else if (hasServerFilter) {
        candidates = entry.serverIndices;
    }

    // Helper: Check Range Filters
    const passesStrainers = (i) => {
        if (!hasStrainers) return true;
        for (let k = 0; k < strainerKeys.length; k++) {
            const varName = strainerKeys[k];
            const range = strainers[varName];
            if (filterBuffers[varName]) {
                const val = filterBuffers[varName][i];
                if (val < range[0] || val > range[1]) return false;
            }
        }
        return true;
    };

    let serverSet = null;
    if (hasServerFilter && candidates !== entry.serverIndices) {
         if (!entry.serverIndicesSet) entry.serverIndicesSet = new Set(entry.serverIndices);
         serverSet = entry.serverIndicesSet;
    }

    const passesServer = (i) => {
        if (!hasServerFilter) return true;
        if (candidates === entry.serverIndices) return true; 
        return serverSet.has(i);
    };

    const passesCats = (i) => {
        if (!hasCatFilters) return true;
        for (const filterSet of activeVarFilters) {
            if (!filterSet.has(i)) return false;
        }
        return true;
    };

    const loopMax = candidates ? candidates.length : n;
    
    for (let j = 0; j < loopMax; j++) {
        const i = candidates ? candidates[j] : j;
        if (passesCats(i) && passesServer(i) && passesStrainers(i)) {
            indices.push(i);
        }
    }
    
    entry.plot.filter(indices, { transition: 0 });
    
    if (window.Shiny && entry.plotId === 'p1') {
         window.Shiny.setInputValue("filtered_count", indices.length);
    }
}

// In-widget range-filter panel. `filterBy` ships per-variable numeric vectors;
// in Shiny the host app supplies sliders that drive `activeStrainers` via the
// update_filter_range handler, but in standalone HTML / R Markdown / the Viewer
// there was no UI at all. This builds a small draggable-free panel of dual
// range sliders that write the same `activeStrainers` and re-run the filter, so
// `filterBy` is interactive everywhere.
function createFilterPanel(container, entry, fontSize) {
    const data = entry && entry.filterData;
    if (!data) return;
    const keys = Object.keys(data);
    if (!keys.length || entry._filterPanel) return;

    const bg = entry.legendBg || '#ffffff';
    const txt = entry.legendText || '#000000';
    const border = 'rgba(128,128,128,0.35)';
    const fam = '-apple-system,BlinkMacSystemFont,"Segoe UI","Inter",Roboto,Arial,sans-serif';

    const accent = '#3b82f6';
    const wrap = document.createElement('div');
    wrap.className = 'sp-filter-wrapper';
    wrap.style.cssText = 'position:absolute; top:10px; left:10px; z-index:998;' +
        'background:' + bg + '; color:' + txt + '; border:1px solid ' + border + ';' +
        'border-radius:8px; box-shadow:0 4px 12px rgba(0,0,0,0.15); font-size:' + fontSize + 'px;' +
        'width:230px; max-height:min(92%,440px); overflow-y:auto; font-family:' + fam + ';';

    // Header with a minimize toggle, mirroring the legend.
    const header = document.createElement('div');
    header.style.cssText = 'display:flex; align-items:center; justify-content:space-between;' +
        'padding:4px 10px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px;' +
        'font-size:' + (fontSize - 1) + 'px; border-bottom:1px solid ' + border + '; cursor:move; user-select:none;';
    const hTitle = document.createElement('span');
    hTitle.textContent = 'Filters';
    const minBtn = document.createElement('button');
    minBtn.textContent = '−';
    minBtn.style.cssText = 'border:none; background:transparent; color:inherit; cursor:pointer;' +
        'font-size:16px; line-height:1; padding:0 2px;';
    header.appendChild(hTitle); header.appendChild(minBtn);
    wrap.appendChild(header);

    const body = document.createElement('div');
    body.style.cssText = 'padding:8px 10px;';
    wrap.appendChild(body);

    // Minimize: collapse to just the header.
    minBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const hidden = body.style.display === 'none';
        body.style.display = hidden ? '' : 'none';
        minBtn.textContent = hidden ? '−' : '+';
    });

    // Drag by the header (same approach as the legend): clear all far-edge
    // anchors first so the panel never stretches between opposite edges.
    let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
    header.addEventListener('mousedown', (e) => {
        if (e.target === minBtn) return;
        dragging = true; sx = e.clientX; sy = e.clientY;
        const r = wrap.getBoundingClientRect();
        const cr = container.getBoundingClientRect();
        ox = r.left - cr.left; oy = r.top - cr.top;
        wrap.style.right = 'auto'; wrap.style.bottom = 'auto';
        wrap.style.left = ox + 'px'; wrap.style.top = oy + 'px';
        e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const maxL = container.clientWidth - wrap.offsetWidth;
        const maxT = container.clientHeight - wrap.offsetHeight;
        wrap.style.left = Math.max(0, Math.min(ox + e.clientX - sx, maxL)) + 'px';
        wrap.style.top = Math.max(0, Math.min(oy + e.clientY - sy, maxT)) + 'px';
    });
    document.addEventListener('mouseup', () => { dragging = false; });

    const fmt = (x) => (Math.abs(x) >= 100 ? x.toFixed(0) : (Math.abs(x) >= 1 ? x.toFixed(1) : x.toFixed(3)));
    const NB = 36;       // histogram bins
    const HH = 38;       // histogram height (px)
    const TH = 14;       // slider track/handle height (px)

    keys.forEach((key) => {
        const arr = data[key];
        let lo = Infinity, hi = -Infinity;
        for (let i = 0; i < arr.length; i++) { const v = arr[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
        if (!isFinite(lo) || !isFinite(hi)) return;
        if (lo === hi) hi = lo + 1;
        const span = hi - lo;

        // distribution histogram
        const bins = new Array(NB).fill(0);
        for (let i = 0; i < arr.length; i++) {
            let b = Math.floor((arr[i] - lo) / span * NB);
            if (b < 0) b = 0; if (b >= NB) b = NB - 1;
            bins[b]++;
        }
        const maxC = Math.max.apply(null, bins) || 1;
        // sqrt scale so small-count bins stay visible next to tall ones
        const barH = (c) => Math.max(2, Math.round(Math.sqrt(c / maxC) * HH));

        let curLo = lo, curHi = hi;

        const item = document.createElement('div');
        item.style.cssText = 'margin-bottom:12px;';
        const label = document.createElement('div');
        label.style.cssText = 'margin-bottom:4px; white-space:nowrap; font-weight:600;';
        item.appendChild(label);

        const area = document.createElement('div');
        area.style.cssText = 'position:relative; height:' + (HH + TH) + 'px; touch-action:none;';

        const histo = document.createElement('div');
        histo.style.cssText = 'position:absolute; top:0; left:0; right:0; height:' + HH +
            'px; display:flex; align-items:flex-end; gap:1px;';
        const barEls = [];
        for (let i = 0; i < NB; i++) {
            const bar = document.createElement('div');
            bar.style.cssText = 'flex:1; height:' + barH(bins[i]) + 'px; background:' + accent +
                '; border-radius:1px 1px 0 0; transition:opacity 0.08s;';
            histo.appendChild(bar); barEls.push(bar);
        }
        area.appendChild(histo);

        const trackY = (TH - 4) / 2;
        const track = document.createElement('div');
        track.style.cssText = 'position:absolute; left:0; right:0; bottom:' + trackY +
            'px; height:4px; background:' + border + '; border-radius:2px;';
        area.appendChild(track);
        const sel = document.createElement('div');
        sel.style.cssText = 'position:absolute; bottom:' + trackY + 'px; height:4px; background:' +
            accent + '; border-radius:2px;';
        area.appendChild(sel);

        const mkHandle = () => {
            const h = document.createElement('div');
            h.style.cssText = 'position:absolute; bottom:0; width:12px; height:' + TH +
                'px; margin-left:-6px; background:#fff; border:2px solid ' + accent +
                '; border-radius:50%; cursor:ew-resize; box-shadow:0 1px 3px rgba(0,0,0,0.35);';
            area.appendChild(h); return h;
        };
        const hLo = mkHandle(), hHi = mkHandle();

        item.appendChild(area);
        body.appendChild(item);

        const frac = (v) => (v - lo) / span;
        const redraw = () => {
            const fLo = frac(curLo), fHi = frac(curHi);
            hLo.style.left = (fLo * 100) + '%';
            hHi.style.left = (fHi * 100) + '%';
            sel.style.left = (fLo * 100) + '%';
            sel.style.width = ((fHi - fLo) * 100) + '%';
            for (let i = 0; i < NB; i++) {
                const c = lo + (i + 0.5) / NB * span;
                barEls[i].style.opacity = (c >= curLo && c <= curHi) ? '1' : '0.22';
            }
            label.textContent = key + ': ' + fmt(curLo) + ' – ' + fmt(curHi);
        };
        redraw();

        const apply = () => {
            if (!entry.activeStrainers) entry.activeStrainers = {};
            if (curLo <= lo && curHi >= hi) delete entry.activeStrainers[key];
            else entry.activeStrainers[key] = [curLo, curHi];
            recalcAndApplyFilters(entry);
        };

        const startDrag = (which) => (ev) => {
            ev.preventDefault(); ev.stopPropagation();
            const move = (e) => {
                const rect = area.getBoundingClientRect();
                const px = (e.touches ? e.touches[0].clientX : e.clientX);
                let f = (px - rect.left) / rect.width;
                f = Math.max(0, Math.min(1, f));
                const v = lo + f * span;
                if (which === 'lo') curLo = Math.min(v, curHi);
                else curHi = Math.max(v, curLo);
                redraw();
            };
            const up = () => {
                document.removeEventListener('mousemove', move);
                document.removeEventListener('mouseup', up);
                document.removeEventListener('touchmove', move);
                document.removeEventListener('touchend', up);
                apply();
            };
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', up);
            document.addEventListener('touchmove', move, { passive: false });
            document.addEventListener('touchend', up);
        };
        hLo.addEventListener('mousedown', startDrag('lo'));
        hHi.addEventListener('mousedown', startDrag('hi'));
        hLo.addEventListener('touchstart', startDrag('lo'), { passive: false });
        hHi.addEventListener('touchstart', startDrag('hi'), { passive: false });
    });

    container.appendChild(wrap);
    entry._filterPanel = wrap;
}

function syncCameraAcrossPlots(sourcePlotId) {
  const sourceEntry = globalRegistry.get(sourcePlotId);
  if (!sourceEntry || !sourceEntry.syncGroup || !sourceEntry.plot || sourceEntry.plot._destroyed) return;
  const sourceCamera = cloneCamera(sourceEntry.plot.get('cameraView'));
  sourceEntry.syncGroup.forEach(targetId => {
      if (targetId === sourcePlotId) return;
      const entry = globalRegistry.get(targetId);
      if (entry && entry.plot && !entry.plot._destroyed && entry.canvas.isConnected && !entry.isInitializing) {
          try {
            entry.plot.set({ cameraView: sourceCamera }, { preventEvent: true });
            entry.savedCameraView = cloneCamera(sourceCamera);
            if (entry.updateAxesFromCamera && !entry.axisThrottle) {
                entry.axisThrottle = requestAnimationFrame(() => { entry.updateAxesFromCamera(); entry.axisThrottle = null; });
            }
          } catch (e) {}
      }
  });
}

// ... [Shiny handlers] ...
if (typeof Shiny !== 'undefined') {
  Shiny.addCustomMessageHandler('update_point_size', function(msg) {
      const entry = globalRegistry.get(msg.plotId);
      if (entry && entry.plot) {
          if (!entry.options) entry.options = {};
          entry.options.size = msg.size;
          entry.plot.set({ pointSize: msg.size });
      }
  });

  Shiny.addCustomMessageHandler('update_plot_color', function(msg) {
      const entry = globalRegistry.get(msg.plotId);
      if (!entry || !entry.plot) return;
      if (msg.z) entry.zData = decodeBase64(msg.z);
      if (msg.group_data) entry.categoryData = decodeBase64(msg.group_data);
      if (msg.legend) {
          const isSolid = (msg.legend.var_type === 'none' || !msg.legend.var_type);
          entry.legend = msg.legend;
          if (isSolid) {
              entry.options.pointColor = '#0072B2';
              entry.options.colorBy = null;
              entry.plot.set({ pointColor: '#0072B2', colorBy: null });
              if (entry.createLegend) entry.createLegend(entry.canvas.parentElement, { var_type: null });
          } else {
              entry.options.pointColor = msg.legend.colors;
              entry.options.colorBy = 'valueA';
              entry.plot.set({ pointColor: msg.legend.colors, colorBy: 'valueA' });
              if (entry.createLegend) entry.createLegend(entry.canvas.parentElement, msg.legend);
          }
          if (entry.updateLegendUI) entry.updateLegendUI();
      }
      const n = entry.n_points;
      if (entry.xData && entry.yData && entry.zData) {
         const points = new Array(n);
         for(let i=0; i<n; i++) points[i] = [entry.xData[i], entry.yData[i], entry.zData[i]];
         entry.plot.draw(points);
      }
      recalcAndApplyFilters(entry);
  });

  Shiny.addCustomMessageHandler('my_scatterplot_sync', function(msg) {
    globalRegistry.globalSyncEnabled = msg.enabled;
    if (msg.enabled && msg.plotIds && Array.isArray(msg.plotIds)) {
        const newGroup = new Set(msg.plotIds);
        globalRegistry.currentSyncGroupSet = newGroup; 
        msg.plotIds.forEach(pid => { const entry = globalRegistry.get(pid); if (entry) entry.syncGroup = newGroup; });
    } else if (!msg.enabled && msg.plotIds) {
        globalRegistry.currentSyncGroupSet = null;
        msg.plotIds.forEach(pid => { const entry = globalRegistry.get(pid); if (entry) entry.syncGroup = null; });
    }
  });

  Shiny.addCustomMessageHandler('update_filter_range', function(msg) {
      // Shiny intentionally broadcasts a range filter to every plot (dashboard
      // model); write the per-plot strainer on each entry and re-filter it.
      globalRegistry.forEach(entry => {
          if (!entry.activeStrainers) entry.activeStrainers = {};
          if (msg.range === null) delete entry.activeStrainers[msg.variable];
          else entry.activeStrainers[msg.variable] = msg.range;
          if (entry.plot && !entry.plot._destroyed) recalcAndApplyFilters(entry);
      });
  });
  
  Shiny.addCustomMessageHandler('clear_plot_selection', function(msg) {
    globalRegistry.forEach((entry) => { if (entry.plot && entry.canvas.isConnected) entry.plot.deselect({ preventEvent: true }); });
  });

  Shiny.addCustomMessageHandler('manual_select_points', function(msg) {
    if (!msg || !msg.indices) return;
    const entry = globalRegistry.get(msg.plotId);
    if (entry && entry.plot && entry.canvas.isConnected) entry.plot.select(msg.indices, { preventEvent: true });
  });

  Shiny.addCustomMessageHandler('filter_points', function(msg) {
    const entry = globalRegistry.get(msg.plotId);
    if (entry && entry.plot) {
        entry.serverIndices = msg.indices; 
        entry.serverIndicesSet = null; // Clear cache
        recalcAndApplyFilters(entry);
    }
  });
}

HTMLWidgets.widget({
    name: 'reglScatterplot',
    type: 'output',
    factory: function(el, width, height) {
        const container = el;
        container.style.position = 'relative';
        container.style.overflow = 'hidden';
        container.style.backgroundColor = 'transparent';
        // Anchor the font stack on the container so SVG ticks and the
        // legend body inherit the same family regardless of the host shell.
        container.style.fontFamily =
            '-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", "Cantarell", "Noto Sans", "Liberation Sans", Roboto, "Helvetica Neue", Arial, sans-serif';

        // Mutable copies so resize() can update them and the rest of the
        // closure reads live dimensions instead of the initial factory values.
        let widgetWidth  = width;
        let widgetHeight = height;
        let prevNumPoints = 0;
        // Forward-declared so the ResizeObserver can call into the public
        // resize() handler without needing HTMLWidgets.find().
        let instanceResize = null;

        let currentAxisColor = '#333333';

        const injectStyles = () => {
            const styleId = 'my-scatterplot-styles';
            if (document.getElementById(styleId)) return;
            const style = document.createElement('style');
            style.id = styleId;
            style.innerHTML = `
                /* --- Download Button (Matched to App.R) --- */
                .sp-download-btn {
                    background: var(--bg-card, #ffffff);
                    border: 1px solid var(--border-color, #e2e8f0);
                    border-radius: 6px;
                    padding: 5px 10px;
                    cursor: pointer;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", "Cantarell", "Noto Sans", "Liberation Sans", Roboto, "Helvetica Neue", Arial, sans-serif;
                    font-size: 12px;
                    font-weight: 500;
                    color: var(--text-sub, #64748b);
                    box-shadow: 0 1px 3px rgba(0,0,0,0.08);
                    transition: all 0.2s ease;
                    display: flex; align-items: center; gap: 4px;
                    user-select: none;
                }
                .sp-download-btn:hover {
                    background: var(--bg-panel, #f8fafc);
                    border-color: var(--accent, #3b82f6);
                    color: var(--accent, #3b82f6);
                    box-shadow: 0 2px 8px rgba(59, 130, 246, 0.15);
                    transform: translateY(-1px);
                }
                .sp-download-btn svg { width: 14px; height: 14px; }
                
                /* --- Download Menu --- */
                .sp-menu {
                    display: none; position: absolute; top: 100%; right: 0; margin-top: 4px;
                    background: var(--bg-card, #ffffff);
                    border: 1px solid var(--border-color, #e2e8f0);
                    border-radius: 8px;
                    box-shadow: 0 8px 24px rgba(0,0,0,0.12);
                    padding: 4px; min-width: 100px; z-index: 101;
                }
                .sp-menu-item {
                    display: block; width: 100%; text-align: left; padding: 6px 10px;
                    font-size: 12px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", "Cantarell", "Noto Sans", "Liberation Sans", Roboto, "Helvetica Neue", Arial, sans-serif;
                    color: var(--text-sub, #64748b); cursor: pointer;
                    border-radius: 4px; transition: all 0.15s;
                }
                .sp-menu-item:hover {
                    background: var(--bg-panel, #f1f5f9);
                    color: var(--accent, #3b82f6);
                }

                /* --- Force sans-serif on SVG text against host-injected CSS. --- */
                .html-widget svg text,
                .html-widget svg .tick text,
                .html-widget svg .x-label,
                .html-widget svg .y-label {
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", "Cantarell", "Noto Sans", "Liberation Sans", Roboto, "Helvetica Neue", Arial, sans-serif !important;
                }

                /* --- Draggable Legend Wrapper (Kept from previous step) --- */
                .sp-legend-wrapper,
                .sp-legend-wrapper *,
                .sp-legend-header,
                .sp-legend-title,
                .sp-legend-content,
                .sp-legend,
                .sp-legend-item {
                    /* !important is needed because RStudio's Qt webview injects
                       its own stylesheet that otherwise wins the specificity
                       fight and forces a serif default. */
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", "Cantarell", "Noto Sans", "Liberation Sans", Roboto, "Helvetica Neue", Arial, sans-serif !important;
                }
                .sp-legend-wrapper {
                    position: absolute;
                    z-index: 999; /* Super high to prevent hiding behind other plots */
                    display: flex; flex-direction: column;
                    background: var(--bg-card, #ffffff);
                    border: 1px solid var(--border-color, #e2e8f0);
                    border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);
                    transition: opacity 0.2s, box-shadow 0.2s;
                    
                    /* AUTO WIDTH FIXES */
                    width: fit-content !important;  /* Force fit content */
                    min-width: 100px;               /* Prevent total collapse */
                    max-width: 250px;               /* Prevent exaggeration */
                    /* Cap height so the legend never spans the whole plot when
                       the container height is indefinite (e.g. a knitted Rmd):
                       a percentage alone collapses to unbounded there, so pair
                       it with a hard pixel ceiling. */
                    max-height: min(90%, 360px);
                    overflow: hidden;
                }
                
                .sp-legend-wrapper.dragging { 
                    opacity: 0.9; box-shadow: 0 8px 24px rgba(0,0,0,0.2); cursor: move; 
                }
                .sp-legend-wrapper.minimized { 
                    width: auto !important; height: auto !important; 
                }
                .sp-legend-wrapper.minimized .sp-legend-content { display: none; }
                
                .sp-legend-header {
                    display: flex; align-items: center; justify-content: space-between;
                    padding: 4px 10px; border-bottom: 1px solid var(--border-color, #e2e8f0);
                    background: var(--bg-panel, #f8fafc);
                    border-radius: 8px 8px 0 0; cursor: move; user-select: none;
                    min-height: 22px;
                    white-space: nowrap; /* Prevent header wrap */
                }
                .sp-legend-title { font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--text-sub, #64748b); letter-spacing: 0.5px; }

                .sp-legend-btn {
                    width: 20px; height: 20px; border: none; background: transparent;
                    color: var(--text-sub, #64748b); cursor: pointer; border-radius: 4px;
                    display: flex; align-items: center; justify-content: center; font-size: 16px; line-height: 1;
                }
                
                .sp-legend-content { padding: 6px; overflow-y: auto; max-height: 300px; }
                
                .sp-legend-item { 
                    transition: opacity 0.2s; user-select: none; 
                    white-space: nowrap; /* CRITICAL: Prevent text wrapping resizing the box awkwardly */
                    overflow: hidden; text-overflow: ellipsis;
                }
                .sp-legend-item:hover { background-color: rgba(128,128,128,0.14); border-radius: 6px; }
                .sp-legend-count { margin-left: auto; padding-left: 10px; font-size: 11px; opacity: 0.6; font-variant-numeric: tabular-nums; }
                .sp-color-swatch { width: 13px; height: 13px; margin-right: 9px; flex-shrink: 0; cursor: pointer; border: 1px solid rgba(0,0,0,0.25); border-radius: 50%; box-shadow: 0 1px 2px rgba(0,0,0,0.15); }
                .sp-toolbar { position: absolute; top: 10px; left: 10px; z-index: 998; display: flex; flex-direction: column; gap: 3px; padding: 4px; border-radius: 9px; background: rgba(20,28,38,0.55); border: 1px solid rgba(255,255,255,0.10); box-shadow: 0 4px 14px rgba(0,0,0,0.3); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
                .sp-toolbar.sp-toolbar-h { flex-direction: row; }
                .sp-tb-btn { width: 28px; height: 28px; display: grid; place-items: center; border: none; border-radius: 6px; background: transparent; color: #cdd9e5; cursor: pointer; padding: 0; }
                .sp-tb-btn:hover { background: rgba(255,255,255,0.12); color: #fff; }
                .sp-tb-btn.on { background: #2563eb; color: #fff; }
                .sp-tb-btn svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
                .sp-loader { border: 4px solid #f3f3f3; border-top: 4px solid #3498db; border-radius: 50%; width: 30px; height: 30px; animation: spin 1s linear infinite; position: absolute; top: 50%; left: 50%; margin-top: -15px; margin-left: -15px; z-index: 50; display: none; }
                @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
            `;
            document.head.appendChild(style);
        };
        injectStyles();

        let loader = document.createElement('div');
        loader.className = 'sp-loader';
        container.appendChild(loader);

        let margin = { top: 20, right: 20, bottom: 60, left: 60 };
        let plotId = null;
        let canvas = document.createElement('canvas');
        canvas.style.position = 'absolute'; 
        canvas.style.top = margin.top + 'px'; 
        canvas.style.left = margin.left + 'px';
        container.appendChild(canvas);

        // [FIX] Add WebGL context lost/restored listeners
        canvas.addEventListener('webglcontextlost', (e) => {
            e.preventDefault();
            console.warn('[SP] webglcontextlost', plotId);
        }, false);

        canvas.addEventListener('webglcontextrestored', () => {
            console.warn('[SP] webglcontextrestored', plotId);
            // Strategy: destroy and recreate plot on next render/resize
            try { plot?.destroy(); } catch(e) {}
            plot = null;
        }, false);

        let plot, renderer, svg, xAxisG, yAxisG, xAxis, yAxis, xScale, yScale;
        let xDomainOrig, yDomainOrig, tooltip, titleDiv;
        let d3Available = false;
        let dataBuffers = { x: null, y: null, z: null };
        let legendDiv = null;
        let isInitialRender = true;
        let resizeObserver = null;
        let lastClickedCategoryIndex = -1;
        // Set true while we're issuing camera changes programmatically
        // (resize, autoAdjustZoom, sync). The 'view' subscriber checks this
        // before flipping `cameraTouched` so we don't mistake our own
        // programmatic updates for user interaction.
        let suppressTouchedFlip = false;
        let totalCategories = 0;
        let filterBuffers = {}; 
        const VECTOR_POINT_LIMIT = 200000;

        const updateAxes = function() {
            if (!d3Available || !xScale || !yScale || !svg || !xAxis || !yAxis) return;
            if (!xAxisG || !yAxisG) return;
            xAxis.scale(xScale); yAxis.scale(yScale);
            xAxisG.call(xAxis); yAxisG.call(yAxis);
            
            // --- UPDATED: Apply Dynamic Axis Color ---
            svg.selectAll('.domain').attr('stroke', currentAxisColor);
            svg.selectAll('.tick line').attr('stroke', currentAxisColor === '#333333' ? '#ccc' : '#555'); // Darker lines in dark mode
            svg.selectAll('.tick text').attr('fill', currentAxisColor).style('font-size', '11px');
            svg.selectAll('.x-label').attr('fill', currentAxisColor);
            svg.selectAll('.y-label').attr('fill', currentAxisColor);
        };

        const updateLegendUI = function() {
            if (!legendDiv) return;
            const items = legendDiv.querySelectorAll('.sp-legend-item');
            const _e = globalRegistry.get(plotId);
            const myVar = _e.legend?.var_name;
            const mySelections = _e.categorySelections && _e.categorySelections.get(myVar);
            
            items.forEach((item, idx) => {
                if (mySelections) {
                    item.style.opacity = mySelections.has(idx) ? '1' : '0.3';
                } else {
                    item.style.opacity = '1';
                }
            });
        };

        let legendWrapper = null; 

        const createLegend = async function(container, legendData, fontSize = 12) {
            const entry = globalRegistry.get(plotId);
            const bg = entry.legendBg || '#ffffff';
            const txt = entry.legendText || '#222222';
            const border = (txt.includes('#222') || txt === '#222') ? 'var(--border-color, #eee)' : 'var(--border-color, #475569)';
            // Frosted-glass card: translucent bg + blur, both tunable.
            const legOpacity = (typeof entry.legendOpacity === 'number') ? entry.legendOpacity : 0.55;
            const legBlur = (typeof entry.legendBlur === 'number') ? entry.legendBlur : 10;
            const frostedBg = hexToRgba(bg, legOpacity);

            if (!legendData || !legendData.var_type || legendData.var_type === 'none') {
                if (legendWrapper) legendWrapper.style.display = 'none';
                return;
            }

            if (!legendWrapper) {
                legendWrapper = document.createElement('div');
                legendWrapper.className = 'sp-legend-wrapper';
                // Apply the configured anchor (defaults to top-right).
                const anc = (entry.legendAnchor && entry.legendAnchor.anchor) || 'top-right';
                legendWrapper.style.top = 'auto';
                legendWrapper.style.bottom = 'auto';
                legendWrapper.style.left = 'auto';
                legendWrapper.style.right = 'auto';
                if (anc === 'custom') {
                    legendWrapper.style.left = (entry.legendAnchor.x || 10) + 'px';
                    legendWrapper.style.top  = (entry.legendAnchor.y || 10) + 'px';
                } else if (anc === 'top-left') {
                    legendWrapper.style.top = '10px';
                    legendWrapper.style.left = '10px';
                } else if (anc === 'bottom-right') {
                    legendWrapper.style.bottom = '10px';
                    legendWrapper.style.right  = '10px';
                } else if (anc === 'bottom-left') {
                    legendWrapper.style.bottom = '10px';
                    legendWrapper.style.left   = '10px';
                } else {
                    legendWrapper.style.top   = '10px';
                    legendWrapper.style.right = '10px';
                }

                // 1. Define crisp SVG icons
                const iconMinus = '<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="3" fill="none"><line x1="5" y1="12" x2="19" y2="12"/></svg>';
                const iconPlus = '<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="3" fill="none"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';

                
                const header = document.createElement('div');
                header.className = 'sp-legend-header';
                header.innerHTML = `<span class="sp-legend-title">Legend</span>
                                    <button class="sp-legend-btn" title="Minimize">−</button>`;
                
                const content = document.createElement('div');
                content.className = 'sp-legend-content';
                
                legendDiv = document.createElement('div');
                legendDiv.className = 'sp-legend';
                
                content.appendChild(legendDiv);
                legendWrapper.appendChild(header);
                legendWrapper.appendChild(content);
                container.appendChild(legendWrapper);

                const minBtn = header.querySelector('.sp-legend-btn');
                minBtn.onclick = (e) => {
                    e.stopPropagation();
                    const isMin = legendWrapper.classList.toggle('minimized');
                    
                    // 3. Swap SVGs on click
                    minBtn.innerHTML = isMin ? iconPlus : iconMinus;
                };

                // --- IMPROVED RESIZE LOGIC ---
                const keepInBounds = () => {
                    if (!legendWrapper || legendWrapper.style.display === 'none') return;
                    if (container.clientWidth === 0 || container.clientHeight === 0) return;

                    // 1. FORCE BROWSER REPAINT (Fixes "Not Auto Width" / "Ghost" issues)
                    // We toggle a negligible transform to force layer recalculation
                    legendWrapper.style.transform = 'translateZ(0)';

                    // 2. CLAMP POSITION (Only if dragged)
                    if (legendWrapper.style.left && legendWrapper.style.left !== 'auto') {
                        const maxLeft = container.clientWidth - legendWrapper.offsetWidth;
                        const maxTop = container.clientHeight - legendWrapper.offsetHeight;
                        
                        const curLeft = parseInt(legendWrapper.style.left) || 0;
                        const curTop = parseInt(legendWrapper.style.top) || 0;

                        const newLeft = Math.max(0, Math.min(curLeft, maxLeft));
                        const newTop = Math.max(0, Math.min(curTop, maxTop));
                        
                        if (newLeft !== curLeft) legendWrapper.style.left = newLeft + 'px';
                        if (newTop !== curTop) legendWrapper.style.top = newTop + 'px';
                    }
                };

                const ro = new ResizeObserver(keepInBounds);
                ro.observe(container);
                ro.observe(legendWrapper); // Observe itself too!

                // --- SMART DRAG LOGIC ---
                let isDragging = false;
                let hasMoved = false; 
                let startX, startY, initialLeft, initialTop;

                header.onmousedown = (e) => {
                    if (e.target.tagName === 'BUTTON') return;
                    if (entry.draggableLegend === false) return;
                    e.preventDefault();
                    isDragging = true;
                    hasMoved = false;
                    startX = e.clientX;
                    startY = e.clientY;
                };
                if (entry.draggableLegend === false) {
                    header.style.cursor = 'default';
                }

                const onMove = (e) => {
                    if (!isDragging) return;

                    const dx = e.clientX - startX;
                    const dy = e.clientY - startY;
                    
                    // Threshold to prevent accidental moves on click
                    if (!hasMoved && Math.sqrt(dx*dx + dy*dy) < 5) return;

                    if (!hasMoved) {
                        hasMoved = true;
                        legendWrapper.classList.add('dragging');
                        const rect = legendWrapper.getBoundingClientRect();
                        const containerRect = container.getBoundingClientRect();
                        
                        // Switch from "Right" anchor to explicit "Left" coords
                        initialLeft = rect.left - containerRect.left;
                        initialTop = rect.top - containerRect.top;
                        
                        // Clear BOTH far-edge anchors. A bottom-/right-anchored
                        // legend keeps `bottom`/`right` set; adding `top`/`left`
                        // without clearing them pins all four edges and the
                        // legend stretches to full height/width while dragging.
                        legendWrapper.style.right = 'auto';
                        legendWrapper.style.bottom = 'auto';
                        legendWrapper.style.left = initialLeft + 'px';
                        legendWrapper.style.top = initialTop + 'px';
                    }

                    let newLeft = initialLeft + dx;
                    let newTop = initialTop + dy;
                    const maxLeft = container.clientWidth - legendWrapper.offsetWidth;
                    const maxTop = container.clientHeight - legendWrapper.offsetHeight;
                    
                    legendWrapper.style.left = Math.max(0, Math.min(newLeft, maxLeft)) + 'px';
                    legendWrapper.style.top = Math.max(0, Math.min(newTop, maxTop)) + 'px';
                };

                const onUp = () => {
                    isDragging = false;
                    if (legendWrapper) legendWrapper.classList.remove('dragging');
                };
                
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            }

            legendWrapper.style.display = 'flex';
            legendWrapper.style.background = frostedBg;
            legendWrapper.style.backdropFilter = legBlur > 0 ? `blur(${legBlur}px) saturate(120%)` : 'none';
            legendWrapper.style.webkitBackdropFilter = legendWrapper.style.backdropFilter;
            legendWrapper.style.borderColor = border;
            legendWrapper.style.color = txt;
            // Header blends into the frosted card (no separate strip).
            const headerEl = legendWrapper.querySelector('.sp-legend-header');
            if (headerEl) {
                headerEl.style.background = 'transparent';
                headerEl.style.borderBottomColor = 'transparent';
            }
            
            const titleEl = legendWrapper.querySelector('.sp-legend-title');
            if(titleEl) {
                titleEl.innerText = legendData.title || "Legend";
                // The stylesheet pins this to var(--text-sub), which RStudio's
                // dark Qt theme overrides to a light colour (the "white legend
                // title" bug). Force it to the configured legend text colour.
                titleEl.style.color = txt;
            }

            legendDiv.innerHTML = '';
            legendDiv.style.fontSize = fontSize + 'px';

            if (legendData.var_type === 'categorical') {
                if (!Array.isArray(legendData.names)) legendData.names = [legendData.names];
                if (!Array.isArray(legendData.colors)) legendData.colors = [legendData.colors];
                totalCategories = legendData.names.length;

                legendData.names.forEach((name, i) => {
                    const row = document.createElement('div');
                    row.className = 'sp-legend-item';
                    row.style.cssText = 'display: flex; align-items: center; width: 100%; box-sizing: border-box; margin-bottom: 2px; padding: 1px 4px; position: relative; cursor: pointer;';
                    
                    const myVar = legendData.var_name;
                    const mySelections = entry.categorySelections && entry.categorySelections.get(myVar);
                    if (mySelections && !mySelections.has(i)) {
                        row.style.opacity = '0.3';
                    }
                    
                    // The colour is shown by a <div> background (renders reliably
                    // in every environment), with a transparent native
                    // <input type=color> overlaid for the picker (the browser
                    // positions the OS picker correctly). A bare color input's
                    // own swatch is restyled away by VS Code / Jupyter CSS.
                    const swatch = document.createElement('span');
                    swatch.className = 'sp-color-swatch';
                    swatch.style.backgroundColor = legendData.colors[i];
                    swatch.style.position = 'relative';
                    swatch.style.display = 'inline-block';
                    swatch.title = 'Click to recolour ' + name;
                    const colorInput = document.createElement('input');
                    colorInput.type = 'color';
                    colorInput.value = legendData.colors[i];
                    colorInput.style.cssText = 'position:absolute; inset:0; width:100%; height:100%; ' +
                        'opacity:0; border:none; padding:0; margin:0; cursor:pointer;';
                    swatch.appendChild(colorInput);
                    row.appendChild(swatch);

                    colorInput.addEventListener('input', () => {
                        const newHex = colorInput.value.substring(0, 7);
                        legendData.colors[i] = newHex;
                        swatch.style.backgroundColor = newHex;
                        plot.set({ pointColor: [...legendData.colors] });
                        if (window.Shiny && window.Shiny.setInputValue) {
                            window.Shiny.setInputValue('sp_color_change', {
                                variable: legendData.var_name,
                                category: name,
                                color: newHex
                            });
                        }
                    });
                    // Don't let opening the picker toggle the category filter.
                    colorInput.addEventListener('click', (e) => e.stopPropagation());
                    swatch.addEventListener('click', (e) => e.stopPropagation());
                    
                    const label = document.createElement('span');
                    label.style.color = 'inherit'; label.innerText = name; 
                    
                    row.onclick = (e) => {
                          if (e.target.closest('.pcr-app')) return;
                          const entry = globalRegistry.get(plotId);
                          if (!entry.categorySelections) entry.categorySelections = new Map();
                          if (!entry.indexFilters) entry.indexFilters = new Map();
                          let activeSet = entry.categorySelections.get(myVar);
                          if (e.shiftKey && lastClickedCategoryIndex !== -1) {
                            const start = Math.min(lastClickedCategoryIndex, i);
                            const end = Math.max(lastClickedCategoryIndex, i);
                            if (!activeSet) activeSet = new Set();
                            for(let k=start; k<=end; k++) activeSet.add(k);
                            entry.categorySelections.set(myVar, activeSet);
                          } else if (e.ctrlKey || e.metaKey) {
                            if (!activeSet) { activeSet = new Set([i]); }
                            else { if (activeSet.has(i)) { activeSet.delete(i); if (activeSet.size === 0) activeSet = null; } else activeSet.add(i); }
                            if (activeSet) entry.categorySelections.set(myVar, activeSet);
                            else entry.categorySelections.delete(myVar);
                          } else {
                            if (activeSet && activeSet.size === 1 && activeSet.has(i)) { entry.categorySelections.delete(myVar); }
                            else { activeSet = new Set([i]); entry.categorySelections.set(myVar, activeSet); }
                          }
                          lastClickedCategoryIndex = i;
                          const currentSelections = entry.categorySelections.get(myVar);
                          if (!currentSelections) { entry.indexFilters.delete(myVar); }
                          else {
                              const newIndexSet = new Set();
                              const n = entry.n_points;
                              let buffer = null;
                              if (entry.colorVar === myVar) buffer = entry.zData;
                              else if (entry.groupVar === myVar) buffer = entry.categoryData;
                              if (buffer) { for(let p=0; p<n; p++) { if (currentSelections.has(Math.round(buffer[p]))) { newIndexSet.add(p); } } entry.indexFilters.set(myVar, newIndexSet); }
                          }
                          if (entry.updateLegendUI) entry.updateLegendUI();
                          recalcAndApplyFilters(entry);
                          if (window.Shiny && window.Shiny.setInputValue) {
                              const allowedIndices = currentSelections ? Array.from(currentSelections) : null;
                              let allowedNames = null;
                              if (allowedIndices && legendData.names) allowedNames = allowedIndices.map(idx => legendData.names[idx]);
                              window.Shiny.setInputValue("legend_selection_change", { variable: myVar, allowed_names: allowedNames, timestamp: Date.now() });
                          }
                    };
                    row.appendChild(label);
                    // Optional per-category point count (right-aligned).
                    if (legendData.counts && legendData.counts[i] != null) {
                        const cnt = document.createElement('span');
                        cnt.className = 'sp-legend-count';
                        cnt.textContent = Number(legendData.counts[i]).toLocaleString();
                        row.appendChild(cnt);
                    }
                    legendDiv.appendChild(row);
                });
            } else if (legendData.var_type === 'continuous') {
                 const gradContainer = document.createElement('div');
                 gradContainer.style.cssText = 'display: flex; align-items: flex-start; margin-top: 5px;';
                 const grad = document.createElement('div');
                 grad.style.cssText = `width: 10px; height: 80px; background: linear-gradient(to top, ${legendData.colors.join(',')}); border-radius: 2px; margin-right: 6px;`;
                 const lbls = document.createElement('div');
                 lbls.style.cssText = `display: flex; flex-direction: column; justify-content: space-between; height: 80px; color: inherit; font-size: ${fontSize-1}px;`;
                 lbls.innerHTML = `<span>${legendData.maxVal.toFixed(1)}</span><span>${legendData.midVal.toFixed(1)}</span><span>${legendData.minVal.toFixed(1)}</span>`;
                 gradContainer.appendChild(grad); gradContainer.appendChild(lbls);
                 legendDiv.appendChild(gradContainer);
            }
        };

        const createDownloadButton = function(container) {
            const entry = globalRegistry.get(plotId);
            const bg = entry.legendBg || 'var(--bg-card, #ffffff)';
            const txt = entry.legendText || 'var(--text-sub, #64748b)';
            const border = (txt.includes('#333') || txt === '#333') ? 'var(--border-color, #ccc)' : 'var(--border-color, #475569)';

            let wrapper = container.querySelector('.dl-btn-container');
            
            if (!wrapper) {
                wrapper = document.createElement('div');
                wrapper.className = 'dl-btn-container';
                // CHANGED: Increased 'right' to 50px so it clears the scrollbar/edge
                wrapper.style.cssText = `position: absolute; top: 10px; left: 10px; z-index: 90;`;                
                const btn = document.createElement('div');
                btn.className = 'sp-download-btn';
                btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
                
                const menu = document.createElement('div');
                menu.className = 'sp-menu';

                // Ensure menu aligns with the left side of the button
                menu.style.left = '0'; 
                menu.style.right = 'auto';
                
                ['PNG', 'SVG', 'PDF'].forEach(format => {
                    const item = document.createElement('div');
                    item.className = 'sp-menu-item';
                    item.innerText = `${format}`;
                    item.onclick = (e) => { e.stopPropagation(); downloadPlot(format.toLowerCase()); menu.style.display = 'none'; };
                    menu.appendChild(item);
                });

                btn.onclick = (e) => { e.stopPropagation(); menu.style.display = menu.style.display === 'block' ? 'none' : 'block'; };
                document.addEventListener('click', () => { menu.style.display = 'none'; });
                
                wrapper.appendChild(btn);
                wrapper.appendChild(menu);
                container.appendChild(wrapper);
            }

            // Update Styles
            const btn = wrapper.querySelector('.sp-download-btn');
            const menu = wrapper.querySelector('.sp-menu');
            
            if (btn) {
                btn.style.background = bg;
                btn.style.color = txt;
                btn.style.borderColor = border;
            }
            if (menu) {
                menu.style.background = bg;
                menu.style.borderColor = border;
                const items = menu.querySelectorAll('.sp-menu-item');
                items.forEach(item => item.style.color = txt);
            }
        };
        const renderElementToCanvas = async function(element) {
            return html2canvas(element, { backgroundColor: null, useCORS: true, allowTaint: true, scale: 2 });
        };
        const drawLegendToCanvas = async function(ctx, legendElement, containerRect) {
             if (legendElement.style.display === 'none' || !legendElement.offsetWidth) return;
            const origStyle = legendElement.style.cssText;
            legendElement.style.boxShadow = 'none'; legendElement.style.backgroundColor = 'white'; legendElement.style.border = '1px solid #ddd';
            const legendCanvas = await renderElementToCanvas(legendElement);
            legendElement.style.cssText = origStyle;
            const rect = legendElement.getBoundingClientRect();
            const x = containerRect.width - rect.width - 10;
            const y = 10;
            ctx.drawImage(legendCanvas, 0, 0, legendCanvas.width, legendCanvas.height, x, y, rect.width, rect.height);
        };
        const drawSVGtoCanvas = async function(ctx, svgEl) {
            const ser = new XMLSerializer();
            let str = ser.serializeToString(svgEl);
            if (!str.includes('xmlns')) str = str.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
            const blob = new Blob([str], { type: 'image/svg+xml;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            return new Promise(r => {
                const img = new Image();
                img.onload = () => { ctx.drawImage(img, 0, 0); URL.revokeObjectURL(url); r(); };
                img.src = url;
            });
        };
        const downloadPlot = async function(format) {
            if(!plot) return;
            const rect = container.getBoundingClientRect();
            const w = rect.width; const h = rect.height;
            const tempContainer = document.createElement('div');
            tempContainer.style.cssText = `position:absolute; top:-10000px; left:-10000px; width:${w}px; height:${h}px; overflow:hidden;`;
            document.body.appendChild(tempContainer);
            try {
                if (format === 'png') await downloadAsPNG(w, h);
                else if (format === 'svg') await downloadAsSVG(w, h);
                else if (format === 'pdf') await downloadAsPDF(w, h);
            } catch (e) { console.error(e); alert('Download failed: '+e.message); }
            document.body.removeChild(tempContainer);
        };
        const downloadAsPNG = async function(w, h) {
            const exCanvas = document.createElement('canvas'); exCanvas.width = w; exCanvas.height = h;
            const ctx = exCanvas.getContext('2d');
            ctx.fillStyle = 'white'; ctx.fillRect(0,0,w,h);
            ctx.drawImage(canvas, margin.left, margin.top, canvas.width, canvas.height);
            if(svg) await drawSVGtoCanvas(ctx, svg.node());
            if(legendDiv && legendDiv.style.display !== 'none') { await drawLegendToCanvas(ctx, legendDiv, {width: w, height: h}); }
            const link = document.createElement('a'); link.download = 'scatterplot.png';
            link.href = exCanvas.toDataURL(); link.click();
        };
        const downloadAsPDF = async function(w, h) {
            const { jsPDF } = window.jspdf; // bundled locally
            const exCanvas = document.createElement('canvas'); exCanvas.width = w; exCanvas.height = h;
            const ctx = exCanvas.getContext('2d');
            ctx.fillStyle = 'white'; ctx.fillRect(0,0,w,h);
            ctx.drawImage(canvas, margin.left, margin.top, canvas.width, canvas.height);
            if(svg) await drawSVGtoCanvas(ctx, svg.node());
            if(legendDiv && legendDiv.style.display !== 'none') { await drawLegendToCanvas(ctx, legendDiv, {width: w, height: h}); }
            const pdf = new jsPDF({ orientation: w>h?'landscape':'portrait', unit:'px', format:[w, h] });
            pdf.addImage(exCanvas.toDataURL('image/png'), 'PNG', 0, 0, w, h);
            pdf.save('scatterplot.pdf');
        };
        const createLegendSVG = function(d, w) {
            const svgNS = 'http://www.w3.org/2000/svg';
            const g = document.createElementNS(svgNS, 'g');
            if (!d || !d.var_type || d.var_type === 'none') return null;

            g.setAttribute('transform', `translate(${w - 140}, 10)`);
            const box = document.createElementNS(svgNS, 'rect');
            const h = d.var_type === 'categorical' ? (d.names.length * 20 + 35) : 150;
            box.setAttribute('width', 130); box.setAttribute('height', h);
            box.setAttribute('fill', 'white'); box.setAttribute('stroke', '#ddd'); box.setAttribute('rx', 4);
            g.appendChild(box);
            if(d.title) {
                const t = document.createElementNS(svgNS, 'text');
                t.setAttribute('x', 65); t.setAttribute('y', 20); t.setAttribute('text-anchor', 'middle'); 
                t.setAttribute('font-family', '-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", "Cantarell", "Noto Sans", "Liberation Sans", Roboto, "Helvetica Neue", Arial, sans-serif'); t.setAttribute('font-weight', 'bold'); t.setAttribute('font-size', '12'); 
                t.textContent = d.title; g.appendChild(t);
            }
            if (d.var_type === 'categorical') {
                d.names.forEach((n, i) => {
                    const y = 45 + i*20;
                    const group = document.createElementNS(svgNS, 'g');
                    
                    const myVar = d.var_name;
                    const _eL = globalRegistry.get(plotId);
                    const mySelections = _eL && _eL.categorySelections && _eL.categorySelections.get(myVar);
                    if (mySelections && !mySelections.has(i)) {
                        group.setAttribute('opacity', '0.3');
                    }
                    const c = document.createElementNS(svgNS, 'circle');
                    c.setAttribute('cx', 15); c.setAttribute('cy', y-4); c.setAttribute('r', 5); c.setAttribute('fill', d.colors[i]);
                    group.appendChild(c);
                    const txt = document.createElementNS(svgNS, 'text');
                    txt.setAttribute('x', 30); txt.setAttribute('y', y);
                    txt.setAttribute('font-family', '-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", "Cantarell", "Noto Sans", "Liberation Sans", Roboto, "Helvetica Neue", Arial, sans-serif'); txt.setAttribute('font-size', '11');
                    txt.textContent = n; group.appendChild(txt);
                    g.appendChild(group);
                });
            } else if (d.var_type === 'continuous' && d.colors) {
                const defs = document.createElementNS(svgNS, 'defs');
                const lg = document.createElementNS(svgNS, 'linearGradient');
                lg.setAttribute('id', 'legGrad'); lg.setAttribute('x1', '0%'); lg.setAttribute('y1', '100%'); lg.setAttribute('x2', '0%'); lg.setAttribute('y2', '0%');
                d.colors.forEach((c, i) => {
                    const s = document.createElementNS(svgNS, 'stop');
                    s.setAttribute('offset', `${(i/(d.colors.length-1))*100}%`); s.setAttribute('stop-color', c);
                    lg.appendChild(s);
                });
                defs.appendChild(lg); g.appendChild(defs); 
                const r = document.createElementNS(svgNS, 'rect');
                r.setAttribute('x', 10); r.setAttribute('y', 35); r.setAttribute('width', 15); r.setAttribute('height', 100); r.setAttribute('fill', 'url(#legGrad)');
                g.appendChild(r);
                [d.maxVal, d.midVal, d.minVal].forEach((v, i) => {
                    const txt = document.createElementNS(svgNS, 'text');
                    txt.setAttribute('x', 35); txt.setAttribute('y', 45 + i*45);
                    txt.setAttribute('font-family', '-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", "Cantarell", "Noto Sans", "Liberation Sans", Roboto, "Helvetica Neue", Arial, sans-serif'); txt.setAttribute('font-size', '11');
                    txt.textContent = v.toFixed(2); g.appendChild(txt);
                });
            }
            return g;
        };
        const downloadAsSVG = async function(w, h) {
             if(!plot) return;
            const registryEntry = globalRegistry.get(plotId);
            const xData = registryEntry; 
            const rX = xData.xData; const rY = xData.yData; const rZ = xData.zData;
            const nPoints = rX ? rX.length : 0;
            const useVector = nPoints <= VECTOR_POINT_LIMIT;
            let svgContent = '';
            const cpId = 'pc_' + Math.random().toString(36).substr(2,9);
            svgContent += `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">`;
            svgContent += `<rect width="${w}" height="${h}" fill="white"/>`;
            if (useVector && d3Available && rX) {
                 const internalXScale = plot.get('xScale'); const internalYScale = plot.get('yScale');
                 let xDomExp, yDomExp;
                 if (internalXScale && internalYScale) {
                     const vnX = internalXScale.domain(); const vnY = internalYScale.domain();
                     xDomExp = [xDomainOrig[0] + (vnX[0]+1)/2 * (xDomainOrig[1]-xDomainOrig[0]), xDomainOrig[0] + (vnX[1]+1)/2 * (xDomainOrig[1]-xDomainOrig[0])];
                     yDomExp = [yDomainOrig[0] + (vnY[0]+1)/2 * (yDomainOrig[1]-yDomainOrig[0]), yDomainOrig[0] + (vnY[1]+1)/2 * (yDomainOrig[1]-yDomainOrig[0])];
                 } else { xDomExp = xDomainOrig; yDomExp = yDomainOrig; }
                 const xSc = d3.scaleLinear().domain(xDomExp).range([margin.left, w - margin.right]);
                 const ySc = d3.scaleLinear().domain(yDomExp).range([h - margin.bottom, margin.top]);
                 const minX = Math.min(xDomExp[0], xDomExp[1]), maxX = Math.max(xDomExp[0], xDomExp[1]);
                 const minY = Math.min(yDomExp[0], yDomExp[1]), maxY = Math.max(yDomExp[0], yDomExp[1]);
                 const circleR = (xData.options.size||3)/2;
                 const opacity = xData.options.opacity || 0.8;
                 const defaultColor = Array.isArray(xData.options.pointColor) ? xData.options.pointColor[0] : (xData.options.pointColor || '#0072B2');
                 let colorScale = null, colors = null, useColorBy = false;
                 if (xData.legend) {
                    if (xData.legend.var_type === 'continuous') {
                        useColorBy = true;
                        colorScale = d3.scaleSequential(d3.piecewise(d3.interpolateRgb, xData.legend.colors)).domain([0, 1]);
                    } else if (xData.legend.var_type === 'categorical') {
                        colors = xData.legend.colors;
                    }
                 }
                 const isCategorical = (xData.legend && xData.legend.var_type === 'categorical');
                 
                 // --- SVG EXPORT FILTERING: INCLUDE SERVER INDICES ---
                 const _eX = globalRegistry.get(plotId);
                 const activeVarFilters = (_eX && _eX.indexFilters) ? Array.from(_eX.indexFilters.values()) : [];
                 const hasCatFilters = (activeVarFilters.length > 0);
                 
                 // PREPARE SERVER FILTERS
                 const serverIndices = registryEntry.serverIndices;
                 const hasServerFilter = (serverIndices && serverIndices.length > 0);
                 const serverSet = hasServerFilter ? new Set(serverIndices) : null;

                 let pointsStr = `<g clip-path="url(#${cpId})">`;
                 for (let i = 0; i < nPoints; i++) {
                    let keep = true;

                    // 1. Strainers (Client Ranges)
                    const _eS = globalRegistry.get(plotId);
                    if (_eS && _eS.activeStrainers) {
                        const strainers = _eS.activeStrainers;
                        const keys = Object.keys(strainers);
                        if (keys.length > 0) {
                            const fBuffs = filterBuffers;
                            for (let k = 0; k < keys.length; k++) {
                                const vName = keys[k];
                                if (fBuffs[vName]) {
                                    const val = fBuffs[vName][i];
                                    if (val < strainers[vName][0] || val > strainers[vName][1]) { keep = false; break; }
                                }
                            }
                        }
                    }
                    if (!keep) continue;

                    // 2. Categorical Filters (Client Legend)
                    if (hasCatFilters) {
                        for (const filterSet of activeVarFilters) {
                            if (!filterSet.has(i)) { keep = false; break; }
                        }
                    }
                    if (!keep) continue;

                    // 3. Server Filters (QC / AND Logic) -- ADDED THIS BLOCK
                    if (hasServerFilter) {
                        if (!serverSet.has(i)) { keep = false; }
                    }
                    if (!keep) continue;

                    const nx = rX[i]; const ny = rY[i];
                    const ox = xDomainOrig[0] + (nx+1)/2 * (xDomainOrig[1]-xDomainOrig[0]);
                    const oy = yDomainOrig[0] + (ny+1)/2 * (yDomainOrig[1]-yDomainOrig[0]);
                    if (ox >= minX && ox <= maxX && oy >= minY && oy <= maxY) {
                        const cx = xSc(ox).toFixed(2);
                        const cy = ySc(oy).toFixed(2);
                        let fill = defaultColor;
                        if (useColorBy && rZ) {
                            fill = colorScale(rZ[i]);
                        } else if (isCategorical && rZ) {
                            const idx = Math.floor(rZ[i]);
                            if(colors && colors[idx]) fill = colors[idx];
                        }
                        pointsStr += `<circle cx="${cx}" cy="${cy}" r="${circleR}" fill="${fill}" fill-opacity="${opacity}"/>`;
                    }
                 }
                 pointsStr += '</g>';
                 svgContent += `<defs><clipPath id="${cpId}"><rect x="${margin.left}" y="${margin.top}" width="${w-margin.left-margin.right}" height="${h-margin.top-margin.bottom}"/></clipPath></defs>`;
                 svgContent += pointsStr;
                 if(svg) {
                     const ser = new XMLSerializer();
                     let axesStr = ser.serializeToString(svg.node());
                     if (axesStr.startsWith('<svg')) {
                         axesStr = axesStr.substring(axesStr.indexOf('>')+1, axesStr.lastIndexOf('<'));
                     }
                     svgContent += axesStr;
                 }
                 if(legendDiv && xData.legend) {
                    const legG = createLegendSVG(xData.legend, w);
                    if (legG) { const ser = new XMLSerializer(); svgContent += ser.serializeToString(legG); }
                 }
            } else {
                const imgData = canvas.toDataURL('image/png');
                svgContent += `<image x="${margin.left}" y="${margin.top}" width="${w-margin.left-margin.right}" height="${h-margin.top-margin.bottom}" href="${imgData}"/>`;
            }
            svgContent += '</svg>';
            const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = 'scatterplot.svg'; a.click(); URL.revokeObjectURL(url);
        };

        const instance = {
            renderValue: async function(xData) {
                if (typeof xData.syncState !== 'undefined') {
                    globalRegistry.globalSyncEnabled = xData.syncState;
                }

                // Filter state is per-plot (stored on each registry entry) and a
                // fresh entry is created on every render, so there is nothing
                // global to reset here when the point count changes.
                globalRegistry.n_points = xData.n_points;

                if (xData.margins) {
                    margin = xData.margins;
                }
                const fSize = xData.fontSize || 12;
                // Drive the axis (ticks, domain line, x/y labels) colour from
                // axisColor; without this it was pinned to the dark default and
                // the axis text was invisible on dark themes.
                currentAxisColor = xData.axisColor || '#333333';

                loader.style.display = 'block';
                if (!Array.isArray(xData.gene_names)) xData.gene_names = [];

                // Prefer the caller's logical plotId: it's the id used by
                // `syncPlots` and by the Shiny message handlers. Falling back to
                // el.id first (the old behaviour) meant the registry was keyed by
                // the DOM id, so a `syncPlots = c("p1","p2")` group never matched
                // and cross-plot sync silently did nothing outside Shiny.
                plotId = xData.plotId || el.id || ('plot_' + Math.random().toString(36).substr(2, 9));
                
                cleanUpZombies();
                const selfEntry = globalRegistry.get(plotId);
                if (selfEntry && selfEntry.plot && !selfEntry.plot._destroyed) {
                    try {
                        selfEntry.plot.destroy();
                    } catch(e) {}
                    if (window.__spUnsubscribers[plotId]) {
                        window.__spUnsubscribers[plotId].forEach(u => { if(typeof u === 'function') u(); });
                        window.__spUnsubscribers[plotId] = [];
                    }
                    globalRegistry.delete(plotId);
                }
                if (!window.__spUnsubscribers[plotId]) window.__spUnsubscribers[plotId] = [];

                let initialView = null;
                const existingEntry = globalRegistry.get(plotId);
                if (xData.masterId) {
                    const masterEntry = globalRegistry.get(xData.masterId);
                    if (masterEntry && masterEntry.plot && !masterEntry.plot._destroyed) {
                         try { initialView = cloneCamera(masterEntry.plot.get('cameraView')); } catch(e){}
                    }
                    if (!initialView && masterEntry && masterEntry.savedCameraView) initialView = cloneCamera(masterEntry.savedCameraView);
                }
                if (!initialView && existingEntry && existingEntry.savedCameraView) initialView = existingEntry.savedCameraView;

                const n = xData.n_points;
                dataBuffers.x = decodeBase64(xData.x);
                dataBuffers.y = decodeBase64(xData.y);
                dataBuffers.z = decodeBase64(xData.z);
                
                filterBuffers = {};
                if (xData.filter_data) {
                    Object.keys(xData.filter_data).forEach(key => {
                        filterBuffers[key] = decodeBase64(xData.filter_data[key]);
                    });
                }
                let catData = null;
                if (xData.group_data) catData = decodeBase64(xData.group_data);
                
                if (dataBuffers.x && dataBuffers.z && dataBuffers.z.length > dataBuffers.x.length) dataBuffers.z = dataBuffers.z.subarray(0, dataBuffers.x.length);

                if (svg) { svg.remove(); svg=null; }
                d3Available = true; // d3 is bundled locally
                
                // Apply color to BOTH canvas and container to prevent white fringes
                if (xData.backgroundColor) {
                    canvas.style.backgroundColor = xData.backgroundColor;
                    container.style.backgroundColor = xData.backgroundColor;
                } else {
                    canvas.style.backgroundColor = 'white';
                    container.style.backgroundColor = 'white';
                }

                xDomainOrig = [xData.x_min, xData.x_max]; yDomainOrig = [xData.y_min, xData.y_max];

                // [FIX] Use ACTUAL DOM size, not factory width/height which may be stale
                // Use live container dimensions; the factory `width`/`height`
                // can be stale (especially in RStudio Viewer / Jupyter where
                // the parent is resized after construction).
                const rect0 = container.getBoundingClientRect();
                const fullW0 = Math.max(1, Math.floor(rect0.width)  || widgetWidth  || 600);
                const fullH0 = Math.max(1, Math.floor(rect0.height) || widgetHeight || 500);
                widgetWidth  = fullW0;
                widgetHeight = fullH0;
                const cW = Math.max(0, fullW0 - margin.left - margin.right);
                const cH = Math.max(0, fullH0 - margin.top  - margin.bottom);

                if (d3Available && xData.showAxes) {
                    svg = d3.select(container).append('svg')
                        .attr('width', fullW0).attr('height', fullH0)
                        .style('position', 'absolute').style('top', 0).style('left', 0)
                        .style('pointer-events', 'none')
                        // Force a sans-serif font on the whole SVG so tick numbers
                        // don't inherit a serif default from the host (RStudio
                        // Viewer's Qt webview falls back to Times otherwise).
                        .style('font-family',
                            '-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", "Cantarell", "Noto Sans", "Liberation Sans", Roboto, "Helvetica Neue", Arial, sans-serif');
                    xAxisG = svg.append('g').attr('class', 'x-axis').attr('transform', `translate(0, ${fullH0 - margin.bottom})`);
                    yAxisG = svg.append('g').attr('class', 'y-axis').attr('transform', `translate(${margin.left}, 0)`);

                    svg.append('text').attr('class','x-label')
                        .attr('x', margin.left + (fullW0 - margin.left - margin.right)/2)
                        .attr('y', fullH0 - (margin.bottom/4))
                        .text(xData.xlab||'X').attr('text-anchor','middle')
                        .style('font-family', '-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", "Cantarell", "Noto Sans", "Liberation Sans", Roboto, "Helvetica Neue", Arial, sans-serif').style('font-size', fSize+'px')
                        .attr('fill', currentAxisColor);

                    svg.append('text').attr('class','y-label').attr('transform','rotate(-90)')
                        .attr('x', -(margin.top + (fullH0 - margin.top - margin.bottom)/2))
                        .attr('y', margin.left/3)
                        .text(xData.ylab||'Y').attr('text-anchor','middle')
                        .style('font-family', '-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", "Cantarell", "Noto Sans", "Liberation Sans", Roboto, "Helvetica Neue", Arial, sans-serif').style('font-size', fSize+'px')
                        .attr('fill', currentAxisColor);

                    xScale = d3.scaleLinear().domain(xDomainOrig).range([margin.left, fullW0 - margin.right]);
                    yScale = d3.scaleLinear().domain(yDomainOrig).range([fullH0 - margin.bottom, margin.top]);
                    const ticks = (fullH0 < 200) ? 3 : 6;
                    xAxis = d3.axisBottom(xScale).ticks(ticks);
                    yAxis = d3.axisLeft(yScale).ticks(ticks);
                    
                    // Call updateAxes immediately to set colors
                    updateAxes();
                }

                if (xData.showTooltip && !tooltip) {
                    tooltip = document.createElement('div'); tooltip.style.cssText = `position:absolute;background:rgba(0,0,0,0.85);color:white;padding:6px 10px;border-radius:4px;font-size:12px;pointer-events:none;display:none;z-index:1000;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Cantarell","Noto Sans",Roboto,Arial,sans-serif;`;
                    container.appendChild(tooltip);
                }

                const rect = container.getBoundingClientRect();
                canvas.style.top = margin.top+'px';
                canvas.style.left = margin.left+'px';

                // Load regl-scatterplot once and cache on window so multiple
                // widget instances share a single import and the same renderer
                // (the latter is required by the library for context sharing).
                const reglMod = window.__reglScatterplotMod; // bundled locally
                // Resolve the device pixel ratio used for the WebGL backing
                // store. regl-scatterplot otherwise defaults to
                // window.devicePixelRatio, which the RStudio Viewer (an embedded
                // Qt WebEngine pane) reports as 1 even on HiDPI displays - the
                // canvas is then rendered at low resolution and upscaled, which
                // looks soft. Quality-first default: render at >=2x (supersample)
                // unless the caller overrides `pixelRatio` or we are in
                // performanceMode (very large data), where we honour the true
                // ratio to keep the pixel count down.
                const dpr = (xData.pixelRatio != null)
                    ? xData.pixelRatio
                    : (xData.performanceMode
                        ? (window.devicePixelRatio || 1)
                        : Math.max(window.devicePixelRatio || 1, 2));
                if (!renderer) { renderer = reglMod.createRenderer({ pixelRatio: dpr }); }
                const intXScale = d3.scaleLinear().domain([-1,1]).range([0,cW]);
                const intYScale = d3.scaleLinear().domain([-1,1]).range([cH,0]);
                let initialAspectRatio = null;
                if (xData.autoFit) initialAspectRatio = cW / cH;

                const createScatterplot = reglMod.default;
                
                try {
                    plot = createScatterplot({
                        renderer, canvas, width: cW, height: cH, pixelRatio: dpr,
                        xScale: intXScale, yScale: intYScale, pointSize: xData.options.size,
                        aspectRatio: initialAspectRatio, performanceMode: xData.performanceMode
                    });
                    const newConf = { pointSize: xData.options.size, pointColor: xData.options.pointColor, opacity: xData.options.opacity };
                    newConf.colorBy = xData.options.colorBy ? xData.options.colorBy : null;
                    if (initialView) newConf.cameraView = initialView;
                    plot.set(newConf);
                    if (xData.autoFit && !initialView) plot.zoomToArea({ x: -1.08, y: -1.08, width: 2.16, height: 2.16 }, { transition: false });
                    const points = new Array(n);
                    if (dataBuffers.z) { for(let i=0; i<n; i++) points[i] = [dataBuffers.x[i], dataBuffers.y[i], dataBuffers.z[i]]; } 
                    else { for(let i=0; i<n; i++) points[i] = [dataBuffers.x[i], dataBuffers.y[i]]; }
                    await plot.draw(points);
                } catch (err) {
                    console.error("[SP-ERROR] Plot render failed (Context Lost?):", err);
                    loader.innerHTML = "⚠️ GPU Error (Try Refreshing)";
                    return; 
                }
                
                loader.style.display = 'none';

                // Plot title. The `title` argument was previously only drawn
                // into PNG/SVG exports, never shown on screen - render it as a
                // centred overlay at the top of the plot.
                if (xData.title) {
                    if (!titleDiv) {
                        titleDiv = document.createElement('div');
                        titleDiv.className = 'sp-plot-title';
                        titleDiv.style.cssText = 'position:absolute; top:6px; left:0; right:0; ' +
                            'text-align:center; pointer-events:none; z-index:40; font-weight:600; ' +
                            'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Inter",Roboto,Arial,sans-serif;';
                        container.appendChild(titleDiv);
                    }
                    titleDiv.textContent = xData.title;
                    titleDiv.style.color = xData.axisColor || '#333333';
                    titleDiv.style.fontSize = ((xData.fontSize || 12) + 3) + 'px';
                    titleDiv.style.display = 'block';
                } else if (titleDiv) {
                    titleDiv.style.display = 'none';
                }

                const updateAxesFromCamera = function() {
                    if (!xData.showAxes || !plot || !xScale || !yScale) return;
                    const evt = { xScale: plot.get('xScale'), yScale: plot.get('yScale') };
                    if (!evt.xScale || !evt.yScale) return;
                    const vnX = evt.xScale.domain(); const vnY = evt.yScale.domain();
                    const nX = [xDomainOrig[0] + (vnX[0]+1)/2 * (xDomainOrig[1]-xDomainOrig[0]), xDomainOrig[0] + (vnX[1]+1)/2 * (xDomainOrig[1]-xDomainOrig[0])];
                    const nY = [yDomainOrig[0] + (vnY[0]+1)/2 * (yDomainOrig[1]-yDomainOrig[0]), yDomainOrig[0] + (vnY[1]+1)/2 * (yDomainOrig[1]-yDomainOrig[0])];
                    xScale.domain(nX); yScale.domain(nY);
                    updateAxes();
                };

                // Hoist autoAdjustZoom so resize() can re-call it while the
                // user hasn't yet touched the camera. This is the fix for
                // "data clipped at bottom in tiled / flex layouts": initial
                // dimensions come from a still-settling container, and the
                // first fit ends up wrong.
                const autoAdjustZoom = function () {
                    if (!plot || plot._destroyed) return;
                    const rect = container.getBoundingClientRect();
                    const currW = rect.width  - margin.left - margin.right;
                    const currH = rect.height - margin.top  - margin.bottom;
                    if (currW <= 0 || currH <= 0) return;
                    const xr = xDomainOrig[1] - xDomainOrig[0];
                    const yr = yDomainOrig[1] - yDomainOrig[0];
                    const sAsp = xr / yr;
                    const cAsp = currW / currH;
                    let zX, zY, zW, zH;
                    if (sAsp > cAsp) {
                        zW = 2; zH = 2 * (sAsp / cAsp);
                        zX = -1; zY = -zH / 2;
                    } else {
                        zH = 2; zW = 2 * (cAsp / sAsp);
                        zX = -zW / 2; zY = -1;
                    }
                    // Add 8% safety padding on every side. Without it the
                    // requested area is exactly at the data edges, and points
                    // at +/- 1 get culled or visually clipped by the projection
                    // / margins of the axis layer.
                    const pad = 0.08;
                    zX -= zW * pad / 2;
                    zY -= zH * pad / 2;
                    zW *= (1 + pad);
                    zH *= (1 + pad);
                    plot.zoomToArea({ x: zX, y: zY, width: zW, height: zH },
                                    { transition: false });
                };

                // Default camera ([-1, 1] x [-1, 1]) combined with R-side
                // 25% range padding shows data in [-0.8, +0.8] with a 20%
                // visual margin. Calling autoAdjustZoom() here was causing
                // edge clipping because regl-scatterplot's `zoomToArea`
                // appears to apply an internal aspect-ratio constraint we
                // can't predict. The data-aspect-preservation goal is now
                // handled instead by the R-side padded range, which already
                // encodes the correct visible domain into x_min/x_max.
                if (d3Available) updateAxesFromCamera();
                
                // ResizeObserver: outside of Shiny (RStudio Viewer, Jupyter,
                // standalone HTML) htmlwidgets does not always call resize()
                // on container changes, so we drive it ourselves via a
                // ref held by the factory (see `instanceResize` below).
                if (!resizeObserver) {
                    let resizeRaf = null;
                    resizeObserver = new ResizeObserver(() => {
                        if (resizeRaf) cancelAnimationFrame(resizeRaf);
                        resizeRaf = requestAnimationFrame(() => {
                            resizeRaf = null;
                            const r = container.getBoundingClientRect();
                            const w = Math.floor(r.width);
                            const h = Math.floor(r.height);
                            if (w <= 0 || h <= 0) return;
                            if (w === widgetWidth && h === widgetHeight) return;
                            if (typeof instanceResize === 'function') {
                                instanceResize(w, h);
                            } else {
                                widgetWidth = w; widgetHeight = h;
                            }
                        });
                    });
                    resizeObserver.observe(container);
                }

                let syncGroup = (existingEntry && existingEntry.syncGroup) ? existingEntry.syncGroup : null;
                if (!syncGroup && globalRegistry.currentSyncGroupSet && globalRegistry.currentSyncGroupSet.has(plotId)) {
                    syncGroup = globalRegistry.currentSyncGroupSet;
                }
                // Client-side sync (no Shiny): when `syncPlots` lists this plot
                // and others, union them all into one shared group so panning /
                // zooming any one drives the rest. In Shiny this is normally set
                // up by the `my_scatterplot_sync` message handler instead.
                if (!syncGroup && Array.isArray(xData.syncPlots) && xData.syncPlots.length > 1 &&
                    xData.syncPlots.indexOf(plotId) !== -1) {
                    syncGroup = globalRegistry.currentSyncGroupSet || new Set();
                    xData.syncPlots.forEach(id => syncGroup.add(id));
                    globalRegistry.currentSyncGroupSet = syncGroup;
                    globalRegistry.globalSyncEnabled = true;
                    // Back-fill any plots in this group that already registered.
                    xData.syncPlots.forEach(id => {
                        const e = globalRegistry.get(id);
                        if (e) e.syncGroup = syncGroup;
                    });
                }

                globalRegistry.set(plotId, { 
                    plotId, plot, canvas, updateAxesFromCamera, syncGroup,
                    initialCameraView: cloneCamera(plot.get('cameraView')), savedCameraView: initialView, 
                    xData: dataBuffers.x, yData: dataBuffers.y, zData: dataBuffers.z,
                    filterData: filterBuffers, categoryData: catData, 
                    colorVar: xData.colorVar, groupVar: xData.groupVar, 
                    options: xData.options, legend: xData.legend, n_points: n,
                    updateLegendUI: updateLegendUI, createLegend: createLegend,
                    isInitializing: true, autoFit: xData.autoFit, serverIndices: xData.init_server_indices,
                    activeStrainers: {}, indexFilters: new Map(), categorySelections: new Map(),
                    legendBg: xData.legendBg,
                    legendText: xData.legendText,
                    legendOpacity: xData.legendOpacity,
                    legendBlur: xData.legendBlur,
                    legendAnchor: xData.legendAnchor,
                    draggableLegend: xData.draggableLegend !== false,
                    autoAdjustZoom: autoAdjustZoom,
                    cameraTouched: false
                });
                
                if (xData.init_selected_indices && xData.init_selected_indices.length > 0) {
                     plot.select(xData.init_selected_indices, { preventEvent: true });
                }

                setTimeout(() => { const e = globalRegistry.get(plotId); if(e) e.isInitializing = false; }, 800);
                updateLegendUI(); 
                recalcAndApplyFilters(globalRegistry.get(plotId));

                let _axisRaf = null;
                const unsubView = plot.subscribe('view', () => {
                    // Coalesce the (d3) axis redraw to one per animation frame -
                    // calling it on every view event made panning feel laggy.
                    if (_axisRaf == null) {
                        _axisRaf = requestAnimationFrame(() => { _axisRaf = null; updateAxesFromCamera(); });
                    }
                    const e = globalRegistry.get(plotId);
                    if (e) {
                        e.savedCameraView = cloneCamera(plot.get('cameraView'));
                        // Only treat view events as "user interaction" when
                        // (a) we're past initial setup and (b) we're not
                        // currently inside a programmatic resize / zoom call.
                        if (!e.isInitializing && !suppressTouchedFlip) {
                            e.cameraTouched = true;
                        }
                    }
                    if(!globalRegistry.globalSyncEnabled) return;
                    if (globalRegistry.get(plotId).isInitializing) return;
                    if (globalRegistry.syncLeader && globalRegistry.syncLeader !== plotId) return;
                    globalRegistry.syncLeader = plotId;
                    if (globalRegistry.leaderTimeout) clearTimeout(globalRegistry.leaderTimeout);
                    if(!globalRegistry.isSyncing) { syncCameraAcrossPlots(plotId); } 
                    globalRegistry.leaderTimeout = setTimeout(() => { globalRegistry.syncLeader = null; }, 50);
                });
                window.__spUnsubscribers[plotId].push(unsubView);
                
                // Report a selection everywhere: Shiny input + a DOM event that
                // non-Shiny hosts (the anywidget adapter) bridge to a model trait
                // so Python can read `w.selection`. Always fires, regardless of
                // sync. Cross-plot mirroring is scoped to the sync group only.
                const zoomToSelection = () => {
                    const e = globalRegistry.get(plotId);
                    const idx = e && e.selectedIndices;
                    if (plot && plot.zoomToPoints && idx && idx.length) {
                        try { plot.zoomToPoints(idx, { transition: true }); } catch (err) {}
                    }
                };
                const reportSelection = (indices) => {
                    const e0 = globalRegistry.get(plotId);
                    if (e0) e0.selectedIndices = indices;
                    if (window.Shiny && window.Shiny.setInputValue) {
                        window.Shiny.setInputValue(plotId + '_selected', { indices: indices, count: indices.length });
                    }
                    try {
                        container.dispatchEvent(new CustomEvent('sp-selection',
                            { detail: { plotId: plotId, indices: indices }, bubbles: false }));
                    } catch (e) {}
                    if (xData.zoomOnSelection && indices.length) zoomToSelection();
                };
                const mirrorToGroup = (apply) => {
                    const e0 = globalRegistry.get(plotId);
                    if (!globalRegistry.globalSyncEnabled || globalRegistry.isSyncing || !e0 || !e0.syncGroup) return;
                    try {
                        globalRegistry.isSyncing = true;
                        e0.syncGroup.forEach(pid => {
                            if (pid === plotId) return;
                            const e = globalRegistry.get(pid);
                            if (e && e.plot && e.canvas && e.canvas.isConnected) apply(e.plot);
                        });
                    } finally { globalRegistry.isSyncing = false; }
                };

                const unsubSelect = plot.subscribe('select', ({ points: sel }) => {
                    const indices = Array.from(sel);
                    reportSelection(indices);
                    mirrorToGroup(pl => pl.select(sel, { preventEvent: true }));
                });
                window.__spUnsubscribers[plotId].push(unsubSelect);

                const unsubDeselect = plot.subscribe('deselect', () => {
                    reportSelection([]);
                    mirrorToGroup(pl => pl.deselect({ preventEvent: true }));
                });
                window.__spUnsubscribers[plotId].push(unsubDeselect);

                if (xData.showTooltip && tooltip) {
                    const unsubOver = plot.subscribe('pointOver', (i) => {
                        const nx = dataBuffers.x[i]; const ny = dataBuffers.y[i];
                        const ox = xDomainOrig[0] + (nx+1)/2 * (xDomainOrig[1]-xDomainOrig[0]);
                        const oy = yDomainOrig[0] + (ny+1)/2 * (yDomainOrig[1]-yDomainOrig[0]);
                        let txt = '';
                        if(xData.gene_names[i]) txt += `<b>${xData.gene_names[i]}</b><br>`;
                        txt += `X: ${ox.toFixed(2)}<br>Y: ${oy.toFixed(2)}`;
                        if(dataBuffers.z && xData.legend) {
                            const z = dataBuffers.z[i]; let val = z.toFixed(2);
                            if(xData.legend.var_type==='categorical') { const idx = Math.floor(z); if(xData.legend.names[idx]) val = xData.legend.names[idx]; } else if(xData.legend.var_type==='continuous') { val = (xData.legend.minVal + z * (xData.legend.maxVal-xData.legend.minVal)).toFixed(2); }
                            txt += `<br>Value: ${val}`;
                        }
                        const [px,py] = plot.getScreenPosition(i);
                        tooltip.innerHTML = txt; tooltip.style.display = 'block'; tooltip.style.left = (px+margin.left+10)+'px'; tooltip.style.top = (py+margin.top)+'px';
                    });
                    window.__spUnsubscribers[plotId].push(unsubOver);
                    const unsubOut = plot.subscribe('pointOut', () => tooltip.style.display='none');
                    window.__spUnsubscribers[plotId].push(unsubOut);
                }

                await createLegend(container, xData.legend, xData.legendFontSize || 12);
                // Hide the download button inside IDE iframes (RStudio Viewer,
                // VSCode Jupyter, Jupyter Lab) because download dialogs there
                // collide with the IDE's own toolbar. The button is shown in
                // standalone HTML, Shiny apps, and full-browser RStudio Zoom.
                const inIframe = (function () {
                    try { return window.parent !== window; } catch (e) { return true; }
                })();
                const inShiny = (typeof Shiny !== 'undefined');
                // An explicit `enableDownload = TRUE` always wins - the user
                // opted in, so honour it even inside an iframe (RStudio Viewer,
                // knitted-HTML preview, Jupyter). The iframe heuristic only
                // governs the unset/auto case.
                const showDownload = xData.enableDownload === true ||
                    (xData.enableDownload !== false && (!inIframe || inShiny));
                if (showDownload) createDownloadButton(container);

                // In-widget filter sliders for `filterBy` variables. Skip in
                // Shiny, where the host app drives `activeStrainers` through its
                // own UI via the update_filter_range message handler.
                if (xData.filter_data && Object.keys(xData.filter_data).length &&
                    typeof Shiny === 'undefined') {
                    createFilterPanel(container, globalRegistry.get(plotId), xData.legendFontSize || 12);
                }

                // Toolbar: pan / lasso / zoom-to-selection / reset / screenshot.
                // toolbarPosition = "left" (vertical), "top" (horizontal) or
                // "none". Created once per container.
                const tbPos = xData.toolbarPosition || 'none';
                if (tbPos !== 'none' && !container.querySelector('.sp-toolbar')) {
                    const TB = {
                        pan: '<svg viewBox="0 0 24 24"><path d="M12 3v18M3 12h18M8 7l4-4 4 4M8 17l4 4 4-4M7 8l-4 4 4 4M17 8l4 4-4 4"/></svg>',
                        lasso: '<svg viewBox="0 0 24 24"><path d="M4 11c0-4 4-6 8-6s8 2 8 6-4 6-8 6c-1 0-2 0-3-.3"/><circle cx="6" cy="18" r="2"/></svg>',
                        zoom: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4M11 8v6M8 11h6"/></svg>',
                        reset: '<svg viewBox="0 0 24 24"><path d="M4 4v6h6M20 20v-6h-6"/><path d="M20 9a8 8 0 0 0-14-3M4 15a8 8 0 0 0 14 3"/></svg>',
                        cam: '<svg viewBox="0 0 24 24"><path d="M3 8h4l2-2h6l2 2h4v12H3z"/><circle cx="12" cy="13" r="3"/></svg>'
                    };
                    const tb = document.createElement('div');
                    tb.className = 'sp-toolbar' + (tbPos === 'top' ? ' sp-toolbar-h' : '');
                    const mk = (title, svg, onClick) => {
                        const btn = document.createElement('button');
                        btn.className = 'sp-tb-btn'; btn.title = title; btn.innerHTML = svg;
                        btn.onclick = (e) => { e.stopPropagation(); onClick(btn); };
                        tb.appendChild(btn); return btn;
                    };
                    const setMode = (mode, btn) => {
                        try { plot.set({ mouseMode: mode }); } catch (err) {}
                        tb.querySelectorAll('.sp-tb-btn').forEach(b => b.classList.remove('on'));
                        if (btn) btn.classList.add('on');
                    };
                    const panBtn = mk('Pan / zoom', TB.pan, (b) => setMode('panZoom', b));
                    mk('Lasso select', TB.lasso, (b) => setMode('lasso', b));
                    mk('Zoom to selection', TB.zoom, () => zoomToSelection());
                    mk('Reset view', TB.reset, () => {
                        try { plot.zoomToArea({ x: -1.08, y: -1.08, width: 2.16, height: 2.16 }, { transition: true }); } catch (err) {}
                    });
                    mk('Screenshot (PNG)', TB.cam, () => downloadPlot('png'));
                    panBtn.classList.add('on');
                    container.appendChild(tb);
                }
                prevNumPoints = n;
                updateLegendUI();
                recalcAndApplyFilters(globalRegistry.get(plotId));
            },

            // Programmatic selection (used by the Python anywidget adapter so
            // `w.selection = [...]` highlights points). preventEvent avoids a
            // feedback loop back to the host.
            setSelection: function(indices) {
                if (!plot) return;
                const e = globalRegistry.get(plotId);
                if (e) e.selectedIndices = Array.isArray(indices) ? indices : [];
                if (indices && indices.length) plot.select(indices, { preventEvent: true });
                else plot.deselect({ preventEvent: true });
            },
            getSelection: function() {
                const e = globalRegistry.get(plotId);
                return (e && e.selectedIndices) || [];
            },

            resize: function(w, h) {
                widgetWidth = w;
                widgetHeight = h;
                const newW = w; const newH = h;
                const cW = newW - margin.left - margin.right;
                const cH = newH - margin.top - margin.bottom;
                if (canvas && plot) {
                    canvas.width = cW; canvas.height = cH;
                    canvas.style.width = cW + 'px'; canvas.style.height = cH + 'px';
                    const entry = globalRegistry.get(plotId);
                    // Mark every camera write that happens here as
                    // programmatic so the 'view' subscriber doesn't promote
                    // it to a "user touched the camera" event.
                    suppressTouchedFlip = true;
                    try {
                        if (entry && entry.autoFit) {
                            plot.set({ width: cW, height: cH, aspectRatio: cW / cH });
                            plot.zoomToArea({ x: -1.08, y: -1.08,
                                              width: 2.16, height: 2.16 },
                                            { transition: false });
                        } else {
                            // Just update dimensions; let the default camera
                            // continue to show the data domain.
                            plot.set({ width: cW, height: cH, aspectRatio: null });
                        }
                    } finally {
                        // Release the guard on the next frame so any
                        // queued view events from regl-scatterplot have a
                        // chance to fire under the suppression.
                        requestAnimationFrame(() => {
                            suppressTouchedFlip = false;
                        });
                    }
                    if (svg) {
                        svg.attr('width', newW).attr('height', newH);
                        if (xScale) xScale.range([margin.left, newW - margin.right]);
                        if (yScale) yScale.range([newH - margin.bottom, margin.top]);
                        if (xAxisG) xAxisG.attr('transform', `translate(0, ${newH - margin.bottom})`);
                        if (svg.select('.x-label')) svg.select('.x-label').attr('x', margin.left + cW/2).attr('y', newH - (margin.bottom/4));
                        if (svg.select('.y-label')) svg.select('.y-label').attr('x', -(margin.top + cH/2)).attr('y', margin.left/3);
                    }
                    if (entry && entry.updateAxesFromCamera) entry.updateAxesFromCamera();
                }

                // Update axes from current camera
                const entry = globalRegistry.get(plotId);
                if (entry?.updateAxesFromCamera) entry.updateAxesFromCamera();

                // Force redraw
                requestAnimationFrame(() => { try { plot.draw(); } catch(e) {} });
            }
        };
        instanceResize = instance.resize;
        return instance;
    }
});

})(); // end IIFE

// ---------------------------------------------------------------------------
// Auto-bootstrap: htmlwidgets normally calls HTMLWidgets.staticRender() on
// DOMContentLoaded, but Jupyter / IRkernel inject the cell's HTML *after*
// that event has already fired in the output iframe, so the factory never
// runs and the user sees a div without a canvas. Re-triggering staticRender
// here is a no-op in environments where the bootstrap already worked.
// ---------------------------------------------------------------------------
if (typeof HTMLWidgets !== 'undefined' &&
    typeof HTMLWidgets.staticRender === 'function') {
    setTimeout(function () {
        try { HTMLWidgets.staticRender(); } catch (e) {
            console.warn('[reglScatterplot] staticRender failed', e);
        }
    }, 0);
}