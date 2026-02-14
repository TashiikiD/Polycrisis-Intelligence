/* The Fragility Brief — Systems Map V0 (D3.js Force-Directed Graph) */

(function () {
    'use strict';

    const CONFIG = {
        width: 960,
        height: 680,
        nodeRadiusMin: 14,
        nodeRadiusMax: 30,
        linkWidthScale: [0.5, 4], // weight 1-5 maps to this px range
        chargeStrength: -400,
        linkDistance: 120,
        collideRadius: 40,
    };

    // Edge type visual config (from PRODUCT_SPEC_SYSTEMS_MAP.md)
    const EDGE_STYLES = {
        CA: { label: 'Causal', dasharray: null, markerEnd: true },
        AM: { label: 'Amplifying', dasharray: null, markerEnd: true, colorOverride: '#f85149' },
        DA: { label: 'Dampening', dasharray: '6,3', markerEnd: true, colorOverride: '#58a6ff' },
        CO: { label: 'Correlated', dasharray: null, markerEnd: false },
        FB: { label: 'Feedback', dasharray: null, markerEnd: true },
        CT: { label: 'Contingent', dasharray: '3,3', markerEnd: true },
        ST: { label: 'Structural', dasharray: '8,4', markerEnd: false },
    };

    let simulation, svg, g, linkGroup, nodeGroup, tooltip, detailPanel;
    let graphData = { nodes: [], edges: [], categories: [] };
    let activeCategories = new Set();

    async function init() {
        const container = document.getElementById('systems-map');
        if (!container) return;

        // Load data
        try {
            const res = await fetch('/systems-map/data/themes.json');
            graphData = await res.json();
        } catch (e) {
            container.innerHTML = '<p style="color:#f85149;padding:20px;">Failed to load systems map data.</p>';
            return;
        }

        // Initialize all categories as active
        graphData.categories.forEach(function (c) { activeCategories.add(c.id); });

        // Build category color map
        const colorMap = {};
        graphData.categories.forEach(function (c) { colorMap[c.id] = c.color; });

        // Count connections per node for radius scaling
        const connectionCount = {};
        graphData.nodes.forEach(function (n) { connectionCount[n.id] = 0; });
        graphData.edges.forEach(function (e) {
            connectionCount[e.source] = (connectionCount[e.source] || 0) + 1;
            connectionCount[e.target] = (connectionCount[e.target] || 0) + 1;
        });
        const maxConn = Math.max.apply(null, Object.values(connectionCount)) || 1;

        // Create SVG
        const rect = container.getBoundingClientRect();
        const width = rect.width || CONFIG.width;
        const height = CONFIG.height;

        svg = d3.select(container)
            .append('svg')
            .attr('viewBox', '0 0 ' + width + ' ' + height)
            .attr('preserveAspectRatio', 'xMidYMid meet')
            .style('width', '100%')
            .style('height', height + 'px')
            .style('background', '#0d1117')
            .style('border-radius', '8px')
            .style('border', '1px solid #30363d');

        // Defs: arrowheads
        var defs = svg.append('defs');

        // Default arrow
        defs.append('marker')
            .attr('id', 'arrow')
            .attr('viewBox', '0 0 10 6')
            .attr('refX', 20)
            .attr('refY', 3)
            .attr('markerWidth', 8)
            .attr('markerHeight', 6)
            .attr('orient', 'auto')
            .append('path')
            .attr('d', 'M0,0 L10,3 L0,6 Z')
            .attr('fill', '#30363d');

        // Red arrow for amplifying
        defs.append('marker')
            .attr('id', 'arrow-red')
            .attr('viewBox', '0 0 10 6')
            .attr('refX', 20)
            .attr('refY', 3)
            .attr('markerWidth', 8)
            .attr('markerHeight', 6)
            .attr('orient', 'auto')
            .append('path')
            .attr('d', 'M0,0 L10,3 L0,6 Z')
            .attr('fill', '#f85149');

        // Zoom group
        g = svg.append('g');

        // Zoom behavior
        var zoom = d3.zoom()
            .scaleExtent([0.3, 5])
            .on('zoom', function (event) {
                g.attr('transform', event.transform);
            });
        svg.call(zoom);

        // Links
        linkGroup = g.append('g').attr('class', 'links');
        nodeGroup = g.append('g').attr('class', 'nodes');

        // Tooltip
        tooltip = d3.select(container)
            .append('div')
            .style('position', 'absolute')
            .style('background', '#161b22')
            .style('border', '1px solid #30363d')
            .style('border-radius', '6px')
            .style('padding', '10px 14px')
            .style('font-size', '0.8rem')
            .style('color', '#c9d1d9')
            .style('pointer-events', 'none')
            .style('opacity', 0)
            .style('z-index', 100)
            .style('max-width', '280px')
            .style('box-shadow', '0 4px 12px rgba(0,0,0,0.5)');

        // Detail panel
        detailPanel = document.getElementById('node-detail');

        // Prepare node data with radius
        graphData.nodes.forEach(function (n) {
            var count = connectionCount[n.id] || 0;
            n.radius = CONFIG.nodeRadiusMin + (count / maxConn) * (CONFIG.nodeRadiusMax - CONFIG.nodeRadiusMin);
            n.color = colorMap[n.category] || '#95A5A6';
        });

        // Deep-copy edges for D3 (it mutates source/target to objects)
        var links = graphData.edges.map(function (e) {
            return Object.assign({}, e);
        });

        // Filter self-loops for display
        links = links.filter(function (l) { return l.source !== l.target; });

        // Link width scale
        var weightToWidth = d3.scaleLinear()
            .domain([1, 5])
            .range(CONFIG.linkWidthScale);

        // Simulation
        simulation = d3.forceSimulation(graphData.nodes)
            .force('link', d3.forceLink(links).id(function (d) { return d.id; }).distance(CONFIG.linkDistance))
            .force('charge', d3.forceManyBody().strength(CONFIG.chargeStrength))
            .force('center', d3.forceCenter(width / 2, height / 2))
            .force('collide', d3.forceCollide().radius(function (d) { return d.radius + 5; }))
            .on('tick', ticked);

        // Draw links
        var link = linkGroup.selectAll('line')
            .data(links)
            .join('line')
            .attr('stroke', function (d) {
                var style = EDGE_STYLES[d.type] || {};
                return style.colorOverride || '#30363d';
            })
            .attr('stroke-width', function (d) { return weightToWidth(d.weight || 1); })
            .attr('stroke-dasharray', function (d) {
                var style = EDGE_STYLES[d.type] || {};
                return style.dasharray || null;
            })
            .attr('marker-end', function (d) {
                var style = EDGE_STYLES[d.type] || {};
                if (!style.markerEnd) return null;
                return style.colorOverride === '#f85149' ? 'url(#arrow-red)' : 'url(#arrow)';
            })
            .attr('opacity', 0.6)
            .on('mouseover', function (event, d) {
                var style = EDGE_STYLES[d.type] || { label: d.type };
                var sourceNode = typeof d.source === 'object' ? d.source : graphData.nodes.find(function (n) { return n.id === d.source; });
                var targetNode = typeof d.target === 'object' ? d.target : graphData.nodes.find(function (n) { return n.id === d.target; });

                tooltip.html(
                    '<strong>' + (sourceNode ? sourceNode.label : d.source) + ' &rarr; ' + (targetNode ? targetNode.label : d.target) + '</strong><br>' +
                    '<span style="color:#8b949e;">' + style.label + ' (weight ' + d.weight + '/5)</span><br>' +
                    '<span style="font-size:0.75rem;">' + d.label + '</span>'
                )
                .style('opacity', 1);
                d3.select(this).attr('opacity', 1).attr('stroke-width', weightToWidth(d.weight || 1) + 2);
            })
            .on('mousemove', function (event) {
                var containerRect = container.getBoundingClientRect();
                tooltip
                    .style('left', (event.clientX - containerRect.left + 12) + 'px')
                    .style('top', (event.clientY - containerRect.top - 10) + 'px');
            })
            .on('mouseout', function (event, d) {
                tooltip.style('opacity', 0);
                d3.select(this).attr('opacity', 0.6).attr('stroke-width', weightToWidth(d.weight || 1));
            });

        // Draw nodes
        var node = nodeGroup.selectAll('g')
            .data(graphData.nodes)
            .join('g')
            .call(d3.drag()
                .on('start', dragstarted)
                .on('drag', dragged)
                .on('end', dragended)
            )
            .on('click', function (event, d) {
                showDetail(d);
            })
            .style('cursor', 'pointer');

        node.append('circle')
            .attr('r', function (d) { return d.radius; })
            .attr('fill', function (d) { return d.color; })
            .attr('fill-opacity', 0.2)
            .attr('stroke', function (d) { return d.color; })
            .attr('stroke-width', 2);

        node.append('text')
            .text(function (d) { return d.label; })
            .attr('text-anchor', 'middle')
            .attr('dy', '0.35em')
            .attr('fill', '#c9d1d9')
            .attr('font-size', '10px')
            .attr('font-weight', 500)
            .attr('pointer-events', 'none');

        function ticked() {
            link
                .attr('x1', function (d) { return d.source.x; })
                .attr('y1', function (d) { return d.source.y; })
                .attr('x2', function (d) { return d.target.x; })
                .attr('y2', function (d) { return d.target.y; });

            node
                .attr('transform', function (d) { return 'translate(' + d.x + ',' + d.y + ')'; });
        }

        function dragstarted(event, d) {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
        }

        function dragged(event, d) {
            d.fx = event.x;
            d.fy = event.y;
        }

        function dragended(event, d) {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
        }

        // Build filter controls
        buildFilters(container);

        // Build legend
        buildLegend(container);
    }

    function showDetail(d) {
        if (!detailPanel) return;

        // Find connected edges
        var connections = graphData.edges.filter(function (e) {
            var src = typeof e.source === 'object' ? e.source.id : e.source;
            var tgt = typeof e.target === 'object' ? e.target.id : e.target;
            return src === d.id || tgt === d.id;
        });

        var connHtml = connections.map(function (e) {
            var src = typeof e.source === 'object' ? e.source : graphData.nodes.find(function (n) { return n.id === e.source; });
            var tgt = typeof e.target === 'object' ? e.target : graphData.nodes.find(function (n) { return n.id === e.target; });
            var style = EDGE_STYLES[e.type] || { label: e.type };
            var srcLabel = src ? src.label || src.id : e.source;
            var tgtLabel = tgt ? tgt.label || tgt.id : e.target;
            return '<li>' + srcLabel + ' &rarr; ' + tgtLabel + ' <span style="color:#8b949e;">(' + style.label + ', ' + e.weight + '/5)</span></li>';
        }).join('');

        var indicatorHtml = (d.indicators || []).map(function (ind) {
            return '<span style="background:#21262d; padding:2px 8px; border-radius:10px; font-size:0.75rem; margin:2px; display:inline-block;">' + ind + '</span>';
        }).join(' ');

        detailPanel.innerHTML =
            '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">' +
            '  <h3 style="margin:0; color:' + d.color + ';">' + d.id + ' ' + d.fullLabel + '</h3>' +
            '  <button onclick="document.getElementById(\'node-detail\').style.display=\'none\'" style="background:none;border:none;color:#8b949e;cursor:pointer;font-size:1.2rem;">&times;</button>' +
            '</div>' +
            '<p style="color:#8b949e; margin-bottom:12px;">' + d.description + '</p>' +
            '<div style="margin-bottom:12px;"><strong style="font-size:0.85rem;">Indicators:</strong><br>' + indicatorHtml + '</div>' +
            (d.analogues ? '<p style="font-size:0.85rem; color:#8b949e;"><strong>Historical:</strong> ' + d.analogues + '</p>' : '') +
            '<div style="margin-top:12px;"><strong style="font-size:0.85rem;">Connections (' + connections.length + '):</strong><ul style="list-style:none; padding:0; margin:8px 0 0 0; font-size:0.85rem;">' + connHtml + '</ul></div>';

        detailPanel.style.display = 'block';
    }

    function buildFilters(container) {
        var filterDiv = document.createElement('div');
        filterDiv.style.cssText = 'display:flex; flex-wrap:wrap; gap:8px; margin-bottom:12px;';

        graphData.categories.forEach(function (cat) {
            var label = document.createElement('label');
            label.style.cssText = 'display:flex; align-items:center; gap:4px; cursor:pointer; font-size:0.8rem; color:#8b949e; padding:4px 8px; border-radius:4px; border:1px solid #30363d; background:#161b22;';

            var checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = true;
            checkbox.style.margin = '0';
            checkbox.addEventListener('change', function () {
                if (this.checked) {
                    activeCategories.add(cat.id);
                } else {
                    activeCategories.delete(cat.id);
                }
                applyFilter();
            });

            var dot = document.createElement('span');
            dot.style.cssText = 'width:8px; height:8px; border-radius:50%; background:' + cat.color + '; display:inline-block;';

            label.appendChild(checkbox);
            label.appendChild(dot);
            label.appendChild(document.createTextNode(' ' + cat.label));
            filterDiv.appendChild(label);
        });

        // Insert before the SVG
        container.insertBefore(filterDiv, container.querySelector('svg'));
    }

    function applyFilter() {
        nodeGroup.selectAll('g')
            .style('opacity', function (d) {
                return activeCategories.has(d.category) ? 1 : 0.08;
            })
            .style('pointer-events', function (d) {
                return activeCategories.has(d.category) ? 'all' : 'none';
            });

        linkGroup.selectAll('line')
            .style('opacity', function (d) {
                var srcCat = typeof d.source === 'object' ? d.source.category : null;
                var tgtCat = typeof d.target === 'object' ? d.target.category : null;
                if (srcCat && tgtCat) {
                    return (activeCategories.has(srcCat) && activeCategories.has(tgtCat)) ? 0.6 : 0.03;
                }
                return 0.6;
            });
    }

    function buildLegend(container) {
        var legend = document.createElement('div');
        legend.style.cssText = 'display:flex; flex-wrap:wrap; gap:16px; margin-top:8px; font-size:0.75rem; color:#8b949e;';

        var types = [
            { key: 'CA', symbol: '&rarr;', color: '#30363d' },
            { key: 'AM', symbol: '&rArr;', color: '#f85149' },
            { key: 'DA', symbol: '&#8674;', color: '#58a6ff' },
            { key: 'FB', symbol: '&#8634;', color: '#30363d' },
        ];

        types.forEach(function (t) {
            var style = EDGE_STYLES[t.key] || {};
            var span = document.createElement('span');
            span.innerHTML = '<span style="color:' + t.color + ';">' + t.symbol + '</span> ' + style.label;
            legend.appendChild(span);
        });

        container.appendChild(legend);
    }

    document.addEventListener('DOMContentLoaded', init);
})();
