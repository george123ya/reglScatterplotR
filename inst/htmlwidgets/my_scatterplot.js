HTMLWidgets.widget({
    name: 'my_scatterplot',
    type: 'output',
    factory: function(el, width, height) {
        const container = el;
        container.style.position = 'relative';
        container.style.overflow = 'hidden';

        let margin = { top: 20, right: 20, bottom: 50, left: 60 };

        // Canvas for regl-scatterplot
        let canvas = document.createElement('canvas');
        canvas.style.position = 'absolute';
        canvas.style.top = '0';
        canvas.style.left = '0';
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';
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
        
        // New constant for hybrid SVG export limit
        const VECTOR_POINT_LIMIT = 50000; 

        const createLegend = function(container, legendData) {
            // ... (createLegend function remains the same)
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

        // Download button creation
        const createDownloadButton = function(container) {
            // ... (createDownloadButton function remains the same)
            const btnContainer = document.createElement('div');
            btnContainer.style.cssText = `
                position: absolute;
                top: 10px;
                left: 10px;
                z-index: 100;
            `;
            btnContainer.className = 'download-btn-container'; // Added class for easier querying
            
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
            
            // Close menu when clicking outside
            document.addEventListener('click', (e) => {
                if (!btnContainer.contains(e.target)) {
                    menu.style.display = 'none';
                }
            });
            
            btnContainer.appendChild(downloadBtn);
            btnContainer.appendChild(menu);
            container.appendChild(btnContainer);
        };

        // Core download function (MODIFIED to calculate containerRect)
        const downloadPlot = async function(format) {
            if (!plot) return;
            
            try {
                // Create temporary container for rendering
                const tempContainer = document.createElement('div');
                tempContainer.style.cssText = `
                    position: absolute;
                    top: -10000px;
                    left: -10000px;
                    width: ${width}px;
                    height: ${height}px;
                `;
                document.body.appendChild(tempContainer);
                
                // Get the container's position relative to the viewport for correct legend placement
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
            // Create a composite canvas
            const exportCanvas = document.createElement('canvas');
            exportCanvas.width = width;
            exportCanvas.height = height;
            const ctx = exportCanvas.getContext('2d');
            
            // Fill background
            ctx.fillStyle = currentXData.backgroundColor || 'white';
            ctx.fillRect(0, 0, width, height);
            
            // Draw the WebGL canvas (plot points)
            ctx.drawImage(canvas, margin.left, margin.top, canvas.width, canvas.height); 
            
            // Draw axes if present
            if (svg && currentXData.showAxes) {
                await drawSVGtoCanvas(ctx, svg.node());
            }
            
            // Draw legend if present (Uses containerRect for position)
            if (legendDiv) {
                // Temporarily set solid white background and disable box-shadow for export
                const originalBg = legendDiv.style.backgroundColor;
                const originalShadow = legendDiv.style.boxShadow;
                legendDiv.style.backgroundColor = 'white';
                legendDiv.style.boxShadow = 'none';
                
                await drawLegendToCanvas(ctx, legendDiv, containerRect);
                
                // Restore original styles
                legendDiv.style.backgroundColor = originalBg;
                legendDiv.style.boxShadow = originalShadow;
            }
            
            // Download
            exportCanvas.toBlob((blob) => {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'scatterplot.png';
                a.click();
                URL.revokeObjectURL(url);
            });
        };

        // Helper: Renders an HTML element (including styles) to a Canvas
        const renderElementToCanvas = async function(element) {
            if (typeof window.html2canvas === 'undefined') {
                const script = document.createElement('script');
                script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
                await new Promise((resolve, reject) => {
                    script.onload = resolve;
                    script.onerror = reject;
                    document.head.appendChild(script);
                });
                console.log('html2canvas loaded dynamically');
            }

            const canvas = await html2canvas(element, {
                backgroundColor: 'white', // FIX: Force solid white background for the legend
                useCORS: true,
                allowTaint: true,
            });
            return canvas;
        };

        // Helper: Draw legend to canvas (Uses html2canvas for accurate rendering)
        const drawLegendToCanvas = async function(ctx, legendElement, containerRect) {
            if (legendElement.style.display === 'none' || !legendElement.offsetWidth || !legendElement.offsetHeight) {
                return;
            }

            const legendCanvas = await renderElementToCanvas(legendElement);

            const rect = legendElement.getBoundingClientRect();
            // Position relative to the main container
            const x = rect.left - containerRect.left;
            const y = rect.top - containerRect.top;
            
            // Draw the rendered legend canvas onto the main canvas
            ctx.drawImage(legendCanvas, x, y, rect.width, rect.height);
        };

        // Helper: Create SVG group containing vector circles for the scatterplot
        const createVectorPointsSVG = function(xData, currentPoints, xDomainOrig, yDomainOrig, xScale, yScale, margin, width, height, currentRadius) {
            const svgNS = 'http://www.w3.org/2000/svg';
            const g = document.createElementNS(svgNS, 'g');
            
            // Fallback/default point color
            const defaultColor = xData.options.pointColor || 'gray';
            const opacity = xData.options.opacity || 0.8;
            const pointRadius = currentRadius; // <-- Using the dynamic radius

            // Prepare color scale if legend present
            let colorScale = null;
            if (xData.legend && xData.legend.var_type === 'continuous') {
                colorScale = d3.scaleSequential(
                    d3.piecewise(d3.interpolateRgb, xData.legend.colors)
                ).domain([0, 1]);
            }

            // Filter and map points to current view for exact match
            const currentXDomain = xScale.domain();
            const currentYDomain = yScale.domain();

            currentPoints.forEach(p => {
                const origX = xDomainOrig[0] + (p[0] + 1) / 2 * (xDomainOrig[1] - xDomainOrig[0]);
                const origY = yDomainOrig[0] + (p[1] + 1) / 2 * (yDomainOrig[1] - yDomainOrig[0]);
                
                // Only include points within current view
                if (origX >= currentXDomain[0] && origX <= currentXDomain[1] &&
                    origY >= currentYDomain[0] && origY <= currentYDomain[1]) {
                    
                    const cx = xScale(origX);
                    const cy = yScale(origY);
                    
                    const circle = document.createElementNS(svgNS, 'circle');
                    
                    circle.setAttribute('cx', cx);
                    circle.setAttribute('cy', cy);
                    circle.setAttribute('r', pointRadius); // <-- Applied here

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

        // Fallback scales for cases without axes or scales (full view)
        const getFallbackScales = function(xDom = [-1, 1], yDom = [-1, 1]) {
            return {
                xScale: d3.scaleLinear().domain(xDom).range([margin.left, width - margin.right]),
                yScale: d3.scaleLinear().domain(yDom).range([height - margin.bottom, margin.top])
            };
        };

        // New function to get the correct scales for export (or internal use)
        const getPlotScales = function(xDom, yDom) {
            if (typeof d3 === 'undefined') {
                console.error("D3 is not available for scale creation.");
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
            console.log(`SVG Exporta: ${useVector ? 'Vector' : 'Raster'} mode (Points: ${numPoints})`);

            // Define a correction factor based on visual inspection (1.1 to 1.2 is common)
            const SVG_VISUAL_CORRECTION = 1.20; // You may need to tune this value!

            let currentPointSize;

            if (plot) {
                // 1. Get current zoom, mode, and base size
                const cameraDistanceArray = plot.get('camera').distance; 
                
                // FIX: Calculate the average camera distance for a robust zoom factor.
                const cameraDistance = (cameraDistanceArray[0] + cameraDistanceArray[1]) / 2;
                
                const baseSize = plot.get('pointSize'); 
                const scaleMode = plot.get('pointScaleMode');
                
                console.log('Camera distance (Avg):', cameraDistance, 'Base size:', baseSize, 'Scale mode:', scaleMode);
                
                const zoom = 1 / cameraDistance; // Zoom factor is inverse of distance
                
                if (scaleMode === 'constant') {
                    currentPointSize = baseSize; // No scaling
                } else if (scaleMode === 'linear') {
                    currentPointSize = baseSize * zoom;
                } else if (scaleMode === 'asinh') {
                    // asinh scaling
                    currentPointSize = baseSize * (Math.asinh(zoom / 5) + 1);
                } else {
                    currentPointSize = baseSize; // Default fallback
                }
                
            } else {
                // Fallback if plot object is missing
                currentPointSize = currentXData.options.size || 3;
            }

            // Apply the correction factor to make the SVG circle look visually equivalent to WebGL.
            const currentRadius = (currentPointSize / 2) * SVG_VISUAL_CORRECTION; 
            // ------------------------------------

            // Background rect
            const bgRect = document.createElementNS(svgNS, 'rect');
            bgRect.setAttribute('width', width);
            bgRect.setAttribute('height', height);
            bgRect.setAttribute('fill', currentXData.backgroundColor || 'white');
            exportSVG.appendChild(bgRect);
            
            // --- Hybrid Plot Content ---
            if (useVector && d3Available) {
                let vectorPlotG;
                let currentDomainX, currentDomainY, exportXScale, exportYScale;
                
                if (xScale && yScale && xDomainOrig && yDomainOrig) {
                    // Axes visible or zoomed: Use current zoomed domains
                    currentDomainX = xScale.domain();
                    currentDomainY = yScale.domain();
                    ({ plotXScale: exportXScale, plotYScale: exportYScale } = getPlotScales(currentDomainX, currentDomainY));
                } else {
                    // No axes/scales: Use current zoom from stored normalized domains
                    if (currentNormDomains && currentNormDomains.x && currentNormDomains.y) {
                        // Convert normalized domains back to original space
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
                        xDomainOrig || [-1, 1], // Original domain for decoding normalized coordinates
                        yDomainOrig || [-1, 1], 
                        exportXScale, 
                        exportYScale, 
                        margin, 
                        width, 
                        height,
                        currentRadius // <-- Pass the dynamic radius
                    );
                
                    // Add clip path to keep points within the plot area defined by margins
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
                    // Fallback to raster mode if scales could not be computed
                    console.warn("D3 scales not available or invalid for vector export. Falling back to raster.");
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
                // 2. Raster Mode (Fallback for high point count or no D3)
                const canvasDataURL = canvas.toDataURL('image/png');
                const image = document.createElementNS(svgNS, 'image');
                // Set image to the area inside the margins
                image.setAttribute('x', margin.left);
                image.setAttribute('y', margin.top);
                image.setAttribute('width', width - margin.left - margin.right);
                image.setAttribute('height', height - margin.top - margin.bottom);
                image.setAttribute('href', canvasDataURL);
                exportSVG.appendChild(image);
            }
            // --- End Hybrid Plot Content ---

            // Clone and append axes SVG
            if (svg && currentXData.showAxes) {
                const axesClone = svg.node().cloneNode(true);
                Array.from(axesClone.children).forEach(child => {
                    exportSVG.appendChild(child.cloneNode(true));
                });
            }
            
            // Draw legend as SVG
            if (legendDiv && currentXData.legend) {
                const legendRes = createLegendSVG(currentXData.legend); 
                if (legendRes.defs) {
                    exportSVG.appendChild(legendRes.defs);
                }
                exportSVG.appendChild(legendRes.g);
            }
            
            // Serialize and download
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
            // Load jsPDF dynamically
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
            
            // Create composite canvas first (same as PNG logic)
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
                // Temporarily set solid white background and disable box-shadow for export
                const originalBg = legendDiv.style.backgroundColor;
                const originalShadow = legendDiv.style.boxShadow;
                legendDiv.style.backgroundColor = 'white';
                legendDiv.style.boxShadow = 'none';
                
                await drawLegendToCanvas(ctx, legendDiv, containerRect);
                
                // Restore original styles
                legendDiv.style.backgroundColor = originalBg;
                legendDiv.style.boxShadow = originalShadow;
            }
            
            // Create PDF
            const imgData = exportCanvas.toDataURL('image/png');
            const pdf = new jsPDF({
                orientation: width > height ? 'landscape' : 'portrait',
                unit: 'px',
                format: [width, height]
            });
            
            pdf.addImage(imgData, 'PNG', 0, 0, width, height);
            pdf.save('scatterplot.pdf');
        };

        // Helper: Draw SVG to canvas (remains the same)
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

        // Helper: Create legend as SVG (MODIFIED for proper continuous gradient)
        const createLegendSVG = function(legendData) {
            const svgNS = 'http://www.w3.org/2000/svg';
            const g = document.createElementNS(svgNS, 'g');
            g.setAttribute('transform', `translate(${width - 160}, 10)`);
            
            let defs = null;

            // Background
            const bg = document.createElementNS(svgNS, 'rect');
            bg.setAttribute('width', 150);
            bg.setAttribute('height', legendData.var_type === 'categorical' ? 
                (legendData.names.length * 20 + 30) : 150);
            bg.setAttribute('fill', 'rgba(255,255,255,0.8)');
            bg.setAttribute('rx', 5);
            g.appendChild(bg);
            
            // Title
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
                    // Color dot
                    const circle = document.createElementNS(svgNS, 'circle');
                    circle.setAttribute('cx', 15);
                    circle.setAttribute('cy', yOffset - 4);
                    circle.setAttribute('r', 6);
                    circle.setAttribute('fill', legendData.colors[i]);
                    g.appendChild(circle);

                    // Text label
                    const text = document.createElementNS(svgNS, 'text');
                    text.setAttribute('x', 30);
                    text.setAttribute('y', yOffset);
                    text.setAttribute('font-size', '12');
                    text.textContent = name;
                    g.appendChild(text);

                    yOffset += 20;
                });
            } else if (legendData.var_type === 'continuous') {
                // Define gradient defs
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
                
                // Gradient bar
                const gradRect = document.createElementNS(svgNS, 'rect');
                gradRect.setAttribute('x', 0);
                gradRect.setAttribute('y', 0);
                gradRect.setAttribute('width', 15);
                gradRect.setAttribute('height', 100);
                gradRect.setAttribute('fill', 'url(#continuousGradient)');
                gradContainer.appendChild(gradRect);

                // Labels
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
            // ... (autoAdjustZoom remains the same)
            if (!xDomain[0] || !xDomain[1] || !yDomain[0] || !yDomain[1]) {
                console.warn('Invalid domain values:', xDomain, yDomain);
                return;
            }
            const rangeX = xDomain[1] - xDomain[0] || 2;
            const rangeY = yDomain[1] - yDomain[0] || 2;
            const padX = rangeX * 0.1;
            const padY = rangeY * 0.1;
            const normalizedX = ((xDomain[0] - padX) - xDomain[0]) / (xDomain[1] - xDomain[0]) * 2 - 1;
            const normalizedWidth = (rangeX + 2 * padX) / (xDomain[1] - xDomain[0]) * 2;
            const normalizedY = ((yDomain[0] - padY) - yDomain[0]) / (yDomain[1] - yDomain[0]) * 2 - 1;
            const normalizedHeight = (rangeY + 2 * padY) / (yDomain[1] - yDomain[0]) * 2;
            if (isNaN(normalizedX) || isNaN(normalizedY) || isNaN(normalizedWidth) || isNaN(normalizedHeight)) {
                console.warn('Invalid zoom bounds:', { normalizedX, normalizedY, normalizedWidth, normalizedHeight });
                return;
            }
            plot.zoomToArea({ x: normalizedX, y: normalizedY, width: normalizedWidth, height: normalizedHeight }, true);
        };

        const updateAxes = function() {
            // ... (updateAxes remains the same)
            if (!d3Available || !xScale || !yScale || !svg || !svg.node() || !xAxis || !yAxis || !xAxisG || !yAxisG) return;
            console.log('Updating axes with domains:', xScale.domain(), yScale.domain());

            xAxis.scale(xScale);
            yAxis.scale(yScale);

            xAxisG.call(xAxis);
            yAxisG.call(yAxis);

            svg.selectAll('.domain').attr('stroke', 'black').attr('stroke-width', 1.5);
            svg.selectAll('.tick line').attr('stroke', 'black');
            svg.selectAll('.tick text').attr('fill', 'black').style('font-size', '11px');
        };

        const updateLabels = function(xlab, ylab) {
            // ... (updateLabels remains the same)
            if (!svg) return;
            svg.select('.x-label').text(xlab || 'X');
            svg.select('.y-label').text(ylab || 'Y');
        };

        return {
            renderValue: async function(xData) {
                // ... (renderValue implementation remains the same)
                console.log('Starting renderValue...');
                currentXData = xData;

                if (typeof d3 === 'undefined') {
                    try {
                        const d3Module = await import('https://esm.sh/d3@7');
                        window.d3 = d3Module;
                        d3Available = true;
                        console.log('D3 loaded dynamically via esm.sh');
                    } catch (error) {
                        console.error('Failed to load D3:', error);
                        d3Available = false;
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
                let marginsChanged = JSON.stringify(newMargin) !== JSON.stringify(margin);
                margin = newMargin;
                console.log('Margins set:', margin, 'for axes:', hasAxes);

                let svgNeedsRecreate = false;
                if (hasAxes) {
                    if (!svg) {
                        svgNeedsRecreate = true;
                    } else if (marginsChanged) {
                        svgNeedsRecreate = true;
                    }
                } else {
                    if (svg) {
                        svg.remove();
                        svg = null;
                    }
                }

                xDomainOrig = [xData.x_min, xData.x_max];
                yDomainOrig = [xData.y_min, xData.y_max];

                if (d3Available && hasAxes && svgNeedsRecreate) {
                    if (svg) svg.remove(); // Ensure clean removal before recreating
                    svg = d3.select(container).append('svg')
                        .attr('width', width)
                        .attr('height', height)
                        .style('position', 'absolute')
                        .style('top', 0)
                        .style('left', 0)
                        .style('pointer-events', 'none');
                    console.log('SVG created');

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

                    xDomainOrig = [xData.x_min, xData.x_max];
                    yDomainOrig = [xData.y_min, xData.y_max];
                    xScale = d3.scaleLinear().domain(xDomainOrig).range([margin.left, width - margin.right]);
                    yScale = d3.scaleLinear().domain(yDomainOrig).range([height - margin.bottom, margin.top]);

                    xAxis = d3.axisBottom(xScale).ticks(6);
                    yAxis = d3.axisLeft(yScale).ticks(6);

                    xAxisG.call(xAxis);
                    yAxisG.call(yAxis);
                    svg.selectAll('.domain').attr('stroke', 'black').attr('stroke-width', 1.5);
                    console.log('Initial axes called');
                } else if (hasAxes) {
                    if (marginsChanged) {
                        xDomainOrig = [xData.x_min, xData.x_max];
                        yDomainOrig = [xData.y_min, xData.y_max];
                        xScale = d3.scaleLinear().domain(xDomainOrig).range([margin.left, width - margin.right]);
                        yScale = d3.scaleLinear().domain(yDomainOrig).range([height - margin.bottom, margin.top]);
                        xAxis = d3.axisBottom(xScale).ticks(6);
                        yAxis = d3.axisLeft(yScale).ticks(6);
                        updateAxes();
                        xAxisG.attr('transform', `translate(0, ${height - margin.bottom})`);
                        yAxisG.attr('transform', `translate(${margin.left}, 0)`);
                        svg.select('.x-label')
                            .attr('x', margin.left + (width - margin.left - margin.right) / 2)
                            .attr('y', height - 10);
                        svg.select('.y-label')
                            .attr('x', -(margin.top + (height - margin.top - margin.bottom) / 2))
                            .attr('y', 15);
                    }
                    updateLabels(xData.xlab, xData.ylab);
                    console.warn('Skipping SVG recreate; updating existing');
                } else if (hasAxes) {
                    console.warn('Skipping axes: D3 not ready');
                }

                if (xData.showTooltip) {
                    if (!tooltip) {
                        tooltip = document.createElement('div');
                        tooltip.id = 'scatterplotTooltip';
                        tooltip.style.cssText = `position:absolute;background-color:rgba(0,0,0,0.8);color:white;padding:5px 10px;border-radius:4px;font-size:12px;pointer-events:none;z-index:1000;display:none;`;
                        container.appendChild(tooltip);
                        console.log('Tooltip enabled');
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
                    console.log('Plot renderer created');
                }

                const internalXScale = d3.scaleLinear().domain([-1, 1]).range([0, canvasWidth]);
                const internalYScale = d3.scaleLinear().domain([-1, 1]).range([canvasHeight, 0]);

                const isSpatialUpdate = plot && 
                    xData.points.length === prevNumPoints && 
                    xData.x_min === prevDomains?.x_min && 
                    xData.x_max === prevDomains?.x_max && 
                    xData.y_min === prevDomains?.y_min && 
                    xData.y_max === prevDomains?.y_max;

                if (isSpatialUpdate) {
                    console.log('Incremental update: reusing plot and spatial index');
                    const spatialIndex = plot.get('spatialIndex');

                    const numPoints = xData.points.length;
                    currentPoints = [];
                    for (let i = 0; i < numPoints; i++) {
                        const point = [
                            xData.points[i][0],
                            xData.points[i][1]
                        ];
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
                    console.log('Incremental draw complete (zoom preserved)');
                } else {
                    console.log('Full recreate: new plot instance');
                    if (plot) {
                        plot.destroy?.();
                        plot = null;
                    }
                    xDomainOrig = [xData.x_min, xData.x_max];
                    yDomainOrig = [xData.y_min, xData.y_max];

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
                    console.log('Plot created');

                    const numPoints = xData.points.length || xData.points.row || 0;
                    currentPoints = [];
                    for (let i = 0; i < numPoints; i++) {
                        const point = [
                            xData.points[i][0],
                            xData.points[i][1]
                        ];
                        if (xData.points[i].length > 2) {
                            point.push(xData.points[i][2]);
                        }
                        currentPoints.push(point);
                    }
                    console.log('Points constructed:', currentPoints.length);

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
                    console.log('Full draw complete');

                    if (isInitialRender) {
                        autoAdjustZoom(xDomainOrig, yDomainOrig);
                        isInitialRender = false;
                    }
                }

                prevDomains = { x_min: xData.x_min, x_max: xData.x_max, y_min: xData.y_min, y_max: xData.y_max };
                prevNumPoints = xData.points.length;

                if (hasAxes && plot) {
                    plot.subscribe('view', (event) => {
                        console.log('View updated');
                        const newXDomain = [
                            xDomainOrig[0] + (event.xScale.domain()[0] + 1) / 2 * (xDomainOrig[1] - xDomainOrig[0]),
                            xDomainOrig[0] + (event.xScale.domain()[1] + 1) / 2 * (xDomainOrig[1] - xDomainOrig[0])
                        ];
                        const newYDomain = [
                            yDomainOrig[0] + (event.yScale.domain()[0] + 1) / 2 * (yDomainOrig[1] - yDomainOrig[0]),
                            yDomainOrig[0] + (event.yScale.domain()[1] + 1) / 2 * (yDomainOrig[1] - yDomainOrig[0])
                        ];

                        xScale.domain(newXDomain);
                        yScale.domain(newYDomain);  

                        updateAxes();
                    });

                } else if (plot) {
                    plot.subscribe('view', (event) => {
                        currentNormDomains.x = event.xScale.domain();
                        currentNormDomains.y = event.yScale.domain();
                    });
                }
                
                if (xData.showTooltip && plot && tooltip) {
                    plot.subscribe('pointOver', (pointIndex) => {
                        console.log('Point over:', pointIndex);
                        const normPoint = plot.get('points')[pointIndex];
                        const [nx, ny] = normPoint.slice(0, 2);
                        const origX = xDomainOrig[0] + (nx + 1) / 2 * (xDomainOrig[1] - xDomainOrig[0]);
                        const origY = yDomainOrig[0] + (ny + 1) / 2 * (yDomainOrig[1] - yDomainOrig[0]);
                        const [px, py] = plot.getScreenPosition(pointIndex);
                        
                        let tooltipContent = `X: ${origX.toFixed(2)}<br>Y: ${origY.toFixed(2)}`;
                        
                        if (normPoint.length > 2) {
                            const z = normPoint[2];
                            let colorVal;
                            if (xData.legend.var_type === 'categorical') {
                                colorVal = xData.legend.names[Math.floor(z)];
                            } else {
                                colorVal = xData.legend.minVal + z * (xData.legend.maxVal - xData.legend.minVal);
                            }
                            tooltipContent += `<br>Value: ${colorVal.toFixed(2)}`;
                        }
                        
                        tooltip.innerHTML = tooltipContent;
                        tooltip.style.display = 'block';
                        tooltip.style.left = (px + margin.left + 10) + 'px';
                        tooltip.style.top = (py + margin.top + 10) + 'px';
                    });

                    plot.subscribe('pointOut', () => {
                        console.log('Point out');
                        tooltip.style.display = 'none';
                    });
                }
                
                if (Object.keys(xData.legend).length > 0) {
                    createLegend(container, xData.legend);
                }
                
                // Add download button if enabled
                if (xData.enableDownload && !container.querySelector('.download-btn-container')) {
                    createDownloadButton(container);
                }
            },

            resize: function(newWidth, newHeight) {
                // ... (resize implementation remains the same)
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
                        console.log('Resized and re-drawn');
                    }
                }
            }
        };
    }
});
