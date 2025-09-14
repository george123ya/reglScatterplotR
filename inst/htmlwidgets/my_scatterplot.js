// inst/htmlwidgets/my_scatterplot.js

HTMLWidgets.widget({
  name: 'my_scatterplot',
  type: 'output',
  factory: function(el, width, height) {
    const container = el;
    container.style.position = 'relative';
    container.style.overflow = 'hidden';

    let margin = { top: 20, right: 20, bottom: 50, left: 60 }; // Default margins

    // Canvas for regl-scatterplot
    let canvas = document.createElement('canvas');
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = width + 'px';   // enforce widget width
    canvas.style.height = height + 'px'; // enforce widget height
    canvas.width = width;                // internal resolution
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
    let currentXData; // Store for resize
    let currentPoints; // Store points for re-draw on resize

    const createLegend = function(container, legendData) {
      const existingLegend = container.querySelector('.scatterplot-legend');
      if (existingLegend) {
        existingLegend.remove();
      }

      const legendDiv = document.createElement('div');
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
        const legendTitle = document.createElement('div');
        legendTitle.innerText = "Value";
        legendTitle.style.marginBottom = "5px";
        legendDiv.appendChild(legendTitle);
        
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
      container.appendChild(legendDiv);
    };

    // Auto-zoom function (adapted from your working code)
    const autoAdjustZoom = function(xDomain, yDomain) {
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

    // Function to update axes (re-call with new scales)
    const updateAxes = function() {
      if (!d3Available || !xScale || !yScale || !svg || !svg.node() || !xAxis || !yAxis || !xAxisG || !yAxisG) return;
      console.log('Updating axes with domains:', xScale.domain(), yScale.domain());

      xAxis.scale(xScale);
      yAxis.scale(yScale);

      xAxisG.call(xAxis);
      yAxisG.call(yAxis);

      // Style axes
      svg.selectAll('.domain').attr('stroke', 'black').attr('stroke-width', 1.5);
      svg.selectAll('.tick line').attr('stroke', 'black');
      svg.selectAll('.tick text').attr('fill', 'black').style('font-size', '11px');
    };

    return {
      renderValue: async function(xData) {
        console.log('Starting renderValue...');
        currentXData = xData;

        // Dynamically load D3 via esm.sh for reliability
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

        // Selective clear: Remove old SVG, tooltip, and legend, keep canvas
        if (svg) svg.remove();
        if (tooltip) tooltip.remove();
        const oldLegend = container.querySelector('.scatterplot-legend');
        if (oldLegend) oldLegend.remove();
        if (plot) plot.destroy?.();
        plot = null;
        xAxisG = null;
        yAxisG = null;

        // Background color for canvas
        if (xData.backgroundColor) {
          canvas.style.backgroundColor = xData.backgroundColor;
        } else {
          canvas.style.backgroundColor = 'white';
        }

        let hasAxes = xData.showAxes;
        margin = hasAxes ? { top: 20, right: 20, bottom: 50, left: 60 } : { top: 0, right: 0, bottom: 0, left: 0 };
        console.log('Margins set:', margin, 'for axes:', hasAxes);

        if (d3Available && hasAxes && typeof d3 !== 'undefined') {
          svg = d3.select(container).append('svg')
            .attr('width', width)
            .attr('height', height)
            .style('position', 'absolute')
            .style('top', 0)
            .style('left', 0)
            .style('pointer-events', 'none');
          console.log('SVG created');

          // Create axis groups and labels BEFORE regl-scatterplot
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

          // Initial scales and axes (full extent)
          xDomainOrig = [xData.x_min, xData.x_max];
          yDomainOrig = [xData.y_min, xData.y_max];
          xScale = d3.scaleLinear().domain(xDomainOrig).range([margin.left, width - margin.right]);
          yScale = d3.scaleLinear().domain(yDomainOrig).range([height - margin.bottom, margin.top]);

          xAxis = d3.axisBottom(xScale).ticks(6);
          yAxis = d3.axisLeft(yScale).ticks(6);

          // Initial call to show axes/ticks
          xAxisG.call(xAxis);
          yAxisG.call(yAxis);
          svg.selectAll('.domain').attr('stroke', 'black').attr('stroke-width', 1.5);
          console.log('Initial axes called');
        } else if (hasAxes) {
          console.warn('Skipping axes: D3 not ready');
        }

        // Tooltip setup if enabled
        if (xData.showTooltip) {
          tooltip = document.createElement('div');
          tooltip.id = 'scatterplotTooltip';
          tooltip.style.cssText = `position:absolute;background-color:rgba(0,0,0,0.8);color:white;padding:5px 10px;border-radius:4px;font-size:12px;pointer-events:none;z-index:1000;display:none;`;
          container.appendChild(tooltip);
          console.log('Tooltip enabled');
        }

        const canvasWidth = width - margin.left - margin.right;
        const canvasHeight = height - margin.top - margin.bottom;
        if (canvasWidth <= 0 || canvasHeight <= 0) return;
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;
        canvas.style.width = canvasWidth + 'px';  // Pixel size to match resolution
        canvas.style.height = canvasHeight + 'px';
        canvas.style.top = margin.top + 'px';
        canvas.style.left = margin.left + 'px';

        const module = await import('https://esm.sh/regl-scatterplot@1.14.1');
        const createScatterplot = module.default;
        const { createRenderer } = module;
        
        renderer = createRenderer();
        console.log('Plot renderer created');

        // Internal scales for regl-scatterplot (domain [-1,1], canvas range)
        const internalXScale = d3.scaleLinear().domain([-1, 1]).range([0, canvasWidth]);
        const internalYScale = d3.scaleLinear().domain([-1, 1]).range([canvasHeight, 0]);
        
        plot = createScatterplot({
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

        // Sync axes on view changes (manual, as in working code)
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
        }
        
        // Tooltip events if enabled
        if (xData.showTooltip && plot && tooltip) {
          plot.subscribe('pointOver', (pointIndex) => {
            console.log('Point over:', pointIndex);
            const normPoint = plot.get('points')[pointIndex];
            const [nx, ny] = normPoint.slice(0, 2);
            // Map normalized back to original
            const origX = xDomainOrig[0] + (nx + 1) / 2 * (xDomainOrig[1] - xDomainOrig[0]);
            const origY = yDomainOrig[0] + (ny + 1) / 2 * (yDomainOrig[1] - yDomainOrig[0]);
            const [px, py] = plot.getScreenPosition(pointIndex);
            
            let tooltipContent = `X: ${origX.toFixed(2)}<br>Y: ${origY.toFixed(2)}`;
            
            // Add color value if present
            if (normPoint.length > 2) {
              const colorVal = xData.options.colorBy ? 
                (xData.legend.var_type === 'categorical' ? 
                 xData.legend.names[Math.floor(normPoint[2])] : 
                 xData.legend.minVal + normPoint[2] * (xData.legend.maxVal - xData.legend.minVal)) : 
                '';
              tooltipContent += `<br>Value: ${colorVal}`;
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
        
        // Build points array (robust to matrix/data.frame) and store for resize
        const numPoints = xData.points.length || xData.points.row || 0;
        currentPoints = [];
        for (let i = 0; i < numPoints; i++) {
          const point = [
            xData.points[i][0],  // x_normalized
            xData.points[i][1]   // y_normalized
          ];
          if (xData.points[i].length > 2) {
            point.push(xData.points[i][2]);  // valueA if present
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
        plot.draw(currentPoints);
        console.log('Points drawn');

        // Auto-zoom
        setTimeout(() => autoAdjustZoom(xDomainOrig, yDomainOrig), 100);
        
        if (Object.keys(xData.legend).length > 0) {
          createLegend(container, xData.legend);
        }
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
            canvas.style.width = canvasWidth + 'px';  // Match resolution to avoid clipping
            canvas.style.height = canvasHeight + 'px';
            canvas.style.top = margin.top + 'px';
            canvas.style.left = margin.left + 'px';
            if (svg && currentXData.showAxes) {
              svg.attr('width', width).attr('height', height);
              // Re-range full scales
              xScale.range([margin.left, width - margin.right]);
              yScale.range([height - margin.bottom, margin.top]);
              // Update internal ranges
              const internalXScale = d3.scaleLinear().domain([-1, 1]).range([0, canvasWidth]);
              const internalYScale = d3.scaleLinear().domain([-1, 1]).range([canvasHeight, 0]);
              plot.set({ 
                xScale: internalXScale, 
                yScale: internalYScale, 
                width: canvasWidth, 
                height: canvasHeight 
              });
              // Reposition labels
              svg.select('.x-label')
                .attr('x', margin.left + (width - margin.left - margin.right) / 2);
              svg.select('.y-label')
                .attr('x', -(margin.top + (height - margin.top - margin.bottom) / 2));
              updateAxes();
            }
            // Re-draw points to sync with new size
            plot.draw(currentPoints);
            console.log('Resized and re-drawn');
          }
        }
      }
    };
  }
});