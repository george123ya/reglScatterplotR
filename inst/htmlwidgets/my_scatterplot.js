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
  
  window.__myScatterplotRegistry.activeStrainers = {}; 
  
  // --- COMMITTEE FILTER STATE ---
  window.__myScatterplotRegistry.indexFilters = new Map(); 
  window.__myScatterplotRegistry.categorySelections = new Map(); 
  
  window.__myScatterplotRegistry.n_points = 0; 
  
  console.log('[SP-DEBUG] Global registry initialized (Committee Model)');
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
    if (typeof base64Str === 'string' && base64Str.startsWith('base64:')) {
        const raw = atob(base64Str.slice(7));
        const len = raw.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) { bytes[i] = raw.charCodeAt(i); }
        return new Float32Array(bytes.buffer);
    }
    return new Float32Array(base64Str);
};

// --- GARBAGE COLLECTOR ---
const cleanUpZombies = () => {
    globalRegistry.forEach((entry, pid) => {
        if (entry.canvas && !entry.canvas.isConnected) {
            console.log(`[SP-DEBUG] 🧟 Zombie detected: ${pid}. Cleaning up...`);
            if (entry.plot && !entry.plot._destroyed) {
                try { 
                    entry.savedCameraView = cloneCamera(entry.plot.get('cameraView')); 
                } catch(e) {}
            }
            if (entry.plot) {
                try { 
                    entry.plot.destroy(); 
                    console.log(`[SP-DEBUG] 🗑️ Destroyed WebGL context for ${pid}`);
                } catch(e) { 
                    console.warn(`[SP-DEBUG] Failed to destroy ${pid}:`, e); 
                }
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
    const strainers = globalRegistry.activeStrainers;
    const strainerKeys = Object.keys(strainers);
    const hasStrainers = (strainerKeys.length > 0);
    const hasServerFilter = (entry.serverIndices && entry.serverIndices.length > 0);
    
    // 1. Get all active categorical filters (The Committee)
    const activeVarFilters = Array.from(globalRegistry.indexFilters.values());
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
      if (msg.range === null) delete globalRegistry.activeStrainers[msg.variable];
      else globalRegistry.activeStrainers[msg.variable] = msg.range;
      globalRegistry.forEach(entry => { if (entry.plot && !entry.plot._destroyed) recalcAndApplyFilters(entry); });
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
    name: 'my_scatterplot',
    type: 'output',
    factory: function(el, width, height) {
        const container = el;
        container.style.position = 'relative';
        container.style.overflow = 'hidden'; 
        container.style.backgroundColor = 'transparent';

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
                    font-family: 'Inter', sans-serif;
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
                    font-size: 12px; font-family: 'Inter', sans-serif;
                    color: var(--text-sub, #64748b); cursor: pointer;
                    border-radius: 4px; transition: all 0.15s;
                }
                .sp-menu-item:hover {
                    background: var(--bg-panel, #f1f5f9);
                    color: var(--accent, #3b82f6);
                }

                /* --- Draggable Legend Wrapper (Kept from previous step) --- */
                .sp-legend-wrapper {
                    position: absolute; z-index: 100; display: flex; flex-direction: column;
                    background: var(--bg-card, rgba(255, 255, 255, 0.95));
                    border: 1px solid var(--border-color, #e2e8f0);
                    border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);
                    transition: opacity 0.2s, box-shadow 0.2s;
                    max-height: 90%;
                }
                .sp-legend-wrapper.dragging { opacity: 0.9; box-shadow: 0 8px 24px rgba(0,0,0,0.2); cursor: move; }
                .sp-legend-wrapper.minimized .sp-legend-content { display: none; }
                .sp-legend-header {
                    display: flex; align-items: center; justify-content: space-between;
                    padding: 6px 10px; border-bottom: 1px solid var(--border-color, #e2e8f0);
                    background: var(--bg-panel, rgba(245, 245, 245, 0.5));
                    border-radius: 8px 8px 0 0; cursor: move; user-select: none;
                    min-height: 28px;
                }
                .sp-legend-title { font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--text-sub, #64748b); letter-spacing: 0.5px; }
                .sp-legend-btn {
                    width: 20px; height: 20px; border: none; background: transparent;
                    color: var(--text-sub, #64748b); cursor: pointer; border-radius: 4px;
                    display: flex; align-items: center; justify-content: center; font-size: 16px; line-height: 1;
                }
                .sp-legend-btn:hover { background: rgba(0,0,0,0.05); color: var(--text-main, #333); }
                .sp-legend-content { padding: 8px; overflow-y: auto; max-height: 300px; }
                .sp-legend { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
                .sp-legend-item { transition: opacity 0.2s; user-select: none; }
                .sp-legend-item:hover { background-color: rgba(0,0,0,0.03); border-radius: 4px; }
                .sp-color-swatch { width: 14px; height: 14px; border-radius: 3px; margin-right: 8px; flex-shrink: 0; cursor: pointer; border: 1px solid rgba(0,0,0,0.2); box-shadow: 0 1px 2px rgba(0,0,0,0.1); }
                .sp-loader { border: 4px solid #f3f3f3; border-top: 4px solid #3498db; border-radius: 50%; width: 30px; height: 30px; animation: spin 1s linear infinite; position: absolute; top: 50%; left: 50%; margin-top: -15px; margin-left: -15px; z-index: 50; display: none; }
                @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
            `;
            document.head.appendChild(style);
            const pickrStyle = document.createElement('link');
            pickrStyle.rel = 'stylesheet';
            pickrStyle.href = 'https://esm.sh/@simonwep/pickr/dist/themes/nano.min.css';
            document.head.appendChild(pickrStyle);
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
        let xDomainOrig, yDomainOrig, tooltip;
        let d3Available = false;
        let dataBuffers = { x: null, y: null, z: null };
        let legendDiv = null;
        let isInitialRender = true;
        let resizeObserver = null;
        let lastClickedCategoryIndex = -1;
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
            const myVar = globalRegistry.get(plotId).legend?.var_name;
            const mySelections = globalRegistry.categorySelections.get(myVar);
            
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
            const bg = entry.legendBg || 'var(--bg-card, #ffffff)';
            const txt = entry.legendText || 'var(--text-main, #222)';
            const border = (txt.includes('#222') || txt === '#222') ? 'var(--border-color, #eee)' : 'var(--border-color, #475569)';

            if (!legendData || !legendData.var_type || legendData.var_type === 'none') {
                if (legendWrapper) legendWrapper.style.display = 'none';
                return;
            }

            if (!legendWrapper) {
                legendWrapper = document.createElement('div');
                legendWrapper.className = 'sp-legend-wrapper';
                // Default position
                legendWrapper.style.top = '10px';
                legendWrapper.style.right = '10px'; 
                legendWrapper.style.left = 'auto'; 
                
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
                    minBtn.innerText = isMin ? '+' : '−';
                };

                // --- FIX: Prevent resize calculation when tab is hidden ---
                const keepInBounds = () => {
                    if (!legendWrapper || legendWrapper.style.display === 'none') return;

                    // CRITICAL FIX: If width is 0 (hidden tab), STOP. 
                    // Otherwise it calculates 'maxLeft' as negative and forces 'left' to 0.
                    if (container.clientWidth === 0 || container.clientHeight === 0) return;
                    
                    // Only apply clamping if we are using 'left' positioning (meaning it was dragged)
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
                ro.observe(legendWrapper);

                // --- Drag Logic ---
                let isDragging = false;
                let startX, startY, initialRight, initialTop;

                header.onmousedown = (e) => {
                    if (e.target.tagName === 'BUTTON') return;
                    e.preventDefault();
                    isDragging = true;
                    legendWrapper.classList.add('dragging');
                    
                    startX = e.clientX;
                    startY = e.clientY;
                    
                    const rect = legendWrapper.getBoundingClientRect();
                    const containerRect = container.getBoundingClientRect();
                    const offsetLeft = rect.left - containerRect.left;
                    const offsetTop = rect.top - containerRect.top;
                    
                    // Switch to explicit left/top positioning on first drag
                    legendWrapper.style.right = 'auto';
                    legendWrapper.style.left = offsetLeft + 'px';
                    legendWrapper.style.top = offsetTop + 'px';
                    
                    initialTop = offsetTop;
                    initialRight = offsetLeft;
                };

                const onMove = (e) => {
                    if (!isDragging) return;
                    const dx = e.clientX - startX;
                    const dy = e.clientY - startY;
                    let newLeft = initialRight + dx;
                    let newTop = initialTop + dy;
                    
                    const maxLeft = container.clientWidth - legendWrapper.offsetWidth;
                    const maxTop = container.clientHeight - legendWrapper.offsetHeight;
                    
                    legendWrapper.style.left = Math.max(0, Math.min(newLeft, maxLeft)) + 'px';
                    legendWrapper.style.top = Math.max(0, Math.min(newTop, maxTop)) + 'px';
                };

                const onUp = () => {
                    if (isDragging) {
                        isDragging = false;
                        legendWrapper.classList.remove('dragging');
                    }
                };
                
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            }

            legendWrapper.style.display = 'flex';
            legendWrapper.style.background = bg;
            legendWrapper.style.borderColor = border;
            legendWrapper.style.color = txt;
            
            const titleEl = legendWrapper.querySelector('.sp-legend-title');
            if(titleEl) titleEl.innerText = legendData.title || "Legend";

            legendDiv.innerHTML = '';
            legendDiv.style.fontSize = fontSize + 'px';

            // ... [Keep Categorical/Continuous population logic below] ...
            if (legendData.var_type === 'categorical') {
                if (!Array.isArray(legendData.names)) legendData.names = [legendData.names];
                if (!Array.isArray(legendData.colors)) legendData.colors = [legendData.colors];
                totalCategories = legendData.names.length;
                let Pickr = window.Pickr;
                if (!Pickr) { const mod = await import('https://esm.sh/@simonwep/pickr'); Pickr = mod.default; window.Pickr = Pickr; }
                
                legendData.names.forEach((name, i) => {
                    const row = document.createElement('div');
                    row.className = 'sp-legend-item';
                    row.style.cssText = 'display: flex; align-items: center; margin-bottom: 4px; padding: 2px 4px; position: relative; cursor: pointer;';
                    
                    const myVar = legendData.var_name;
                    const mySelections = globalRegistry.categorySelections.get(myVar);
                    if (mySelections && !mySelections.has(i)) {
                        row.style.opacity = '0.3';
                    }
                    
                    const swatch = document.createElement('div');
                    swatch.className = 'sp-color-swatch';
                    swatch.style.backgroundColor = legendData.colors[i];
                    swatch.style.width = (fontSize + 2) + 'px'; 
                    swatch.style.height = (fontSize + 2) + 'px';
                    row.appendChild(swatch);
                    
                    const pickrInst = Pickr.create({
                        el: swatch, theme: 'nano', default: legendData.colors[i], defaultRepresentation: 'HEX', useAsButton: true,
                        components: { preview: true, opacity: false, hue: true, interaction: { hex: true, rgba: false, input: true, save: true } }
                    });
                    
                    pickrInst.on('save', (color, instance) => {
                        const newHex = color.toHEXA().toString().substring(0, 7);
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
                        pickrInst.hide();
                    });
                    
                    swatch.addEventListener('click', (e) => e.stopPropagation());
                    
                    const label = document.createElement('span');
                    label.style.color = 'inherit'; label.innerText = name; 
                    
                    row.onclick = (e) => {
                          if (e.target.closest('.pcr-app')) return;
                          let activeSet = globalRegistry.categorySelections.get(myVar);
                          if (e.shiftKey && lastClickedCategoryIndex !== -1) {
                            const start = Math.min(lastClickedCategoryIndex, i); 
                            const end = Math.max(lastClickedCategoryIndex, i);
                            if (!activeSet) activeSet = new Set();
                            for(let k=start; k<=end; k++) activeSet.add(k);
                            globalRegistry.categorySelections.set(myVar, activeSet);
                          } else if (e.ctrlKey || e.metaKey) {
                            if (!activeSet) { activeSet = new Set([i]); } 
                            else { if (activeSet.has(i)) { activeSet.delete(i); if (activeSet.size === 0) activeSet = null; } else activeSet.add(i); }
                            if (activeSet) globalRegistry.categorySelections.set(myVar, activeSet);
                            else globalRegistry.categorySelections.delete(myVar);
                          } else {
                            if (activeSet && activeSet.size === 1 && activeSet.has(i)) { globalRegistry.categorySelections.delete(myVar); } 
                            else { activeSet = new Set([i]); globalRegistry.categorySelections.set(myVar, activeSet); }
                          }
                          lastClickedCategoryIndex = i;
                          const entry = globalRegistry.get(plotId);
                          const currentSelections = globalRegistry.categorySelections.get(myVar);
                          if (!currentSelections) { globalRegistry.indexFilters.delete(myVar); } 
                          else {
                              const newIndexSet = new Set();
                              const n = entry.n_points;
                              let buffer = null;
                              if (entry.colorVar === myVar) buffer = entry.zData;
                              else if (entry.groupVar === myVar) buffer = entry.categoryData;
                              if (buffer) { for(let p=0; p<n; p++) { if (currentSelections.has(Math.round(buffer[p]))) { newIndexSet.add(p); } } globalRegistry.indexFilters.set(myVar, newIndexSet); } 
                          }
                          globalRegistry.forEach(entry => { if(entry.updateLegendUI) entry.updateLegendUI(); recalcAndApplyFilters(entry); });
                          if (window.Shiny && window.Shiny.setInputValue) {
                              const allowedIndices = currentSelections ? Array.from(currentSelections) : null;
                              let allowedNames = null;
                              if (allowedIndices && legendData.names) allowedNames = allowedIndices.map(idx => legendData.names[idx]);
                              window.Shiny.setInputValue("legend_selection_change", { variable: myVar, allowed_names: allowedNames, timestamp: Date.now() });
                          }
                    };
                    row.appendChild(label); legendDiv.appendChild(row);
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
             if (typeof window.html2canvas === 'undefined') {
                const script = document.createElement('script'); script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
                await new Promise((r) => { script.onload = r; document.head.appendChild(script); });
            }
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
            if (!window.jspdf) {
                 const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
                 await new Promise(r => { s.onload = r; document.head.appendChild(s); });
            }
            const { jsPDF } = window.jspdf;
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
                t.setAttribute('font-family', 'sans-serif'); t.setAttribute('font-weight', 'bold'); t.setAttribute('font-size', '12'); 
                t.textContent = d.title; g.appendChild(t);
            }
            if (d.var_type === 'categorical') {
                d.names.forEach((n, i) => {
                    const y = 45 + i*20;
                    const group = document.createElementNS(svgNS, 'g');
                    
                    const myVar = d.var_name;
                    const mySelections = globalRegistry.categorySelections.get(myVar);
                    if (mySelections && !mySelections.has(i)) {
                        group.setAttribute('opacity', '0.3');
                    }
                    const c = document.createElementNS(svgNS, 'circle');
                    c.setAttribute('cx', 15); c.setAttribute('cy', y-4); c.setAttribute('r', 5); c.setAttribute('fill', d.colors[i]);
                    group.appendChild(c);
                    const txt = document.createElementNS(svgNS, 'text');
                    txt.setAttribute('x', 30); txt.setAttribute('y', y);
                    txt.setAttribute('font-family', 'sans-serif'); txt.setAttribute('font-size', '11');
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
                    txt.setAttribute('font-family', 'sans-serif'); txt.setAttribute('font-size', '11');
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
                 const activeVarFilters = Array.from(globalRegistry.indexFilters.values());
                 const hasCatFilters = (activeVarFilters.length > 0);
                 
                 // PREPARE SERVER FILTERS
                 const serverIndices = registryEntry.serverIndices;
                 const hasServerFilter = (serverIndices && serverIndices.length > 0);
                 const serverSet = hasServerFilter ? new Set(serverIndices) : null;

                 let pointsStr = `<g clip-path="url(#${cpId})">`;
                 for (let i = 0; i < nPoints; i++) {
                    let keep = true;

                    // 1. Strainers (Client Ranges)
                    if (globalRegistry.activeStrainers) {
                        const strainers = globalRegistry.activeStrainers;
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

        return {
            renderValue: async function(xData) {
                console.log("[SP-DEBUG] renderValue called for:", xData.plotId);

                if (typeof xData.syncState !== 'undefined') {
                    globalRegistry.globalSyncEnabled = xData.syncState;
                }

                if (globalRegistry.n_points !== 0 && globalRegistry.n_points !== xData.n_points) {
                    globalRegistry.indexFilters.clear();
                    globalRegistry.categorySelections.clear();
                }
                globalRegistry.n_points = xData.n_points;

                if (xData.margins) {
                    margin = xData.margins;
                }
                const fSize = xData.fontSize || 12;

                loader.style.display = 'block'; 
                if (xData.gene_names && Array.isArray(xData.gene_names)) console.log(`Names: ${xData.gene_names.length}`);
                else xData.gene_names = [];

                plotId = el.id || xData.plotId || ('plot_' + Math.random().toString(36).substr(2, 9));
                
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
                if (typeof d3 === 'undefined') { window.d3 = await import('https://esm.sh/d3@7'); d3Available = true; } else d3Available = true;
                
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
                const rect0 = container.getBoundingClientRect();
                const fullW0 = Math.floor(rect0.width);
                const fullH0 = Math.floor(rect0.height);
                const cW = Math.max(0, fullW0 - margin.left - margin.right);
                const cH = Math.max(0, fullH0 - margin.top - margin.bottom);

                if (d3Available && xData.showAxes) {
                    svg = d3.select(container).append('svg')
                        .attr('width', width).attr('height', height)
                        .style('position', 'absolute').style('top', 0).style('left', 0).style('pointer-events', 'none');
                    xAxisG = svg.append('g').attr('class', 'x-axis').attr('transform', `translate(0, ${height - margin.bottom})`);
                    yAxisG = svg.append('g').attr('class', 'y-axis').attr('transform', `translate(${margin.left}, 0)`);
                    
                    // --- UPDATED: Axis Labels with Color ---
                    svg.append('text').attr('class','x-label')
                        .attr('x', margin.left+(width-margin.left-margin.right)/2).attr('y',height - (margin.bottom/4))
                        .text(xData.xlab||'X').attr('text-anchor','middle').style('font-family','sans-serif').style('font-size', fSize+'px').attr('fill', currentAxisColor);
                    
                    svg.append('text').attr('class','y-label').attr('transform','rotate(-90)')
                        .attr('x', -(margin.top+(height-margin.top-margin.bottom)/2)).attr('y', margin.left/3)
                        .text(xData.ylab||'Y').attr('text-anchor','middle').style('font-family','sans-serif').style('font-size', fSize+'px').attr('fill', currentAxisColor);
                        
                    xScale = d3.scaleLinear().domain(xDomainOrig).range([margin.left, width - margin.right]);
                    yScale = d3.scaleLinear().domain(yDomainOrig).range([height - margin.bottom, margin.top]);
                    const ticks = (height < 200) ? 3 : 6;
                    xAxis = d3.axisBottom(xScale).ticks(ticks); 
                    yAxis = d3.axisLeft(yScale).ticks(ticks);
                    
                    // Call updateAxes immediately to set colors
                    updateAxes();
                }

                if (xData.showTooltip && !tooltip) {
                    tooltip = document.createElement('div'); tooltip.style.cssText = `position:absolute;background:rgba(0,0,0,0.85);color:white;padding:6px 10px;border-radius:4px;font-size:12px;pointer-events:none;display:none;z-index:1000;font-family:sans-serif;`;
                    container.appendChild(tooltip);
                }

                const rect = container.getBoundingClientRect();
                // const cW = rect.width - margin.left - margin.right; 
                // const cH = rect.height - margin.top - margin.bottom;
                canvas.style.top = margin.top+'px'; 
                canvas.style.left = margin.left+'px';

                if (!renderer) { const mod = await import('https://esm.sh/regl-scatterplot@1.14.1'); renderer = mod.createRenderer(); }
                const intXScale = d3.scaleLinear().domain([-1,1]).range([0,cW]);
                const intYScale = d3.scaleLinear().domain([-1,1]).range([cH,0]);
                let initialAspectRatio = null; 
                if (xData.autoFit) initialAspectRatio = cW / cH; 

                const createScatterplot = (await import('https://esm.sh/regl-scatterplot@1.14.1')).default;
                
                try {
                    plot = createScatterplot({ 
                        renderer, canvas, width: cW, height: cH, 
                        xScale: intXScale, yScale: intYScale, pointSize: xData.options.size, 
                        aspectRatio: initialAspectRatio, performanceMode: xData.performanceMode 
                    });
                    const newConf = { pointSize: xData.options.size, pointColor: xData.options.pointColor, opacity: xData.options.opacity };
                    newConf.colorBy = xData.options.colorBy ? xData.options.colorBy : null;
                    if (initialView) newConf.cameraView = initialView;
                    plot.set(newConf);
                    if (xData.autoFit && !initialView) plot.zoomToArea({ x: -1, y: -1, width: 2, height: 2 }, { transition: false });
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

                if (!initialView && isInitialRender && !xData.autoFit) {
                     const autoAdjustZoom = function() {
                        const rect = container.getBoundingClientRect();
                        const currW = rect.width - margin.left - margin.right;
                        const currH = rect.height - margin.top - margin.bottom;
                        if (currW <= 0 || currH <= 0) return;
                        const xr = xDomainOrig[1] - xDomainOrig[0]; const yr = yDomainOrig[1] - yDomainOrig[0];
                        const sAsp = xr / yr; const cAsp = currW / currH;
                        let zX, zY, zW, zH;
                        if (sAsp > cAsp) { zW = 2; zH = 2 * (sAsp / cAsp); zX = -1; zY = -zH / 2; } 
                        else { zH = 2; zW = 2 * (cAsp / sAsp); zX = -zW / 2; zY = -1; }
                        plot.zoomToArea({ x: zX, y: zY, width: zW, height: zH }, true);
                     };
                     autoAdjustZoom();
                } else { if (d3Available) updateAxesFromCamera(); }
                
                if (!resizeObserver) { 
                    resizeObserver = new ResizeObserver((entries) => {
                         // resize logic
                    }); 
                    resizeObserver.observe(container); 
                }

                let syncGroup = (existingEntry && existingEntry.syncGroup) ? existingEntry.syncGroup : null;
                if (!syncGroup && globalRegistry.currentSyncGroupSet && globalRegistry.currentSyncGroupSet.has(plotId)) {
                    syncGroup = globalRegistry.currentSyncGroupSet;
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
                    legendBg: xData.legendBg,
                    legendText: xData.legendText
                });
                
                if (xData.init_selected_indices && xData.init_selected_indices.length > 0) {
                     plot.select(xData.init_selected_indices, { preventEvent: true });
                }

                setTimeout(() => { const e = globalRegistry.get(plotId); if(e) e.isInitializing = false; }, 800);
                updateLegendUI(); 
                recalcAndApplyFilters(globalRegistry.get(plotId));

                const unsubView = plot.subscribe('view', () => { 
                    updateAxesFromCamera(); 
                    const e = globalRegistry.get(plotId);
                    if (e) { e.savedCameraView = cloneCamera(plot.get('cameraView')); }
                    if(!globalRegistry.globalSyncEnabled) return; 
                    if (globalRegistry.get(plotId).isInitializing) return;
                    if (globalRegistry.syncLeader && globalRegistry.syncLeader !== plotId) return;
                    globalRegistry.syncLeader = plotId;
                    if (globalRegistry.leaderTimeout) clearTimeout(globalRegistry.leaderTimeout);
                    if(!globalRegistry.isSyncing) { syncCameraAcrossPlots(plotId); } 
                    globalRegistry.leaderTimeout = setTimeout(() => { globalRegistry.syncLeader = null; }, 50);
                });
                window.__spUnsubscribers[plotId].push(unsubView);
                
                const unsubSelect = plot.subscribe('select', ({ points: sel }) => { 
                    if (!globalRegistry.globalSyncEnabled) return;
                    if (!globalRegistry.isSyncing) { 
                        try {
                            globalRegistry.isSyncing = true;
                            if (window.Shiny && window.Shiny.setInputValue) { window.Shiny.setInputValue(plotId+'_selected', { indices: Array.from(sel), count: sel.length }); } 
                            globalRegistry.forEach((e, pid) => {
                                if (pid !== plotId && e.plot && e.canvas.isConnected) e.plot.select(sel, { preventEvent: true });
                            });
                        } finally { globalRegistry.isSyncing = false; }
                    } 
                });
                window.__spUnsubscribers[plotId].push(unsubSelect);

                const unsubDeselect = plot.subscribe('deselect', () => { 
                    if (!globalRegistry.globalSyncEnabled) return;
                    if(!globalRegistry.isSyncing) { 
                        try {
                            globalRegistry.isSyncing = true;
                            if(window.Shiny) window.Shiny.setInputValue(plotId+'_selected', {indices:[], count:0}); 
                            globalRegistry.forEach((e, pid) => {
                                if (pid !== plotId && e.plot && e.canvas.isConnected) e.plot.deselect({ preventEvent: true });
                            });
                        } finally { globalRegistry.isSyncing = false; }
                    } 
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
                if(xData.enableDownload) createDownloadButton(container);
                prevNumPoints = n;
                updateLegendUI(); 
                recalcAndApplyFilters(globalRegistry.get(plotId));
            },
            
            resize: function(w, h) {
                const newW = w; const newH = h;
                const cW = newW - margin.left - margin.right;
                const cH = newH - margin.top - margin.bottom;
                if (canvas && plot) {
                    canvas.width = cW; canvas.height = cH;
                    canvas.style.width = cW + 'px'; canvas.style.height = cH + 'px';
                    const entry = globalRegistry.get(plotId);
                    if (entry && entry.autoFit) {
                        plot.set({ width: cW, height: cH, aspectRatio: cW / cH });
                        plot.zoomToArea({ x: -1, y: -1, width: 2, height: 2 });
                    } else {
                        plot.set({ width: cW, height: cH, aspectRatio: null });
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
    }
});