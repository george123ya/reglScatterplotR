// ============================================================================
// MULTI-SYNC REGISTRY (Global - shared across all plot instances)
// ============================================================================
if (!window.__myScatterplotRegistry) {
  window.__myScatterplotRegistry = new Map();
  console.log('✓ Global registry initialized');
}

let globalSyncEnabled = false;
let globalSyncPlotIds = [];
let isSyncing = false;
const globalRegistry = window.__myScatterplotRegistry;

// ============================================================================
// SYNC FUNCTIONS
// ============================================================================

function syncCameraAcrossPlots(sourcePlotId) {
  const sourceEntry = globalRegistry.get(sourcePlotId);
  if (!sourceEntry || !sourceEntry.plot) return;

  isSyncing = true;
  const sourceCamera = sourceEntry.plot.get('cameraView');
  const syncGroup = sourceEntry.syncGroup || new Set(globalRegistry.keys());

  syncGroup.forEach(plotId => {
    if (plotId !== sourcePlotId) {
      const entry = globalRegistry.get(plotId);
      if (entry && entry.plot && !entry.plot._destroyed) {
        try {
          entry.plot.set({ cameraView: sourceCamera }, { preventEvent: true });
          if (entry.updateAxesFromCamera) {
            entry.updateAxesFromCamera();
          }
        } catch (e) {}
      }
    }
  });

  isSyncing = false;
}

if (typeof Shiny !== 'undefined') {
  // Highlight table rows
  Shiny.addCustomMessageHandler('highlight_table_rows', function(msg) {
    console.log('Highlighting table rows:', msg.rows);
    
    // First, remove all existing highlights
    document.querySelectorAll('tr.dt-highlighted').forEach(row => {
      row.classList.remove('dt-highlighted');
    });
    
    // Then add highlight to specified rows
    if (msg.rows && msg.rows.length > 0) {
      const table = document.querySelector('table.dataTable tbody');
      if (table) {
        msg.rows.forEach(rowNum => {
          const row = table.rows[rowNum - 1]; // rowNum is 1-indexed
          if (row) {
            row.classList.add('dt-highlighted');
            console.log('Highlighted row', rowNum);
          }
        });
      }
    }
  });
  
  // Clear table highlights
  Shiny.addCustomMessageHandler('clear_table_highlight', function(msg) {
    console.log('Clearing table highlights');
    document.querySelectorAll('tr.dt-highlighted').forEach(row => {
      row.classList.remove('dt-highlighted');
    });
  });
}

// Handler to highlight plot points when table rows are selected
Shiny.addCustomMessageHandler('highlight_plot_points', function(msg) {
    if (!msg.indices || !Array.isArray(msg.indices)) return;
    
    console.log('📋 → 📊 Table selection sent to plot:', msg.indices);
    
    // Find all registered plots and apply selection to the first one
    globalRegistry.forEach((entry, plotId) => {
        if (entry.plot && !entry.plot._destroyed) {
            try {
                entry.plot.select(new Set(msg.indices), { preventEvent: true });
                console.log(`✓ Applied selection to plot ${plotId}`);
            } catch (e) {
                console.warn(`Failed to select on plot ${plotId}:`, e);
            }
        }
    });
});

// Handler to scroll table to row (optional enhancement)
Shiny.addCustomMessageHandler('scroll_to_row', function(msg) {
    var table = $('#' + msg.tableId).DataTable();
    if (table) {
        var page = Math.floor(msg.rowIndex / table.page.len());
        table.page(page).draw(false);
        console.log(`📍 Scrolled table to row ${msg.rowIndex}`);
    }
});

// Handler to update selected count
Shiny.addCustomMessageHandler('update_count', function(msg) {
    document.getElementById('selected_count').textContent = msg.count;
});

if (typeof Shiny !== 'undefined') {
  Shiny.addCustomMessageHandler('select_plot_points', function(msg) {
    console.log('📋 select_plot_points received:', msg);
    
    if (!msg || msg.indices === undefined || msg.indices === null) {
      console.error('❌ No indices');
      return;
    }
    
    let indices = msg.indices;
    
    // Handle empty array
    if (Array.isArray(indices) && indices.length === 0) {
      console.log('Empty selection');
      return;
    }
    
    // ✅ FIX: Ensure it's an array, NOT a Set
    if (!Array.isArray(indices)) {
      console.log('Converting to array:', indices);
      indices = [indices];
    }
    
    console.log('✅ Selecting indices (as array):', indices);
    
    // Apply to all plots
    globalRegistry.forEach((entry, plotId) => {
      if (entry?.plot && !entry.plot._destroyed) {
        try {
          // ✅ FIX: Pass array directly, not Set
          entry.plot.select(indices, { preventEvent: true });
          console.log(`✓ Selected on ${plotId}:`, indices);
        } catch (e) {
          console.error(`❌ Error on ${plotId}:`, e.message);
        }
      }
    });
  });
  
  Shiny.addCustomMessageHandler('clear_plot_selection', function(msg) {
    console.log('🗑️  Clearing selection');
    globalRegistry.forEach((entry, plotId) => {
      if (entry?.plot && !entry.plot._destroyed) {
        try {
          entry.plot.deselect({ preventEvent: true });
          console.log(`✓ Deselected on ${plotId}`);
        } catch (e) {
          console.error(`❌ Error:`, e.message);
        }
      }
    });
  });
}

// 🔗 Shiny handler to enable/disable sync
Shiny.addCustomMessageHandler('my_scatterplot_sync', function(msg) {
    console.log('🔗 Sync message received, enabled:', msg.enabled);

    if (msg.enabled) {
        globalSyncEnabled = true;
        const checkAndSync = () => {
            const plotIds = (msg.plotIds && Array.isArray(msg.plotIds) && msg.plotIds.length > 0) 
                ? msg.plotIds 
                : Array.from(globalRegistry.keys());
            
            console.log('📡 Syncing plots:', plotIds);
            
            if (plotIds.length === 0) {
                setTimeout(checkAndSync, 100);
                return;
            }

            globalSyncPlotIds = plotIds;
            const syncGroup = new Set(plotIds);
            
            plotIds.forEach(pid => {
                const entry = globalRegistry.get(pid);
                if (entry) {
                    entry.syncGroup = syncGroup;
                }
            });

            if (plotIds.length > 0) {
                const mainEntry = globalRegistry.get(plotIds[0]);
                if (mainEntry && mainEntry.plot) {
                    const mainCamera = mainEntry.plot.get('cameraView');
                    
                    plotIds.slice(1).forEach(pid => {
                        const entry = globalRegistry.get(pid);
                        if (entry && entry.plot) {
                            entry.plot.set({ cameraView: mainCamera }, { preventEvent: true });
                            if (entry.updateAxesFromCamera) {
                                entry.updateAxesFromCamera();
                            }
                        }
                    });
                }
            }
        };

        checkAndSync();
    } else {
        globalSyncEnabled = false;
        globalSyncPlotIds = [];
        globalRegistry.forEach((entry) => {
            entry.syncGroup = null;
        });
    }
});

// ============================================================================
// MAIN WIDGET
// ============================================================================
HTMLWidgets.widget({
    name: 'my_scatterplot',
    type: 'output',
    factory: function(el, width, height) {
        const container = el;
        container.style.position = 'relative';
        container.style.overflow = 'hidden';

        let margin = { top: 20, right: 20, bottom: 50, left: 60 };
        let plotId = null;
        const VECTOR_POINT_LIMIT = 50000;

        let canvas = document.createElement('canvas');
        canvas.style.position = 'absolute';
        canvas.style.top = '0';
        canvas.style.left = '0';
        canvas.width = width;
        canvas.height = height;
        container.appendChild(canvas);

        let plot;
        let renderer;
        let xAxisG, yAxisG, xAxis, yAxis;
        let xScale, yScale;
        let xDomainOrig, yDomainOrig;
        let svg;
        let tooltip;
        let d3Available = false;
        let currentXData;
        let currentPoints;
        let prevDomains = null;
        let prevNumPoints = 0;
        let legendDiv = null;
        let isInitialRender = true;
        let currentNormDomains = { x: [-1, 1], y: [-1, 1] };

        const createLegend = function(container, legendData) {
            if (!legendDiv) {
                legendDiv = document.createElement('div');
                legendDiv.className = 'scatterplot-legend';
                legendDiv.style.cssText = `
                    position: absolute;
                    top: 10px;
                    right: 10px;
                    background: rgba(255, 255, 255, 0.8);
                    padding: 10px;
                    border-radius: 5px;
                    box-shadow: 0 2px 5px rgba(0,0,0,0.2);
                    max-height: 80%;
                    overflow-y: auto;
                    font-family: sans-serif;
                    font-size: 12px;
                    z-index: 10;
                `;
                container.appendChild(legendDiv);
            } else {
                legendDiv.innerHTML = '';
            }

            if (legendData.title) {
                const legendTitle = document.createElement('div');
                legendTitle.innerText = legendData.title;
                legendTitle.style.cssText = `
                    margin-bottom: 10px;
                    font-weight: bold;
                    font-size: 14px;
                    text-align: center;
                `;
                legendDiv.appendChild(legendTitle);
            }

            if (legendData.var_type === 'categorical') {
                legendData.names.forEach((name, i) => {
                    const item = document.createElement('div');
                    item.style.marginBottom = '5px';
                    item.innerHTML = `
                        <span style="display: inline-block; width: 12px; height: 12px; border-radius: 50%; background-color: ${legendData.colors[i]}; vertical-align: middle;"></span>
                        <span style="margin-left: 5px; vertical-align: middle;">${name}</span>
                    `;
                    legendDiv.appendChild(item);
                });
            } else if (legendData.var_type === 'continuous') {
                const gradientContainer = document.createElement('div');
                gradientContainer.style.display = 'flex';
                gradientContainer.style.alignItems = 'center';
                
                const gradient = document.createElement('div');
                gradient.style.cssText = `
                    width: 15px;
                    height: 100px;
                    background: linear-gradient(to top, ${legendData.colors.join(', ')});
                `;
                gradientContainer.appendChild(gradient);
                
                const labels = document.createElement('div');
                labels.style.marginLeft = '10px';
                labels.innerHTML = `
                    <div>Max: ${legendData.maxVal.toFixed(2)}</div>
                    <div>Avg: ${legendData.midVal.toFixed(2)}</div>
                    <div>Min: ${legendData.minVal.toFixed(2)}</div>
                `;
                gradientContainer.appendChild(labels);
                
                legendDiv.appendChild(gradientContainer);
            }
        };

        const createDownloadButton = function(container) {
            const btnContainer = document.createElement('div');
            btnContainer.style.cssText = `
                position: absolute;
                top: 10px;
                left: 10px;
                z-index: 100;
            `;
            btnContainer.className = 'download-btn-container';
            
            const downloadBtn = document.createElement('button');
            downloadBtn.innerHTML = '⬇ Download';
            downloadBtn.style.cssText = `
                background: white;
                border: 1px solid #ccc;
                padding: 8px 12px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 12px;
                font-family: sans-serif;
            `;
            
            const menu = document.createElement('div');
            menu.style.cssText = `
                display: none;
                position: absolute;
                top: 100%;
                left: 0;
                margin-top: 4px;
                background: white;
                border: 1px solid #ccc;
                border-radius: 4px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.15);
                min-width: 120px;
            `;
            
            const formats = ['PNG', 'SVG', 'PDF'];
            formats.forEach(format => {
                const option = document.createElement('div');
                option.innerText = format;
                option.style.cssText = `
                    padding: 8px 12px;
                    cursor: pointer;
                    font-size: 12px;
                    font-family: sans-serif;
                `;
                option.onmouseover = () => option.style.background = '#f0f0f0';
                option.onmouseout = () => option.style.background = 'white';
                option.onclick = () => {
                    downloadPlot(format.toLowerCase());
                    menu.style.display = 'none';
                };
                menu.appendChild(option);
            });
            
            downloadBtn.onclick = () => {
                menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
            };
            
            document.addEventListener('click', (e) => {
                if (!btnContainer.contains(e.target)) {
                    menu.style.display = 'none';
                }
            });
            
            btnContainer.appendChild(downloadBtn);
            btnContainer.appendChild(menu);
            container.appendChild(btnContainer);
        };

        const downloadPlot = async function(format) {
            if (!plot) return;
            
            try {
                const tempContainer = document.createElement('div');
                tempContainer.style.cssText = `
                    position: absolute;
                    top: -10000px;
                    left: -10000px;
                    width: ${width}px;
                    height: ${height}px;
                `;
                document.body.appendChild(tempContainer);
                
                const containerRect = container.getBoundingClientRect();

                if (format === 'png') {
                    await downloadAsPNG(containerRect);
                } else if (format === 'svg') {
                    await downloadAsSVG(tempContainer);
                } else if (format === 'pdf') {
                    await downloadAsPDF(containerRect);
                }
                
                document.body.removeChild(tempContainer);
            } catch (error) {
                console.error('Download failed:', error);
                alert('Download failed: ' + error.message);
            }
        };

        const downloadAsPNG = async function(containerRect) {
            const exportCanvas = document.createElement('canvas');
            exportCanvas.width = width;
            exportCanvas.height = height;
            const ctx = exportCanvas.getContext('2d');
            
            ctx.fillStyle = currentXData.backgroundColor || 'white';
            ctx.fillRect(0, 0, width, height);
            
            ctx.drawImage(canvas, margin.left, margin.top, canvas.width, canvas.height);
            
            if (svg && currentXData.showAxes) {
                await drawSVGtoCanvas(ctx, svg.node());
            }
            
            if (legendDiv) {
                const originalBg = legendDiv.style.backgroundColor;
                const originalShadow = legendDiv.style.boxShadow;
                legendDiv.style.backgroundColor = 'white';
                legendDiv.style.boxShadow = 'none';
                
                await drawLegendToCanvas(ctx, legendDiv, containerRect);
                
                legendDiv.style.backgroundColor = originalBg;
                legendDiv.style.boxShadow = originalShadow;
            }
            
            exportCanvas.toBlob((blob) => {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'scatterplot.png';
                a.click();
                URL.revokeObjectURL(url);
            });
        };

        const renderElementToCanvas = async function(element) {
            if (typeof window.html2canvas === 'undefined') {
                const script = document.createElement('script');
                script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
                await new Promise((resolve, reject) => {
                    script.onload = resolve;
                    script.onerror = reject;
                    document.head.appendChild(script);
                });
            }

            const canvas = await html2canvas(element, {
                backgroundColor: 'white',
                useCORS: true,
                allowTaint: true,
            });
            return canvas;
        };

        const drawLegendToCanvas = async function(ctx, legendElement, containerRect) {
            if (legendElement.style.display === 'none' || !legendElement.offsetWidth || !legendElement.offsetHeight) {
                return;
            }

            const legendCanvas = await renderElementToCanvas(legendElement);
            const rect = legendElement.getBoundingClientRect();
            const x = rect.left - containerRect.left;
            const y = rect.top - containerRect.top;
            
            ctx.drawImage(legendCanvas, x, y, rect.width, rect.height);
        };

        const createVectorPointsSVG = function(xData, currentPoints, xDomainOrig, yDomainOrig, xScale, yScale, margin, width, height, currentRadius) {
            const svgNS = 'http://www.w3.org/2000/svg';
            const g = document.createElementNS(svgNS, 'g');
            
            const defaultColor = xData.options.pointColor || 'gray';
            const opacity = xData.options.opacity || 0.8;
            const pointRadius = currentRadius;

            let colorScale = null;
            if (xData.legend && xData.legend.var_type === 'continuous') {
                colorScale = d3.scaleSequential(
                    d3.piecewise(d3.interpolateRgb, xData.legend.colors)
                ).domain([0, 1]);
            }

            const currentXDomain = xScale.domain();
            const currentYDomain = yScale.domain();

            currentPoints.forEach(p => {
                const origX = xDomainOrig[0] + (p[0] + 1) / 2 * (xDomainOrig[1] - xDomainOrig[0]);
                const origY = yDomainOrig[0] + (p[1] + 1) / 2 * (yDomainOrig[1] - yDomainOrig[0]);
                
                if (origX >= currentXDomain[0] && origX <= currentXDomain[1] &&
                    origY >= currentYDomain[0] && origY <= currentYDomain[1]) {
                    
                    const cx = xScale(origX);
                    const cy = yScale(origY);
                    
                    const circle = document.createElementNS(svgNS, 'circle');
                    circle.setAttribute('cx', cx);
                    circle.setAttribute('cy', cy);
                    circle.setAttribute('r', pointRadius);

                    let pointColor = defaultColor;
                    
                    if (p.length > 2 && xData.legend) {
                        if (xData.legend.var_type === 'categorical') {
                            const colorIndex = Math.floor(p[2]);
                            if (xData.legend.colors[colorIndex]) {
                                pointColor = xData.legend.colors[colorIndex];
                            }
                        } else if (xData.legend.var_type === 'continuous') {
                            pointColor = colorScale(p[2]);
                        }
                    }
                    
                    circle.setAttribute('fill', pointColor);
                    circle.setAttribute('fill-opacity', opacity);
                    g.appendChild(circle);
                }
            });
            
            return g;
        };

        const getPlotScales = function(xDom, yDom) {
            if (typeof d3 === 'undefined') {
                return null;
            }
            
            const plotXScale = d3.scaleLinear()
                .domain(xDom)
                .range([margin.left, width - margin.right]);
                
            const plotYScale = d3.scaleLinear()
                .domain(yDom)
                .range([height - margin.bottom, margin.top]);
                
            return { plotXScale, plotYScale };
        };

        const downloadAsSVG = async function(tempContainer) {
            const svgNS = 'http://www.w3.org/2000/svg';
            const exportSVG = document.createElementNS(svgNS, 'svg');
            exportSVG.setAttribute('width', width);
            exportSVG.setAttribute('height', height);
            exportSVG.setAttribute('xmlns', svgNS);
            
            const numPoints = currentPoints ? currentPoints.length : 0;
            const useVector = numPoints <= VECTOR_POINT_LIMIT;
            const SVG_VISUAL_CORRECTION = 1.20;

            let currentPointSize;

            if (plot) {
                const cameraDistanceArray = plot.get('camera').distance;
                const cameraDistance = (cameraDistanceArray[0] + cameraDistanceArray[1]) / 2;
                const baseSize = plot.get('pointSize');
                const scaleMode = plot.get('pointScaleMode');
                
                const zoom = 1 / cameraDistance;
                
                if (scaleMode === 'constant') {
                    currentPointSize = baseSize;
                } else if (scaleMode === 'linear') {
                    currentPointSize = baseSize * zoom;
                } else if (scaleMode === 'asinh') {
                    currentPointSize = baseSize * (Math.asinh(zoom / 5) + 1);
                } else {
                    currentPointSize = baseSize;
                }
            } else {
                currentPointSize = currentXData.options.size || 3;
            }

            const currentRadius = (currentPointSize / 2) * SVG_VISUAL_CORRECTION;

            const bgRect = document.createElementNS(svgNS, 'rect');
            bgRect.setAttribute('width', width);
            bgRect.setAttribute('height', height);
            bgRect.setAttribute('fill', currentXData.backgroundColor || 'white');
            exportSVG.appendChild(bgRect);
            
            if (useVector && d3Available) {
                let vectorPlotG;
                let currentDomainX, currentDomainY, exportXScale, exportYScale;
                
                if (xScale && yScale && xDomainOrig && yDomainOrig) {
                    currentDomainX = xScale.domain();
                    currentDomainY = yScale.domain();
                    ({ plotXScale: exportXScale, plotYScale: exportYScale } = getPlotScales(currentDomainX, currentDomainY));
                } else {
                    if (currentNormDomains && currentNormDomains.x && currentNormDomains.y) {
                        currentDomainX = [
                            xDomainOrig[0] + (currentNormDomains.x[0] + 1) / 2 * (xDomainOrig[1] - xDomainOrig[0]),
                            xDomainOrig[0] + (currentNormDomains.x[1] + 1) / 2 * (xDomainOrig[1] - xDomainOrig[0])
                        ];
                        currentDomainY = [
                            yDomainOrig[0] + (currentNormDomains.y[0] + 1) / 2 * (yDomainOrig[1] - yDomainOrig[0]),
                            yDomainOrig[0] + (currentNormDomains.y[1] + 1) / 2 * (yDomainOrig[1] - yDomainOrig[0])
                        ];
                    } else {
                        currentDomainX = xDomainOrig || [-1, 1];
                        currentDomainY = yDomainOrig || [-1, 1];
                    }
                    ({ plotXScale: exportXScale, plotYScale: exportYScale } = getPlotScales(currentDomainX, currentDomainY));
                }

                if (exportXScale && exportYScale) {
                    vectorPlotG = createVectorPointsSVG(
                        currentXData, 
                        currentPoints, 
                        xDomainOrig || [-1, 1],
                        yDomainOrig || [-1, 1],
                        exportXScale,
                        exportYScale,
                        margin,
                        width,
                        height,
                        currentRadius
                    );
                
                    const defs = document.createElementNS(svgNS, 'defs');
                    const clipPath = document.createElementNS(svgNS, 'clipPath');
                    clipPath.setAttribute('id', 'plotClip');
                    const clipRect = document.createElementNS(svgNS, 'rect');
                    clipRect.setAttribute('x', margin.left);
                    clipRect.setAttribute('y', margin.top);
                    clipRect.setAttribute('width', width - margin.left - margin.right);
                    clipRect.setAttribute('height', height - margin.top - margin.bottom);
                    clipPath.appendChild(clipRect);
                    defs.appendChild(clipPath);
                    exportSVG.appendChild(defs);
                    
                    vectorPlotG.setAttribute('clip-path', 'url(#plotClip)');
                    exportSVG.appendChild(vectorPlotG);
                } else {
                    const canvasDataURL = canvas.toDataURL('image/png');
                    const image = document.createElementNS(svgNS, 'image');
                    image.setAttribute('x', margin.left);
                    image.setAttribute('y', margin.top);
                    image.setAttribute('width', width - margin.left - margin.right);
                    image.setAttribute('height', height - margin.top - margin.bottom);
                    image.setAttribute('href', canvasDataURL);
                    exportSVG.appendChild(image);
                }
            } else {
                const canvasDataURL = canvas.toDataURL('image/png');
                const image = document.createElementNS(svgNS, 'image');
                image.setAttribute('x', margin.left);
                image.setAttribute('y', margin.top);
                image.setAttribute('width', width - margin.left - margin.right);
                image.setAttribute('height', height - margin.top - margin.bottom);
                image.setAttribute('href', canvasDataURL);
                exportSVG.appendChild(image);
            }

            if (svg && currentXData.showAxes) {
                const axesClone = svg.node().cloneNode(true);
                Array.from(axesClone.children).forEach(child => {
                    exportSVG.appendChild(child.cloneNode(true));
                });
            }
            
            if (legendDiv && currentXData.legend) {
                const legendRes = createLegendSVG(currentXData.legend);
                if (legendRes.defs) {
                    exportSVG.appendChild(legendRes.defs);
                }
                exportSVG.appendChild(legendRes.g);
            }
            
            const serializer = new XMLSerializer();
            const svgString = serializer.serializeToString(exportSVG);
            const blob = new Blob([svgString], { type: 'image/svg+xml' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'scatterplot.svg';
            a.click();
            URL.revokeObjectURL(url);
        };

        const downloadAsPDF = async function(containerRect) {
            if (typeof window.jspdf === 'undefined') {
                const script = document.createElement('script');
                script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
                await new Promise((resolve, reject) => {
                    script.onload = resolve;
                    script.onerror = reject;
                    document.head.appendChild(script);
                });
            }
            
            const { jsPDF } = window.jspdf;
            
            const exportCanvas = document.createElement('canvas');
            exportCanvas.width = width;
            exportCanvas.height = height;
            const ctx = exportCanvas.getContext('2d');
            
            ctx.fillStyle = currentXData.backgroundColor || 'white';
            ctx.fillRect(0, 0, width, height);
            ctx.drawImage(canvas, margin.left, margin.top, canvas.width, canvas.height);
            
            if (svg && currentXData.showAxes) {
                await drawSVGtoCanvas(ctx, svg.node());
            }
            
            if (legendDiv) {
                const originalBg = legendDiv.style.backgroundColor;
                const originalShadow = legendDiv.style.boxShadow;
                legendDiv.style.backgroundColor = 'white';
                legendDiv.style.boxShadow = 'none';
                
                await drawLegendToCanvas(ctx, legendDiv, containerRect);
                
                legendDiv.style.backgroundColor = originalBg;
                legendDiv.style.boxShadow = originalShadow;
            }
            
            const imgData = exportCanvas.toDataURL('image/png');
            const pdf = new jsPDF({
                orientation: width > height ? 'landscape' : 'portrait',
                unit: 'px',
                format: [width, height]
            });
            
            pdf.addImage(imgData, 'PNG', 0, 0, width, height);
            pdf.save('scatterplot.pdf');
        };

        const drawSVGtoCanvas = async function(ctx, svgElement) {
            const serializer = new XMLSerializer();
            let svgString = serializer.serializeToString(svgElement);
            
            if (!svgString.includes('xmlns')) {
                svgString = svgString.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
            }
            
            const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            
            return new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => {
                    ctx.drawImage(img, 0, 0);
                    URL.revokeObjectURL(url);
                    resolve();
                };
                img.onerror = reject;
                img.src = url;
            });
        };

        const createLegendSVG = function(legendData) {
            const svgNS = 'http://www.w3.org/2000/svg';
            const g = document.createElementNS(svgNS, 'g');
            g.setAttribute('transform', `translate(${width - 160}, 10)`);
            
            let defs = null;

            const bg = document.createElementNS(svgNS, 'rect');
            bg.setAttribute('width', 150);
            bg.setAttribute('height', legendData.var_type === 'categorical' ? 
                (legendData.names.length * 20 + 30) : 150);
            bg.setAttribute('fill', 'rgba(255,255,255,0.8)');
            bg.setAttribute('rx', 5);
            g.appendChild(bg);
            
            if (legendData.title) {
                const title = document.createElementNS(svgNS, 'text');
                title.setAttribute('x', 75);
                title.setAttribute('y', 20);
                title.setAttribute('text-anchor', 'middle');
                title.setAttribute('font-weight', 'bold');
                title.setAttribute('font-size', '14');
                title.textContent = legendData.title;
                g.appendChild(title);
            }
            
            if (legendData.var_type === 'categorical') {
                let yOffset = 40;
                legendData.names.forEach((name, i) => {
                    const circle = document.createElementNS(svgNS, 'circle');
                    circle.setAttribute('cx', 15);
                    circle.setAttribute('cy', yOffset - 4);
                    circle.setAttribute('r', 6);
                    circle.setAttribute('fill', legendData.colors[i]);
                    g.appendChild(circle);

                    const text = document.createElementNS(svgNS, 'text');
                    text.setAttribute('x', 30);
                    text.setAttribute('y', yOffset);
                    text.setAttribute('font-size', '12');
                    text.textContent = name;
                    g.appendChild(text);

                    yOffset += 20;
                });
            } else if (legendData.var_type === 'continuous') {
                defs = document.createElementNS(svgNS, 'defs');
                const linearGradient = document.createElementNS(svgNS, 'linearGradient');
                linearGradient.setAttribute('id', 'continuousGradient');
                linearGradient.setAttribute('x1', '0%');
                linearGradient.setAttribute('y1', '100%');
                linearGradient.setAttribute('x2', '0%');
                linearGradient.setAttribute('y2', '0%');
                
                const numStops = legendData.colors.length;
                legendData.colors.forEach((color, i) => {
                    const stop = document.createElementNS(svgNS, 'stop');
                    stop.setAttribute('offset', `${(i / (numStops - 1)) * 100}%`);
                    stop.setAttribute('stop-color', color);
                    linearGradient.appendChild(stop);
                });
                defs.appendChild(linearGradient);
                
                const gradContainer = document.createElementNS(svgNS, 'g');
                gradContainer.setAttribute('transform', 'translate(10, 40)');
                
                const gradRect = document.createElementNS(svgNS, 'rect');
                gradRect.setAttribute('x', 0);
                gradRect.setAttribute('y', 0);
                gradRect.setAttribute('width', 15);
                gradRect.setAttribute('height', 100);
                gradRect.setAttribute('fill', 'url(#continuousGradient)');
                gradContainer.appendChild(gradRect);

                const maxLabel = document.createElementNS(svgNS, 'text');
                maxLabel.setAttribute('x', 30);
                maxLabel.setAttribute('y', 10);
                maxLabel.setAttribute('font-size', '12');
                maxLabel.textContent = `Max: ${legendData.maxVal.toFixed(2)}`;
                gradContainer.appendChild(maxLabel);
                
                const midLabel = document.createElementNS(svgNS, 'text');
                midLabel.setAttribute('x', 30);
                midLabel.setAttribute('y', 55);
                midLabel.setAttribute('font-size', '12');
                midLabel.textContent = `Avg: ${legendData.midVal.toFixed(2)}`;
                gradContainer.appendChild(midLabel);
                
                const minLabel = document.createElementNS(svgNS, 'text');
                minLabel.setAttribute('x', 30);
                minLabel.setAttribute('y', 100);
                minLabel.setAttribute('font-size', '12');
                minLabel.textContent = `Min: ${legendData.minVal.toFixed(2)}`;
                gradContainer.appendChild(minLabel);

                g.appendChild(gradContainer);
            }

            return { defs, g };
        };

        const autoAdjustZoom = function(xDomain, yDomain) {
            if (!xDomain[0] || !xDomain[1] || !yDomain[0] || !yDomain[1]) {
                return;
            }
            
            // ✅ Calculate aspect ratio of SPECIFIED ranges (not data extent)
            const specifiedRangeX = xDomain[1] - xDomain[0];
            const specifiedRangeY = yDomain[1] - yDomain[0];
            const specifiedAspect = specifiedRangeX / specifiedRangeY;
            
            // ✅ Calculate canvas aspect ratio
            const canvasWidth = width - margin.left - margin.right;
            const canvasHeight = height - margin.top - margin.bottom;
            const canvasAspect = canvasWidth / canvasHeight;
            
            // ✅ Zoom to show FULL normalized range [-1, 1] in both dimensions
            // But adjust for aspect ratio to avoid blank space
            let zoomX, zoomY, zoomWidth, zoomHeight;
            
            if (specifiedAspect > canvasAspect) {
                // Specified range is wider - fit width, extend height
                zoomWidth = 2;  // Show full [-1, 1] in x
                zoomHeight = 2 * (specifiedAspect / canvasAspect);
                zoomX = -1;
                zoomY = -zoomHeight / 2;
            } else {
                // Specified range is taller - fit height, extend width
                zoomHeight = 2;  // Show full [-1, 1] in y
                zoomWidth = 2 * (canvasAspect / specifiedAspect);
                zoomX = -zoomWidth / 2;
                zoomY = -1;
            }
            
            console.log('Auto-zoom to FULL specified range:', { 
                x: zoomX, 
                y: zoomY, 
                width: zoomWidth, 
                height: zoomHeight,
                specifiedAspect,
                canvasAspect
            });
            
            plot.zoomToArea({ 
                x: zoomX, 
                y: zoomY, 
                width: zoomWidth, 
                height: zoomHeight 
            }, true);
            
            // ✅ Force axis update
            requestAnimationFrame(() => {
                updateAxesFromCamera();
            });
        };

        const updateAxes = function() {
            if (!d3Available || !xScale || !yScale || !svg || !svg.node() || !xAxis || !yAxis || !xAxisG || !yAxisG) return;

            xAxis.scale(xScale);
            yAxis.scale(yScale);

            xAxisG.call(xAxis);
            yAxisG.call(yAxis);

            svg.selectAll('.domain').attr('stroke', 'black').attr('stroke-width', 1.5);
            svg.selectAll('.tick line').attr('stroke', 'black');
            svg.selectAll('.tick text').attr('fill', 'black').style('font-size', '11px');
        };

        const updateLabels = function(xlab, ylab) {
            if (!svg) return;
            svg.select('.x-label').text(xlab || 'X');
            svg.select('.y-label').text(ylab || 'Y');
        };

        return {
            renderValue: async function(xData) {
                // GENE NAMES
                if (xData.gene_names && Array.isArray(xData.gene_names)) {
                    console.log(`Gene names loaded: ${xData.gene_names.length} names`);
                } else {
                    xData.gene_names = [];
                }

                plotId = el.id || xData.plotId || ('plot_' + Math.random().toString(36).substr(2, 9));
                console.log('Plot ID:', plotId);
                console.log('Container ID:', el.id);

                currentXData = xData;

                // NEW: Use dataVersion if provided (from R)
                const dataVersion = xData.dataVersion || xData.points.length + '_' + Date.now();
                
                // OLD: Your old key (keep for backward compat)
                const oldKey = `${plotId}_${xData.points.length}_${xData.x_min}_${xData.x_max}_${xData.y_min}_${xData.y_max}`;
                
                // NEW: Stronger key with dataVersion
                const dataKey = `${plotId}_v${dataVersion}`;

                if (window.__lastDataKeys === undefined) window.__lastDataKeys = {};
                const lastKey = window.__lastDataKeys[plotId];

                // FORCE REDRAW if dataVersion changed
                if (lastKey === dataKey && plot && currentPoints && currentPoints.length > 0) {
                    console.log(`Skipping re-render for ${plotId} (dataVersion unchanged)`);
                    return;
                }

                console.log(`FULL REDRAW: New dataVersion ${dataVersion}`);
                window.__lastDataKeys[plotId] = dataKey;

                // DESTROY OLD PLOT IF EXISTS
                if (plot) {
                    console.log(`Destroying old plot ${plotId}`);
                    plot.destroy();
                    plot = null;
                }

                if (typeof d3 === 'undefined') {
                    try {
                        const d3Module = await import('https://esm.sh/d3@7');
                        window.d3 = d3Module;
                        d3Available = true;
                    } catch (error) {
                        console.error('Failed to load D3:', error);
                        return;
                    }
                } else {
                    d3Available = true;
                }

                if (xData.backgroundColor) {
                    canvas.style.backgroundColor = xData.backgroundColor;
                } else {
                    canvas.style.backgroundColor = 'white';
                }

                let hasAxes = xData.showAxes;
                let newMargin = hasAxes ? { top: 20, right: 20, bottom: 50, left: 60 } : { top: 0, right: 0, bottom: 0, left: 0 };
                margin = newMargin;

                let svgNeedsRecreate = false;
                if (hasAxes && !svg) {
                    svgNeedsRecreate = true;
                } else if (!hasAxes && svg) {
                    svg.remove();
                    svg = null;
                }

                xDomainOrig = [xData.x_min, xData.x_max];
                yDomainOrig = [xData.y_min, xData.y_max];

                if (d3Available && hasAxes && svgNeedsRecreate) {
                    if (svg) svg.remove();
                    svg = d3.select(container).append('svg')
                        .attr('width', width)
                        .attr('height', height)
                        .style('position', 'absolute')
                        .style('top', 0)
                        .style('left', 0)
                        .style('pointer-events', 'none');

                    xAxisG = svg.append('g').attr('class', 'x-axis').attr('transform', `translate(0, ${height - margin.bottom})`);
                    svg.append('text')
                        .attr('class', 'x-label')
                        .attr('x', margin.left + (width - margin.left - margin.right) / 2)
                        .attr('y', height - 10)
                        .attr('text-anchor', 'middle')
                        .attr('fill', 'black')
                        .style('font-size', '12px')
                        .text(xData.xlab || 'X');

                    yAxisG = svg.append('g').attr('class', 'y-axis').attr('transform', `translate(${margin.left}, 0)`);
                    svg.append('text')
                        .attr('class', 'y-label')
                        .attr('transform', 'rotate(-90)')
                        .attr('x', -(margin.top + (height - margin.top - margin.bottom) / 2))
                        .attr('y', 15)
                        .attr('text-anchor', 'middle')
                        .attr('fill', 'black')
                        .style('font-size', '12px')
                        .text(xData.ylab || 'Y');

                    // ✅ RESTORE: Initialize with original domains
                    xScale = d3.scaleLinear().domain(xDomainOrig).range([margin.left, width - margin.right]);
                    yScale = d3.scaleLinear().domain(yDomainOrig).range([height - margin.bottom, margin.top]);
                    
                    xAxis = d3.axisBottom(xScale).ticks(6);
                    yAxis = d3.axisLeft(yScale).ticks(6);
                    
                    xAxisG.call(xAxis);
                    yAxisG.call(yAxis);
                    svg.selectAll('.domain').attr('stroke', 'black').attr('stroke-width', 1.5);
                }

                if (xData.showTooltip) {
                    if (!tooltip) {
                        tooltip = document.createElement('div');
                        tooltip.id = 'scatterplotTooltip';
                        tooltip.style.cssText = `position:absolute;background-color:rgba(0,0,0,0.8);color:white;padding:5px 10px;border-radius:4px;font-size:12px;pointer-events:none;z-index:1000;display:none;`;
                        container.appendChild(tooltip);
                    }
                } else if (tooltip) {
                    tooltip.remove();
                    tooltip = null;
                }

                const canvasWidth = width - margin.left - margin.right;
                const canvasHeight = height - margin.top - margin.bottom;
                if (canvasWidth <= 0 || canvasHeight <= 0) return;
                canvas.width = canvasWidth;
                canvas.height = canvasHeight;
                canvas.style.width = canvasWidth + 'px';
                canvas.style.height = canvasHeight + 'px';
                canvas.style.top = margin.top + 'px';
                canvas.style.left = margin.left + 'px';

                if (!renderer) {
                    const module = await import('https://esm.sh/regl-scatterplot@1.14.1');
                    const { default: createScatterplot, createRenderer } = module;
                    renderer = createRenderer();
                }

                const internalXScale = d3.scaleLinear().domain([-1, 1]).range([0, canvasWidth]);
                const internalYScale = d3.scaleLinear().domain([-1, 1]).range([canvasHeight, 0]);

                const isSpatialUpdate = plot && xData.points.length === prevNumPoints;

                if (isSpatialUpdate) {
                    const spatialIndex = plot.get('spatialIndex');
                    const numPoints = xData.points.length;
                    currentPoints = [];
                    for (let i = 0; i < numPoints; i++) {
                        const point = [xData.points[i][0], xData.points[i][1]];
                        if (xData.points[i].length > 2) {
                            point.push(xData.points[i][2]);
                        }
                        currentPoints.push(point);
                    }

                    const config = {
                        pointSize: xData.options.size,
                        pointColor: xData.options.pointColor,
                        opacity: xData.options.opacity || 0.8
                    };
                    
                    if (xData.options.colorBy) {
                        config.colorBy = xData.options.colorBy;
                    }

                    plot.set(config);
                    await plot.draw(currentPoints, { spatialIndex });
                } else {
                    if (plot) {
                        plot.destroy?.();
                        plot = null;
                    }

                    plot = (await import('https://esm.sh/regl-scatterplot@1.14.1')).default({
                        renderer,
                        canvas,
                        width: canvasWidth,
                        height: canvasHeight,
                        xScale: internalXScale,
                        yScale: internalYScale,
                        pointSize: xData.options.size || 3,
                        opacity: xData.options.opacity || 0.8,
                    });

                    const numPoints = xData.points.length || 0;
                    currentPoints = [];
                    for (let i = 0; i < numPoints; i++) {
                        const point = [xData.points[i][0], xData.points[i][1]];
                        if (xData.points[i].length > 2) {
                            point.push(xData.points[i][2]);
                        }
                        currentPoints.push(point);
                    }

                    const config = {
                        pointSize: xData.options.size,
                        pointColor: xData.options.pointColor,
                        opacity: xData.options.opacity || 0.8
                    };
                    
                    if (xData.options.colorBy) {
                        config.colorBy = xData.options.colorBy;
                    }

                    plot.set(config);
                    await plot.draw(currentPoints);

                    // 🔗 Apply synced camera BEFORE initial auto-zoom
                    if (globalSyncEnabled && globalSyncPlotIds.length > 0 && globalSyncPlotIds.includes(plotId)) {
                        // This plot is part of a sync group
                        const firstPid = globalSyncPlotIds[0];
                        const firstEntry = globalRegistry.get(firstPid);
                        if (firstEntry && firstEntry.plot && plotId !== firstPid) {
                            // Add to sync group BEFORE setting camera
                            if (firstEntry.syncGroup) {
                                firstEntry.syncGroup.add(plotId);
                            }
                            
                            const mainCamera = firstEntry.plot.get('cameraView');
                            if (mainCamera) {
                                plot.set({ cameraView: mainCamera }, { preventEvent: true });
                                isInitialRender = false; // Skip auto-zoom for synced plots
                                console.log(`✓ Applied synced camera to ${plotId}`);
                            }
                        } else if (plotId === firstPid && isInitialRender) {
                            // First plot in sync group - do auto-zoom
                            autoAdjustZoom(xDomainOrig, yDomainOrig);
                            isInitialRender = false;
                            console.log(`✓ Auto-zoomed first synced plot ${plotId}`);
                        }
                    } else if (isInitialRender) {
                        autoAdjustZoom(xDomainOrig, yDomainOrig);
                        isInitialRender = false;
                        console.log(`✓ Auto-zoomed independent plot ${plotId}`);
                        
                        // ✅ ADD THIS: Update axes after zoom completes
                        requestAnimationFrame(() => {
                            updateAxesFromCamera();
                        });
                    }
                }

                prevDomains = { x_min: xData.x_min, x_max: xData.x_max, y_min: xData.y_min, y_max: xData.y_max };
                prevNumPoints = xData.points.length;

                // Create axis update function - ALWAYS available for sync
                const updateAxesFromCamera = function() {
                    if (!hasAxes || !plot || !xScale || !yScale) return;
                    
                    const event = { xScale: plot.get('xScale'), yScale: plot.get('yScale') };
                    
                    // ✅ Get the VISIBLE normalized range from the camera
                    const visibleNormX = event.xScale.domain(); // e.g., [-0.5, 0.3]
                    const visibleNormY = event.yScale.domain(); // e.g., [-0.2, 0.8]
                    
                    // ✅ Map the VISIBLE normalized range to the ORIGINAL data range
                    // Formula: origValue = origMin + (normValue + 1) / 2 * (origMax - origMin)
                    const newXDomain = [
                        xDomainOrig[0] + (visibleNormX[0] + 1) / 2 * (xDomainOrig[1] - xDomainOrig[0]),
                        xDomainOrig[0] + (visibleNormX[1] + 1) / 2 * (xDomainOrig[1] - xDomainOrig[0])
                    ];
                    const newYDomain = [
                        yDomainOrig[0] + (visibleNormY[0] + 1) / 2 * (yDomainOrig[1] - yDomainOrig[0]),
                        yDomainOrig[0] + (visibleNormY[1] + 1) / 2 * (yDomainOrig[1] - yDomainOrig[0])
                    ];

                    // ✅ Update D3 scales to show ONLY the visible portion
                    xScale.domain(newXDomain);
                    yScale.domain(newYDomain);
                    
                    // Update axes
                    xAxis.scale(xScale);
                    yAxis.scale(yScale);
                    xAxisG.call(xAxis);
                    yAxisG.call(yAxis);
                };

                if (plot) {
                    // ALWAYS subscribe to view - not just when syncing!
                    plot.subscribe('view', (event) => {
                        if (!isSyncing) {
                            // Apply constraints first
                            // constrainCamera();
                            
                            // Update local axes
                            updateAxesFromCamera();
                            
                            // Then sync if in a sync group
                            const entry = globalRegistry.get(plotId);
                            if (entry && entry.syncGroup && entry.syncGroup.size > 0) {
                                syncCameraAcrossPlots(plotId);
                            }
                        }
                    });

                    plot.subscribe('select', ({ points: selectedIndices }) => {
                        if (!isSyncing) {
                            console.log('✓ Selection event fired, plotId:', plotId);
                            console.log('✓ Selected indices:', Array.from(selectedIndices));
                            
                            // 📤 Send selected indices back to Shiny using the OUTPUT ID
                            if (window.Shiny && window.Shiny.setInputValue) {
                                const inputName = plotId + '_selected';
                                console.log('📤 Setting input:', inputName);
                                
                                window.Shiny.setInputValue(inputName, {
                                    indices: Array.from(selectedIndices),
                                    count: selectedIndices.length,
                                    timestamp: Date.now()
                                });
                                
                                console.log(`✓ Plot ${plotId}: ${selectedIndices.length} points selected, sent to Shiny`);
                            } else {
                                console.warn('⚠️ Shiny not available or setInputValue not found');
                            }
                            
                            // Sync across plots
                            const entry = globalRegistry.get(plotId);
                            if (entry && entry.syncGroup && entry.syncGroup.size > 0) {
                                isSyncing = true;
                                entry.syncGroup.forEach(pid => {
                                    if (pid !== plotId) {
                                        const e = globalRegistry.get(pid);
                                        if (e && e.plot) {
                                            e.plot.select(selectedIndices, { preventEvent: true });
                                        }
                                    }
                                });
                                isSyncing = false;
                            }
                        }
                    });

                    // ALSO add this for deselect:
                    plot.subscribe('deselect', () => {
                        if (!isSyncing) {
                            console.log('✓ Deselect event fired, plotId:', plotId);
                            
                            if (window.Shiny && window.Shiny.setInputValue) {
                                const inputName = plotId + '_selected';
                                window.Shiny.setInputValue(inputName, {
                                    indices: [],
                                    count: 0,
                                    timestamp: Date.now()
                                });
                                
                                console.log(`✓ Plot ${plotId}: deselected, sent to Shiny`);
                            }
                            
                            // Sync deselection
                            const entry = globalRegistry.get(plotId);
                            if (entry && entry.syncGroup && entry.syncGroup.size > 0) {
                                isSyncing = true;
                                entry.syncGroup.forEach(pid => {
                                    if (pid !== plotId) {
                                        const e = globalRegistry.get(pid);
                                        if (e && e.plot) {
                                            e.plot.deselect({ preventEvent: true });
                                        }
                                    }
                                });
                                isSyncing = false;
                            }
                        }
                    });

                    
                    if (xData.showTooltip && tooltip) {
                        plot.subscribe('pointOver', (pointIndex) => {
                            const normPoint = plot.get('points')[pointIndex];
                            const [nx, ny] = normPoint.slice(0, 2);
                            const origX = xDomainOrig[0] + (nx + 1) / 2 * (xDomainOrig[1] - xDomainOrig[0]);
                            const origY = yDomainOrig[0] + (ny + 1) / 2 * (yDomainOrig[1] - yDomainOrig[0]);
                            const [px, py] = plot.getScreenPosition(pointIndex);
                            
                            let tooltipContent = '';
                            
                            // ✅ SHOW GENE NAME FIRST IF AVAILABLE
                            if (xData.gene_names && xData.gene_names[pointIndex]) {
                                tooltipContent += `<strong style="color: #E74C3C; font-size: 1.1em;">${xData.gene_names[pointIndex]}</strong><br>`;
                            }
                            
                            tooltipContent += `X: ${origX.toFixed(2)}<br>Y: ${origY.toFixed(2)}`;
                            
                            if (normPoint.length > 2 && xData.legend) {
                                const z = normPoint[2];
                                let colorVal;
                                
                                if (xData.legend.var_type === 'categorical') {
                                    const colorIndex = Math.floor(z);
                                    colorVal = xData.legend.names && xData.legend.names[colorIndex] 
                                        ? xData.legend.names[colorIndex] 
                                        : z.toFixed(2);
                                } else if (xData.legend.var_type === 'continuous') {
                                    colorVal = xData.legend.minVal + z * (xData.legend.maxVal - xData.legend.minVal);
                                    colorVal = colorVal.toFixed(2);
                                } else {
                                    colorVal = z.toFixed(2);
                                }
                                
                                tooltipContent += `<br>Value: ${colorVal}`;
                            }
                            
                            tooltip.innerHTML = tooltipContent;
                            tooltip.style.display = 'block';
                            tooltip.style.left = (px + margin.left + 10) + 'px';
                            tooltip.style.top = (py + margin.top + 10) + 'px';
                        });

                        plot.subscribe('pointOut', () => {
                            tooltip.style.display = 'none';
                        });
                    }
                }
                
                if (Object.keys(xData.legend).length > 0) {
                    createLegend(container, xData.legend);
                }
                
                if (xData.enableDownload && !container.querySelector('.download-btn-container')) {
                    createDownloadButton(container);
                }
                
                // Register in global registry
                const entry = globalRegistry.get(plotId) || {};
                
                // Get sync group - inherit from first synced plot if available
                let syncGroup = entry.syncGroup;
                if (!syncGroup && globalSyncEnabled && globalSyncPlotIds.length > 0) {
                    const firstPid = globalSyncPlotIds[0];
                    const firstEntry = globalRegistry.get(firstPid);
                    if (firstEntry && firstEntry.syncGroup) {
                        syncGroup = firstEntry.syncGroup;
                    }
                }
                
                globalRegistry.set(plotId, {
                  plotId,
                  plot,
                  points: currentPoints,
                  width: canvasWidth,
                  height: canvasHeight,
                  syncGroup: syncGroup,
                  updateAxesFromCamera
                });
                
                console.log(`✓ Registered plot ${plotId}`);
            },

            resize: function(newWidth, newHeight) {
                width = newWidth;
                height = newHeight;
                if (plot && currentXData && currentPoints && d3Available) {
                    const canvasWidth = width - margin.left - margin.right;
                    const canvasHeight = height - margin.top - margin.bottom;
                    if (canvasWidth > 0 && canvasHeight > 0) {
                        canvas.width = canvasWidth;
                        canvas.height = canvasHeight;
                        canvas.style.width = canvasWidth + 'px';
                        canvas.style.height = canvasHeight + 'px';
                        canvas.style.top = margin.top + 'px';
                        canvas.style.left = margin.left + 'px';
                        if (svg && currentXData.showAxes) {
                            svg.attr('width', width).attr('height', height);
                            xScale.range([margin.left, width - margin.right]);
                            yScale.range([height - margin.bottom, margin.top]);
                            const internalXScale = d3.scaleLinear().domain([-1, 1]).range([0, canvasWidth]);
                            const internalYScale = d3.scaleLinear().domain([-1, 1]).range([canvasHeight, 0]);
                            plot.set({ 
                                xScale: internalXScale, 
                                yScale: internalYScale, 
                                width: canvasWidth, 
                                height: canvasHeight 
                            });
                            svg.select('.x-label')
                                .attr('x', margin.left + (width - margin.left - margin.right) / 2);
                            svg.select('.y-label')
                                .attr('x', -(margin.top + (height - margin.top - margin.bottom) / 2))
                                .attr('y', 15);
                            updateAxes();
                        }
                        plot.draw(currentPoints);
                    }
                }
            }
        };
    }
});