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

// Decode a channel that arrived as RAW BINARY (a DataView/ArrayBuffer from a
// Jupyter comm buffer — the experimental fast path), applying the channel's
// known transform. mode: 'u16' (x/y bipolar), 'u16u' (continuous 0..1),
// 'u16i' (integer codes), 'f32' (raw float32).
const decodeBinary = (view, mode) => {
    if (!view) return null;
    const buf = view.buffer || view;
    const off = view.byteOffset || 0;
    const byteLen = (view.byteLength != null) ? view.byteLength : buf.byteLength;
    if (mode === 'f32') return new Float32Array(buf, off, byteLen / 4);
    const u16 = new Uint16Array(buf, off, byteLen / 2);
    const out = new Float32Array(u16.length);
    if (mode === 'u16') { const inv = 1 / 32767.5; for (let i = 0; i < u16.length; i++) out[i] = u16[i] * inv - 1; }
    else if (mode === 'u16u') { const inv = 1 / 65535; for (let i = 0; i < u16.length; i++) out[i] = u16[i] * inv; }
    else { for (let i = 0; i < u16.length; i++) out[i] = u16[i]; }   // u16i
    return out;
};

// Pick base64-string vs binary decode for a channel.
const decodeChannel = (v, mode) => {
    if (v == null) return null;
    return (typeof v === 'string') ? decodeBase64(v) : decodeBinary(v, mode);
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
// Cells kept by THIS plot's own filters, as a Set of ORIGINAL indices (null = no
// own filter -> no constraint). Used to intersect filters across linked panels.
function computeOwnKept(entry) {
    const n = entry.n_points;
    const strainers = entry.activeStrainers || (entry.activeStrainers = {});
    const strainerKeys = Object.keys(strainers);
    const hasStrainers = strainerKeys.length > 0;
    const hasServerFilter = (entry.serverIndices && entry.serverIndices.length > 0);
    if (!entry.indexFilters) entry.indexFilters = new Map();
    const activeVarFilters = Array.from(entry.indexFilters.values());
    const hasCatFilters = activeVarFilters.length > 0;
    if (!hasServerFilter && !hasStrainers && !hasCatFilters) return null;

    const filterBuffers = entry.filterData;
    let candidates = null;
    if (hasCatFilters) {
        let smallest = activeVarFilters[0];
        for (let i = 1; i < activeVarFilters.length; i++)
            if (activeVarFilters[i].size < smallest.size) smallest = activeVarFilters[i];
        candidates = Array.from(smallest);
    } else if (hasServerFilter) {
        candidates = entry.serverIndices;
    }
    const passesStrainers = (i) => {
        if (!hasStrainers) return true;
        for (let k = 0; k < strainerKeys.length; k++) {
            const r = strainers[strainerKeys[k]];
            const buf = filterBuffers && filterBuffers[strainerKeys[k]];
            if (buf) { const v = buf[i]; if (v < r[0] || v > r[1]) return false; }
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
        for (const fs of activeVarFilters) if (!fs.has(i)) return false;
        return true;
    };
    const loopMax = candidates ? candidates.length : n;
    const dO = entry.drawOrder;
    const kept = new Set();
    for (let j = 0; j < loopMax; j++) {
        const i = candidates ? candidates[j] : j;
        if (passesCats(i) && passesServer(i) && passesStrainers(i)) kept.add(dO ? dO[i] : i);
    }
    return kept;
}

// Map ORIGINAL indices to this plot's drawn positions.
function origToPositions(entry, origIter) {
    const dO = entry.drawOrder;
    if (!dO) return Array.from(origIter);
    if (!entry._invDrawOrder) {
        const m = new Map();
        for (let i = 0; i < dO.length; i++) m.set(dO[i], i);
        entry._invDrawOrder = m;
    }
    const out = [];
    for (const o of origIter) { const p = entry._invDrawOrder.get(o); if (p !== undefined) out.push(p); }
    return out;
}

// Apply a resolved kept-set (ORIGINAL indices, or null = show all) to one plot.
function applyResolvedFilter(entry, keptOrig) {
    if (!entry || !entry.plot || entry.plot._destroyed) return;
    if (keptOrig === null) {
        entry.plot.unfilter({ transition: 0 });
        if (entry.reportFilter) entry.reportFilter(null);
    } else {
        entry.plot.filter(origToPositions(entry, keptOrig), { transition: 0 });
        if (entry.reportFilter) entry.reportFilter(Array.from(keptOrig));
    }
    if (window.Shiny && entry.plotId === 'p1')
        window.Shiny.setInputValue("filtered_count", keptOrig === null ? entry.n_points : keptOrig.size);
}

// Intersect every linked panel's OWN kept set (by ORIGINAL cell) and apply the
// result to ALL of them — so a filter on ONE panel filters the whole group, even
// panels coloured/built without that filter variable.
function applyGroupFilter(group) {
    const entries = Array.from(group)
        .map(id => globalRegistry.get(id))
        .filter(e => e && e.plot && !e.plot._destroyed);
    let inter = null, any = false;
    for (const e of entries) {
        if (e.detailOnZoom) continue;      // progressive panels sync via the kernel
        const s = computeOwnKept(e);       // recompute fresh (a sibling's strainers may have changed)
        e._ownKeptOrig = s;
        if (s == null) continue;           // null = that panel adds no constraint
        any = true;
        inter = (inter === null) ? new Set(s) : new Set([...inter].filter(x => s.has(x)));
    }
    const resolved = any ? inter : null;
    for (const e of entries) { if (!e.detailOnZoom) applyResolvedFilter(e, resolved); }
}

function recalcAndApplyFilters(entry) {
    if (!entry || !entry.plot) return;
    entry._ownKeptOrig = computeOwnKept(entry);   // this plot's own filters (original cells)
    // Non-progressive linked panels intersect filters by original cell; progressive
    // panels manage cross-panel filtering through the kernel, so apply locally.
    if (entry.syncGroup && globalRegistry.globalSyncEnabled && !entry.detailOnZoom)
        applyGroupFilter(entry.syncGroup);
    else
        applyResolvedFilter(entry, entry._ownKeptOrig);
}

// Remap a set of drawn positions from one panel to another by ORIGINAL cell
// (using each panel's drawOrder). Identity when neither panel is reordered.
function remapPositions(posIter, srcEntry, tgtEntry) {
    const sDO = srcEntry.drawOrder, tDO = tgtEntry.drawOrder;
    if (!sDO && !tDO) return new Set(posIter);
    if (tDO && !tgtEntry._invDrawOrder) {
        const m = new Map();
        for (let i = 0; i < tDO.length; i++) m.set(tDO[i], i);
        tgtEntry._invDrawOrder = m;
    }
    const out = new Set();
    for (const p of posIter) {
        const orig = sDO ? sDO[p] : p;
        const tp = tDO ? tgtEntry._invDrawOrder.get(orig) : orig;
        if (tp !== undefined) out.add(tp);
    }
    return out;
}

// Share legend / range filtering across a sync group. Independent plots (no
// syncGroup) stay isolated; plots linked via `syncPlots` / compose() filter
// together. Filters map by ORIGINAL cell, so this works even when group members
// colour by different variables / are drawn in different orders.
// Mirror a range-slider change to the SAME slider on linked panels (handles +
// label + activeStrainers) so both move together. Only panels that HAVE the
// variable (same data); a panel coloured by something else just gets the filtered
// RESULT via applyGroupFilter.
function syncStrainerToGroup(src, key, range) {
    if (!src || !src.syncGroup || !globalRegistry.globalSyncEnabled) return;
    src.syncGroup.forEach(pid => {
        if (pid === src.plotId) return;
        const e = globalRegistry.get(pid);
        if (!e || !e.plot || e.plot._destroyed || e.detailOnZoom) return;
        if (!e._strainerSetters || !e._strainerSetters[key]) return;
        if (!e.activeStrainers) e.activeStrainers = {};
        if (range === null) delete e.activeStrainers[key];
        else e.activeStrainers[key] = range.slice();
        e._strainerSetters[key](range);
    });
}

function propagateFiltersToGroup(src) {
    if (!src || !src.syncGroup || !globalRegistry.globalSyncEnabled) return;
    // Non-progressive linked panels are handled by recalcAndApplyFilters ->
    // applyGroupFilter (intersection by original cell). Only PROGRESSIVE panels
    // (kernel-rendered subsets) still need their own per-panel code recompute here.
    src.syncGroup.forEach(pid => {
        if (pid === src.plotId) return;
        const e = globalRegistry.get(pid);
        if (!e || !e.plot || e.plot._destroyed || !e._overview) return;
        e.activeStrainers = Object.assign({}, src.activeStrainers);
        e.categorySelections = new Map(src.categorySelections);
        e.indexFilters = new Map();
        e.categorySelections.forEach((sel, varName) => {
            let buf = null;
            if (e.colorVar === varName) buf = e.zData;
            else if (e.groupVar === varName) buf = e.categoryData;
            if (buf && sel && sel.size) {
                const s = new Set(); const n = e.n_points;
                for (let p = 0; p < n; p++) if (sel.has(Math.round(buf[p]))) s.add(p);
                e.indexFilters.set(varName, s);
            }
        });
        if (e.updateLegendUI) e.updateLegendUI();
        recalcAndApplyFilters(e);
    });
}

// In-widget range-filter panel. `filterBy` ships per-variable numeric vectors;
// in Shiny the host app supplies sliders that drive `activeStrainers` via the
// update_filter_range handler, but in standalone HTML / R Markdown / the Viewer
// there was no UI at all. This builds a small draggable-free panel of dual
// range sliders that write the same `activeStrainers` and re-run the filter, so
// `filterBy` is interactive everywhere.
function createFilterPanel(container, entry, fontSize, margins) {
    const data = entry && entry.filterData;
    if (!data) return;
    const keys = Object.keys(data);
    if (!keys.length || entry._filterPanel) return;

    const bg = entry.legendBg || '#ffffff';
    const txt = entry.legendText || '#000000';
    // SP_PANEL: shared frosted-card look across legend / filter / toolbar.
    const border = 'rgba(127,127,127,0.30)';
    const legOpacity = (typeof entry.legendOpacity === 'number') ? entry.legendOpacity : 0.55;
    const legBlur = (typeof entry.legendBlur === 'number') ? entry.legendBlur : 10;
    const frostedBg = hexToRgba(bg, legOpacity);
    const blurCss = legBlur > 0 ? 'backdrop-filter:blur(' + legBlur + 'px) saturate(120%); -webkit-backdrop-filter:blur(' + legBlur + 'px) saturate(120%);' : '';
    const fam = '-apple-system,BlinkMacSystemFont,"Segoe UI","Inter",Roboto,Arial,sans-serif';

    const accent = '#3b82f6';        // density / selected-band tint
    const grabCol = '#000000';       // grabber handles — black bars (white ring for contrast)
    // Live-filter while dragging unless the dataset is large (then on release).
    const liveFilter = (entry.n_points || 0) <= 150000;
    // Anchor inside the plotting area so the panel clears the axes/labels.
    const _m = margins || {};
    const fL = (_m.left || 0) + 10, fB = (_m.bottom || 0) + 10;
    const wrap = document.createElement('div');
    wrap.className = 'sp-filter-wrapper';
    wrap.style.cssText = 'position:absolute; bottom:' + fB + 'px; left:' + fL + 'px; z-index:998;' +
        'background:' + frostedBg + '; color:' + txt + '; border:1px solid ' + border + ';' + blurCss +
        'border-radius:8px; box-shadow:0 4px 14px rgba(0,0,0,0.28); font-size:' + fontSize + 'px;' +
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
    minBtn.tabIndex = -1;
    minBtn.style.cssText = 'border:none; background:transparent; color:inherit; cursor:pointer;' +
        'font-size:16px; line-height:1; padding:0 2px; outline:none;';
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
    const NB = 36;       // density bins
    const HH = 38;       // density height (px)
    const TH = 14;       // slider track/handle height (px)
    let clipSeq = 0;     // unique clipPath ids per variable

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
        const maxC = Math.max.apply(null, bins) || 1; // sqrt-scaled for visibility

        let curLo = lo, curHi = hi;

        const item = document.createElement('div');
        item.style.cssText = 'margin-bottom:12px;';
        const label = document.createElement('div');
        label.style.cssText = 'margin-bottom:4px; white-space:nowrap; font-weight:600;';
        item.appendChild(label);

        const area = document.createElement('div');
        area.style.cssText = 'position:relative; height:' + (HH + TH) + 'px; touch-action:none;';

        // Smooth density area (SVG). A muted base path shows the full
        // distribution; a brighter copy clipped to [curLo, curHi] highlights the
        // selected range.
        const ns = 'http://www.w3.org/2000/svg';
        let dPath = 'M 0 ' + HH + ' ';
        for (let i = 0; i < NB; i++) {
            const x = (NB === 1 ? 0 : i / (NB - 1) * 100);
            const y = HH - Math.sqrt(bins[i] / maxC) * (HH - 2);
            dPath += 'L ' + x.toFixed(2) + ' ' + y.toFixed(2) + ' ';
        }
        dPath += 'L 100 ' + HH + ' Z';
        const clipId = 'spden-' + (entry.plotId || 'p') + '-' + clipSeq++;
        const svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('viewBox', '0 0 100 ' + HH);
        svg.setAttribute('preserveAspectRatio', 'none');
        svg.style.cssText = 'position:absolute; top:0; left:0; width:100%; height:' + HH + 'px;';
        const defs = document.createElementNS(ns, 'defs');
        const clip = document.createElementNS(ns, 'clipPath'); clip.setAttribute('id', clipId);
        const clipRect = document.createElementNS(ns, 'rect');
        clipRect.setAttribute('x', '0'); clipRect.setAttribute('y', '0');
        clipRect.setAttribute('width', '100'); clipRect.setAttribute('height', String(HH));
        clip.appendChild(clipRect); defs.appendChild(clip); svg.appendChild(defs);
        const baseP = document.createElementNS(ns, 'path');
        baseP.setAttribute('d', dPath); baseP.setAttribute('fill', accent); baseP.setAttribute('opacity', '0.22');
        const hiP = document.createElementNS(ns, 'path');
        hiP.setAttribute('d', dPath); hiP.setAttribute('fill', accent); hiP.setAttribute('opacity', '0.85');
        hiP.setAttribute('clip-path', 'url(#' + clipId + ')');
        svg.appendChild(baseP); svg.appendChild(hiP);
        area.appendChild(svg);

        // Brush directly over the density: a shaded selected region + two
        // draggable vertical handles spanning the histogram (no separate track).
        area.style.height = HH + 'px';
        const shade = document.createElement('div');
        // The selected band is draggable (pan the whole range) — cursor:grab.
        shade.style.cssText = 'position:absolute; top:0; height:' + HH + 'px; ' +
            'background:' + accent + '; opacity:0.12; cursor:grab; touch-action:none; z-index:1;';
        area.appendChild(shade);

        const mkHandle = () => {
            const h = document.createElement('div');
            // A clean vertical bar spanning the histogram - no bottom knob. The
            // 12px hit area is wider than the visible 5px bar for easy grabbing.
            h.style.cssText = 'position:absolute; top:0; width:12px; height:' + HH +
                'px; margin-left:-6px; cursor:ew-resize; touch-action:none; z-index:3;';
            h.innerHTML =
                '<div style="position:absolute; left:3.5px; top:0; width:5px; height:' + HH + 'px; ' +
                'background:' + grabCol + '; border-radius:3px; box-shadow:0 0 0 1px #fff, 0 0 0 2px rgba(0,0,0,0.25);"></div>';
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
            shade.style.left = (fLo * 100) + '%';
            shade.style.width = ((fHi - fLo) * 100) + '%';
            clipRect.setAttribute('x', String(fLo * 100));
            clipRect.setAttribute('width', String((fHi - fLo) * 100));
            label.textContent = key + ': ' + fmt(curLo) + ' – ' + fmt(curHi);
        };
        redraw();

        // Let a linked panel move THIS slider (handles + label) without re-firing
        // apply() — used to keep the same filter in sync across compose panels.
        entry._strainerSetters = entry._strainerSetters || {};
        entry._strainerSetters[key] = (range) => {
            curLo = range ? range[0] : lo;
            curHi = range ? range[1] : hi;
            redraw();
        };

        const apply = () => {
            if (!entry.activeStrainers) entry.activeStrainers = {};
            const range = (curLo <= lo && curHi >= hi) ? null : [curLo, curHi];
            if (range === null) delete entry.activeStrainers[key];
            else entry.activeStrainers[key] = range;
            // sync the SAME slider on linked panels (same variable = same data)
            syncStrainerToGroup(entry, key, range);
            recalcAndApplyFilters(entry);   // applyGroupFilter applies the intersected result to all
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
                if (liveFilter) apply();
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

        // Pan the selected band: drag the shaded region to move the whole range.
        const startBand = (ev) => {
            ev.preventDefault(); ev.stopPropagation();
            const rect = area.getBoundingClientRect();
            const startX = ev.touches ? ev.touches[0].clientX : ev.clientX;
            const w = curHi - curLo, sLo = curLo;
            shade.style.cursor = 'grabbing';
            const move = (e) => {
                const px = e.touches ? e.touches[0].clientX : e.clientX;
                let nLo = sLo + ((px - startX) / rect.width) * span;
                nLo = Math.max(lo, Math.min(nLo, hi - w));
                curLo = nLo; curHi = nLo + w;
                redraw();
                if (liveFilter) apply();
            };
            const up = () => {
                document.removeEventListener('mousemove', move);
                document.removeEventListener('mouseup', up);
                document.removeEventListener('touchmove', move);
                document.removeEventListener('touchend', up);
                shade.style.cursor = 'grab';
                apply();
            };
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', up);
            document.addEventListener('touchmove', move, { passive: false });
            document.addEventListener('touchend', up);
        };
        shade.addEventListener('mousedown', startBand);
        shade.addEventListener('touchstart', startBand, { passive: false });
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
            // The camera was moved silently (preventEvent), so a detail-on-zoom
            // sibling won't fetch on its own — nudge it (debounced) to re-render
            // the in-view cells for the synced viewport. ONLY for detail-on-zoom
            // panels: a plain (all-resident) sibling has no viewport handler, so
            // emitting would show a loader that never gets a response to clear it.
            if (entry.detailOnZoom && entry.emitViewport && entry.getViewportBounds) {
                if (entry._syncFetchTimer) clearTimeout(entry._syncFetchTimer);
                entry._syncFetchTimer = setTimeout(() => {
                    try { const b = entry.getViewportBounds(); if (b) entry.emitViewport(b); } catch (e) {}
                }, 360);
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
                    /* Blend into the plot by default; reveal the frosted card on
                       hover. --legend-bg / --legend-border are set inline. */
                    background: transparent;
                    border: 1px solid transparent;
                    border-radius: 8px; box-shadow: none;
                    transition: background 0.15s, border-color 0.15s, box-shadow 0.15s;
                    backdrop-filter: none !important;
                    -webkit-backdrop-filter: none !important;

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
                .sp-legend-wrapper:hover, .sp-legend-wrapper.dragging, .sp-legend-wrapper.pinned {
                    background: var(--legend-bg, rgba(255,255,255,0.55));
                    border-color: var(--legend-border, rgba(127,127,127,0.30));
                    box-shadow: 0 4px 14px rgba(0,0,0,0.28);
                    backdrop-filter: var(--legend-blur, none) !important;
                    -webkit-backdrop-filter: var(--legend-blur, none) !important;
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
                    color: inherit; cursor: pointer; border-radius: 4px; outline: none;
                    display: flex; align-items: center; justify-content: center; font-size: 16px; line-height: 1;
                    opacity: 0; pointer-events: none; transition: opacity 0.15s;
                }
                /* The minimize button hides while the legend is blended; it
                   appears on hover (or stays when minimized, to allow expanding). */
                .sp-legend-wrapper:hover .sp-legend-btn,
                .sp-legend-wrapper.dragging .sp-legend-btn,
                .sp-legend-wrapper.minimized .sp-legend-btn { opacity: 0.75; pointer-events: auto; }
                .sp-legend-btn:focus, .sp-legend-btn:focus-visible { outline: none; box-shadow: none; }
                
                .sp-legend-content { padding: 6px; overflow-y: auto; max-height: 300px;
                    scrollbar-width: thin; scrollbar-color: rgba(127,127,127,0.45) transparent; }
                .sp-legend-content::-webkit-scrollbar { width: 8px; }
                .sp-legend-content::-webkit-scrollbar-track { background: transparent; }
                .sp-legend-content::-webkit-scrollbar-thumb { background: rgba(127,127,127,0.45); border-radius: 4px; }
                .sp-legend-content::-webkit-scrollbar-thumb:hover { background: rgba(127,127,127,0.7); }
                
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
                .sp-tb-grip { display: flex; align-items: center; justify-content: center; cursor: move; opacity: 0.45; }
                .sp-tb-grip:hover { opacity: 0.85; }
                .sp-tb-grip svg { fill: currentColor; stroke: none; width: 16px; height: 12px; }
                .sp-toolbar .sp-tb-grip { width: 100%; height: 11px; }
                .sp-toolbar.sp-toolbar-h .sp-tb-grip { width: 11px; height: auto; align-self: stretch; }
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
            // The browser reclaimed this WebGL context (e.g. too many plots open)
            // and has now restored it — rebuild the plot so it isn't left blank.
            try { plot?.destroy(); } catch(e) {}
            plot = null;
            try { delete window.__reglSharedRenderer; } catch(e) { window.__reglSharedRenderer = null; }
            if (lastXData) { try { instance.renderValue(lastXData); } catch(e) {} }
        }, false);

        let plot, renderer, svg, xAxisG, yAxisG, xAxis, yAxis, xScale, yScale;
        let lastXData = null;   // last spec, for re-rendering after context loss
        let xDomainOrig, yDomainOrig, tooltip, titleDiv, captionDiv;
        let d3Available = false;
        let dataBuffers = { x: null, y: null, z: null, w: null };
        let tooltipFields = [];   // hoisted so updateData() can refresh hover fields on a viewport swap
        let _vpSeq = 0;           // viewport-request sequence; drop stale/out-of-order responses (factory scope so updateData + view handler share it)
        let _vpLoadTimer = null;  // delayed "loading detail" indicator for viewport fetches
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
            const border = 'rgba(127,127,127,0.30)'; // shared panel border (see SP_PANEL)
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
                // Anchor INSIDE the plotting area: offset by the axis margins
                // (+pad) so the legend doesn't sit on top of the axes/labels.
                // With showAxes=FALSE the margins are ~0, so it hugs the edge.
                const pad = 10;
                const offL = (margin.left || 0) + pad, offR = (margin.right || 0) + pad;
                const offT = (margin.top || 0) + pad, offB = (margin.bottom || 0) + pad;
                if (anc === 'custom') {
                    legendWrapper.style.left = (entry.legendAnchor.x || offL) + 'px';
                    legendWrapper.style.top  = (entry.legendAnchor.y || offT) + 'px';
                } else if (anc === 'top-left') {
                    legendWrapper.style.top = offT + 'px';
                    legendWrapper.style.left = offL + 'px';
                } else if (anc === 'bottom-right') {
                    legendWrapper.style.bottom = offB + 'px';
                    legendWrapper.style.right  = offR + 'px';
                } else if (anc === 'bottom-left') {
                    legendWrapper.style.bottom = offB + 'px';
                    legendWrapper.style.left   = offL + 'px';
                } else {
                    legendWrapper.style.top   = offT + 'px';
                    legendWrapper.style.right = offR + 'px';
                }

                // 1. Define crisp SVG icons
                const iconMinus = '<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="3" fill="none"><line x1="5" y1="12" x2="19" y2="12"/></svg>';
                const iconPlus = '<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="3" fill="none"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';

                
                const header = document.createElement('div');
                header.className = 'sp-legend-header';
                header.innerHTML = `<span class="sp-legend-title">Legend</span>
                                    <button class="sp-legend-btn" title="Minimize" tabindex="-1">−</button>`;
                
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
                    // Keep the legend inside the plot area (within the axis
                    // margins) so it never overlaps / blends into the axes.
                    const mL = margin.left, mT = margin.top, mR = margin.right, mB = margin.bottom;
                    const minLeft = mL, minTop = mT;
                    const maxLeft = container.clientWidth - mR - legendWrapper.offsetWidth;
                    const maxTop = container.clientHeight - mB - legendWrapper.offsetHeight;
                    legendWrapper.style.left = Math.max(minLeft, Math.min(newLeft, Math.max(minLeft, maxLeft))) + 'px';
                    legendWrapper.style.top = Math.max(minTop, Math.min(newTop, Math.max(minTop, maxTop))) + 'px';
                };

                const onUp = () => {
                    isDragging = false;
                    if (legendWrapper) legendWrapper.classList.remove('dragging');
                };
                
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            }

            legendWrapper.style.display = 'flex';
            // The frosted look is applied only on hover/drag (see CSS); the card
            // blends into the plot otherwise. Feed the values as custom props.
            legendWrapper.style.setProperty('--legend-bg', frostedBg);
            legendWrapper.style.setProperty('--legend-border', border);
            legendWrapper.style.setProperty('--legend-blur',
                legBlur > 0 ? `blur(${legBlur}px) saturate(120%)` : 'none');
            legendWrapper.style.color = txt;
            const headerEl = legendWrapper.querySelector('.sp-legend-header');
            if (headerEl) {
                headerEl.style.background = 'transparent';
                headerEl.style.borderBottomColor = 'transparent';
            }
            
            const titleEl = legendWrapper.querySelector('.sp-legend-title');
            if(titleEl) {
                const vName = (legendData.var_name && legendData.var_name !== 'Solid_Color')
                    ? legendData.var_name : null;
                titleEl.innerText = legendData.title || vName ||
                    (legendData.var_type === 'continuous' ? 'Value' : 'Legend');
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
                          if (entry.detailOnZoom && entry.syncGroup) {   // NB: xData is out of scope here (factory, not renderValue)
                              // progressive + LINKED: route via the kernel so the
                              // filter resolves to ORIGINAL cells and syncs cross-
                              // variable across panels. Heavier (full-data scan), but
                              // only worth it when there ARE siblings to sync.
                              const cs = entry.categorySelections.get(myVar);
                              const names = cs ? Array.from(cs).map(ix => legendData.names[ix]) : null;
                              try { container.dispatchEvent(new CustomEvent('sp-legendfilter',
                                  { detail: { plotId: plotId, cats: names }, bubbles: false })); } catch (e) {}
                          } else {
                              // single plot (incl. a standalone progressive plot):
                              // filter the DISPLAYED points locally — fast, no kernel
                              // round-trip over millions of cells.
                              recalcAndApplyFilters(entry);
                              propagateFiltersToGroup(entry);
                          }
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
                 // Clean colour-bar with axis-style tick labels.
                 const fmtV = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : (Math.abs(v) >= 1 ? v.toFixed(1) : v.toFixed(2)));
                 const BH = 92;            // bar height (px)
                 const lo = legendData.minVal, hi = legendData.maxVal;
                 const wrap = document.createElement('div');
                 wrap.style.cssText = `position: relative; height: ${BH}px; margin: 4px 0 2px;`;
                 const bar = document.createElement('div');
                 bar.style.cssText = `position: absolute; left: 0; top: 0; width: 12px; height: ${BH}px; ` +
                     `border-radius: 3px; background: linear-gradient(to top, ${legendData.colors.join(',')});`;
                 wrap.appendChild(bar);
                 const N = 5;
                 let maxLabW = 0;
                 for (let i = 0; i < N; i++) {
                     const frac = i / (N - 1);                 // 0 (bottom) .. 1 (top)
                     const topPx = (1 - frac) * BH;
                     const v = lo + frac * (hi - lo);
                     const tick = document.createElement('div');
                     tick.style.cssText = `position: absolute; left: 12px; top: ${topPx}px; width: 4px; ` +
                         `height: 1px; background: currentColor; opacity: 0.55;`;
                     const lab = document.createElement('div');
                     lab.style.cssText = `position: absolute; left: 19px; top: ${topPx}px; transform: translateY(-50%); ` +
                         `font-size: ${fontSize - 2}px; opacity: 0.85; white-space: nowrap;`;
                     lab.textContent = fmtV(v);
                     wrap.appendChild(tick); wrap.appendChild(lab);
                     maxLabW = Math.max(maxLabW, ('' + fmtV(v)).length);
                 }
                 wrap.style.width = (24 + maxLabW * (fontSize - 2) * 0.62) + 'px';
                 legendDiv.appendChild(wrap);
            }
        };

        const createDownloadButton = function(container) {
            const entry = globalRegistry.get(plotId);
            // SP_PANEL: frosted-card look matching the legend / filter / toolbar
            // family (semi-transparent legendBg + blur + the shared border),
            // instead of a solid white chip that looks foreign to the legend.
            const baseBg = entry.legendBg || '#ffffff';
            const txt = entry.legendText || '#222222';
            const legOpacity = (typeof entry.legendOpacity === 'number') ? entry.legendOpacity : 0.55;
            const legBlur = (typeof entry.legendBlur === 'number') ? entry.legendBlur : 10;
            const bg = hexToRgba(baseBg, legOpacity);
            const border = 'rgba(127,127,127,0.30)';
            const blur = legBlur > 0 ? 'blur(' + legBlur + 'px) saturate(120%)' : 'none';

            let wrapper = container.querySelector('.dl-btn-container');

            if (!wrapper) {
                wrapper = document.createElement('div');
                wrapper.className = 'dl-btn-container';
                // Bottom-right: the one free corner in the default layout
                // (toolbar top-left, legend top-right, filter bottom-left), so
                // the download chip + menu never overlap the other panels.
                // Offset by the axis margins so it clears the axes/labels.
                const dlB = (margin.bottom || 0) + 10, dlR = (margin.right || 0) + 10;
                wrapper.style.cssText = `position: absolute; bottom: ${dlB}px; right: ${dlR}px; z-index: 90;`;
                const btn = document.createElement('div');
                btn.className = 'sp-download-btn';
                btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';

                const menu = document.createElement('div');
                menu.className = 'sp-menu';

                // Anchored bottom-right, the menu opens UPWARD off the button.
                menu.style.right = '0';
                menu.style.left = 'auto';
                menu.style.top = 'auto';
                menu.style.bottom = '100%';
                menu.style.marginTop = '0';
                menu.style.marginBottom = '4px';

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
                btn.style.backdropFilter = blur;
                btn.style.webkitBackdropFilter = blur;
            }
            if (menu) {
                menu.style.background = bg;
                menu.style.borderColor = border;
                menu.style.backdropFilter = blur;
                menu.style.webkitBackdropFilter = blur;
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
            // Match the on-screen title fallback (variable name when no explicit
            // title) so the SVG legend isn't left untitled.
            const legTitle = d.title || ((d.var_name && d.var_name !== 'Solid_Color')
                ? d.var_name : (d.var_type === 'continuous' ? 'Value' : 'Legend'));
            if(legTitle) {
                const t = document.createElementNS(svgNS, 'text');
                t.setAttribute('x', 65); t.setAttribute('y', 20); t.setAttribute('text-anchor', 'middle');
                t.setAttribute('font-family', '-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", "Cantarell", "Noto Sans", "Liberation Sans", Roboto, "Helvetica Neue", Arial, sans-serif'); t.setAttribute('font-weight', 'bold'); t.setAttribute('font-size', '12');
                t.textContent = legTitle; g.appendChild(t);
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
            const bgFill = (xData.backgroundColor) ? xData.backgroundColor : 'white';
            svgContent += `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">`;
            svgContent += `<rect width="${w}" height="${h}" fill="${bgFill}"/>`;
            if (useVector && d3Available && rX && xScale && yScale) {
                 // Real vector points positioned with the LIVE axis scales, so
                 // they match the on-screen axes + WebGL canvas exactly - no
                 // aspect deformation (the scales already encode the visible
                 // domain, which is aspect-preserved on screen).
                 const xSc = (v) => xScale(v);
                 const ySc = (v) => yScale(v);
                 const xd = xScale.domain(), yd = yScale.domain();
                 const minX = Math.min(xd[0], xd[1]), maxX = Math.max(xd[0], xd[1]);
                 const minY = Math.min(yd[0], yd[1]), maxY = Math.max(yd[0], yd[1]);
                 const cpId = 'pc_' + Math.random().toString(36).substr(2, 9);
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
                 if(legendDiv && legendDiv.style.display !== 'none' && xData.legend) {
                    const legG = createLegendSVG(xData.legend, w);
                    if (legG) { const ser = new XMLSerializer(); svgContent += ser.serializeToString(legG); }
                 }
            } else {
                 // Too many points for vector circles: embed the rendered canvas
                 // bitmap as the plot area, with crisp vector axes + legend.
                 const cW2 = w - margin.left - margin.right, cH2 = h - margin.top - margin.bottom;
                 try { svgContent += `<image x="${margin.left}" y="${margin.top}" width="${cW2}" height="${cH2}" preserveAspectRatio="none" href="${canvas.toDataURL('image/png')}"/>`; } catch (e) {}
                 if (svg) {
                     const ser = new XMLSerializer();
                     let axesStr = ser.serializeToString(svg.node());
                     if (axesStr.startsWith('<svg')) axesStr = axesStr.substring(axesStr.indexOf('>') + 1, axesStr.lastIndexOf('<'));
                     svgContent += axesStr;
                 }
                 if (legendDiv && legendDiv.style.display !== 'none' && xData.legend) {
                     const legG = createLegendSVG(xData.legend, w);
                     if (legG) { const ser = new XMLSerializer(); svgContent += ser.serializeToString(legG); }
                 }
            }
            svgContent += '</svg>';
            const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = 'scatterplot.svg'; a.click(); URL.revokeObjectURL(url);
        };

        const instance = {
            // Lightweight data swap for detail-on-zoom: update the points on the
            // EXISTING plot via plot.draw (no destroy/recreate, no new spatial-index
            // worker, no spinner) instead of a full renderValue re-render. The color
            // scale / legend / palette are unchanged, so only x/y/z(/w) move. Channels
            // arrive in the same encoding build_payload produces (base64 here).
            updateData: async function(msg, buffers) {
                const entry = globalRegistry.get(plotId);
                if (!entry || !entry.plot || entry.plot._destroyed || !msg) return;
                // Selection-only update (full-region lasso result): apply on the
                // current points, no redraw.
                // ANY response means a fetch returned -> clear the loader FIRST,
                // before the staleness check, so a superseded request (e.g. a reset
                // bumped the seq while this was in flight) can never leave the spinner
                // stuck on in a linked sibling.
                if (_vpLoadTimer) { clearTimeout(_vpLoadTimer); _vpLoadTimer = null; }
                try { loader.style.display = 'none'; } catch (e) {}
                // Drop the stale response's DATA (racing pans/zooms / a reset) so
                // stale detail tiles don't clobber the latest view. vp_select (lasso)
                // carries no seq -> always applies.
                if (msg.seq != null && msg.seq < _vpSeq) return;
                // no-op: the kernel had nothing new to draw (fetch skipped/covered) —
                // just clear the loading indicator so it never gets stuck on.
                if (msg.type === 'vp_noop') {
                    if (_vpLoadTimer) { clearTimeout(_vpLoadTimer); _vpLoadTimer = null; }
                    try { loader.style.display = 'none'; } catch (e) {}
                    return;
                }
                if (msg.type === 'vp_select') {
                    const s = Array.isArray(msg.select) ? msg.select : [];
                    entry.selectedIndices = s;
                    try { s.length ? entry.plot.select(s, { preventEvent: true })
                                   : entry.plot.deselect({ preventEvent: true }); } catch (e) {}
                    return;
                }
                // synced legend filter (original-cell): keep positions, null = show all
                if (msg.type === 'vp_filter') {
                    try {
                        if (msg.keep === null) entry.plot.unfilter({ preventEvent: true });
                        else if (Array.isArray(msg.keep)) entry.plot.filter(msg.keep, { preventEvent: true });
                    } catch (e) {}
                    return;
                }
                try {
                    let X, Y, Z, W, n;
                    if (msg.type === 'vp_overview' && entry._overview) {
                        // zoom-out: redraw the cached overview (no transfer/decode),
                        // restoring its tooltip/filter buffers too.
                        const o = entry._overview;
                        X = o.x; Y = o.y; Z = o.z; W = o.w; n = o.n;
                        if (o.categoryData) entry.categoryData = o.categoryData;
                        if (o.tooltip) tooltipFields = o.tooltip;
                        if (o.filter) entry.filterData = o.filter;
                    } else {
                        const lt = entry.legend && entry.legend.var_type;
                        const zmode = lt === 'categorical' ? 'u16i'
                                    : (lt === 'continuous' ? 'u16u' : 'f32');
                        // channels arrive as raw binary comm buffers (no base64),
                        // ordered by msg.buf_order
                        const order = msg.buf_order || [];
                        const ch = (k, mode) => {
                            const i = order.indexOf(k);
                            return (i >= 0 && buffers && buffers[i] != null)
                                ? decodeChannel(buffers[i], mode) : null;
                        };
                        X = ch('x', 'u16'); Y = ch('y', 'u16');
                        Z = ch('z', zmode); W = ch('w', 'u16u');
                        n = msg.n_points;
                        if (Z && X && Z.length > X.length) Z = Z.subarray(0, X.length);
                        if (msg.group_data) entry.categoryData = decodeBase64(msg.group_data);
                        // refresh hover fields + filter ranges for the new in-view cells
                        if (Array.isArray(msg.tooltip_data)) {
                            tooltipFields = msg.tooltip_data.map((f) => (f.kind === 'num')
                                ? { name: f.name, kind: 'num', arr: decodeBase64(f.data) }
                                : { name: f.name, kind: 'cat', codes: decodeBase64(f.codes), levels: f.levels });
                        }
                        if (msg.filter_data) {
                            const fb = {};
                            Object.keys(msg.filter_data).forEach((k) => { fb[k] = decodeBase64(msg.filter_data[k]); });
                            entry.filterData = fb;
                        }
                    }
                    entry.xData = X; entry.yData = Y; entry.zData = Z; entry.n_points = n;
                    // the hover/tooltip handler reads the closure dataBuffers (not
                    // entry.*), so refresh them too or hover shows stale coords/values.
                    dataBuffers.x = X; dataBuffers.y = Y; dataBuffers.z = Z; dataBuffers.w = W;

                    // A viewport swap invalidates POSITIONAL state. The kernel
                    // re-maps the persistent selection to the new in-view positions
                    // (msg.select), applied AFTER the draw below. RECOMPUTE the
                    // categorical legend filters from the new per-point codes (chosen
                    // categories persist; their index sets must be rebuilt here or
                    // they mis-filter).
                    const _sel = Array.isArray(msg.select) ? msg.select : [];
                    entry.selectedIndices = _sel;
                    if (entry.indexFilters && entry.categorySelections) {
                        entry.indexFilters.clear();
                        entry.categorySelections.forEach((sel, varName) => {
                            let buf = null;
                            if (entry.colorVar === varName) buf = entry.zData;
                            else if (entry.groupVar === varName) buf = entry.categoryData;
                            if (buf && sel && sel.size) {
                                const s = new Set();
                                for (let p = 0; p < n; p++) if (sel.has(Math.round(buf[p]))) s.add(p);
                                entry.indexFilters.set(varName, s);
                            }
                        });
                    }

                    const pts = new Array(n);
                    if (W) { for (let i=0;i<n;i++) pts[i] = [X[i], Y[i], Z?Z[i]:0, W[i]]; }
                    else if (Z) { for (let i=0;i<n;i++) pts[i] = [X[i], Y[i], Z[i]]; }
                    else { for (let i=0;i<n;i++) pts[i] = [X[i], Y[i]]; }
                    // Clear the old highlight BEFORE drawing the new points, else the
                    // previous selection's indices flash on the new set mid-swap.
                    try { entry.plot.deselect({ preventEvent: true }); } catch (e) {}
                    // AWAIT the draw: plot.draw resolves only after the new points
                    // (and spatial index) are in place. Selecting before it settles
                    // applies the indices to the OLD points -> random highlights.
                    await entry.plot.draw(pts);
                    try {
                        if (_sel.length) entry.plot.select(_sel, { preventEvent: true });
                        else entry.plot.deselect({ preventEvent: true });
                    } catch (e) {}
                    if (typeof recalcAndApplyFilters === 'function') recalcAndApplyFilters(entry);
                    if (entry.updateLegendUI) entry.updateLegendUI();
                    // synced legend filter applied AFTER recalc so it wins; keep
                    // positions / null = show all / undefined = leave as-is.
                    if (msg.keep !== undefined) {
                        try {
                            if (msg.keep === null) entry.plot.unfilter({ preventEvent: true });
                            else entry.plot.filter(msg.keep, { preventEvent: true });
                        } catch (e) {}
                    }
                    if (_vpLoadTimer) { clearTimeout(_vpLoadTimer); _vpLoadTimer = null; }
                    try { loader.style.display = 'none'; } catch (e) {}   // detail fetch done
                } catch (e) { console.error('[reglScatterplot] updateData failed', e); }
            },
            renderValue: async function(xData) {
                lastXData = xData;   // remembered so we can re-render after a WebGL context loss
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

                // Show the spinner only if rendering is genuinely slow (a big
                // initial load) via a delayed show, so fast re-renders (e.g.
                // detail-on-zoom viewport refreshes) never flash a loading circle.
                loader.innerHTML = '';
                const _loaderTimer = setTimeout(() => { loader.style.display = 'block'; }, 450);
                if (!Array.isArray(xData.gene_names)) xData.gene_names = [];

                // Prefer the caller's logical plotId: it's the id used by
                // `syncPlots` and by the Shiny message handlers. Falling back to
                // el.id first (the old behaviour) meant the registry was keyed by
                // the DOM id, so a `syncPlots = c("p1","p2")` group never matched
                // and cross-plot sync silently did nothing outside Shiny.
                plotId = xData.plotId || el.id || ('plot_' + Math.random().toString(36).substr(2, 9));
                
                cleanUpZombies();
                let prevCam = null;
                const selfEntry = globalRegistry.get(plotId);
                if (selfEntry && selfEntry.plot && !selfEntry.plot._destroyed) {
                    // Keep the current view across an in-place re-render (e.g. the
                    // progressive subset -> full swap) so it doesn't jump back.
                    try { prevCam = cloneCamera(selfEntry.plot.get('cameraView')); } catch(e) {}
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

                let initialView = prevCam;
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
                // Channels may arrive as base64 strings (default) OR, in the
                // experimental fast path, as raw binary (DataView from a comm
                // buffer). decodeChannel picks the right path by the channel's
                // known transform.
                const _zmode = (xData.legend && xData.legend.var_type === 'categorical')
                    ? 'u16i'
                    : ((xData.legend && xData.legend.var_type === 'continuous') ? 'u16u' : 'f32');
                dataBuffers.x = decodeChannel(xData.x, 'u16');
                dataBuffers.y = decodeChannel(xData.y, 'u16');
                dataBuffers.z = decodeChannel(xData.z, _zmode);
                dataBuffers.w = xData.w ? decodeChannel(xData.w, 'u16u') : null; // size/opacity channel

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
                // pixel_ratio override: regl-scatterplot reads window.devicePixelRatio
                // directly (and ignores the pixelRatio we pass), so the ONLY way to
                // render crisper than the device (e.g. browser zoomed < 100%, dpr < 1)
                // is to raise the global ratio. It's page-global, so to avoid a STICKY
                // ratio (forcing 2x once would keep every later plot supersampled =>
                // laggy), restore native FIRST, then re-apply only if THIS plot asks.
                if (window.__reglDprForced) {
                    try { delete window.devicePixelRatio; } catch (e) {}
                    window.__reglDprForced = null;
                }
                if (xData.pixelRatio != null) {
                    const _t = Number(xData.pixelRatio);
                    if (_t > (window.devicePixelRatio || 1)) {
                        try {
                            Object.defineProperty(window, 'devicePixelRatio',
                                { configurable: true, get: () => _t });
                            window.__reglDprForced = _t;
                        } catch (e) {}
                    }
                }
                const dpr = (xData.pixelRatio != null)
                    ? xData.pixelRatio
                    : (xData.performanceMode
                        ? (window.devicePixelRatio || 1)
                        : Math.max(window.devicePixelRatio || 1, 2));
                // Share ONE WebGL renderer (context) across every widget on the
                // page. Browsers cap live WebGL contexts (~16); a new context per
                // plot/cell exhausts them and triggers context-loss ("GPU Error").
                if (xData.pixelRatio != null) {
                    // An explicit pixelRatio gets its OWN renderer so the override applies.
                    renderer = reglMod.createRenderer({ pixelRatio: dpr });
                } else {
                    if (!window.__reglSharedRenderer) {
                        window.__reglSharedRenderer = reglMod.createRenderer({ pixelRatio: dpr });
                    }
                    renderer = window.__reglSharedRenderer;
                }
                const intXScale = d3.scaleLinear().domain([-1,1]).range([0,cW]);
                const intYScale = d3.scaleLinear().domain([-1,1]).range([cH,0]);
                let initialAspectRatio = null;
                if (xData.autoFit) initialAspectRatio = cW / cH;

                const createScatterplot = reglMod.default;
                
                try {
                    plot = createScatterplot({
                        renderer, canvas, width: cW, height: cH, pixelRatio: dpr,
                        xScale: intXScale, yScale: intYScale, pointSize: xData.options.size,
                        aspectRatio: initialAspectRatio, performanceMode: xData.performanceMode,
                        // Long-press then drag = lasso, no modifier needed. Shift+drag
                        // also lassos where the host allows it, but JupyterLab grabs
                        // Shift+mousedown at the document level (cell/text selection)
                        // before the canvas sees it, so on a server Lab the modifier
                        // never arrives — long-press can't be intercepted, so lasso
                        // works everywhere (plus the toolbar lasso button).
                        lassoOnLongPress: true,
                        // Click a point = select it; ADD to the selection with Ctrl
                        // (Win/Linux) or Cmd (Mac); remove with Alt. Ctrl isn't
                        // intercepted by JupyterLab the way Shift is (that's why
                        // Ctrl+scroll works on servers), so Ctrl+click is reliable
                        // everywhere — unlike Shift+drag lasso.
                        actionKeyMap: {
                            lasso: 'shift',
                            merge: (/Mac|iPhone|iPad/.test((typeof navigator !== 'undefined'
                                && (navigator.platform || navigator.userAgent)) || '') ? 'cmd' : 'ctrl'),
                            rotate: 'alt',
                            remove: 'alt',
                        },
                        // Build the KDBush spatial index (lasso/hover hit-testing) in a
                        // Web Worker so it doesn't block/freeze the main thread on large
                        // data — regl-scatterplot builds it eagerly on every draw().
                        spatialIndexUseWorker: true
                    });
                    const newConf = { pointSize: xData.options.size, pointColor: xData.options.pointColor, opacity: xData.options.opacity };
                    newConf.colorBy = xData.options.colorBy ? xData.options.colorBy : null;
                    // Size / opacity encoding by a second data channel (valueB).
                    if (dataBuffers.w) {
                        const szMax = xData.options.size || 6;
                        if (xData.sizeBy) {
                            newConf.sizeBy = 'valueB';
                            newConf.pointSize = [Math.max(1, szMax * 0.25), szMax * 0.5, szMax];
                        }
                        if (xData.opacityBy) {
                            newConf.opacityBy = 'valueB';
                            newConf.opacity = [0.15, 0.5, 1];
                        }
                    }
                    if (initialView) newConf.cameraView = initialView;
                    // scanpy-style add_outline: a crisp ring + background gap behind
                    // every point, using the engine's antialiased outline passes (the
                    // same look as a selection). outlineColor = the outer-ring colour.
                    if (xData.addOutline) {
                        newConf.outlineAllPoints = true;
                        if (xData.outlineAllWidth != null) newConf.outlineAllWidth = xData.outlineAllWidth;
                        if (xData.outlineColor) newConf.pointColorActive = xData.outlineColor;
                    }
                    plot.set(newConf);
                    if (xData.autoFit && !initialView) plot.zoomToArea({ x: -1.08, y: -1.08, width: 2.16, height: 2.16 }, { transition: false });
                    const points = new Array(n);
                    if (dataBuffers.w) { const zb = dataBuffers.z; for(let i=0; i<n; i++) points[i] = [dataBuffers.x[i], dataBuffers.y[i], zb ? zb[i] : 0, dataBuffers.w[i]]; }
                    else if (dataBuffers.z) { for(let i=0; i<n; i++) points[i] = [dataBuffers.x[i], dataBuffers.y[i], dataBuffers.z[i]]; }
                    else { for(let i=0; i<n; i++) points[i] = [dataBuffers.x[i], dataBuffers.y[i]]; }
                    await plot.draw(points);
                } catch (err) {
                    console.error("[SP-ERROR] Plot render failed (Context Lost?):", err);
                    clearTimeout(_loaderTimer);
                    loader.innerHTML = "⚠️ GPU Error (Try Refreshing)";
                    loader.style.display = 'block';
                    return;
                }

                clearTimeout(_loaderTimer);
                loader.style.display = 'none';

                // --- interaction niceties (added once) --------------------
                // Reset to the exact view the plot first had (not a guessed area).
                const resetView = () => {
                    try {
                        const ent = globalRegistry.get(plotId);
                        if (ent && ent.initialCameraView) {
                            plot.set({ cameraView: cloneCamera(ent.initialCameraView) });
                        } else {
                            plot.zoomToArea({ x: -1.08, y: -1.08, width: 2.16, height: 2.16 }, { transition: true });
                        }
                        // compose: mirror the reset camera to the linked panels (a
                        // programmatic camera set doesn't fire the sync 'view' event).
                        try {
                            if (ent && ent.syncGroup && globalRegistry.globalSyncEnabled) {
                                syncCameraAcrossPlots(plotId);
                            }
                        } catch (e) {}
                        // detail-on-zoom: redraw the cached overview RIGHT NOW (robust —
                        // a programmatic reset may not emit a 'view' event, and the
                        // emit->kernel->snap-back chain can race; without this only the
                        // zoomed-in detail points remain). Then emit so the kernel
                        // re-syncs its draw-order + re-applies the selection.
                        if (xData.detailOnZoom) {
                            _vpSeq++;   // invalidate any in-flight detail responses first
                            const ent2 = globalRegistry.get(plotId);
                            // reset the VIEW only — keep the selection (Escape clears it).
                            // The kernel snap-back re-applies the current selection.
                            if (ent2 && ent2._overview && instance && instance.updateData) {
                                try { instance.updateData({ type: 'vp_overview' }); } catch (e) {}
                            }
                            if (xDomainOrig && yDomainOrig) {
                                setTimeout(() => {   // re-sync kernel (reuse the bumped seq)
                                    _emitViewport([xDomainOrig[0], yDomainOrig[0],
                                                   xDomainOrig[1], yDomainOrig[1]], false);
                                }, 60);
                            }
                        }
                    } catch (err) {}
                };
                // Double-click resets the view (zoom) — selection is kept; Escape clears it.
                if (canvas && !canvas.__rsDbl) {
                    canvas.__rsDbl = true;
                    canvas.addEventListener('dblclick', (e) => {
                        e.preventDefault();
                        resetView();
                    });
                }
                // Escape (while hovering this plot, and only if something is selected)
                // deselects — without stealing Jupyter's own Escape (command mode) when
                // the cursor is elsewhere or there's nothing to clear.
                if (canvas && !canvas.__rsEsc) {
                    canvas.__rsEsc = true;
                    let overCanvas = false;
                    canvas.addEventListener('mouseenter', () => { overCanvas = true; });
                    canvas.addEventListener('mouseleave', () => { overCanvas = false; });
                    document.addEventListener('keydown', (e) => {
                        if (e.key !== 'Escape' || !overCanvas || !plot || plot._destroyed) return;
                        const e0 = globalRegistry.get(plotId);
                        const hasSel = e0 && ((e0.selectedIndices && e0.selectedIndices.length) ||
                            (e0._vp && e0._vp.sel && e0._vp.sel.size));
                        if (!hasSel) return;        // nothing to clear -> let Jupyter handle Escape
                        try { plot.deselect(); } catch (err) {}   // fires events -> clears local + kernel + group
                        e.preventDefault(); e.stopPropagation();
                    });
                }
                // Wheel model: scroll anywhere INSIDE THE AXES (over the canvas) zooms
                // (no modifier); scroll OUTSIDE the plot area (margins / axis labels)
                // scrolls the page. We toggle regl's `cameraIsFixed` — when fixed it
                // doesn't preventDefault on wheel, so the browser scrolls natively (and
                // we forward for the static iframe).
                if (container && !container.__rsWheel) {
                    container.__rsWheel = true;
                    let curFixed = false;
                    const setFixed = (v) => {
                        if (v === curFixed || !plot) return;
                        curFixed = v;
                        try { plot.set({ cameraIsFixed: v }); } catch (err) {}
                    };
                    container.addEventListener('wheel', (e) => {
                        // inside the plotting area (the canvas, bounded by the axes)?
                        let overPlot = false;
                        try {
                            const r = canvas.getBoundingClientRect();
                            overPlot = e.clientX >= r.left && e.clientX <= r.right &&
                                       e.clientY >= r.top && e.clientY <= r.bottom;
                        } catch (err) {}
                        setFixed(!overPlot);
                        if (overPlot) return;       // let regl zoom toward the cursor
                        // outside the plot area: scroll the page. Live widget (no iframe)
                        // bubbles natively (cameraIsFixed -> no preventDefault). The
                        // STATIC <iframe> latches the gesture, so forward it to the
                        // notebook's scroll container.
                        let fe = null; try { fe = window.frameElement; } catch (err) {}
                        if (!fe) return;
                        let pdoc; try { pdoc = window.parent.document; } catch (err) { return; }
                        let dy = e.deltaY;
                        if (e.deltaMode === 1) dy *= 16;
                        else if (e.deltaMode === 2) dy *= (container.clientHeight || 400);
                        let n = fe.parentElement, target = null;
                        while (n && n.nodeType === 1) {
                            const oy = getComputedStyle(n).overflowY;
                            if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay') &&
                                n.scrollHeight > n.clientHeight + 1) { target = n; break; }
                            n = n.parentElement;
                        }
                        if (!target) target = pdoc.querySelector(
                            '.jp-WindowedPanel-outer, .jp-Notebook, .jp-NotebookPanel-notebook');
                        if (!target) target = pdoc.scrollingElement || pdoc.documentElement;
                        if (target) { e.preventDefault(); target.scrollTop += dy; }
                    }, { capture: true, passive: false });
                    container.addEventListener('mousedown', () => setFixed(false), { capture: true });
                }

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

                // Honest subsample note (e.g. "500,000 of 10,000,000 shown") so a
                // downsampled plot never looks like it's showing every point.
                if (xData.caption) {
                    if (!captionDiv) {
                        captionDiv = document.createElement('div');
                        captionDiv.className = 'sp-plot-caption';
                        captionDiv.style.cssText = 'position:absolute; bottom:4px; right:8px; ' +
                            'pointer-events:none; z-index:40; opacity:0.6; ' +
                            'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Inter",Roboto,Arial,sans-serif;';
                        container.appendChild(captionDiv);
                    }
                    captionDiv.textContent = xData.caption;
                    captionDiv.style.color = xData.axisColor || '#333333';
                    captionDiv.style.fontSize = Math.max(9, (xData.fontSize || 12) - 2) + 'px';
                    captionDiv.style.display = 'block';
                } else if (captionDiv) {
                    captionDiv.style.display = 'none';
                }

                // The current view as ORIGINAL data-coordinate bounds
                // [x0,y0,x1,y1] (detail-on-zoom asks the kernel for the cells in
                // here). Same camera->data math as updateAxesFromCamera, minus the
                // axes guard so it works whether or not axes are shown.
                const getViewportBounds = function() {
                    if (!plot || !xDomainOrig || !yDomainOrig) return null;
                    const xs = plot.get('xScale'), ys = plot.get('yScale');
                    if (!xs || !ys) return null;
                    const vnX = xs.domain(), vnY = ys.domain();
                    const ox = (v) => xDomainOrig[0] + (v+1)/2 * (xDomainOrig[1]-xDomainOrig[0]);
                    const oy = (v) => yDomainOrig[0] + (v+1)/2 * (yDomainOrig[1]-yDomainOrig[0]);
                    const X = [ox(vnX[0]), ox(vnX[1])], Y = [oy(vnY[0]), oy(vnY[1])];
                    return [Math.min(X[0],X[1]), Math.min(Y[0],Y[1]),
                            Math.max(X[0],X[1]), Math.max(Y[0],Y[1])];
                };

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
                    // detail-on-zoom: cache the overview buffers so zoom-out redraws
                    // them instantly (no channel transfer/decode over the comm).
                    _overview: xData.detailOnZoom ? {
                        x: dataBuffers.x, y: dataBuffers.y, z: dataBuffers.z,
                        w: dataBuffers.w, n: n, categoryData: catData,
                        filter: filterBuffers, tooltip: null,   // tooltip set after its setup below
                    } : null,
                    filterData: filterBuffers, categoryData: catData,
                    colorVar: xData.colorVar, groupVar: xData.groupVar,
                    detailOnZoom: xData.detailOnZoom,   // read in the legend-click handler (factory scope, no xData)
                    drawOrder: xData.drawOrder || null, // original cell per drawn position (for cross-panel selection sync)
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
                let _vpTimer = null;
                // Motion-LOD (cheap): shrink the point size while the camera moves so
                // a dense cloud thins out and pans smoothly (less overdraw), then
                // restore at rest. Just a uniform change — NO point re-upload/index
                // rebuild, so no freeze on release (unlike the count-based version).
                let _lodTimer = null, _lodActive = false;
                const _lodThreshold = 120000;
                const _lodOrigSize = (xData.options && xData.options.size) || 3;
                const _emitViewport = (bounds, bump, reset) => {
                    if (bump !== false) _vpSeq++;     // bump=false reuses the current seq
                    // show the loader if the fetch is slow (delayed so fast ones don't flash)
                    if (_vpLoadTimer) clearTimeout(_vpLoadTimer);
                    _vpLoadTimer = setTimeout(() => { try { loader.innerHTML = ''; loader.style.display = 'block'; } catch (e) {} }, 350);
                    try {
                        container.dispatchEvent(new CustomEvent('sp-viewport',
                            { detail: { plotId: plotId, bounds: bounds, seq: _vpSeq, reset: !!reset }, bubbles: false }));
                    } catch (e) {}
                };
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
                    // motion-LOD: shrink points while moving (cheap), restore at rest.
                    if (xData.detailOnZoom && e && e.cameraTouched && !e.isInitializing
                            && (e.n_points || 0) > _lodThreshold) {
                        if (!_lodActive) {
                            _lodActive = true;
                            try { plot.set({ pointSize: Math.max(1, _lodOrigSize * 0.4) }); } catch (er) {}
                        }
                        if (_lodTimer) clearTimeout(_lodTimer);
                        _lodTimer = setTimeout(() => {
                            _lodActive = false;
                            try { plot.set({ pointSize: _lodOrigSize }); } catch (er) {}
                        }, 150);
                    }
                    // detail-on-zoom: once the user has moved, debounce-emit the
                    // current viewport so the kernel can re-render the in-view cells.
                    if (xData.detailOnZoom && e && e.cameraTouched && !e.isInitializing) {
                        if (_vpTimer) clearTimeout(_vpTimer);
                        _vpTimer = setTimeout(() => {
                            const b = getViewportBounds();
                            if (b) _emitViewport(b);
                        }, 350);
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
                // Expose this panel's detail-on-zoom fetch hooks so a synced
                // sibling (whose camera is moved with preventEvent, so its own
                // 'view' handler never fires) can be told to fetch detail for the
                // shared viewport. Without this, linked progressive panels stay
                // frozen on the overview while the panned/zoomed panel updates.
                { const _e = globalRegistry.get(plotId);
                  if (_e) { _e.emitViewport = _emitViewport; _e.getViewportBounds = getViewportBounds; } }

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
                    // Push to a linked crosstalk group (DT / plotly / leaflet …).
                    if (e0 && e0.ctSel && e0.ctKeys) {
                        try { e0.ctSel.set(indices.length ? indices.map(j => e0.ctKeys[j]) : null); } catch (e) {}
                    }
                    if (xData.zoomOnSelection && indices.length) zoomToSelection();
                };
                // Report the filtered set to the kernel (w.filtered). orig = kept
                // ORIGINAL indices, or null when no filter is active.
                { const _e = globalRegistry.get(plotId);
                  if (_e) _e.reportFilter = (orig) => {
                      try { container.dispatchEvent(new CustomEvent('sp-filter',
                          { detail: { plotId: plotId, indices: orig }, bubbles: false })); } catch (e) {}
                  }; }
                const mirrorToGroup = (apply) => {
                    const e0 = globalRegistry.get(plotId);
                    if (!globalRegistry.globalSyncEnabled || globalRegistry.isSyncing || !e0 || !e0.syncGroup) return;
                    try {
                        globalRegistry.isSyncing = true;
                        e0.syncGroup.forEach(pid => {
                            if (pid === plotId) return;
                            const e = globalRegistry.get(pid);
                            if (e && e.plot && e.canvas && e.canvas.isConnected) apply(e.plot, e);
                        });
                    } finally { globalRegistry.isSyncing = false; }
                };
                // Map drawn positions in THIS panel -> ORIGINAL cells -> drawn
                // positions in a target panel, so a selection lands on the SAME cells
                // even when panels are drawn in different orders (compose by different
                // colours). Identity when neither panel has a draw order.
                const mapSelToPanel = (positions, targetEntry) => {
                    const myDO = (globalRegistry.get(plotId) || {}).drawOrder;
                    const tgtDO = targetEntry.drawOrder;
                    if (!myDO && !tgtDO) return positions;             // both identity -> positional
                    const orig = myDO ? positions.map(p => myDO[p]) : positions;
                    if (!tgtDO) return orig;                            // target identity -> originals are positions
                    if (!targetEntry._invDrawOrder) {
                        const m = new Map();
                        for (let i = 0; i < tgtDO.length; i++) m.set(tgtDO[i], i);
                        targetEntry._invDrawOrder = m;
                    }
                    const out = [];
                    for (const o of orig) { const p = targetEntry._invDrawOrder.get(o); if (p !== undefined) out.push(p); }
                    return out;
                };

                const unsubSelect = plot.subscribe('select', ({ points: sel }) => {
                    const indices = Array.from(sel);
                    reportSelection(indices);
                    // progressive panels sync cross-panel via the kernel (sp-lasso,
                    // original-cell); the positional JS mirror would use a stale order.
                    if (!xData.detailOnZoom) {
                        mirrorToGroup((pl, e) => {
                            const tgt = mapSelToPanel(indices, e);   // map by ORIGINAL cell
                            tgt.length ? pl.select(tgt, { preventEvent: true })
                                       : pl.deselect({ preventEvent: true });
                        });
                    }
                });
                window.__spUnsubscribers[plotId].push(unsubSelect);

                const unsubDeselect = plot.subscribe('deselect', () => {
                    reportSelection([]);
                    mirrorToGroup(pl => pl.deselect({ preventEvent: true }));
                });
                window.__spUnsubscribers[plotId].push(unsubDeselect);

                // detail-on-zoom: also emit the lasso POLYGON (in data coords) so the
                // kernel can select EVERY cell inside it on the full dataset, not just
                // the rendered subset (the plain 'select' above only hits drawn points).
                if (xData.detailOnZoom) {
                    const unsubLasso = plot.subscribe('lassoEnd', ({ coordinates }) => {
                        if (!coordinates || coordinates.length < 3 || !xDomainOrig || !yDomainOrig) return;
                        const poly = coordinates.map((c) => {
                            const nx = c[0], ny = c[1];
                            return [xDomainOrig[0] + (nx + 1) / 2 * (xDomainOrig[1] - xDomainOrig[0]),
                                    yDomainOrig[0] + (ny + 1) / 2 * (yDomainOrig[1] - yDomainOrig[0])];
                        });
                        try {
                            container.dispatchEvent(new CustomEvent('sp-lasso',
                                { detail: { plotId: plotId, polygon: poly }, bubbles: false }));
                        } catch (e) {}
                    });
                    window.__spUnsubscribers[plotId].push(unsubLasso);
                }

                // crosstalk: link selection + filtering with other crosstalk
                // widgets (DT, plotly, leaflet) sharing the same group.
                if (xData.crosstalk && xData.crosstalk.on && xData.crosstalk.key &&
                    typeof window !== 'undefined' && window.crosstalk) {
                    const ct = window.crosstalk;
                    const ctKeys = xData.crosstalk.key;
                    const keyToIdx = new Map();
                    ctKeys.forEach((k, i) => keyToIdx.set(String(k), i));
                    const toIdx = (vals) => (vals || [])
                        .map(k => keyToIdx.get(String(k)))
                        .filter(v => v !== undefined);
                    const e0 = globalRegistry.get(plotId);
                    const selH = new ct.SelectionHandle(xData.crosstalk.group);
                    if (e0) { e0.ctSel = selH; e0.ctKeys = ctKeys; }
                    selH.on('change', (e) => {
                        if (e.sender === selH) return;       // ignore our own echo
                        const idx = toIdx(e.value);
                        if (idx.length) plot.select(idx, { preventEvent: true });
                        else plot.deselect({ preventEvent: true });
                    });
                    const filtH = new ct.FilterHandle(xData.crosstalk.group);
                    filtH.on('change', (e) => {
                        const ent = globalRegistry.get(plotId);
                        if (!ent) return;
                        if (e.value == null) { delete ent.serverIndices; }
                        else { ent.serverIndices = toIdx(e.value); ent.serverIndicesSet = null; }
                        recalcAndApplyFilters(ent);
                    });
                    window.__spUnsubscribers[plotId].push(() => { try { selH.close(); filtH.close(); } catch (e) {} });
                }

                if (xData.showTooltip && tooltip) {
                    // Extra hover fields (tooltipBy): numeric -> raw float buffer;
                    // categorical -> integer codes + level labels.
                    tooltipFields = [];
                    if (Array.isArray(xData.tooltip_data)) {
                        tooltipFields = xData.tooltip_data.map((f) => (f.kind === 'num')
                            ? { name: f.name, kind: 'num', arr: decodeBase64(f.data) }
                            : { name: f.name, kind: 'cat', codes: decodeBase64(f.codes), levels: f.levels });
                    }
                    // cache for the detail-on-zoom overview restore (zoom-out)
                    { const _eo = globalRegistry.get(plotId);
                      if (_eo && _eo._overview) _eo._overview.tooltip = tooltipFields; }
                    const colorVarName = (xData.colorVar && xData.colorVar !== 'Solid_Color') ? xData.colorVar : 'Value';
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
                            txt += `<br>${colorVarName}: ${val}`;
                        }
                        for (let f = 0; f < tooltipFields.length; f++) {
                            const fl = tooltipFields[f];
                            let v;
                            if (fl.kind === 'num') { v = fl.arr[i]; v = (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2)); }
                            else { const ci = Math.round(fl.codes[i]); v = (fl.levels && fl.levels[ci] !== undefined) ? fl.levels[ci] : '?'; }
                            txt += `<br>${fl.name}: ${v}`;
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
                    createFilterPanel(container, globalRegistry.get(plotId), xData.legendFontSize || 12, margin);
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
                    // Default anchor INSIDE the plotting area (offset by the axis
                    // margins) so the toolbar doesn't sit over the axes/labels.
                    tb.style.top = ((margin.top || 0) + 10) + 'px';
                    tb.style.left = ((margin.left || 0) + 10) + 'px';
                    // SP_PANEL: match the legend/filter frosted card (bg from
                    // legendBg, icons in legendText) so the panels are a family.
                    const tbBg = xData.legendBg || '#ffffff';
                    const tbTxt = xData.legendText || '#222222';
                    const tbOpacity = (typeof xData.legendOpacity === 'number') ? xData.legendOpacity : 0.55;
                    const tbBlur = (typeof xData.legendBlur === 'number') ? xData.legendBlur : 10;
                    tb.style.background = hexToRgba(tbBg, tbOpacity);
                    tb.style.borderColor = 'rgba(127,127,127,0.30)';
                    if (tbBlur > 0) { tb.style.backdropFilter = 'blur(' + tbBlur + 'px) saturate(120%)'; tb.style.webkitBackdropFilter = tb.style.backdropFilter; }
                    const mk = (title, svg, onClick) => {
                        const btn = document.createElement('button');
                        btn.className = 'sp-tb-btn'; btn.title = title; btn.innerHTML = svg;
                        btn.style.color = tbTxt;
                        btn.onclick = (e) => { e.stopPropagation(); onClick(btn); };
                        tb.appendChild(btn); return btn;
                    };
                    const setMode = (mode, btn) => {
                        try { plot.set({ mouseMode: mode }); } catch (err) {}
                        // Manage inline colour explicitly: the active icon is white,
                        // others use legendText (inline styles beat the .on CSS).
                        tb.querySelectorAll('.sp-tb-btn').forEach(b => { b.classList.remove('on'); b.style.color = tbTxt; });
                        if (btn) { btn.classList.add('on'); btn.style.color = '#fff'; }
                    };
                    const panBtn = mk('Pan / zoom', TB.pan, (b) => setMode('panZoom', b));
                    mk('Lasso select', TB.lasso, (b) => setMode('lasso', b));
                    mk('Zoom to selection', TB.zoom, () => zoomToSelection());
                    mk('Reset view', TB.reset, () => resetView());
                    mk('Screenshot (PNG)', TB.cam, () => downloadPlot('png'));
                    panBtn.classList.add('on'); panBtn.style.color = '#fff';

                    // Drag grip so the toolbar can be moved off the axes.
                    const grip = document.createElement('div');
                    grip.className = 'sp-tb-grip';
                    grip.title = 'Drag to move';
                    grip.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg>';
                    grip.style.color = tbTxt;
                    tb.insertBefore(grip, tb.firstChild);
                    let tdr = false, tsx = 0, tsy = 0, tox = 0, toy = 0;
                    grip.addEventListener('mousedown', (e) => {
                        tdr = true; tsx = e.clientX; tsy = e.clientY;
                        const r = tb.getBoundingClientRect(), cr = container.getBoundingClientRect();
                        tox = r.left - cr.left; toy = r.top - cr.top;
                        tb.style.right = 'auto'; tb.style.bottom = 'auto';
                        tb.style.left = tox + 'px'; tb.style.top = toy + 'px';
                        e.preventDefault();
                    });
                    document.addEventListener('mousemove', (e) => {
                        if (!tdr) return;
                        const maxL = container.clientWidth - tb.offsetWidth;
                        const maxT = container.clientHeight - tb.offsetHeight;
                        tb.style.left = Math.max(0, Math.min(tox + e.clientX - tsx, maxL)) + 'px';
                        tb.style.top = Math.max(0, Math.min(toy + e.clientY - tsy, maxT)) + 'px';
                    });
                    document.addEventListener('mouseup', () => { tdr = false; });

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
            // Persistent highlight: mark points with the engine's crisp ring + size
            // bump (patched into regl-scatterplot), independent of the selection so
            // it survives double-click / new lasso. positions are POSITIONAL indices
            // into the current draw; color sets the ring colour (pointColorActive).
            setHighlight: function(content) {
                if (!plot) return;
                const e = globalRegistry.get(plotId);
                if (e) e.highlightPoints = Array.isArray(content.points) ? content.points : [];
                try {
                    if (content.color) plot.set({ pointColorActive: content.color });
                    plot.set({ highlightPoints: (content.points || []) });
                } catch (err) {}
            },

            resize: function(w, h) {
                widgetWidth = w;
                widgetHeight = h;
                const newW = w; const newH = h;
                const cW = newW - margin.left - margin.right;
                const cH = newH - margin.top - margin.bottom;
                if (canvas && plot) {
                    // Do NOT size the canvas ourselves: regl-scatterplot owns the
                    // drawing buffer (canvas.width = width * devicePixelRatio). Setting
                    // it here to plain CSS px clobbered the DPR scaling whenever a
                    // resize fired with unchanged dims (plot.set early-returns), so the
                    // rendered content and the pointer mapping desynced -> the pan
                    // "phantom"/offset click, especially in a settling compose grid.
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