import { useEffect, useRef, useState, useCallback } from 'react';
import * as d3 from 'd3';

interface NetworkNode {
  id: string;
  name: string;
  category: string;
  priority: string;
  value: number;
  stress_level: string;
  color: string;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
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

interface FlashPoint {
  nodes: [string, string];
  correlation: number;
  description: string;
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
  const [flashPoints, setFlashPoints] = useState<FlashPoint[]>([]);
  const [hoveredFlashPoint, setHoveredFlashPoint] = useState<FlashPoint | null>(null);

  // Detect flash points - high correlations between stressed themes
  const detectFlashPoints = useCallback((nodes: NetworkNode[], links: NetworkLink[]): FlashPoint[] => {
    const stressedNodes = nodes.filter(n => 
      n.stress_level === 'critical' || n.stress_level === 'approaching' || n.value > 0.6
    );
    
    const points: FlashPoint[] = [];
    
    links.forEach(link => {
      const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
      const targetId = typeof link.target === 'string' ? link.target : link.target.id;
      
      const sourceNode = nodes.find(n => n.id === sourceId);
      const targetNode = nodes.find(n => n.id === targetId);
      
      if (sourceNode && targetNode && link.value > 0.75) {
        // High correlation
        const isStressed = stressedNodes.includes(sourceNode) || stressedNodes.includes(targetNode);
        const isCrossDomain = sourceNode.category !== targetNode.category;
        
        if (isStressed || isCrossDomain) {
          points.push({
            nodes: [sourceNode.name, targetNode.name],
            correlation: link.value,
            description: isCrossDomain 
              ? `${sourceNode.category.split('-')[0]} + ${targetNode.category.split('-')[0]} interaction`
              : `${sourceNode.category.split('-')[0]} systemic stress`
          });
        }
      }
    });
    
    return points.sort((a, b) => b.correlation - a.correlation).slice(0, 3);
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    // Clear previous
    containerRef.current.innerHTML = '';

    // Detect flash points
    const points = detectFlashPoints(data.nodes, data.links);
    setFlashPoints(points);

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

    // Process links
    const processedLinks: NetworkLink[] = data.links.map(l => ({
      ...l,
      source: typeof l.source === 'string' ? l.source : l.source.id,
      target: typeof l.target === 'string' ? l.target : l.target.id
    }));

    // Force simulation
    const simulation = d3.forceSimulation<NetworkNode>(data.nodes)
      .force('link', d3.forceLink<NetworkNode, NetworkLink>(processedLinks)
        .id(d => d.id)
        .distance(d => 80 + (1 - d.value) * 100))
      .force('charge', d3.forceManyBody().strength(-400))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(d => 25 + d.value * 20));

    // Create links with gradient for high correlations
    const linkGroup = g.append('g').attr('class', 'links');
    
    processedLinks.forEach((link, i) => {
      const isHighCorrelation = link.value > 0.75;
      const isCrossDomain = link.type !== 'intra_system';
      
      linkGroup.append('line')
        .attr('class', `link-${i}`)
        .attr('stroke', isHighCorrelation ? '#ff3864' : isCrossDomain ? '#4ecdc4' : '#6b7280')
        .attr('stroke-width', Math.sqrt(link.value) * (isHighCorrelation ? 5 : 3))
        .attr('stroke-opacity', isHighCorrelation ? 0.8 : 0.4)
        .attr('stroke-dasharray', isCrossDomain ? '5,3' : null)
        .attr('stroke-linecap', 'round');
    });

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

    // Node circles with stress indicator ring
    node.append('circle')
      .attr('r', d => 6 + d.value * 12)
      .attr('fill', d => categoryColors[d.category] || '#666')
      .attr('stroke', d => {
        if (d.stress_level === 'critical') return '#ff3864';
        if (d.stress_level === 'approaching') return '#ff6b35';
        return '#1a1a2e';
      })
      .attr('stroke-width', d => d.stress_level === 'critical' ? 4 : d.stress_level === 'approaching' ? 3 : 2);

    // Pulse animation for high-stress nodes
    node.filter(d => d.stress_level === 'critical' || d.stress_level === 'approaching')
      .append('circle')
      .attr('r', d => 6 + d.value * 12)
      .attr('fill', 'none')
      .attr('stroke', d => d.stress_level === 'critical' ? '#ff3864' : '#ff6b35')
      .attr('stroke-width', 2)
      .attr('opacity', 0.6)
      .append('animate')
      .attr('attributeName', 'r')
      .attr('from', d => 6 + d.value * 12)
      .attr('to', d => 6 + d.value * 12 + 10)
      .attr('dur', '1.5s')
      .attr('repeatCount', 'indefinite');

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

    // Node interactions
    node.on('mouseover', function(event, d) {
      d3.select(this).select('circle:first-child')
        .transition()
        .duration(200)
        .attr('r', (d.value * 12 + 6) * 1.3);
    })
    .on('mouseout', function(event, d) {
      d3.select(this).select('circle:first-child')
        .transition()
        .duration(200)
        .attr('r', d.value * 12 + 6);
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
      linkGroup.selectAll('line').style('opacity', (l: any) => {
        const sourceId = typeof l.source === 'string' ? l.source : l.source.id;
        const targetId = typeof l.target === 'string' ? l.target : l.target.id;
        return (sourceId === d.id || targetId === d.id) ? 1 : 0.05;
      });
    });

    // Double-click to reset
    svg.on('dblclick', () => {
      setSelectedNode(null);
      node.style('opacity', 1);
      linkGroup.selectAll('line').style('opacity', (d: any) => d.value > 0.75 ? 0.8 : 0.4);
    });

    // Update positions on tick
    simulation.on('tick', () => {
      linkGroup.selectAll('line')
        .attr('x1', (d: any) => (d.source as NetworkNode).x ?? 0)
        .attr('y1', (d: any) => (d.source as NetworkNode).y ?? 0)
        .attr('x2', (d: any) => (d.target as NetworkNode).x ?? 0)
        .attr('y2', (d: any) => (d.target as NetworkNode).y ?? 0);

      node.attr('transform', d => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });

    return () => {
      simulation.stop();
    };
  }, [data, width, height, onNodeClick, detectFlashPoints]);

  return (
    <div className="relative" style={{ width, height }} ref={containerRef}>
      {/* Flash Points Panel */}
      {flashPoints.length > 0 && (
        <div className="absolute top-4 right-4 space-y-2 z-10">
          {flashPoints.map((point, idx) => (
            <div
              key={idx}
              className={`bg-gradient-to-r from-red-600/80 to-orange-600/80 backdrop-blur rounded-lg p-3 text-white cursor-pointer transition-all ${
                hoveredFlashPoint === point ? 'scale-105 shadow-lg' : ''
              }`}
              onMouseEnter={() => setHoveredFlashPoint(point)}
              onMouseLeave={() => setHoveredFlashPoint(null)}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg">⚡</span>
                <span className="text-xs font-semibold uppercase tracking-wide">Flash Point</span>
              </div>
              <div className="text-sm font-medium">{point.nodes.join(' + ')}</div>
              <div className="text-xs opacity-90 mt-1">{point.description}</div>
              <div className="text-xs font-mono mt-1">Correlation: {(point.correlation * 100).toFixed(0)}%</div>
            </div>
          ))}
        </div>
      )}

      {/* Controls */}
      <div className="absolute bottom-4 left-4 flex gap-2 z-10">
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
          onClick={() => {
            setLabelsVisible(!labelsVisible);
            if (svgRef.current) {
              svgRef.current.selectAll('.nodes text')
                .transition()
                .duration(300)
                .style('opacity', labelsVisible ? 0 : (d: any) => d.value > 0.5 ? 1 : 0.7);
            }
          }}
          className="px-3 py-2 bg-surface/80 backdrop-blur border border-surface rounded-lg text-xs text-text-secondary hover:bg-surface transition-colors"
        >
          🏷️ {labelsVisible ? 'Hide' : 'Show'} Labels
        </button>
        <button
          onClick={() => {
            if (!svgRef.current) return;
            // Filter to show only high-stress nodes
            svgRef.current.selectAll('.nodes g')
              .style('opacity', (d: any) => 
                d.stress_level === 'critical' || d.stress_level === 'approaching' ? 1 : 0.1
              );
          }}
          className="px-3 py-2 bg-surface/80 backdrop-blur border border-surface rounded-lg text-xs text-text-secondary hover:bg-surface transition-colors"
        >
          🚨 High Stress
        </button>
      </div>

      {/* Selected node info */}
      {selectedNode && (
        <div className="absolute top-4 left-4 bg-surface/90 backdrop-blur border border-surface rounded-lg p-4 max-w-xs z-10">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold">{selectedNode.name}</h3>
            <button 
              onClick={() => setSelectedNode(null)}
              className="text-text-muted hover:text-text-primary"
            >
              ×
            </button>
          </div>
          <div className="text-xs text-text-secondary space-y-1">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full" style={{ background: selectedNode.color }}></span>
              <span>{selectedNode.category}</span>
            </div>
            <div>
              Stress: <span className={`
                ${selectedNode.stress_level === 'critical' ? 'text-red-500' : ''}
                ${selectedNode.stress_level === 'approaching' ? 'text-amber-500' : ''}
                ${selectedNode.stress_level === 'stable' ? 'text-cyan-500' : ''}
              `}>{selectedNode.stress_level}</span>
            </div>
            <div>Signal: {(selectedNode.value * 100).toFixed(1)}%</div>
            <div>Priority: {selectedNode.priority}</div>
          </div>
          <p className="text-xs text-text-muted mt-3">Double-click background to reset view</p>
        </div>
      )}

      {/* Legend */}
      <div className="absolute bottom-4 right-4 bg-surface/80 backdrop-blur border border-surface rounded-lg p-3 z-10">
        <h4 className="text-xs font-semibold mb-2 text-text-secondary">Categories</h4>
        {Object.entries(categoryColors).slice(0, 4).map(([cat, color]) => (
          <div key={cat} className="flex items-center gap-2 mb-1">
            <div className="w-3 h-3 rounded-full" style={{ background: color }} />
            <span className="text-xs text-text-muted">{cat.split('-')[0]}</span>
          </div>
        ))}
        <div className="mt-3 pt-2 border-t border-surface">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-4 h-0.5 bg-red-500"></div>
            <span className="text-xs text-text-muted">High correlation</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-0.5 bg-gray-500 border-dashed" style={{ borderTop: '1px dashed #6b7280' }}></div>
            <span className="text-xs text-text-muted">Cross-domain</span>
          </div>
        </div>
      </div>
    </div>
  );
}
