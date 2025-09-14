// inst/htmlwidgets/my_violinplot.js

HTMLWidgets.widget({
  name: 'my_violinplot',
  type: 'output',
  factory: function(el, width, height) {
    const container = el;
    container.style.position = 'relative';
    container.style.overflow = 'hidden';

    let margin = { top: 40, right: 40, bottom: 60, left: 60 };
    let legendWidth = 150;
    let plotWidth;
    let svg, canvas, ctx;
    let currentDatasets;
    let plotElements = {};
    let d3Available = false;

    // Utility function to convert RGB to HEX
    function rgbToHex(rgb) {
      if (rgb.startsWith('#')) return rgb.toUpperCase();
      const match = rgb.match(/\d+/g);
      if (!match) return '#000000';
      const [r, g, b] = match.map(Number);
      return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase()}`;
    }

    // Core plotting function
    function updatePlot() {
      if (!d3Available || !ctx || !svg || !currentDatasets) {
        console.warn("Plot elements or data not initialized.");
        return;
      }

      const { showPoints, logScale, pointSize, legendPosition, groupColors, pointOffsets } = plotElements;

      ctx.save();
      ctx.clearRect(0, 0, width, height);
      svg.selectAll('*').remove();

      // Set background color
      if (plotElements.backgroundColor) {
        ctx.fillStyle = plotElements.backgroundColor;
        ctx.fillRect(0, 0, width, height);
      }

      // Re-create the clipping path
      svg.append('clipPath')
        .attr('id', 'violin-clip')
        .append('rect')
        .attr('x', margin.left)
        .attr('y', margin.top)
        .attr('width', width - margin.left - margin.right - (legendPosition === 'Legend' ? legendWidth : 0))
        .attr('height', height - margin.top - margin.bottom);

      // D3 Utility Functions
      function standardDeviation(arr) {
        if (!Array.isArray(arr) || arr.length < 2) return 0;
        const mean = d3.mean(arr);
        if (mean === undefined || mean === null) return 0;
        const variance = d3.sum(arr.map(x => (x - mean) ** 2)) / (arr.length - 1);
        return Math.sqrt(variance);
      }

      function iqr(arr) {
        const sorted = arr.slice().sort(d3.ascending);
        const q1 = d3.quantile(sorted, 0.25);
        const q3 = d3.quantile(sorted, 0.75);
        return q3 - q1;
      }

      function kernelDensityEstimator(kernel, X) {
        return function(V) {
          return X.map(x => [x, d3.mean(V, v => kernel(x - v))]);
        };
      }

      function kernelEpanechnikov(k) {
        return function(v) {
          return Math.abs(v /= k) <= 1 ? 0.75 * (1 - v*v) / k : 0;
        };
      }

      const allValues = currentDatasets.flatMap(d => d.values);
      if (allValues.length === 0) {
        console.warn("No valid values in datasets");
        return;
      }

      const dataExtent = d3.extent(allValues);
      const padding = (dataExtent[1] - dataExtent[0]) * 0.05;
      const y = logScale ?
        d3.scaleLog().domain([Math.max(d3.min(allValues, d => d > 0 ? d : 1), 1), d3.max(allValues)]).range([height - margin.bottom, margin.top]).nice() :
        d3.scaleLinear().domain([dataExtent[0] - padding, dataExtent[1] + padding]).range([height - margin.bottom, margin.top]);

      const plotWidthActual = (width - margin.left - margin.right - (legendPosition === 'Legend' ? legendWidth : 0)) / currentDatasets.length;

      // Draw violins
      currentDatasets.forEach((dataset, i) => {
        if (!dataset.values || !Array.isArray(dataset.values) || dataset.values.length === 0) return;

        const n = dataset.values.length;
        const stdDev = standardDeviation(dataset.values);
        const dataIQR = iqr(dataset.values);
        const h = Math.max(0.9 * Math.min(stdDev, dataIQR / 1.34) * Math.pow(n, -1/5), 0.01);

        const dataExtentGroup = d3.extent(dataset.values);
        const kdePadding = (dataExtentGroup[1] - dataExtentGroup[0]) * 0.05;
        const kdeTicks = d3.range(dataExtentGroup[0] - kdePadding, dataExtentGroup[1] + kdePadding, (dataExtentGroup[1] - dataExtentGroup[0]) / 100);
        const kde = kernelDensityEstimator(kernelEpanechnikov(h), kdeTicks);
        let density = kde(dataset.values);

        const x = d3.scaleLinear().domain([0, d3.max(density, d => d[1]) || 1]).range([0, plotWidthActual * 0.4]);
        const xCenter = margin.left + plotWidthActual * (i + 0.5);

        svg.append('path')
          .datum(density)
          .attr('class', `violin-path-${i}`)
          .attr('fill', groupColors[i])
          .attr('fill-opacity', 0.6)
          .attr('stroke', '#333')
          .attr('stroke-width', 1)
          .attr('clip-path', 'url(#violin-clip)')
          .attr('d', d3.area()
            .x0(d => xCenter - x(d[1]))
            .x1(d => xCenter + x(d[1]))
            .y(d => y(d[0]))
            .curve(d3.curveBasis)
          );
      });

      // Draw points on canvas
      if (showPoints) {
        ctx.globalAlpha = 0.5;
        currentDatasets.forEach((dataset, i) => {
          const xCenter = margin.left + plotWidthActual * (i + 0.5);
          ctx.fillStyle = groupColors[i];
          dataset.values.forEach((v, j) => {
            ctx.beginPath();
            ctx.arc(
              xCenter + pointOffsets[i][j],
              y(v),
              pointSize,
              0,
              2 * Math.PI
            );
            ctx.fill();
          });
        });
        ctx.globalAlpha = 1.0;
      }

      // Draw legend or labels
      if (legendPosition === 'Legend') {
        const legendX = width - margin.right - legendWidth + 5;
        const legendY = margin.top;

        const legend = svg.append('g')
          .attr('class', 'legend-group')
          .attr('transform', `translate(${legendX}, ${legendY})`);

        currentDatasets.forEach((dataset, i) => {
          if (!dataset.values || dataset.values.length === 0) return;
          
          const legendItem = legend.append('g')
            .attr('transform', `translate(0, ${i * 25})`);
            
          legendItem.append('rect')
            .attr('class', `legend-rect-${i}`)
            .attr('width', 15)
            .attr('height', 15)
            .attr('fill', groupColors[i])
            .attr('fill-opacity', 0.6)
            .attr('stroke', '#333')
            .attr('stroke-width', 1);
            
          legendItem.append('text')
            .attr('x', 20)
            .attr('y', 12)
            .attr('fill', '#333')
            .attr('font-size', 12)
            .text(dataset.metadata?.name || `Group ${i + 1}`);
        });
      } else {
        const labelY = height - margin.bottom + 20;
        currentDatasets.forEach((dataset, i) => {
          if (!dataset.values || dataset.values.length === 0) return;
          const xCenter = margin.left + plotWidthActual * (i + 0.5);
          svg.append('text')
            .attr('class', 'bottom-label')
            .attr('x', xCenter)
            .attr('y', labelY)
            .attr('text-anchor', 'middle')
            .attr('fill', '#333')
            .attr('font-size', 12)
            .text(dataset.metadata?.name || `Group ${i + 1}`);
        });
      }

      // Y-axis
      const yAxis = d3.axisLeft(y).ticks(5).tickFormat(logScale ? d3.format('.2f') : null);
      svg.append('g')
        .attr('class', 'y-axis')
        .attr('transform', `translate(${margin.left},0)`)
        .call(yAxis);

      // Add y-axis label
      if (plotElements.ylab) {
        svg.append('text')
          .attr('class', 'y-label')
          .attr('transform', 'rotate(-90)')
          .attr('x', -(height / 2))
          .attr('y', 15)
          .attr('text-anchor', 'middle')
          .attr('fill', '#333')
          .attr('font-size', 14)
          .text(plotElements.ylab);
      }

      // Add title
      if (plotElements.title) {
        svg.append('text')
          .attr('class', 'plot-title')
          .attr('x', width / 2)
          .attr('y', 20)
          .attr('text-anchor', 'middle')
          .attr('fill', '#333')
          .attr('font-size', 16)
          .attr('font-weight', 'bold')
          .text(plotElements.title);
      }

      // Hover interactions
      const hoverLine = svg.append('line')
        .attr('class', 'hover-line')
        .attr('stroke', 'red')
        .attr('stroke-width', 1)
        .style('display', 'none');

      const hoverLabel = svg.append('text')
        .attr('class', 'hover-label')
        .attr('x', margin.left + (width - margin.left - margin.right - (legendPosition === 'Legend' ? legendWidth : 0)) / 2)
        .attr('y', height - margin.bottom + 40)
        .attr('text-anchor', 'middle')
        .attr('fill', 'red')
        .style('font-size', '12px')
        .text('');

      const counters = currentDatasets.map((dataset, i) => {
        if (!dataset.values || !Array.isArray(dataset.values) || dataset.values.length === 0) return null;
        return svg.append('text')
          .attr('class', `counter-${i}`)
          .attr('x', margin.left + plotWidthActual * (i + 0.5))
          .attr('y', margin.top - 10)
          .attr('text-anchor', 'middle')
          .attr('fill', '#333')
          .attr('font-size', 12)
          .style('display', 'none')
          .text('');
      }).filter(d => d !== null);

      const allSorted = currentDatasets.map(d => d.values.slice().sort(d3.ascending));

      svg.append('rect')
        .attr('x', margin.left)
        .attr('y', margin.top)
        .attr('width', width - margin.left - margin.right - (legendPosition === 'Legend' ? legendWidth : 0))
        .attr('height', height - margin.top - margin.bottom)
        .attr('fill', 'transparent')
        .on('mousemove', function(event) {
          const [mx, my] = d3.pointer(event);
          if (my < margin.top || my > height - margin.bottom) return;
          const yVal = y.invert(my);
          const totalCount = allSorted.reduce((sum, sorted) => sum + d3.bisectLeft(sorted, yVal), 0);
          
          hoverLine
            .attr('x1', margin.left)
            .attr('x2', width - margin.right - (legendPosition === 'Legend' ? legendWidth : 0))
            .attr('y1', my)
            .attr('y2', my)
            .style('display', null);
          
          hoverLabel.text(`Count ≤ ${yVal.toFixed(2)}`);
          
          allSorted.forEach((sorted, i) => {
            if (counters[i]) {
              const count = d3.bisectLeft(sorted, yVal);
              counters[i].text(`n=${count}`).style('display', null);
            }
          });
        })
        .on('mouseleave', function() {
          hoverLine.style('display', 'none');
          hoverLabel.text('');
          counters.forEach(counter => counter.style('display', 'none'));
        });

      ctx.restore();
    }

    return {
      renderValue: async function(xData) {
        console.log('Starting renderValue for violin plot...');
        
        // Load D3 if not available
        if (typeof d3 === 'undefined') {
          try {
            const d3Module = await import('https://esm.sh/d3@7');
            window.d3 = d3Module;
            d3Available = true;
            console.log('D3 loaded dynamically');
          } catch (error) {
            console.error('Failed to load D3:', error);
            d3Available = false;
            return;
          }
        } else {
          d3Available = true;
        }

        // Clear previous content
        container.innerHTML = '';

        // Create canvas for points
        canvas = document.createElement('canvas');
        canvas.style.position = 'absolute';
        canvas.style.top = '0';
        canvas.style.left = '0';
        canvas.width = width;
        canvas.height = height;
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';
        container.appendChild(canvas);

        ctx = canvas.getContext('2d');

        // Create SVG for violins and axes
        svg = d3.select(container).append('svg')
          .attr('width', width)
          .attr('height', height)
          .style('position', 'absolute')
          .style('top', 0)
          .style('left', 0);

        currentDatasets = xData.datasets;
        
        // Set up plot elements
        plotWidth = (width - margin.left - margin.right - (xData.legendPosition === 'Legend' ? legendWidth : 0)) / currentDatasets.length;
        
        plotElements = {
          showPoints: xData.showPoints,
          logScale: xData.logScale,
          pointSize: xData.pointSize || 2,
          legendPosition: xData.legendPosition || 'Legend',
          ylab: xData.ylab,
          title: xData.title,
          backgroundColor: xData.backgroundColor,
          pointOffsets: currentDatasets.map(d => d.values.map(() => (Math.random() - 0.5) * (plotWidth * 0.2))),
          groupColors: currentDatasets.map((d, i) => {
            if (d.metadata?.color) {
              return d.metadata.color;
            }
            // Default D3 color scheme
            return d3.schemeSet1[i % d3.schemeSet1.length];
          })
        };

        updatePlot();
      },

      resize: function(newWidth, newHeight) {
        width = newWidth;
        height = newHeight;
        
        if (canvas) {
          canvas.width = width;
          canvas.height = height;
          canvas.style.width = width + 'px';
          canvas.style.height = height + 'px';
        }
        
        if (svg) {
          svg.attr('width', width).attr('height', height);
        }
        
        if (currentDatasets && plotElements) {
          // Recalculate plotWidth for new dimensions
          plotWidth = (width - margin.left - margin.right - (plotElements.legendPosition === 'Legend' ? legendWidth : 0)) / currentDatasets.length;
          plotElements.pointOffsets = currentDatasets.map(d => d.values.map(() => (Math.random() - 0.5) * (plotWidth * 0.2)));
          updatePlot();
        }
      }
    };
  }
});