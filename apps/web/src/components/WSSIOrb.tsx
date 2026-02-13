import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

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
    
    // Use ResizeObserver for more accurate sizing
    const resizeObserver = new ResizeObserver(updateDimensions);
    resizeObserver.observe(containerRef.current);

    return () => {
      window.removeEventListener('resize', updateDimensions);
      resizeObserver.disconnect();
    };
  }, [initialWidth, initialHeight]);

  useEffect(() => {
    if (!containerRef.current || dimensions.width === 0) return;

    // Scene setup
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0a0a0f, 0.02);

    const camera = new THREE.PerspectiveCamera(75, dimensions.width / dimensions.height, 0.1, 1000);
    camera.position.z = 8;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(dimensions.width, dimensions.height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    containerRef.current.appendChild(renderer.domElement);

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
    const nodeMeshes: Map<string, THREE.Mesh> = new Map();

    data.nodes.forEach(node => {
      if (node.type === 'theme') {
        const size = 0.1 + (node.value * 0.15);
        const geometry = new THREE.SphereGeometry(size, 16, 16);
        const material = new THREE.MeshPhongMaterial({
          color: node.color,
          emissive: node.color,
          emissiveIntensity: 0.3,
          shininess: 50
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(node.x, node.y, node.z);
        mesh.userData = node;
        scene.add(mesh);
        nodes.push(mesh);
        nodeMeshes.set(node.id, mesh);

        // Connection to core
        const lineGeometry = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(node.x, node.y, node.z)
        ]);
        const lineMaterial = new THREE.LineBasicMaterial({
          color: node.color,
          transparent: true,
          opacity: 0.2
        });
        const line = new THREE.Line(lineGeometry, lineMaterial);
        scene.add(line);
      }
    });

    // Particles
    const particlesGeometry = new THREE.BufferGeometry();
    const particlesCount = 500;
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

    const handleMouseMove = (event: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(nodes);

      if (intersects.length > 0) {
        const node = intersects[0].object.userData as OrbNode;
        setHoveredNode(node);
        document.body.style.cursor = 'pointer';
      } else {
        setHoveredNode(null);
        document.body.style.cursor = 'default';
      }
    };

    const handleClick = () => {
      if (hoveredNode && onNodeClick) {
        onNodeClick(hoveredNode);
      }
    };

    renderer.domElement.addEventListener('mousemove', handleMouseMove);
    renderer.domElement.addEventListener('click', handleClick);

    // Animation
    let time = 0;
    const stressLevel = data.stress_level;
    const pulseSpeed = stressLevel === 'critical' ? 3 :
                      stressLevel === 'approaching' ? 2 : 1;

    function animate() {
      animationRef.current = requestAnimationFrame(animate);
      time += 0.01;

      const pulse = 1 + Math.sin(time * pulseSpeed) * 0.1;
      coreOrb.scale.set(pulse, pulse, pulse);
      coreGlow.scale.set(pulse * 1.2, pulse * 1.2, pulse * 1.2);

      energyField.rotation.y += 0.001;
      energyField.rotation.x += 0.0005;

      nodes.forEach((node, i) => {
        node.position.y += Math.sin(time + i) * 0.002;
      });

      particlesMesh.rotation.y += 0.0005;

      renderer.render(scene, camera);
    }

    animate();

    // Cleanup
    return () => {
      cancelAnimationFrame(animationRef.current);
      renderer.domElement.removeEventListener('mousemove', handleMouseMove);
      renderer.domElement.removeEventListener('click', handleClick);
      renderer.dispose();
      if (containerRef.current && renderer.domElement.parentNode === containerRef.current) {
        containerRef.current.removeChild(renderer.domElement);
      }
    };
  }, [data, dimensions, hoveredNode, onNodeClick]);

  return (
    <div
      ref={containerRef}
      className={`wssi-orb relative ${className}`}
      style={{ width: '100%', height: '100%' }}
    >
      {hoveredNode && (
        <div className="absolute top-4 left-4 bg-surface/90 backdrop-blur border border-surface rounded-lg p-3 pointer-events-none z-10">
          <div className="text-sm font-semibold" style={{ color: hoveredNode.color }}>
            {hoveredNode.name}
          </div>
          <div className="text-xs text-text-secondary mt-1">
            {hoveredNode.category}
          </div>
          <div className="text-xs text-text-muted mt-1">
            Click for details
          </div>
        </div>
      )}
    </div>
  );
}
