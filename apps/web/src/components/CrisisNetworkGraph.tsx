import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';

interface NetworkNode {
  id: string;
  name: string;
  category: string;
  priority: string;
  value: number;
  stress_level: string;
  color: string;
}

interface NetworkLink {
  source: string | NetworkNode;
  target: string | NetworkNode;
  value: number;
  type: string;
}

interface NetworkData {
  nodes: NetworkNode[];
  links: NetworkLink[];
}

interface CrisisNetworkGraphProps {
  data: NetworkData;
  width?: number;
  height?: number;
  onNodeClick?: (node: NetworkNode) => void;
}

const categoryColors: Record<string, string> = {
  'Economic-Financial': '#ff3864',
  'Climate-Environmental': '#00d4aa',
  'Geopolitical-Conflict': '#ff9f1c',
  'Technological': '#3b82f6',
  'Biological-Health': '#a855f7',
  'Cross-Cutting': '#6b7280'
};

export default function CrisisNetworkGraph({
  data,
  width = 800,
  height = 600,
  onNodeClick
}: CrisisNetworkGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<d3.Selection<SVGSVGElement, unknown, null, undefined> | null>(null);
  const [selectedNode, setSelectedNode] = useState<NetworkNode | null>(null);
  const [labelsVisible, setLabelsVisible] = useState(true);

  useEffect(() => {
    if (!containerRef.current) return;

    // Clear previous
    containerRef.current.innerHTML = '';

    // Create SVG
    const svg = d3.select(containerRef.current)
      .append('svg')
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', [0, 0, width, height]);

    svgRef.current = svg;

    // Add zoom behavior
    const g = svg.append('g');

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    svg.call(zoom);

    // Process links - ensure source/target are objects
    const processedLinks: NetworkLink[] = data.links.map(l => ({
      ...l,
      source: typeof l.source === 'string' ? l.source : l.source.id,
      target: typeof l.target === 'string' ? l.target : l.target.id
    }));

    // Force simulation
    const simulation = d3.forceSimulation<NetworkNode>(data.nodes)
      .force('link', d3.forceLink<NetworkNode, NetworkLink>(processedLinks)
        .id(d => d.id)
        .distance(d => 100 + (1 - d.value) * 100))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(d => 20 + d.value * 20));

    // Create links
    const link = g.append('g')
      .attr('class', 'links')
      .selectAll('line')
      .data(processedLinks)
      .enter().append('line')
      .attr('stroke', d => d.type === 'intra_system' ? '#ff6b6b' : '#4ecdc4')
      .attr('stroke-width', d => Math.sqrt(d.value) * 3)
      .attr('stroke-opacity', 0.6)
      .attr('stroke-dasharray', d => d.type === 'intra_system' ? null : '5,3');

    // Create nodes
    const node = g.append('g')
      .attr('class', 'nodes')
      .selectAll('g')
      .data(data.nodes)
      .enter().append('g')
      .attr('cursor', 'pointer')
      .call(d3.drag<SVGGElement, NetworkNode>()
        .on('start', (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on('drag', (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on('end', (event, d) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        }));

    // Node circles
    node.append('circle')
      .attr('r', d => 8 + d.value * 12)
      .attr('fill', d => categoryColors[d.category] || '#666')
      .attr('stroke', d => {
        if (d.stress_level === 'critical') return '#ff3864';
        if (d.stress_level === 'approaching') return '#ff6b35';
        return '#fff';
      })
      .attr('stroke-width', d => d.stress_level === 'critical' ? 3 : 1.5);

    // Node labels
    const labels = node.append('text')
      .attr('dx', d => 12 + d.value * 5)
      .attr('dy', '.35em')
      .text(d => d.name)
      .attr('fill', '#f0f0f5')
      .attr('font-size', '11px')
      .attr('pointer-events', 'none')
      .style('opacity', d => d.value > 0.5 ? 1 : 0.7)
      .style('text-shadow', '0 1px 3px rgba(0,0,0,0.8)');

    // Tooltip div
    const tooltip = d3.select(containerRef.current)
      .append('div')
      .attr('class', 'tooltip')
      .style('position', 'absolute')
      .style('padding', '12px')
      .style('background', 'rgba(0,0,0,0.9)')
      .style('color', 'white')
      .style('border-radius', '8px')
      .style('border', '1px solid rgba(255,255,255,0.1)')
      .style('font-size', '13px')
      .style('pointer-events', 'none')
      .style('opacity', 0)
      .style('transition', 'opacity 0.2s')
      .style('max-width', '250px');

    // Node interactions
    node.on('mouseover', function(event, d) {
      d3.select(this).select('circle')
        .transition()
        .duration(200)
        .attr('r', (d.value * 12 + 8) * 1.3);

      tooltip.html(`
        <strong>${d.name}</strong><br/>
        Category: ${d.category}<br/>
        Stress: ${d.stress_level}<br/>
        Signal: ${d.value.toFixed(2)}<br/>
        Priority: ${d.priority}
      `)
      .style('left', (event.pageX - containerRef.current!.getBoundingClientRect().left + 10) + 'px')
      .style('top', (event.pageY - containerRef.current!.getBoundingClientRect().top - 10) + 'px')
      .style('opacity', 1);
    })
    .on('mouseout', function(event, d) {
      d3.select(this).select('circle')
        .transition()
        .duration(200)
        .attr('r', d.value * 12 + 8);

      tooltip.style('opacity', 0);
    })
    .on('click', function(event, d) {
      setSelectedNode(d);
      if (onNodeClick) onNodeClick(d);

      // Highlight connected nodes
      const connected = new Set<string>();
      connected.add(d.id);

      processedLinks.forEach(l => {
        const sourceId = typeof l.source === 'string' ? l.source : l.source.id;
        const targetId = typeof l.target === 'string' ? l.target : l.target.id;
        if (sourceId === d.id) connected.add(targetId);
        if (targetId === d.id) connected.add(sourceId);
      });

      node.style('opacity', n => connected.has(n.id) ? 1 : 0.2);
      link.style('opacity', l => {
        const sourceId = typeof l.source === 'string' ? l.source : l.source.id;
        const targetId = typeof l.target === 'string' ? l.target : l.target.id;
        return (sourceId === d.id || targetId === d.id) ? 1 : 0.05;
      });
    });

    // Double-click to reset
    svg.on('dblclick', () => {
      setSelectedNode(null);
      node.style('opacity', 1);
      link.style('opacity', 0.6);
    });

    // Update positions on tick
    simulation.on('tick', () => {
      link
        .attr('x1', d => (d.source as NetworkNode).x ?? 0)
        .attr('y1', d => (d.source as NetworkNode).y ?? 0)
        .attr('x2', d => (d.target as NetworkNode).x ?? 0)
        .attr('y2', d => (d.target as NetworkNode).y ?? 0);

      node
        .attr('transform', d => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });

    // Expose toggle function
    (window as any).toggleNetworkLabels = () => {
      setLabelsVisible(prev => {
        const newVal = !prev;
        labels.transition().duration(300).style('opacity', newVal ? 1 : 0);
        return newVal;
      });
    };

    return () => {
      simulation.stop();
    };
  }, [data, width, height, onNodeClick]);

  return (
    <div className="relative" style={{ width, height }} ref={containerRef}>
      {/* Controls */}
      <div className="absolute bottom-4 left-4 flex gap-2">
        <button
          onClick={() => {
            if (!svgRef.current) return;
            svgRef.current.transition().duration(750).call(
              d3.zoom().transform,
              d3.zoomIdentity
            );
          }}
          className="px-3 py-2 bg-surface/80 backdrop-blur border border-surface rounded-lg text-xs text-text-secondary hover:bg-surface transition-colors"
        >
          ⟲ Reset View
        </button>
        <button
          onClick={() => setLabelsVisible(!labelsVisible)}
          className="px-3 py-2 bg-surface/80 backdrop-blur border border-surface rounded-lg text-xs text-text-secondary hover:bg-surface transition-colors"
        >
          🏷️ {labelsVisible ? 'Hide' : 'Show'} Labels
        </button>
      </div>

      {/* Selected node info */}
      {selectedNode && (
        <div className="absolute top-4 right-4 bg-surface/90 backdrop-blur border border-surface rounded-lg p-4 max-w-xs">
          <h3 className="text-sm font-semibold mb-2">{selectedNode.name}</h3>
          <div className="text-xs text-text-secondary space-y-1">
            <div>Category: {selectedNode.category}</div>
            <div>Stress: <span className={`
              ${selectedNode.stress_level === 'critical' ? 'text-red-500' : ''}
              ${selectedNode.stress_level === 'approaching' ? 'text-amber-500' : ''}
              ${selectedNode.stress_level === 'stable' ? 'text-cyan-500' : ''}
            `}>{selectedNode.stress_level}</span></div>
            <div>Signal: {selectedNode.value.toFixed(2)}</div>
            <div>Priority: {selectedNode.priority}</div>
          </div>
          <p className="text-xs text-text-muted mt-3">Double-click to reset view</p>
        </div>
      )}

      {/* Legend */}
      <div className="absolute top-4 left-4 bg-surface/80 backdrop-blur border border-surface rounded-lg p-3">
        <h4 className="text-xs font-semibold mb-2 text-text-secondary">Categories</h4>
        {Object.entries(categoryColors).slice(0, 4).map(([cat, color]) => (
          <div key={cat} className="flex items-center gap-2 mb-1">
            <div className="w-3 h-3 rounded-full" style={{ background: color }} />
            <span className="text-xs text-text-muted">{cat.split('-')[0]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
