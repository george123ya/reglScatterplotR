// ============================================================================
// MULTI-SYNC REGISTRY (Merged: First Code Features + Second Code Sync Logic)
// ============================================================================
if (!window.__myScatterplotRegistry) {
  window.__myScatterplotRegistry = new Map();
  window.__myScatterplotRegistry.globalSyncEnabled = false;
  window.__myScatterplotRegistry.globalSyncPlotIds = [];
  
  window.__myScatterplotRegistry.isSyncing = false;       
  window.__myScatterplotRegistry.syncLeader = null;       
  window.__myScatterplotRegistry.leaderTimeout = null;
  
  window.__myScatterplotRegistry.activeStrainers = {}; 
  window.__myScatterplotRegistry.activeCategories = null; 
  
  console.log('[SP-DEBUG] Global registry initialized');
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

function recalcAndApplyFilters(entry) {
    if (!entry || !entry.plot || !entry.filterData) return;

    const n = entry.n_points;
    const strainers = globalRegistry.activeStrainers;
    const categories = globalRegistry.activeCategories; 
    const strainerKeys = Object.keys(strainers);
    
    if (strainerKeys.length === 0 && categories === null) {
        entry.plot.unfilter();
        if (window.Shiny && (entry.plotId === 'p1' || entry.plotId === globalRegistry.globalSyncPlotIds[0])) {
            window.Shiny.setInputValue("filtered_count", n);
        }
        return;
    }

    const indices = [];
    const filterBuffers = entry.filterData; 
    const catBuffer = entry.categoryData || entry.zData;

    for (let i = 0; i < n; i++) {
        let pass = true;
        for (let k = 0; k < strainerKeys.length; k++) {
            const varName = strainerKeys[k];
            const range = strainers[varName];
            if (filterBuffers[varName]) {
                const val = filterBuffers[varName][i];
                if (val < range[0] || val > range[1]) {
                    pass = false;
                    break;
                }
            }
        }
        if (!pass) continue; 

        if (categories !== null && catBuffer) {
            const cat = Math.floor(catBuffer[i]);
            if (!categories.has(cat)) {
                pass = false;
            }
        }

        if (pass) indices.push(i);
    }
    
    entry.plot.filter(indices);
    
    if (window.Shiny && (entry.plotId === 'p1' || entry.plotId === globalRegistry.globalSyncPlotIds[0])) {
         window.Shiny.setInputValue("filtered_count", indices.length);
    }
}

function syncCameraAcrossPlots(sourcePlotId) {
  if (!globalRegistry.globalSyncEnabled) return;
  const sourceEntry = globalRegistry.get(sourcePlotId);
  if (sourceEntry && sourceEntry.plot && !sourceEntry.plot._destroyed) {
      const sourceCamera = cloneCamera(sourceEntry.plot.get('cameraView'));
      
      // Use the global list to ensure we hit everyone
      globalRegistry.forEach((entry, targetId) => {
        if (targetId !== sourcePlotId && entry.plot && !entry.plot._destroyed && entry.canvas.isConnected) {
            // [FIX] Check initialization flag to prevent race conditions
            if (!entry.isInitializing) {
                try {
                  entry.plot.set({ cameraView: sourceCamera }, { preventEvent: true });
                  if (entry.updateAxesFromCamera && !entry.axisThrottle) {
                      entry.axisThrottle = requestAnimationFrame(() => {
                          entry.updateAxesFromCamera();
                          entry.axisThrottle = null;
                      });
                  }
                } catch (e) {}
            }
        }
      });
  }
}

if (typeof Shiny !== 'undefined') {

  // [NEW] Fast Point Size Update Handler
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

      if (msg.z) {
          entry.zData = decodeBase64(msg.z);
      }
      
      if (msg.group_data) {
          entry.categoryData = decodeBase64(msg.group_data);
      }

      if (msg.legend) {
          const isSolid = (msg.legend.var_type === 'none' || !msg.legend.var_type);
          
          entry.legend = msg.legend;
          
          if (isSolid) {
              entry.options.pointColor = '#0072B2';
              entry.options.colorBy = null;
              entry.plot.set({ pointColor: '#0072B2', colorBy: null });
              if (entry.createLegend) {
                  entry.createLegend(entry.canvas.parentElement, { var_type: null });
              }
          } else {
              entry.options.pointColor = msg.legend.colors;
              entry.options.colorBy = 'valueA';
              entry.plot.set({ pointColor: msg.legend.colors, colorBy: 'valueA' });
              if (entry.createLegend) {
                  entry.createLegend(entry.canvas.parentElement, msg.legend);
              }
          }
          if (entry.updateLegendUI) entry.updateLegendUI();
      }

      const n = entry.n_points;
      if (entry.xData && entry.yData && entry.zData) {
         const points = new Array(n);
         for(let i=0; i<n; i++) {
             points[i] = [entry.xData[i], entry.yData[i], entry.zData[i]];
         }
         entry.plot.draw(points);
      }
      recalcAndApplyFilters(entry);
  });

  Shiny.addCustomMessageHandler('update_plot_strainers', function(msg) {
      const entry = globalRegistry.get(msg.plotId);
      if (!entry) return;
      if (!entry.filterData) entry.filterData = {};
      entry.filterData[msg.col] = decodeBase64(msg.data);
      recalcAndApplyFilters(entry);
  });
  
  Shiny.addCustomMessageHandler('my_scatterplot_sync', function(msg) {
    globalRegistry.globalSyncEnabled = msg.enabled;
    
    if (msg.enabled) {
        const activeIds = Array.from(globalRegistry.keys()).filter(id => {
            const e = globalRegistry.get(id);
            return e && e.plot && !e.plot._destroyed && e.canvas.isConnected;
        });
        globalRegistry.globalSyncPlotIds = activeIds;
        const syncGroup = new Set(activeIds);
        activeIds.forEach(pid => {
            const entry = globalRegistry.get(pid);
            if (entry) entry.syncGroup = syncGroup;
        });
    } else {
        // Clear groups if disabled
        globalRegistry.forEach(entry => entry.syncGroup = null);
        globalRegistry.globalSyncPlotIds = [];
    }
  });

  Shiny.addCustomMessageHandler('update_filter_range', function(msg) {
      if (msg.range === null) {
          delete globalRegistry.activeStrainers[msg.variable];
      } else {
          globalRegistry.activeStrainers[msg.variable] = msg.range;
      }
      globalRegistry.forEach(entry => {
          if (entry.plot && !entry.plot._destroyed) {
              recalcAndApplyFilters(entry);
          }
      });
  });

  Shiny.addCustomMessageHandler('select_plot_points', function(msg) {
    if (!msg || !msg.indices) return;
    const indices = Array.isArray(msg.indices) ? msg.indices : [msg.indices];
    globalRegistry.forEach((entry) => {
      if (entry.plot && entry.canvas.isConnected) {
          entry.plot.select(indices, { preventEvent: true });
      }
    });
  });
  
  Shiny.addCustomMessageHandler('clear_plot_selection', function(msg) {
    globalRegistry.forEach((entry) => {
      if (entry.plot && entry.canvas.isConnected) {
          entry.plot.deselect({ preventEvent: true });
      }
    });
  });
}

HTMLWidgets.widget({
    name: 'my_scatterplot',
    type: 'output',
    factory: function(el, width, height) {
        const container = el;
        container.style.position = 'relative';
        container.style.overflow = 'hidden'; 
        container.style.backgroundColor = 'white';

        const injectStyles = () => {
            const styleId = 'my-scatterplot-styles';
            if (document.getElementById(styleId)) return;
            const style = document.createElement('style');
            style.id = styleId;
            style.innerHTML = `
                .sp-download-btn { position: absolute; top: 10px; left: 10px; z-index: 100; background: white; border: 1px solid #ccc; border-radius: 4px; padding: 6px 12px; cursor: pointer; font-family: sans-serif; font-size: 13px; color: #333; box-shadow: 0 2px 4px rgba(0,0,0,0.1); user-select: none; transition: background 0.2s; }
                .sp-download-btn:hover { background: #f8f9fa; }
                .sp-menu { display: none; position: absolute; top: 100%; left: 0; margin-top: 5px; background: white; border: 1px solid #ddd; border-radius: 4px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); min-width: 140px; z-index: 101; }
                .sp-menu-item { padding: 8px 12px; cursor: pointer; font-size: 13px; font-family: sans-serif; color: #333; }
                .sp-menu-item:hover { background: #f0f7ff; color: #000; }
                .sp-legend { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
                .sp-legend-item { transition: opacity 0.2s; user-select: none; }
                .sp-legend-item:hover { background-color: #f5f5f5; border-radius: 4px; }
                .sp-color-swatch { width: 14px; height: 14px; border-radius: 3px; margin-right: 8px; flex-shrink: 0; cursor: pointer; border: 1px solid rgba(0,0,0,0.2); box-shadow: 0 1px 2px rgba(0,0,0,0.1); }
                .sp-color-swatch:hover { border-color: #000; }
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

        let plot, renderer, svg, xAxisG, yAxisG, xAxis, yAxis, xScale, yScale;
        let xDomainOrig, yDomainOrig, tooltip;
        let d3Available = false;
        let dataBuffers = { x: null, y: null, z: null };
        
        let prevNumPoints = 0;
        let legendDiv = null;
        let isInitialRender = true;
        let resizeObserver = null;
        let activeCategories = null; 
        let lastClickedCategoryIndex = -1;
        let totalCategories = 0;
        let filterBuffers = {}; 

        const VECTOR_POINT_LIMIT = 200000;

        const updateAxes = function() {
            if (!d3Available || !xScale || !yScale || !svg || !xAxis || !yAxis) return;
            if (!xAxisG || !yAxisG) return;
            xAxis.scale(xScale); yAxis.scale(yScale);
            xAxisG.call(xAxis); yAxisG.call(yAxis);
            svg.selectAll('.domain').attr('stroke', '#333');
            svg.selectAll('.tick line').attr('stroke', '#ccc');
            svg.selectAll('.tick text').attr('fill', '#333').style('font-size', '11px');
        };

        const updateLegendUI = function() {
            if (!legendDiv) return;
            const items = legendDiv.querySelectorAll('.sp-legend-item');
            const cats = globalRegistry.activeCategories;
            items.forEach((item, idx) => {
                if (cats === null || cats.has(idx)) {
                    item.style.opacity = '1';
                } else {
                    item.style.opacity = '0.3';
                }
            });
        };

        const createLegend = async function(container, legendData) {
            if (!legendDiv) {
                legendDiv = document.createElement('div');
                legendDiv.className = 'sp-legend';
                legendDiv.style.cssText = `position: absolute; top: 10px; right: 10px; background: rgba(255, 255, 255, 0.85); padding: 12px; border-radius: 6px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); max-height: 80%; overflow-y: auto; font-size: 12px; z-index: 10; border: 1px solid #eee;`;
                container.appendChild(legendDiv);
            } else {
                legendDiv.innerHTML = '';
            }

            if (!legendData || !legendData.var_type || legendData.var_type === 'none') {
                legendDiv.style.display = 'none';
                return; 
            }
            legendDiv.style.display = 'block';

            if (legendData.title) {
                const t = document.createElement('div');
                t.innerText = legendData.title; t.style.cssText = `margin-bottom: 8px; font-weight: 600; font-size: 13px; text-align: center; color: #222;`;
                legendDiv.appendChild(t);
            }

            if (legendData.var_type === 'categorical') {
                totalCategories = legendData.names.length;
                let Pickr = window.Pickr;
                if (!Pickr) {
                    const mod = await import('https://esm.sh/@simonwep/pickr');
                    Pickr = mod.default;
                    window.Pickr = Pickr;
                }

                legendData.names.forEach((name, i) => {
                    const row = document.createElement('div');
                    row.className = 'sp-legend-item';
                    row.style.cssText = 'display: flex; align-items: center; margin-bottom: 4px; padding: 2px 4px; position: relative; cursor: pointer;';
                    
                    if (globalRegistry.activeCategories !== null && !globalRegistry.activeCategories.has(i)) {
                        row.style.opacity = '0.3';
                    }
                    
                    const swatch = document.createElement('div');
                    swatch.className = 'sp-color-swatch';
                    swatch.style.backgroundColor = legendData.colors[i];
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
                        
                        if(window.Shiny && window.Shiny.setInputValue && plotId) {
                            window.Shiny.setInputValue(plotId + '_legend_colors', legendData.colors);
                        }
                        
                        pickrInst.hide();
                    });

                    swatch.addEventListener('click', (e) => e.stopPropagation());

                    const label = document.createElement('span');
                    label.style.color = '#444';
                    label.innerText = name;
                    
                    row.onclick = (e) => {
                          if (e.target.closest('.pcr-app')) return;
                          
                          if (e.shiftKey && lastClickedCategoryIndex !== -1) {
                            const start = Math.min(lastClickedCategoryIndex, i); 
                            const end = Math.max(lastClickedCategoryIndex, i);
                            if (globalRegistry.activeCategories === null) globalRegistry.activeCategories = new Set();
                            for(let k=start; k<=end; k++) globalRegistry.activeCategories.add(k);
                        } else if (e.ctrlKey || e.metaKey) {
                            if (globalRegistry.activeCategories === null) { 
                                globalRegistry.activeCategories = new Set(); 
                                for(let k=0; k<totalCategories; k++) globalRegistry.activeCategories.add(k); 
                                globalRegistry.activeCategories.delete(i); 
                            } else { 
                                if (globalRegistry.activeCategories.has(i)) globalRegistry.activeCategories.delete(i); 
                                else globalRegistry.activeCategories.add(i); 
                            }
                        } else {
                            if (globalRegistry.activeCategories !== null && globalRegistry.activeCategories.size === 1 && globalRegistry.activeCategories.has(i)) {
                                globalRegistry.activeCategories = null; // Toggle off to show all
                            } else {
                                globalRegistry.activeCategories = new Set([i]); 
                            }
                        }

                        if (window.Shiny && window.Shiny.setInputValue) {
                            const activeList = globalRegistry.activeCategories === null ? null : Array.from(globalRegistry.activeCategories);
                            window.Shiny.setInputValue("visible_groups", activeList);
                        }
                        lastClickedCategoryIndex = i;
                        globalRegistry.forEach(entry => { if(entry.updateLegendUI) entry.updateLegendUI(); recalcAndApplyFilters(entry); });
                    };
                    row.appendChild(label); legendDiv.appendChild(row);
                });
            } else if (legendData.var_type === 'continuous') {
                 const gradContainer = document.createElement('div');
                 gradContainer.style.cssText = 'display: flex; align-items: flex-start; margin-top: 5px;';
                 const grad = document.createElement('div');
                 grad.style.cssText = `width: 12px; height: 120px; background: linear-gradient(to top, ${legendData.colors.join(',')}); border-radius: 2px; margin-right: 8px;`;
                 const lbls = document.createElement('div');
                 lbls.style.cssText = 'display: flex; flex-direction: column; justify-content: space-between; height: 120px; color: #444; font-size: 11px;';
                 lbls.innerHTML = `<span>${legendData.maxVal.toFixed(2)}</span><span>${legendData.midVal.toFixed(2)}</span><span>${legendData.minVal.toFixed(2)}</span>`;
                 gradContainer.appendChild(grad); gradContainer.appendChild(lbls);
                 legendDiv.appendChild(gradContainer);
            }
        };

        const createDownloadButton = function(container) {
            if (container.querySelector('.dl-btn-container')) return;
            const wrapper = document.createElement('div');
            wrapper.className = 'dl-btn-container';
            wrapper.style.cssText = `position: absolute; top: 10px; left: 10px; z-index: 100;`;
            const btn = document.createElement('div');
            btn.className = 'sp-download-btn';
            btn.innerHTML = '⬇ Download';
            const menu = document.createElement('div');
            menu.className = 'sp-menu';
            ['PNG', 'SVG', 'PDF'].forEach(format => {
                const item = document.createElement('div');
                item.className = 'sp-menu-item';
                item.innerText = `Download as ${format}`;
                item.onclick = (e) => { e.stopPropagation(); downloadPlot(format.toLowerCase()); menu.style.display = 'none'; };
                menu.appendChild(item);
            });
            btn.onclick = (e) => { e.stopPropagation(); menu.style.display = menu.style.display === 'block' ? 'none' : 'block'; };
            document.addEventListener('click', () => { menu.style.display = 'none'; });
            wrapper.appendChild(btn); wrapper.appendChild(menu); container.appendChild(wrapper);
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
                    if (globalRegistry.activeCategories !== null && !globalRegistry.activeCategories.has(i)) {
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
                 const shouldFilter = isCategorical && (globalRegistry.activeCategories !== null);

                 let pointsStr = `<g clip-path="url(#${cpId})">`;
                 for (let i = 0; i < nPoints; i++) {
                    let passStrainer = true;
                    if (globalRegistry.activeStrainers) {
                        const strainers = globalRegistry.activeStrainers;
                        const keys = Object.keys(strainers);
                        if (keys.length > 0) {
                            const fBuffs = filterBuffers;
                            for (let k = 0; k < keys.length; k++) {
                                const vName = keys[k];
                                if (fBuffs[vName]) {
                                    const val = fBuffs[vName][i];
                                    if (val < strainers[vName][0] || val > strainers[vName][1]) { passStrainer = false; break; }
                                }
                            }
                        }
                    }
                    if (!passStrainer) continue;

                    if (shouldFilter && rZ) {
                         const cat = Math.floor(rZ[i]);
                         if (!globalRegistry.activeCategories.has(cat)) continue;
                    }

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
                loader.style.display = 'block'; 
                if (xData.gene_names && Array.isArray(xData.gene_names)) console.log(`Names: ${xData.gene_names.length}`);
                else xData.gene_names = [];

                plotId = el.id || xData.plotId || ('plot_' + Math.random().toString(36).substr(2, 9));

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
                if (xData.group_data) {
                    catData = decodeBase64(xData.group_data);
                }
                
                if (dataBuffers.x && dataBuffers.z && dataBuffers.z.length > dataBuffers.x.length) {
                    dataBuffers.z = dataBuffers.z.subarray(0, dataBuffers.x.length);
                }

                if (plot && window.__lastPerfMode !== xData.performanceMode) { 
                    plot.destroy(); plot = null; 
                }
                window.__lastPerfMode = xData.performanceMode;

                if (window.__spUnsubscribers[plotId]) {
                    window.__spUnsubscribers[plotId].forEach(unsub => {
                        if (typeof unsub === 'function') unsub();
                    });
                }
                window.__spUnsubscribers[plotId] = [];

                if (typeof d3 === 'undefined') { window.d3 = await import('https://esm.sh/d3@7'); d3Available = true; } else d3Available = true;

                if (xData.backgroundColor) canvas.style.backgroundColor = xData.backgroundColor; else canvas.style.backgroundColor = 'white';

                xDomainOrig = [xData.x_min, xData.x_max]; yDomainOrig = [xData.y_min, xData.y_max];

                if (d3Available && xData.showAxes) {
                    if (svg) svg.remove();
                    svg = d3.select(container).append('svg').attr('width', width).attr('height', height).style('position', 'absolute').style('top', 0).style('left', 0).style('pointer-events', 'none');
                    xAxisG = svg.append('g').attr('class', 'x-axis').attr('transform', `translate(0, ${height - margin.bottom})`);
                    yAxisG = svg.append('g').attr('class', 'y-axis').attr('transform', `translate(${margin.left}, 0)`);
                    svg.append('text').attr('class','x-label').attr('x', margin.left+(width-margin.left-margin.right)/2).attr('y',height-10).text(xData.xlab||'X').attr('text-anchor','middle').style('font-family','sans-serif').style('font-size','12px');
                    svg.append('text').attr('class','y-label').attr('transform','rotate(-90)').attr('x', -(margin.top+(height-margin.top-margin.bottom)/2)).attr('y',15).text(xData.ylab||'Y').attr('text-anchor','middle').style('font-family','sans-serif').style('font-size','12px');
                    xScale = d3.scaleLinear().domain(xDomainOrig).range([margin.left, width - margin.right]);
                    yScale = d3.scaleLinear().domain(yDomainOrig).range([height - margin.bottom, margin.top]);
                    xAxis = d3.axisBottom(xScale).ticks(6); yAxis = d3.axisLeft(yScale).ticks(6);
                    xAxisG.call(xAxis); yAxisG.call(yAxis);
                } else if (svg) { svg.remove(); svg=null; }

                if (xData.showTooltip && !tooltip) {
                    tooltip = document.createElement('div'); tooltip.style.cssText = `position:absolute;background:rgba(0,0,0,0.85);color:white;padding:6px 10px;border-radius:4px;font-size:12px;pointer-events:none;display:none;z-index:1000;font-family:sans-serif;`;
                    container.appendChild(tooltip);
                }

                const cW = width - margin.left - margin.right; 
                const cH = height - margin.top - margin.bottom;
                canvas.width = cW; canvas.height = cH; 
                canvas.style.width = cW+'px'; canvas.style.height = cH+'px'; 
                canvas.style.top = margin.top+'px'; canvas.style.left = margin.left+'px';

                if (!renderer) { const mod = await import('https://esm.sh/regl-scatterplot@1.14.1'); renderer = mod.createRenderer(); }

                const intXScale = d3.scaleLinear().domain([-1,1]).range([0,cW]);
                const intYScale = d3.scaleLinear().domain([-1,1]).range([cH,0]);

                if (!plot) {
                    const createScatterplot = (await import('https://esm.sh/regl-scatterplot@1.14.1')).default;
                    plot = createScatterplot({ renderer, canvas, width: cW, height: cH, xScale: intXScale, yScale: intYScale, pointSize: xData.options.size, performanceMode: xData.performanceMode });
                }

                const newConf = { pointSize: xData.options.size, pointColor: xData.options.pointColor, opacity: xData.options.opacity };
                newConf.colorBy = xData.options.colorBy ? xData.options.colorBy : null;
                plot.set(newConf);

                const points = new Array(n);
                if (dataBuffers.z) { for(let i=0; i<n; i++) points[i] = [dataBuffers.x[i], dataBuffers.y[i], dataBuffers.z[i]]; } 
                else { for(let i=0; i<n; i++) points[i] = [dataBuffers.x[i], dataBuffers.y[i]]; }
                
                await plot.draw(points);
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

                // [CRITICAL FIX] Aggressive Sync Logic from Second Code
                const applyMasterView = function() {
                    const masterEntry = globalRegistry.get('p1');
                    if (masterEntry && masterEntry.plot && plotId !== 'p1') {
                        try {
                            const masterCam = cloneCamera(masterEntry.plot.get('cameraView'));
                            if (masterCam) {
                                plot.set({ cameraView: masterCam }, { preventEvent: true });
                                if (d3Available) updateAxesFromCamera();
                                return true;
                            }
                        } catch(e) { console.error("Sync failed:", e); }
                    }
                    return false;
                };

                const autoAdjustZoom = function() {
                    // Try to sync with P1 first to prevent deformation
                    if (globalRegistry.globalSyncEnabled) {
                        const synced = applyMasterView();
                        if (synced) return; 
                    }

                    // Fallback to aspect ratio calc
                    const rect = container.getBoundingClientRect();
                    const currW = rect.width - margin.left - margin.right;
                    const currH = rect.height - margin.top - margin.bottom;
                    if (currW <= 0 || currH <= 0) return;
                    const xr = xDomainOrig[1] - xDomainOrig[0]; 
                    const yr = yDomainOrig[1] - yDomainOrig[0];
                    const sAsp = xr / yr; 
                    const cAsp = currW / currH;
                    let zX, zY, zW, zH;
                    if (sAsp > cAsp) { zW = 2; zH = 2 * (sAsp / cAsp); zX = -1; zY = -zH / 2; } 
                    else { zH = 2; zW = 2 * (cAsp / sAsp); zX = -zW / 2; zY = -1; }
                    
                    if (plot) { 
                        plot.zoomToArea({ x: zX, y: zY, width: zW, height: zH }, true);
                        requestAnimationFrame(updateAxesFromCamera); 
                    }
                };
                
                let lastWidth = el.offsetWidth;
                let lastHeight = el.offsetHeight;

                if (!resizeObserver) {
                    resizeObserver = new ResizeObserver((entries) => {
                        const width = el.offsetWidth;
                        const height = el.offsetHeight;
                        if (width === lastWidth && height === lastHeight) return;
                        lastWidth = width;
                        lastHeight = height;

                        if (window.requestIdleCallback) {
                            window.requestIdleCallback(() => {
                                if (el.offsetWidth > 0 && el.offsetHeight > 0) {
                                     // Attempt master sync on resize
                                     if(globalRegistry.globalSyncEnabled) applyMasterView();
                                     else autoAdjustZoom();
                                }
                            });
                        } else {
                            setTimeout(() => {
                                if (el.offsetWidth > 0 && el.offsetHeight > 0) {
                                     if(globalRegistry.globalSyncEnabled) applyMasterView();
                                     else autoAdjustZoom();
                                }
                            }, 100);
                        }
                    });
                    resizeObserver.observe(container);
                }

                if (isInitialRender) { autoAdjustZoom(); }

                const entry = globalRegistry.get(plotId) || {};
                let syncGroup = entry.syncGroup;
                if (!syncGroup && globalRegistry.globalSyncEnabled && globalRegistry.globalSyncPlotIds.length>0) {
                    const first = globalRegistry.get(globalRegistry.globalSyncPlotIds[0]);
                    if(first && first.syncGroup) syncGroup = first.syncGroup;
                }

                globalRegistry.set(plotId, { 
                    plotId, 
                    plot, 
                    canvas, 
                    updateAxesFromCamera, 
                    syncGroup,
                    
                    xData: dataBuffers.x,
                    yData: dataBuffers.y,
                    zData: dataBuffers.z,
                    filterData: filterBuffers, 
                    categoryData: catData, 
                    
                    options: xData.options,
                    legend: xData.legend,
                    
                    n_points: n,
                    
                    updateLegendUI: updateLegendUI,
                    createLegend: createLegend,
                    isInitializing: true // [FIX] Added flag
                });

                // Clear initialization flag to allow broadcasting
                setTimeout(() => { 
                    const e = globalRegistry.get(plotId);
                    if(e) e.isInitializing = false; 
                }, 800);

                if (globalRegistry.globalSyncEnabled) {
                    if (!Array.isArray(globalRegistry.globalSyncPlotIds)) globalRegistry.globalSyncPlotIds = [];
                    if (!globalRegistry.globalSyncPlotIds.includes(plotId)) globalRegistry.globalSyncPlotIds.push(plotId);
                    const group = new Set(globalRegistry.globalSyncPlotIds);
                    globalRegistry.globalSyncPlotIds.forEach(pid => { const e = globalRegistry.get(pid); if (e) e.syncGroup = group; });
                }
                
                updateLegendUI(); 
                recalcAndApplyFilters(globalRegistry.get(plotId));

                const unsubView = plot.subscribe('view', () => { 
                    updateAxesFromCamera(); 
                    if(!globalRegistry.globalSyncEnabled) return; 
                    
                    // [FIX] Do not broadcast if initializing
                    if (globalRegistry.get(plotId).isInitializing) return;

                    if (globalRegistry.syncLeader && globalRegistry.syncLeader !== plotId) return;
                    globalRegistry.syncLeader = plotId;
                    if (globalRegistry.leaderTimeout) clearTimeout(globalRegistry.leaderTimeout);
                    if(!globalRegistry.isSyncing) { 
                        syncCameraAcrossPlots(plotId); 
                    } 
                    globalRegistry.leaderTimeout = setTimeout(() => { globalRegistry.syncLeader = null; }, 50);
                });
                window.__spUnsubscribers[plotId].push(unsubView);
                
                const unsubSelect = plot.subscribe('select', ({ points: sel }) => { 
                    if (!globalRegistry.globalSyncEnabled) return;
                    if (!globalRegistry.isSyncing) { 
                        try {
                            globalRegistry.isSyncing = true;
                            if (window.Shiny && window.Shiny.setInputValue) { window.Shiny.setInputValue(plotId+'_selected', { indices: Array.from(sel), count: sel.length }); } 
                            
                            // [FIX] Use global registry logic to ensure we hit everyone
                            globalRegistry.forEach((e, pid) => {
                                if (pid !== plotId && e.plot && e.canvas.isConnected) {
                                    e.plot.select(sel, { preventEvent: true });
                                }
                            });
                        } finally {
                            globalRegistry.isSyncing = false; 
                        }
                    } 
                });
                window.__spUnsubscribers[plotId].push(unsubSelect);

                const unsubDeselect = plot.subscribe('deselect', () => { 
                    if (!globalRegistry.globalSyncEnabled) return;
                    if(!globalRegistry.isSyncing) { 
                        try {
                            globalRegistry.isSyncing = true;
                            if(window.Shiny) window.Shiny.setInputValue(plotId+'_selected', {indices:[], count:0}); 
                             // [FIX] Use global registry logic
                            globalRegistry.forEach((e, pid) => {
                                if (pid !== plotId && e.plot && e.canvas.isConnected) {
                                    e.plot.deselect({ preventEvent: true });
                                }
                            });
                        } finally {
                            globalRegistry.isSyncing = false;
                        }
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

                await createLegend(container, xData.legend);
                if(xData.enableDownload) createDownloadButton(container);
                prevNumPoints = n;
                
                updateLegendUI(); 
                recalcAndApplyFilters(globalRegistry.get(plotId));
            },
            
            resize: function(w, h) {
                // 1. Force container to match new Shiny dimensions
                container.style.width = w + 'px'; 
                container.style.height = h + 'px';
                
                // 2. Get the ACTUAL calculated pixel size
                const rect = container.getBoundingClientRect();
                const newW = rect.width;
                const newH = rect.height;

                // 3. Update Canvas
                if (canvas && plot) {
                    canvas.width = newW;
                    canvas.height = newH;
                    canvas.style.width = newW + 'px';
                    canvas.style.height = newH + 'px';
                    
                    plot.set({ 
                        width: newW, 
                        height: newH
                    });
                    
                    const registryEntry = globalRegistry.get(plotId);
                    
                    // 4. Update D3 Ranges (Pixels)
                    if (svg && registryEntry && registryEntry.options) { 
                        svg.attr('width', newW).attr('height', newH);
                        
                        // Update the pixel ranges of the D3 scales
                        if (xScale) xScale.range([margin.left, newW - margin.right]); 
                        if (yScale) yScale.range([newH - margin.bottom, margin.top]);
                        
                        // Reposition Axis Groups
                        if (xAxisG) xAxisG.attr('transform', `translate(0, ${newH - margin.bottom})`);
                        
                        // Reposition Labels
                        if (svg.select('.x-label')) {
                            svg.select('.x-label')
                                .attr('x', margin.left + (newW - margin.left - margin.right)/2)
                                .attr('y', newH - 10);
                        }
                        if (svg.select('.y-label')) {
                            svg.select('.y-label')
                                .attr('x', -(margin.top + (newH - margin.top - margin.bottom)/2))
                                .attr('y', 15);
                        }
                    }

                    // 5. Update Axes based on current camera
                    if (registryEntry && registryEntry.updateAxesFromCamera) {
                        registryEntry.updateAxesFromCamera();
                    }
                    
                    // 6. Force redraw
                    plot.draw();
                }
            }
        };
    }
});