import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

interface OrbNode {
  id: string;
  name: string;
  type: string;
  x: number;
  y: number;
  z: number;
  value: number;
  stress_level: string;
  color: string;
  category?: string;
}

interface OrbData {
  wssi_value: number;
  wssi_score?: number;
  stress_level: string;
  active_themes: number;
  nodes: OrbNode[];
}

interface WSSIOrbProps {
  data: OrbData;
  width?: number;
  height?: number;
  className?: string;
  onNodeClick?: (node: OrbNode) => void;
}

export default function WSSIOrb({
  data,
  width: initialWidth = 800,
  height: initialHeight = 600,
  className = '',
  onNodeClick
}: WSSIOrbProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number>(0);
  const [dimensions, setDimensions] = useState({ width: initialWidth, height: initialHeight });
  const [hoveredNode, setHoveredNode] = useState<OrbNode | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  // Refs so Three.js handlers do not force scene re-init
  const hoveredNodeRef = useRef<OrbNode | null>(null);
  const onNodeClickRef = useRef<typeof onNodeClick>(onNodeClick);
  const mousePosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const tooltipRafRef = useRef<number | null>(null);

  // Deterministic position generator from node id - evenly distributed on sphere
  const getDeterministicPosition = (id: string, index: number, total: number): { x: number; y: number; z: number } => {
    // Use node id to generate a stable offset for this node's position
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = ((hash << 5) - hash) + id.charCodeAt(i);
      hash = hash & 0xffffffff;
    }
    const normalizedHash = (Math.abs(hash) % 1000000) / 1000000;
    
    // Fibonacci sphere distribution for even spacing
    // Use index for base position, then apply hash offset for variation
    const goldenRatio = (1 + Math.sqrt(5)) / 2;
    const i = (index + normalizedHash * 0.5) % total; // Add hash-based jitter
    const theta = 2 * Math.PI * i / goldenRatio;
    const phi = Math.acos(1 - 2 * (i + 0.5) / total);
    const radius = 2.5 + (normalizedHash * 0.8); // 2.5 to 3.3 radius variation
    
    return {
      x: radius * Math.sin(phi) * Math.cos(theta),
      y: radius * Math.sin(phi) * Math.sin(theta),
      z: radius * Math.cos(phi),
    };
  };

  useEffect(() => {
    onNodeClickRef.current = onNodeClick;
  }, [onNodeClick]);

  // Get color based on WSSI value
  const getIconForNode = (node: OrbNode): string => {
    const categoryIcons: Record<string, string> = {
      'Economic-Financial': '💰',
      'Climate-Environmental': '🌍',
      'Geopolitical-Conflict': '⚔️',
      'Technological': '🤖',
      'Biological-Health': '🦠',
      'Cross-Cutting': '🔗',
    };
    
    const themeIcons: Record<string, string> = {
      'Sovereign Debt Stress': '💸',
      'Corporate Debt Distress': '🏢',
      'Banking System Stress': '🏦',
      'Real Asset Bubbles/Busts': '🏠',
      'Tipping Point Proximity': '🌡️',
      'Extreme Weather Events': '⛈️',
      'Carbon Cycle Disruption': '🌿',
      'Ecosystem Collapse': '🌲',
      'Interstate Conflict': '⚔️',
      'Intrastate Violence': '🔥',
      'Resource Competition': '⛽',
      'Governance Decay': '🏛️',
      'Cyber Systemic Risk': '💻',
      'Critical Infra Failure': '⚡',
      'AI/Compute Concentration': '🧠',
      'Pandemic/Pathogen Risk': '😷',
      'Food System Fragility': '🌾',
      'Cascade Interactions': '🔀',
      'Correlation Clusters': '📊',
      'Systemic Resilience': '🛡️',
    };
    
    return themeIcons[node.name] || categoryIcons[node.category || ''] || '●';
  };

  // Get color based on WSSI value
  const getCoreColor = (value: number): string => {
    if (value < -1.5) return '#ff3864'; // Critical - red
    if (value < -1.0) return '#ff6b35'; // Approaching - amber
    if (value < -0.5) return '#ff9f1c'; // Watch - yellow
    return '#00d4aa'; // Stable - cyan
  };

  // Update dimensions based on container size
  useEffect(() => {
    if (!containerRef.current) return;
    
    const updateDimensions = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setDimensions({
          width: rect.width || initialWidth,
          height: rect.height || initialHeight
        });
      }
    };

    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    
    // Use ResizeObserver for more accurate sizing (guarded for older environments)
    const resizeObserver = typeof ResizeObserver !== 'undefined' 
      ? new ResizeObserver(updateDimensions) 
      : null;
    resizeObserver?.observe(containerRef.current);

    return () => {
      window.removeEventListener('resize', updateDimensions);
      resizeObserver?.disconnect();
    };
  }, [initialWidth, initialHeight]);

  useEffect(() => {
    if (!containerRef.current || dimensions.width === 0) return;

    // Respect reduced motion preference
    const prefersReducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    // Scene setup
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0a0a0f, 0.02);

    const camera = new THREE.PerspectiveCamera(75, dimensions.width / dimensions.height, 0.1, 1000);
    camera.position.z = 8;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(dimensions.width, dimensions.height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.domElement.style.touchAction = 'none';
    containerRef.current.appendChild(renderer.domElement);

    // OrbitControls for drag-to-rotate
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.minDistance = 5;
    controls.maxDistance = 20;
    controls.target.set(0, 0, 0);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x404040, 2);
    scene.add(ambientLight);

    const pointLight = new THREE.PointLight(0xffffff, 1, 100);
    pointLight.position.set(10, 10, 10);
    scene.add(pointLight);

    const coreColor = getCoreColor(data.wssi_value);
    const pointLight2 = new THREE.PointLight(coreColor, 2, 50);
    pointLight2.position.set(-5, -5, 5);
    scene.add(pointLight2);

    // Core Orb
    const coreGeometry = new THREE.SphereGeometry(0.8, 64, 64);
    const coreMaterial = new THREE.MeshPhongMaterial({
      color: coreColor,
      emissive: coreColor,
      emissiveIntensity: 0.5,
      shininess: 100,
      transparent: true,
      opacity: 0.9
    });
    const coreOrb = new THREE.Mesh(coreGeometry, coreMaterial);
    scene.add(coreOrb);

    // Core glow
    const glowGeometry = new THREE.SphereGeometry(1.2, 32, 32);
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: coreColor,
      transparent: true,
      opacity: 0.1
    });
    const coreGlow = new THREE.Mesh(glowGeometry, glowMaterial);
    scene.add(coreGlow);

    // Energy field
    const fieldGeometry = new THREE.SphereGeometry(2, 32, 32);
    const fieldMaterial = new THREE.MeshBasicMaterial({
      color: coreColor,
      wireframe: true,
      transparent: true,
      opacity: 0.15
    });
    const energyField = new THREE.Mesh(fieldGeometry, fieldMaterial);
    scene.add(energyField);

    // Theme nodes
    const nodes: THREE.Mesh[] = [];
    const baseY = new Map<THREE.Mesh, number>();
    const coreLineByNodeId = new Map<string, THREE.Line>();

    // Count theme nodes first for even distribution
    const themeNodes = data.nodes.filter(n => n.type === 'theme');
    const totalThemes = themeNodes.length;

    themeNodes.forEach((node, index) => {
      const size = 0.1 + (node.value * 0.15);
      const geometry = new THREE.SphereGeometry(size, 16, 16);
      const material = new THREE.MeshPhongMaterial({
        color: node.color,
        emissive: node.color,
        emissiveIntensity: 0.3,
        shininess: 50
      });

      const mesh = new THREE.Mesh(geometry, material);
      // Use deterministic position based on node id for spatial memory
      const pos = getDeterministicPosition(node.id, index, totalThemes);
      mesh.position.set(pos.x, pos.y, pos.z);
      mesh.userData = node;
      baseY.set(mesh, pos.y);
      scene.add(mesh);
      nodes.push(mesh);

      // Connection to core
      const lineGeometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(pos.x, pos.y, pos.z)
      ]);
      const lineMaterial = new THREE.LineBasicMaterial({
        color: node.color,
        transparent: true,
        opacity: 0.2
      });
      const line = new THREE.Line(lineGeometry, lineMaterial);
      line.userData.nodeId = node.id;
      scene.add(line);
      coreLineByNodeId.set(node.id, line);
    });

    // Particles
    const particlesGeometry = new THREE.BufferGeometry();
    const particlesCount = prefersReducedMotion ? 50 : 500;
    const posArray = new Float32Array(particlesCount * 3);

    for (let i = 0; i < particlesCount * 3; i++) {
      posArray[i] = (Math.random() - 0.5) * 15;
    }

    particlesGeometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
    const particlesMaterial = new THREE.PointsMaterial({
      size: 0.02,
      color: 0xffffff,
      transparent: true,
      opacity: 0.4
    });
    const particlesMesh = new THREE.Points(particlesGeometry, particlesMaterial);
    scene.add(particlesMesh);

    // Raycaster for mouse interaction
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const applyHoverHighlight = (hoveredId: string | null) => {
      for (const [id, line] of coreLineByNodeId) {
        const mat = line.material as THREE.LineBasicMaterial;
        if (!hoveredId) {
          mat.opacity = 0.2;
        } else if (id === hoveredId) {
          mat.opacity = 0.9;
        } else {
          mat.opacity = 0.06;
        }
        mat.needsUpdate = true;
      }
    };

    const setHoverIfChanged = (next: OrbNode | null) => {
      const prev = hoveredNodeRef.current;
      const prevId = prev?.id ?? null;
      const nextId = next?.id ?? null;
      if (prevId !== nextId) {
        hoveredNodeRef.current = next;
        setHoveredNode(next);
        applyHoverHighlight(nextId);
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      // Record cursor position in container coords for tooltip
      const rect2 = containerRef.current?.getBoundingClientRect();
      if (rect2) {
        mousePosRef.current = {
          x: event.clientX - rect2.left,
          y: event.clientY - rect2.top,
        };
      }

      // Throttled tooltip update
      const scheduleTooltipUpdate = () => {
        if (tooltipRafRef.current != null) return;
        tooltipRafRef.current = requestAnimationFrame(() => {
          tooltipRafRef.current = null;
          const p = mousePosRef.current;
          setTooltipPos({ x: p.x + 12, y: p.y + 12 });
        });
      };

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(nodes);

      if (intersects.length > 0) {
        const node = intersects[0].object.userData as OrbNode;
        setHoverIfChanged(node);
        scheduleTooltipUpdate();
        renderer.domElement.style.cursor = 'pointer';
      } else {
        setHoverIfChanged(null);
        setTooltipPos(null);
        renderer.domElement.style.cursor = 'default';
      }
    };

    const handlePointerDown = () => {
      const node = hoveredNodeRef.current;
      if (node) onNodeClickRef.current?.(node);
    };

    renderer.domElement.addEventListener('pointermove', handlePointerMove);
    renderer.domElement.addEventListener('pointerdown', handlePointerDown);

    // Animation
    let time = 0;
    let running = true;
    const stressLevel = data.stress_level;
    const pulseSpeed = stressLevel === 'critical' ? 3 :
                      stressLevel === 'approaching' ? 2 : 1;

    function animate() {
      if (!running) return;
      animationRef.current = requestAnimationFrame(animate);
      time += 0.01;

      // Reduced motion: subtler pulse, skip node bobbing
      const pulseIntensity = prefersReducedMotion ? 0.02 : 0.1;
      const pulse = 1 + Math.sin(time * pulseSpeed) * pulseIntensity;
      coreOrb.scale.set(pulse, pulse, pulse);
      coreGlow.scale.set(pulse * 1.2, pulse * 1.2, pulse * 1.2);

      energyField.rotation.y += 0.001;
      energyField.rotation.x += 0.0005;

      // IMPORTANT: do not accumulate y forever; set relative to base
      nodes.forEach((node, i) => {
        const y0 = baseY.get(node) ?? node.position.y;
        const bobAmount = prefersReducedMotion ? 0 : 0.12;
        node.position.y = y0 + Math.sin(time + i) * bobAmount;
      });

      particlesMesh.rotation.y += 0.0005;

      controls.update();
      renderer.render(scene, camera);
    }

    const onVis = () => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(animationRef.current);
      } else {
        if (!running) {
          running = true;
          animate();
        }
      }
    };
    document.addEventListener('visibilitychange', onVis);

    animate();

    // Cleanup: actually dispose resources
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      running = false;
      cancelAnimationFrame(animationRef.current);
      renderer.domElement.removeEventListener('pointermove', handlePointerMove);
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      renderer.domElement.style.cursor = 'default';

      if (tooltipRafRef.current != null) {
        cancelAnimationFrame(tooltipRafRef.current);
        tooltipRafRef.current = null;
      }

      controls.dispose();

      // Dispose core connection lines
      for (const [, line] of coreLineByNodeId) {
        line.geometry.dispose();
        const mat = line.material as THREE.Material;
        mat.dispose();
      }
      coreLineByNodeId.clear();

      scene.traverse((obj) => {
        const anyObj = obj as any;
        if (anyObj.geometry?.dispose) anyObj.geometry.dispose();
        if (anyObj.material) {
          const mats = Array.isArray(anyObj.material) ? anyObj.material : [anyObj.material];
          mats.forEach((m: any) => m?.dispose?.());
        }
      });

      // Helps avoid "Too many active WebGL contexts" in SPA navigation
      renderer.renderLists?.dispose?.();
      renderer.dispose();
      renderer.forceContextLoss?.();

      if (containerRef.current && renderer.domElement.parentNode === containerRef.current) {
        containerRef.current.removeChild(renderer.domElement);
      }
    };
  }, [data, dimensions.width, dimensions.height]);

  return (
    <div
      ref={containerRef}
      className={`wssi-orb relative ${className}`}
      style={{ width: '100%', height: '100%' }}
    >
      {hoveredNode && tooltipPos && (
        <div
          className="absolute z-20 pointer-events-none whitespace-pre-line text-xs bg-black/80 border border-white/10 rounded-md px-2 py-1 text-white"
          style={{ left: tooltipPos.x, top: tooltipPos.y }}
        >
          {`${hoveredNode.name}\n${hoveredNode.category || ''}\nStress: ${hoveredNode.stress_level}\nScore: ${(hoveredNode.value * 100).toFixed(1)}`}
        </div>
      )}
    </div>
  );
}
