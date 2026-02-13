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
  pinned?: boolean;
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
  const svgRef = useRef<SVGSVGElement | null>(null);
  const simulationRef = useRef<d3.Simulation<NetworkNode, NetworkLink> | null>(null);
  const gRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const rotationDegRef = useRef<number>(0);
  const [selectedNode, setSelectedNode] = useState<NetworkNode | null>(null);
  const [hoveredNode, setHoveredNode] = useState<NetworkNode | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [labelsVisible, setLabelsVisible] = useState(true);
  const [flashPoints, setFlashPoints] = useState<FlashPoint[]>([]);
  const [hoveredFlashPoint, setHoveredFlashPoint] = useState<FlashPoint | null>(null);
  const [clustered, setClustered] = useState(true);  // Default to clustered view

  // Detect flash points
  const detectFlashPoints = useCallback((nodes: NetworkNode[], links: NetworkLink[]): FlashPoint[] => {
    const points: FlashPoint[] = [];
    
    links.forEach(link => {
      if (link.value > 0.75) {
        const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
        const targetId = typeof link.target === 'string' ? link.target : link.target.id;
        const sourceNode = nodes.find(n => n.id === sourceId);
        const targetNode = nodes.find(n => n.id === targetId);
        
        if (sourceNode && targetNode && 
            (sourceNode.stress_level === 'critical' || sourceNode.stress_level === 'approaching' || sourceNode.value > 0.6)) {
          points.push({
            nodes: [sourceNode.name, targetNode.name],
            correlation: link.value,
            description: `High correlation (${link.value.toFixed(2)}) between stressed themes`
          });
        }
      }
    });
    
    return points;
  }, []);

  // Cleanup function
  const cleanup = useCallback(() => {
    if (simulationRef.current) {
      simulationRef.current.stop();
      simulationRef.current = null;
    }
    if (svgRef.current && containerRef.current) {
      containerRef.current.innerHTML = '';
      svgRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!containerRef.current || data.nodes.length === 0) return;

    // Clean up previous render
    cleanup();

    // Detect flash points
    setFlashPoints(detectFlashPoints(data.nodes, data.links));

    // Create SVG
    const svg = d3.select(containerRef.current)
      .append('svg')
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', [0, 0, width, height])
      .style('max-width', '100%')
      .style('height', 'auto');

    svgRef.current = svg.node();

    // Add zoom behavior
    const g = svg.append('g');
    gRef.current = g;

    const applyTransform = (t: d3.ZoomTransform) => {
      const angle = rotationDegRef.current;
      const cx = width / 2;
      const cy = height / 2;
      const base = t.toString();
      g.attr('transform', angle ? `rotate(${angle},${cx},${cy}) ${base}` : base);
      
      // Counter-rotate labels so they stay upright relative to screen
      if (angle) {
        g.selectAll('.node-label')
          .attr('transform', d => {
            const nodeAngle = -angle;
            // Rotate around the node's current position (relative to the rotated group)
            return `rotate(${nodeAngle})`;
          });
      } else {
        g.selectAll('.node-label').attr('transform', null);
      }
    };
    
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3])
      .on('zoom', (event) => {
        applyTransform(event.transform);
        const k = event.transform.k;
        // Fade labels when zoomed out, grow when zoomed in
        g.selectAll('.nodes text')
          .style('opacity', labelsVisible ? (k < 0.8 ? 0 : k < 1.2 ? 0.35 : 1) : 0)
          .attr('font-size', `${Math.min(14, 11 * k)}px`);
      });

    zoomRef.current = zoom;
    svg.call(zoom);

    // Add arrowhead marker
    const defs = svg.append('defs');
    defs.append('marker')
      .attr('id', 'arrow')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 25)  // Push arrowhead back so it's not hidden by nodes
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#6b7280');

    // Process links - ensure string IDs
    const processedLinks: NetworkLink[] = data.links.map(l => ({
      ...l,
      source: typeof l.source === 'string' ? l.source : l.source.id,
      target: typeof l.target === 'string' ? l.target : l.target.id
    }));

    // Build adjacency map for hover highlighting
    const neighbors = new Map<string, Set<string>>();
    for (const n of data.nodes) neighbors.set(n.id, new Set([n.id]));
    for (const l of processedLinks) {
      const s = typeof l.source === 'string' ? l.source : l.source.id;
      const t = typeof l.target === 'string' ? l.target : l.target.id;
      neighbors.get(s)?.add(t);
      neighbors.get(t)?.add(s);
    }

    // Create simulation
    const simulation = d3.forceSimulation<NetworkNode>(data.nodes)
      .force('link', d3.forceLink<NetworkNode, NetworkLink>(processedLinks)
        .id(d => d.id)
        .distance(d => 80 + (1 - d.value) * 100))
      .force('charge', d3.forceManyBody().strength(-400))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(d => 25 + d.value * 20));

    simulationRef.current = simulation;

    // Setup clustering scales
    const categories = Array.from(new Set(data.nodes.map(n => n.category)));
    const xScale = d3.scalePoint<string>()
      .domain(categories)
      .range([width * 0.15, width * 0.85]);
    const stressOrder = ['critical', 'approaching', 'watch', 'stable'];
    const yScale = d3.scalePoint<string>()
      .domain(stressOrder)
      .range([height * 0.25, height * 0.75]);

    // Apply clustering forces if enabled
    if (clustered) {
      simulation
        .force('x', d3.forceX<NetworkNode>(d => xScale(d.category) ?? width / 2).strength(0.12))
        .force('y', d3.forceY<NetworkNode>(d => yScale(d.stress_level) ?? height / 2).strength(0.10));
    } else {
      simulation.force('x', null).force('y', null);
    }
    simulation.alpha(0.7).restart();

    // Create links
    const linkGroup = g.append('g').attr('class', 'links');
    
    const links = linkGroup.selectAll('line')
      .data(processedLinks)
      .enter()
      .append('line')
      .attr('stroke', (d: NetworkLink) => {
        const isHighCorrelation = d.value > 0.75;
        const isCrossDomain = d.type !== 'intra_system';
        return isHighCorrelation ? '#ff3864' : isCrossDomain ? '#4ecdc4' : '#6b7280';
      })
      .attr('stroke-width', (d: NetworkLink) => {
        const isHighCorrelation = d.value > 0.75;
        return Math.sqrt(d.value) * (isHighCorrelation ? 5 : 3);
      })
      .attr('stroke-opacity', (d: NetworkLink) => d.value > 0.75 ? 0.8 : 0.4)
      .attr('stroke-dasharray', (d: NetworkLink) => d.type !== 'intra_system' ? '5,3' : null)
      .attr('stroke-linecap', 'round')
      .attr('marker-end', (d: NetworkLink) => d.type !== 'intra_system' ? 'url(#arrow)' : null);

    // Create nodes
    const nodeGroup = g.append('g').attr('class', 'nodes');
    
    const node = nodeGroup.selectAll('g')
      .data(data.nodes)
      .enter()
      .append('g')
      .attr('cursor', 'pointer')
      .call(d3.drag<SVGGElement, NetworkNode>()
        .clickDistance(5)  // Treat small movements as clicks, not drags
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
          if (!d.pinned) {
            d.fx = null;
            d.fy = null;
          }
        }));

    // Node circles
    node.append('circle')
      .attr('r', d => 6 + d.value * 12)
      .attr('fill', d => categoryColors[d.category] || '#666')
      .attr('stroke', d => {
        if (d.stress_level === 'critical') return '#ff3864';
        if (d.stress_level === 'approaching') return '#ff6b35';
        return '#1a1a2e';
      })
      .attr('stroke-width', d => d.stress_level === 'critical' ? 4 : d.stress_level === 'approaching' ? 3 : 2);

    // Labels
    const labels = node.append('text')
      .attr('dx', d => 12 + d.value * 5)
      .attr('dy', '.35em')
      .text(d => d.name)
      .attr('fill', '#f0f0f5')
      .attr('font-size', '11px')
      .attr('pointer-events', 'none')
      .style('opacity', labelsVisible ? (d => d.value > 0.5 ? 1 : 0.7) : 0)
      .style('text-shadow', '0 1px 3px rgba(0,0,0,0.8)')
      .attr('class', 'node-label');

    // Hover effects with tooltip and neighbor highlighting
    node
      .on('mousemove', function (event, d) {
        setHoveredNode(d);
        // Tooltip position in container coordinates
        const [mx, my] = d3.pointer(event, containerRef.current);
        setTooltip({ 
          x: mx + 12, 
          y: my + 12, 
          text: `${d.name}\n${d.category}\nStress: ${d.stress_level}\nScore: ${(d.value * 100).toFixed(1)}` 
        });
        
        // Hover highlight (do not override a selected state)
        if (!selectedNode) {
          const nb = neighbors.get(d.id) ?? new Set([d.id]);
          node.style('opacity', n => (nb.has(n.id) ? 1 : 0.15));
          links.style('opacity', (l: any) => {
            const s = typeof l.source === 'string' ? l.source : l.source?.id;
            const t = typeof l.target === 'string' ? l.target : l.target?.id;
            return (s && t && (s === d.id || t === d.id)) ? 0.9 : 0.05;
          });
        }
        
        // Circle grow effect
        d3.select(this).select('circle')
          .transition().duration(80)
          .attr('r', (d.value * 12 + 6) * 1.25);
      })
      .on('mouseleave', function (event, d) {
        setHoveredNode(null);
        setTooltip(null);
        
        // Restore hover highlight (do not override selected state)
        if (!selectedNode) {
          node.style('opacity', 1);
          links.style('opacity', (l: any) => l.value > 0.75 ? 0.8 : 0.4);
        }
        
        // Restore radius
        d3.select(this).select('circle')
          .transition().duration(120)
          .attr('r', d.value * 12 + 6);
      })
      .on('click', function(event, d) {
        // Shift-click to pin/unpin node
        if (event.shiftKey) {
          d.pinned = !d.pinned;
          if (d.pinned) {
            d.fx = d.x ?? null;
            d.fy = d.y ?? null;
          } else {
            d.fx = null;
            d.fy = null;
          }
          // Visual cue: white stroke when pinned
          d3.select(this).select('circle')
            .attr('stroke', d.pinned ? '#ffffff' : (d.stress_level === 'critical' ? '#ff3864' : d.stress_level === 'approaching' ? '#ff6b35' : '#1a1a2e'))
            .attr('stroke-width', d.pinned ? 4 : (d.stress_level === 'critical' ? 4 : d.stress_level === 'approaching' ? 3 : 2));
          return;
        }
        
        setSelectedNode(d);
        if (onNodeClick) onNodeClick(d);

        const connected = new Set<string>([d.id]);

        processedLinks.forEach(l => {
          const sourceId = typeof l.source === 'string' ? l.source : l.source?.id;
          const targetId = typeof l.target === 'string' ? l.target : l.target?.id;
          if (!sourceId || !targetId) return;
          if (sourceId === d.id) connected.add(targetId);
          if (targetId === d.id) connected.add(sourceId);
        });

        node.style('opacity', n => connected.has(n.id) ? 1 : 0.2);
        links.style('opacity', (l: any) => {
          const sourceId = typeof l.source === 'string' ? l.source : l.source?.id;
          const targetId = typeof l.target === 'string' ? l.target : l.target?.id;
          if (!sourceId || !targetId) return 0.05;
          return (sourceId === d.id || targetId === d.id) ? 1 : 0.05;
        });
      });

    // Reset on double-click
    svg.on('dblclick', () => {
      setSelectedNode(null);
      node.style('opacity', 1);
      links.style('opacity', (d: any) => d.value > 0.75 ? 0.8 : 0.4);
    });

    // Tick function with RAF throttling for smooth performance
    let rafPending = false;
    simulation.on('tick', () => {
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        links
          .attr('x1', (d: any) => (d.source as NetworkNode)?.x ?? 0)
          .attr('y1', (d: any) => (d.source as NetworkNode)?.y ?? 0)
          .attr('x2', (d: any) => (d.target as NetworkNode)?.x ?? 0)
          .attr('y2', (d: any) => (d.target as NetworkNode)?.y ?? 0);
        node.attr('transform', d => `translate(${d.x ?? 0},${d.y ?? 0})`);
      });
    });

    return cleanup;
  }, [data, width, height, onNodeClick, detectFlashPoints, cleanup, clustered]);

  // Toggle labels visibility
  useEffect(() => {
    if (!gRef.current) return;
    gRef.current.selectAll('text').style('opacity', labelsVisible ? 1 : 0);
  }, [labelsVisible]);

  // Reset zoom function
  const resetZoom = () => {
    if (!svgRef.current || !zoomRef.current) return;
    const svg = d3.select(svgRef.current);
    rotationDegRef.current = 0;
    svg.transition().duration(750).call(zoomRef.current.transform, d3.zoomIdentity);
    setSelectedNode(null);
    // Reset node and link opacity
    if (gRef.current) {
      gRef.current.selectAll('.nodes g').style('opacity', 1);
      gRef.current.selectAll('.links line').style('opacity', (d: any) => d.value > 0.75 ? 0.8 : 0.4);
    }
  };

  // Keyboard navigation (arrow keys to pan)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!svgRef.current || !zoomRef.current) return;
      const svg = d3.select(svgRef.current);
      const currentTransform = d3.zoomTransform(svgRef.current);
      
      let dx = 0, dy = 0;
      const step = 50 / currentTransform.k;
      
      switch (e.key) {
        case 'ArrowUp': dy = step; break;
        case 'ArrowDown': dy = -step; break;
        case 'ArrowLeft': dx = step; break;
        case 'ArrowRight': dx = -step; break;
        case 'Home': 
          e.preventDefault();
          resetZoom(); 
          return;
        case 'Escape':
          e.preventDefault();
          setSelectedNode(null);
          if (gRef.current) {
            gRef.current.selectAll('.nodes g').style('opacity', 1);
            gRef.current.selectAll('.links line').style('opacity', (d: any) => d.value > 0.75 ? 0.8 : 0.4);
          }
          return;
        case 'r':
        case 'R': {
          e.preventDefault();
          rotationDegRef.current = (rotationDegRef.current + 45) % 360;
          if (gRef.current) {
            const angle = rotationDegRef.current;
            const cx = width / 2;
            const cy = height / 2;
            const base = currentTransform.toString();
            gRef.current
              .transition()
              .duration(500)
              .attr('transform', `rotate(${angle},${cx},${cy}) ${base}`);
            
            // Counter-rotate labels to stay upright
            if (angle) {
              gRef.current.selectAll('.node-label')
                .transition()
                .duration(500)
                .attr('transform', `rotate(${-angle})`);
            } else {
              gRef.current.selectAll('.node-label')
                .transition()
                .duration(500)
                .attr('transform', null);
            }
          }
          return;
        }
        case 'c': 
        case 'C':
          e.preventDefault();
          if (selectedNode && selectedNode.x && selectedNode.y) {
            centerOnNode(selectedNode);
          }
          return;
        default: return;
      }
      
      // Only arrow keys reach here
      e.preventDefault();
      const newTransform = currentTransform.translate(dx, dy);
      svg.transition().duration(150).call(zoomRef.current.transform, newTransform);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedNode]);

  // Center on specific node
  const centerOnNode = (node: NetworkNode) => {
    if (!svgRef.current || !zoomRef.current || !node.x || !node.y) return;
    const svg = d3.select(svgRef.current);
    const scale = 1.5;
    const x = -node.x * scale + width / 2;
    const y = -node.y * scale + height / 2;
    
    svg.transition().duration(750).call(
      zoomRef.current.transform,
      d3.zoomIdentity.translate(x, y).scale(scale)
    );
  };

  // Export SVG with branding and black background
  const exportSvg = () => {
    if (!svgRef.current || !gRef.current) return;
    
    // Add black background before export
    const background = gRef.current.insert('rect', ':first-child')
      .attr('class', 'export-bg')
      .attr('x', -width)
      .attr('y', -height)
      .attr('width', width * 3)
      .attr('height', height * 3)
      .attr('fill', '#0a0a0f');
    
    // Add branding watermark before export
    const branding = gRef.current.append('g').attr('class', 'export-branding');
    branding.append('text')
      .attr('x', width - 10)
      .attr('y', height - 10)
      .attr('text-anchor', 'end')
      .attr('fill', '#6b7280')
      .attr('font-size', '10px')
      .attr('font-family', 'system-ui, sans-serif')
      .text('https://tashiikid.github.io/Polycrisis-Intelligence/');
    
    const serializer = new XMLSerializer();
    const svgText = serializer.serializeToString(svgRef.current);
    
    // Remove branding and background after export
    branding.remove();
    background.remove();
    
    const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'crisis-network.svg';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="relative" style={{ width, height }}>
      {/* D3 Container - isolated from React reconciliation */}
      <div ref={containerRef} className="w-full h-full" />

      {/* Tooltip */}
      {tooltip && (
        <div 
          className="absolute z-20 pointer-events-none whitespace-pre-line text-xs bg-black/80 border border-white/10 rounded-md px-2 py-1 text-white"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          {tooltip.text}
        </div>
      )}

      {/* Controls overlay */}
      <div className="absolute top-4 left-4 space-y-2 z-10">
        <button
          onClick={() => setLabelsVisible(!labelsVisible)}
          className="px-3 py-1.5 bg-surface/90 backdrop-blur border border-surface rounded-lg text-xs text-text-primary hover:border-cyan-500/50 transition-colors block"
        >
          {labelsVisible ? 'Hide' : 'Show'} Labels
        </button>
        <button
          onClick={resetZoom}
          className="px-3 py-1.5 bg-surface/90 backdrop-blur border border-surface rounded-lg text-xs text-text-primary hover:border-cyan-500/50 transition-colors block"
        >
          Reset View (Home)
        </button>
        {selectedNode && (
          <>
            <button
              onClick={() => centerOnNode(selectedNode)}
              className="px-3 py-1.5 bg-cyan-500/20 backdrop-blur border border-cyan-500/50 rounded-lg text-xs text-cyan-400 hover:bg-cyan-500/30 transition-colors block"
            >
              Center on Selected (C)
            </button>
            <button
              onClick={() => {
                setSelectedNode(null);
                if (gRef.current) {
                  gRef.current.selectAll('.nodes g').style('opacity', 1);
                  gRef.current.selectAll('.links line').style('opacity', (d: any) => d.value > 0.75 ? 0.8 : 0.4);
                }
              }}
              className="px-3 py-1.5 bg-surface/90 backdrop-blur border border-surface rounded-lg text-xs text-text-primary hover:border-red-500/50 transition-colors block"
            >
              Deselect (Esc)
            </button>
          </>
        )}
        <button
          onClick={() => {
            if (!svgRef.current || !zoomRef.current) return;
            rotationDegRef.current = (rotationDegRef.current + 45) % 360;
            const t = d3.zoomTransform(svgRef.current);
            const angle = rotationDegRef.current;
            const cx = width / 2;
            const cy = height / 2;
            const base = t.toString();
            if (gRef.current) {
              gRef.current
                .transition()
                .duration(500)
                .attr('transform', `rotate(${angle},${cx},${cy}) ${base}`);
              
              // Counter-rotate labels to stay upright
              if (angle) {
                gRef.current.selectAll('.node-label')
                  .transition()
                  .duration(500)
                  .attr('transform', `rotate(${-angle})`);
              } else {
                gRef.current.selectAll('.node-label')
                  .transition()
                  .duration(500)
                  .attr('transform', null);
              }
            }
          }}
          className="px-3 py-1.5 bg-surface/90 backdrop-blur border border-surface rounded-lg text-xs text-text-primary hover:border-cyan-500/50 transition-colors block"
        >
          Rotate 45° (R)
        </button>
        <button
          onClick={() => setClustered(v => !v)}
          className="px-3 py-1.5 bg-surface/90 backdrop-blur border border-surface rounded-lg text-xs text-text-primary hover:border-cyan-500/50 transition-colors block"
        >
          {clustered ? 'Free Layout' : 'Cluster by Domain'}
        </button>
        <button
          onClick={exportSvg}
          className="px-3 py-1.5 bg-surface/90 backdrop-blur border border-surface rounded-lg text-xs text-text-primary hover:border-cyan-500/50 transition-colors block"
        >
          Export SVG
        </button>
        <div className="text-xs text-text-muted mt-2 px-1">
          <div>↑↓←→ Pan</div>
          <div>Scroll Zoom</div>
          <div>Drag Move</div>
          <div>R Rotate 45°</div>
          <div>C Center on Node</div>
          <div>Esc Deselect</div>
          <div>Home Reset View</div>
        </div>
      </div>

      {/* Flash Points Panel */}
      {flashPoints.length > 0 && (
        <div className="absolute top-4 right-4 space-y-2 z-10 max-w-xs">
          {flashPoints.map((point, idx) => (
            <div
              key={idx}
              onMouseEnter={() => setHoveredFlashPoint(point)}
              onMouseLeave={() => setHoveredFlashPoint(null)}
              className={`bg-gradient-to-r ${
                point.correlation > 0.85 
                  ? 'from-red-600/90 to-orange-600/90' 
                  : 'from-amber-600/90 to-orange-600/90'
              } backdrop-blur rounded-lg p-3 text-white cursor-pointer transition-all hover:scale-105`}
            >
              <div className="text-xs font-semibold mb-1">⚡ Flash Point {idx + 1}</div>
              <div className="text-xs opacity-90">{point.nodes.join(' + ')}</div>
              <div className="text-xs font-medium mt-1">r = {point.correlation.toFixed(2)}</div>
            </div>
          ))}
        </div>
      )}

      {/* Selected Node Info */}
      {selectedNode && (
        <div className="absolute bottom-4 left-4 bg-surface/95 backdrop-blur border border-surface rounded-lg p-4 max-w-sm z-10">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="font-semibold text-text-primary">{selectedNode.name}</h3>
              <p className="text-sm text-text-secondary">{selectedNode.category}</p>
            </div>
            <button
              onClick={() => setSelectedNode(null)}
              className="text-text-muted hover:text-text-primary"
            >
              ×
            </button>
          </div>
          <div className="mt-3 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-text-muted">Stress Level:</span>
              <span className={
                selectedNode.stress_level === 'critical' ? 'text-red-500' :
                selectedNode.stress_level === 'approaching' ? 'text-orange-500' :
                selectedNode.stress_level === 'watch' ? 'text-amber-500' : 'text-cyan-500'
              }>
                {selectedNode.stress_level}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Score:</span>
              <span className="font-mono">{(selectedNode.value * 100).toFixed(1)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
