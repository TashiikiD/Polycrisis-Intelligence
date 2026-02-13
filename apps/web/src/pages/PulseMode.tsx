import { useEffect, useRef, useState } from 'react';
import { useWSSI, useThemes } from '../hooks/useWSSI';
import WSSIOrb from '../components/WSSIOrb';

// Generate 3D node positions for themes arranged in a sphere
function generateThemeNodes(themes: any[]) {
  const categoryColors: Record<string, string> = {
    'Economic-Financial': '#ff3864',
    'Climate-Environmental': '#00d4aa',
    'Geopolitical-Conflict': '#ff9f1c',
    'Technological': '#3b82f6',
    'Biological-Health': '#a855f7',
    'Cross-Cutting': '#6b7280'
  };

  const nodes = themes.map((theme, index) => {
    // Distribute themes on a sphere surface
    const phi = Math.acos(-1 + (2 * index) / Math.max(themes.length, 1));
    const theta = Math.sqrt(Math.max(themes.length, 1) * Math.PI) * phi;

    const radius = 2.5;
    const x = radius * Math.cos(theta) * Math.sin(phi);
    const y = radius * Math.sin(theta) * Math.sin(phi);
    const z = radius * Math.cos(phi);

    return {
      id: theme.theme_id,
      name: theme.theme_name,
      type: 'theme',
      category: theme.category_name || 'Unknown',
      x,
      y,
      z,
      value: (theme.normalized_score || 0) / 100,
      stress_level: theme.stress_level,
      color: categoryColors[theme.category_name] || '#6b7280'
    };
  });

  return nodes;
}

export default function PulseMode() {
  const { data: wssi, isLoading: wssiLoading } = useWSSI();
  const { data: themes, isLoading: themesLoading } = useThemes();
  const [use3D, setUse3D] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const isLoading = wssiLoading || themesLoading;

  // Generate orb data
  const orbData = themes ? {
    wssi_value: -(wssi?.wssi_score || 27.8) / 20,
    wssi_score: wssi?.wssi_score || 27.8,
    stress_level: wssi?.stress_level || 'moderate',
    active_themes: wssi?.active_themes || 11,
    nodes: generateThemeNodes(themes)
  } : null;

  // 2D Canvas fallback animation
  useEffect(() => {
    if (use3D || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width = canvas.offsetWidth * window.devicePixelRatio;
      canvas.height = canvas.offsetHeight * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };
    resize();
    window.addEventListener('resize', resize);

    let animationId: number;
    let time = 0;

    const animate = () => {
      time += 0.02;
      const width = canvas.offsetWidth;
      const height = canvas.offsetHeight;
      const centerX = width / 2;
      const centerY = height / 2;

      ctx.fillStyle = '#0a0a0f';
      ctx.fillRect(0, 0, width, height);

      const score = wssi?.wssi_score || 27.8;
      const baseRadius = 40 + (score / 100) * 40;
      const pulse = Math.sin(time) * (10 + score / 20);
      const radius = baseRadius + pulse;

      let orbColor = '#00d4aa';
      if (score >= 75) orbColor = '#ff3864';
      else if (score >= 50) orbColor = '#ff9f1c';
      else if (score >= 25) orbColor = '#ff9f1c';

      const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius * 2);
      gradient.addColorStop(0, orbColor + '4d');
      gradient.addColorStop(0.5, orbColor + '1a');
      gradient.addColorStop(1, orbColor + '00');

      ctx.beginPath();
      ctx.arc(centerX, centerY, radius * 2, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.fillStyle = orbColor;
      ctx.fill();

      const themeCount = themes?.length || 11;
      for (let i = 0; i < themeCount; i++) {
        const angle = (i / themeCount) * Math.PI * 2 + time * 0.3;
        const orbitRadius = 140 + Math.sin(time + i * 0.5) * 10;
        const x = centerX + Math.cos(angle) * orbitRadius;
        const y = centerY + Math.sin(angle) * orbitRadius;

        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fillStyle = '#4a4a5a';
        ctx.fill();
      }

      ctx.font = 'bold 48px system-ui';
      ctx.fillStyle = '#f0f0f5';
      ctx.textAlign = 'center';
      ctx.fillText(score.toFixed(1), centerX, centerY + 200);

      ctx.font = '16px system-ui';
      ctx.fillStyle = '#8b8b9a';
      ctx.fillText('WSSI Score', centerX, centerY + 230);

      animationId = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationId);
    };
  }, [wssi, themes, use3D]);

  if (isLoading) {
    return (
      <div className="h-[calc(100vh-4rem)] flex items-center justify-center">
        <div className="text-text-secondary">Loading Pulse visualization...</div>
      </div>
    );
  }

  const stressedThemes = themes?.filter(
    t => t.stress_level === 'watch' || t.stress_level === 'approaching' || t.stress_level === 'critical'
  ) || [];

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col">
      {/* Toggle */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex gap-2">
        <button
          onClick={() => setUse3D(true)}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            use3D ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/50' : 'bg-surface/80 text-text-secondary'
          }`}
        >
          3D Orb
        </button>
        <button
          onClick={() => setUse3D(false)}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            !use3D ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/50' : 'bg-surface/80 text-text-secondary'
          }`}
        >
          2D Canvas
        </button>
      </div>

      <div className="flex-1 relative">
        {use3D && orbData ? (
          <WSSIOrb
            data={orbData}
            width={typeof window !== 'undefined' ? window.innerWidth : 800}
            height={typeof window !== 'undefined' ? window.innerHeight - 64 : 600}
            className="w-full h-full"
          />
        ) : (
          <canvas
            ref={canvasRef}
            className="w-full h-full"
            style={{ background: '#0a0a0f' }}
          />
        )}

        {/* Overlay UI */}
        <div className="absolute top-4 left-4 bg-surface/80 backdrop-blur border border-surface rounded-lg p-4">
          <h2 className="text-lg font-semibold mb-2">Pulse Mode</h2>
          <p className="text-sm text-text-secondary">Living visualization of systemic stress.</p>
          <div className="mt-3 text-xs text-text-muted">
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2 h-2 rounded-full bg-amber-500"></span>
              <span>Watch/Approaching</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-cyan-500"></span>
              <span>Stable</span>
            </div>
          </div>
        </div>

        {/* Active Alerts */}
        {stressedThemes.length > 0 && (
          <div className="absolute top-4 right-4 bg-surface/80 backdrop-blur border border-surface rounded-lg p-4 max-w-xs">
            <h3 className="text-sm font-semibold mb-2 text-amber-500">⚠️ Active Alerts ({stressedThemes.length})</h3>
            <div className="space-y-1">
              {stressedThemes.slice(0, 5).map(theme => (
                <div key={theme.theme_id} className="text-xs text-text-secondary">
                  {theme.theme_name}
                </div>
              ))}
              {stressedThemes.length > 5 && (
                <div className="text-xs text-text-muted">+{stressedThemes.length - 5} more...</div>
              )}
            </div>
          </div>
        )}

        {/* Score overlay */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 text-center">
          <div className="text-6xl font-bold text-fg">{wssi?.wssi_score?.toFixed(1) || '27.8'}</div>
          <div className="text-sm text-text-secondary mt-1">WSSI Score</div>
          <div className={`text-sm font-medium mt-1 ${
            wssi?.stress_level === 'critical' ? 'text-red-500' :
            wssi?.stress_level === 'approaching' ? 'text-amber-500' :
            wssi?.stress_level === 'watch' ? 'text-yellow-500' :
            'text-cyan-500'
          }`}>
            {(wssi?.stress_level || 'MODERATE').toUpperCase()}
          </div>
        </div>
      </div>
    </div>
  );
}
