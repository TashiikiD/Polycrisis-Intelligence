/**
 * CausalLoopRenderer - Vanilla JS CLD visualizer for Polycrisis Intelligence
 * Renders CLD JSON to interactive SVG diagrams
 * No dependencies - pure vanilla JS
 */

class CausalLoopRenderer {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      throw new Error(`Container #${containerId} not found`);
    }
    
    this.options = {
      width: options.width || 800,
      height: options.height || 600,
      nodeRadius: options.nodeRadius || 25,
      fontSize: options.fontSize || 12,
      showLabels: options.showLabels !== false,
      interactive: options.interactive !== false,
      theme: options.theme || 'dark',
      ...options
    };
    
    this.svg = null;
    this.nodes = [];
    this.links = [];
    this.selectedNode = null;
    this.transform = { x: 0, y: 0, scale: 1 };
    this.isDragging = false;
    this.dragStart = { x: 0, y: 0 };
    
    this.colors = this.options.theme === 'dark' ? {
      background: '#0d1117',
      node: '#21262d',
      nodeBorder: '#58a6ff',
      nodeText: '#c9d1d9',
      link: '#8b949e',
      linkPositive: '#3fb950',
      linkNegative: '#f85149',
      label: '#8b949e',
      group: 'rgba(88, 166, 255, 0.1)',
      groupBorder: 'rgba(88, 166, 255, 0.3)'
    } : {
      background: '#ffffff',
      node: '#f6f8fa',
      nodeBorder: '#0969da',
      nodeText: '#1f2328',
      link: '#6e7781',
      linkPositive: '#1a7f37',
      linkNegative: '#cf222e',
      label: '#6e7781',
      group: 'rgba(9, 105, 218, 0.1)',
      groupBorder: 'rgba(9, 105, 218, 0.3)'
    };
    
    this.init();
  }
  
  init() {
    this.container.style.width = this.options.width + 'px';
    this.container.style.height = this.options.height + 'px';
    this.container.style.background = this.colors.background;
    this.container.style.borderRadius = '8px';
    this.container.style.position = 'relative';
    this.container.style.overflow = 'hidden';
    
    // Create SVG
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('width', '100%');
    this.svg.setAttribute('height', '100%');
    this.svg.setAttribute('viewBox', `0 0 ${this.options.width} ${this.options.height}`);
    this.svg.style.cursor = 'grab';
    
    // Create groups for layering
    this.groupsGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.linksGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.nodesGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.labelsGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    
    this.svg.appendChild(this.groupsGroup);
    this.svg.appendChild(this.linksGroup);
    this.svg.appendChild(this.nodesGroup);
    this.svg.appendChild(this.labelsGroup);
    
    this.container.appendChild(this.svg);
    
    if (this.options.interactive) {
      this.setupInteractions();
    }
  }
  
  async loadFromURL(url) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      this.render(data);
      return data;
    } catch (error) {
      console.error('Failed to load CLD:', error);
      this.showError('Failed to load diagram: ' + error.message);
      throw error;
    }
  }
  
  loadFromObject(data) {
    this.render(data);
    return data;
  }
  
  render(data) {
    this.clear();
    
    if (!data || !data.nodes || !data.links) {
      this.showError('Invalid CLD data structure');
      return;
    }
    
    this.nodes = data.nodes.map(n => ({...n}));
    this.links = data.links.map(l => ({...l}));
    
    // Calculate bounds and center
    const bounds = this.calculateBounds();
    this.centerDiagram(bounds);
    
    // Render groups first (background)
    if (data.groups) {
      this.renderGroups(data.groups);
    }
    
    // Render links
    this.renderLinks();
    
    // Render nodes
    this.renderNodes();
    
    // Render title if present
    if (data.title) {
      this.renderTitle(data.title, data.subtitle);
    }
  }
  
  calculateBounds() {
    if (this.nodes.length === 0) return { minX: 0, maxX: 800, minY: 0, maxY: 600 };
    
    const xs = this.nodes.map(n => n.placement?.x || 0);
    const ys = this.nodes.map(n => n.placement?.y || 0);
    return {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys)
    };
  }
  
  centerDiagram(bounds) {
    const padding = 100;
    const diagramWidth = bounds.maxX - bounds.minX + padding * 2;
    const diagramHeight = bounds.maxY - bounds.minY + padding * 2;
    
    const scaleX = this.options.width / diagramWidth;
    const scaleY = this.options.height / diagramHeight;
    this.transform.scale = Math.min(scaleX, scaleY, 1);
    
    this.transform.x = (this.options.width - (bounds.maxX + bounds.minX) * this.transform.scale) / 2;
    this.transform.y = (this.options.height - (bounds.maxY + bounds.minY) * this.transform.scale) / 2;
    
    this.updateTransform();
  }
  
  updateTransform() {
    const transform = `translate(${this.transform.x}, ${this.transform.y}) scale(${this.transform.scale})`;
    this.groupsGroup.setAttribute('transform', transform);
    this.linksGroup.setAttribute('transform', transform);
    this.nodesGroup.setAttribute('transform', transform);
    this.labelsGroup.setAttribute('transform', transform);
  }
  
  renderGroups(groups) {
    groups.forEach(group => {
      if (!group.nodeIds || group.nodeIds.length < 2) return;
      
      // Calculate bounding box of nodes in group
      const groupNodes = this.nodes.filter(n => group.nodeIds.includes(n.id));
      if (groupNodes.length === 0) return;
      
      const xs = groupNodes.map(n => n.placement?.x || 0);
      const ys = groupNodes.map(n => n.placement?.y || 0);
      
      const minX = Math.min(...xs) - 60;
      const maxX = Math.max(...xs) + 60;
      const minY = Math.min(...ys) - 40;
      const maxY = Math.max(...ys) + 40;
      
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', minX);
      rect.setAttribute('y', minY);
      rect.setAttribute('width', maxX - minX);
      rect.setAttribute('height', maxY - minY);
      rect.setAttribute('fill', this.colors.group);
      rect.setAttribute('stroke', this.colors.groupBorder);
      rect.setAttribute('stroke-dasharray', '5,5');
      rect.setAttribute('rx', 10);
      
      // Add group label
      if (group.label) {
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', minX + 10);
        label.setAttribute('y', minY + 20);
        label.setAttribute('fill', this.colors.label);
        label.setAttribute('font-size', '11');
        label.setAttribute('font-weight', 'bold');
        label.textContent = group.label;
        this.groupsGroup.appendChild(label);
      }
      
      this.groupsGroup.appendChild(rect);
    });
  }
  
  renderLinks() {
    this.links.forEach((link, index) => {
      const fromNode = this.nodes.find(n => n.id === link.fromId);
      const toNode = this.nodes.find(n => n.id === link.toId);
      
      if (!fromNode || !toNode) return;
      
      const x1 = fromNode.placement?.x || 0;
      const y1 = fromNode.placement?.y || 0;
      const x2 = toNode.placement?.x || 0;
      const y2 = toNode.placement?.y || 0;
      
      // Calculate arrow endpoint (stop at node edge)
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const nodeRadius = this.options.nodeRadius;
      const endX = x2 - Math.cos(angle) * (nodeRadius + 5);
      const endY = y2 - Math.sin(angle) * (nodeRadius + 5);
      
      // Create curved path
      const midX = (x1 + endX) / 2;
      const midY = (y1 + endY) / 2;
      const curvature = 30;
      const cpX = midX + Math.sin(angle) * curvature;
      const cpY = midY - Math.cos(angle) * curvature;
      
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M ${x1} ${y1} Q ${cpX} ${cpY} ${endX} ${endY}`);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', link.polarity === 'reinforcing' ? this.colors.linkPositive : this.colors.linkNegative);
      path.setAttribute('stroke-width', '2');
      path.setAttribute('marker-end', `url(#arrow-${link.polarity})`);
      
      this.linksGroup.appendChild(path);
      
      // Add link label if present
      if (link.label && this.options.showLabels) {
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', cpX);
        label.setAttribute('y', cpY - 5);
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('fill', this.colors.label);
        label.setAttribute('font-size', '11');
        label.setAttribute('font-weight', 'bold');
        label.textContent = link.label;
        this.labelsGroup.appendChild(label);
      }
    });
    
    // Define arrow markers
    this.defineMarkers();
  }
  
  defineMarkers() {
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    
    ['reinforcing', 'balancing'].forEach(polarity => {
      const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
      marker.setAttribute('id', `arrow-${polarity}`);
      marker.setAttribute('markerWidth', '10');
      marker.setAttribute('markerHeight', '7');
      marker.setAttribute('refX', '9');
      marker.setAttribute('refY', '3.5');
      marker.setAttribute('orient', 'auto');
      
      const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      polygon.setAttribute('points', '0 0, 10 3.5, 0 7');
      polygon.setAttribute('fill', polarity === 'reinforcing' ? this.colors.linkPositive : this.colors.linkNegative);
      
      marker.appendChild(polygon);
      defs.appendChild(marker);
    });
    
    this.svg.insertBefore(defs, this.svg.firstChild);
  }
  
  renderNodes() {
    this.nodes.forEach(node => {
      const x = node.placement?.x || 0;
      const y = node.placement?.y || 0;
      const r = this.options.nodeRadius;
      
      // Node group
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('transform', `translate(${x}, ${y})`);
      g.style.cursor = 'pointer';
      g.dataset.nodeId = node.id;
      
      // Node circle
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('r', r);
      circle.setAttribute('fill', this.colors.node);
      circle.setAttribute('stroke', this.colors.nodeBorder);
      circle.setAttribute('stroke-width', '2');
      
      // Severity indicator (colored ring)
      if (node.severity !== undefined) {
        const severityColor = this.getSeverityColor(node.severity);
        circle.setAttribute('stroke', severityColor);
        circle.setAttribute('stroke-width', '3');
      }
      
      // Node label
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dy', '0.35em');
      text.setAttribute('fill', this.colors.nodeText);
      text.setAttribute('font-size', this.options.fontSize);
      text.textContent = this.truncateText(node.label || node.id, 15);
      
      g.appendChild(circle);
      g.appendChild(text);
      
      if (this.options.interactive) {
        g.addEventListener('click', () => this.selectNode(node));
        g.addEventListener('mouseenter', () => this.highlightNode(node, true));
        g.addEventListener('mouseleave', () => this.highlightNode(node, false));
      }
      
      this.nodesGroup.appendChild(g);
    });
  }
  
  getSeverityColor(severity) {
    // severity 0-1
    if (severity < 0.3) return '#3fb950'; // green
    if (severity < 0.6) return '#d29922'; // yellow
    if (severity < 0.8) return '#f85149'; // red
    return '#a371f7'; // purple (critical)
  }
  
  truncateText(text, maxLength) {
    if (!text || text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  }
  
  renderTitle(title, subtitle) {
    const titleGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    titleGroup.setAttribute('transform', `translate(20, 30)`);
    
    const titleText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    titleText.setAttribute('fill', this.colors.nodeText);
    titleText.setAttribute('font-size', '18');
    titleText.setAttribute('font-weight', 'bold');
    titleText.textContent = title;
    
    titleGroup.appendChild(titleText);
    
    if (subtitle) {
      const subText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      subText.setAttribute('y', '22');
      subText.setAttribute('fill', this.colors.label);
      subText.setAttribute('font-size', '12');
      subText.textContent = this.truncateText(subtitle, 80);
      titleGroup.appendChild(subText);
    }
    
    this.svg.appendChild(titleGroup);
  }
  
  selectNode(node) {
    this.selectedNode = node;
    
    // Dispatch custom event
    this.container.dispatchEvent(new CustomEvent('nodeSelect', {
      detail: node
    }));
    
    // Visual feedback
    const nodeElements = this.nodesGroup.querySelectorAll('g');
    nodeElements.forEach(el => {
      const circle = el.querySelector('circle');
      if (el.dataset.nodeId === node.id) {
        circle.setAttribute('stroke', '#a371f7');
        circle.setAttribute('stroke-width', '4');
      } else {
        circle.setAttribute('stroke', this.colors.nodeBorder);
        circle.setAttribute('stroke-width', '2');
      }
    });
  }
  
  highlightNode(node, highlight) {
    if (this.selectedNode?.id === node.id) return;
    
    const nodeEl = this.nodesGroup.querySelector(`g[data-node-id="${node.id}"]`);
    if (nodeEl) {
      const circle = nodeEl.querySelector('circle');
      if (highlight) {
        circle.setAttribute('stroke-width', '4');
      } else {
        circle.setAttribute('stroke-width', node.severity !== undefined ? '3' : '2');
      }
    }
  }
  
  setupInteractions() {
    // Pan
    this.svg.addEventListener('mousedown', (e) => {
      if (e.target === this.svg || e.target.tagName === 'svg') {
        this.isDragging = true;
        this.dragStart = { x: e.clientX - this.transform.x, y: e.clientY - this.transform.y };
        this.svg.style.cursor = 'grabbing';
      }
    });
    
    window.addEventListener('mousemove', (e) => {
      if (this.isDragging) {
        this.transform.x = e.clientX - this.dragStart.x;
        this.transform.y = e.clientY - this.dragStart.y;
        this.updateTransform();
      }
    });
    
    window.addEventListener('mouseup', () => {
      this.isDragging = false;
      this.svg.style.cursor = 'grab';
    });
    
    // Zoom
    this.svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const scaleFactor = e.deltaY > 0 ? 0.9 : 1.1;
      this.transform.scale *= scaleFactor;
      this.transform.scale = Math.max(0.1, Math.min(5, this.transform.scale));
      this.updateTransform();
    });
  }
  
  zoomIn() {
    this.transform.scale *= 1.2;
    this.updateTransform();
  }
  
  zoomOut() {
    this.transform.scale /= 1.2;
    this.updateTransform();
  }
  
  resetView() {
    const bounds = this.calculateBounds();
    this.centerDiagram(bounds);
  }
  
  clear() {
    this.groupsGroup.innerHTML = '';
    this.linksGroup.innerHTML = '';
    this.nodesGroup.innerHTML = '';
    this.labelsGroup.innerHTML = '';
    this.selectedNode = null;
  }
  
  showError(message) {
    this.container.innerHTML = `<div style="padding: 20px; color: #f85149; text-align: center;">${message}</div>`;
  }
  
  destroy() {
    if (this.container) {
      this.container.innerHTML = '';
    }
  }
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CausalLoopRenderer;
}
