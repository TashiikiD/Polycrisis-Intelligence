import { useEffect, useRef } from 'react';
import { useWSSI } from '../hooks/useWSSI';

export default function PulseMode() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { data: wssi, isLoading } = useWSSI();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    const resize = () => {
      canvas.width = canvas.offsetWidth * window.devicePixelRatio;
      canvas.height = canvas.offsetHeight * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };
    resize();
    window.addEventListener('resize', resize);

    // Animation
    let animationId: number;
    let time = 0;

    const animate = () => {
      time += 0.02;
      const width = canvas.offsetWidth;
      const height = canvas.offsetHeight;
      const centerX = width / 2;
      const centerY = height / 2;

      // Clear
      ctx.fillStyle = '#0a0a0f';
      ctx.fillRect(0, 0, width, height);

      // Calculate pulse based on WSSI score
      const score = wssi?.wssi_score || 27.8;
      const baseRadius = 40 + (score / 100) * 40; // 40-80px based on score
      const pulse = Math.sin(time) * (10 + score / 20);
      const radius = baseRadius + pulse;

      // Color based on stress level
      let orbColor = '#00d4aa'; // cyan (low)
      let glowColor = 'rgba(0, 212, 170,';
      if (score >= 75) {
        orbColor = '#ff3864'; // red (critical)
        glowColor = 'rgba(255, 56, 100,';
      } else if (score >= 50) {
        orbColor = '#ff9f1c'; // amber (elevated)
        glowColor = 'rgba(255, 159, 28,';
      } else if (score >= 25) {
        orbColor = '#ff9f1c'; // amber (moderate)
        glowColor = 'rgba(255, 159, 28,';
      }

      // Outer glow
      const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius * 2);
      gradient.addColorStop(0, glowColor + ' 0.3)');
      gradient.addColorStop(0.5, glowColor + ' 0.1)');
      gradient.addColorStop(1, glowColor + ' 0)');

      ctx.beginPath();
      ctx.arc(centerX, centerY, radius * 2, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();

      // Core orb
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.fillStyle = orbColor;
      ctx.fill();

      // Orbiting nodes - based on actual themes
      const themes = wssi?.theme_signals || [];
      const nodeCount = themes.length || 11;

      for (let i = 0; i < nodeCount; i++) {
        const theme = themes[i];
        const angle = (i / nodeCount) * Math.PI * 2 + time * 0.3;
        const orbitRadius = 140 + Math.sin(time + i * 0.5) * 10;
        const x = centerX + Math.cos(angle) * orbitRadius;
        const y = centerY + Math.sin(angle) * orbitRadius;

        // Node color based on theme stress level
        let nodeColor = '#4a4a5a'; // default gray
        if (theme) {
          if (theme.stress_level === 'critical') nodeColor = '#ff3864';
          else if (theme.stress_level === 'approaching') nodeColor = '#ff6b35';
          else if (theme.stress_level === 'watch') nodeColor = '#ff9f1c';
          else if (theme.stress_level === 'stable') nodeColor = '#00d4aa';
        }

        ctx.beginPath();
        ctx.arc(x, y, theme?.stress_level !== 'stable' ? 10 : 6, 0, Math.PI * 2);
        ctx.fillStyle = nodeColor;
        ctx.fill();

        // Draw connection line to center for stressed themes
        if (theme && theme.stress_level !== 'stable') {
          ctx.beginPath();
          ctx.moveTo(centerX, centerY);
          ctx.lineTo(x, y);
          ctx.strokeStyle = nodeColor + '30';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      // WSSI text
      ctx.font = 'bold 48px system-ui';
      ctx.fillStyle = '#f0f0f5';
      ctx.textAlign = 'center';
      ctx.fillText(score.toFixed(1), centerX, centerY + 200);

      ctx.font = '16px system-ui';
      ctx.fillStyle = '#8b8b9a';
      ctx.fillText('WSSI Score', centerX, centerY + 230);

      // Status text
      ctx.font = '14px system-ui';
      ctx.fillStyle = orbColor;
      ctx.fillText(wssi?.stress_level?.toUpperCase() || 'MODERATE', centerX, centerY + 255);

      animationId = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationId);
    };
  }, [wssi]);

  if (isLoading) {
    return (
      <div className="h-[calc(100vh-4rem)] flex items-center justify-center">
        <div className="text-text-secondary">Loading Pulse visualization...</div>
      </div>
    );
  }

  // Get stressed themes for the legend
  const stressedThemes = wssi?.theme_signals.filter(
    t => t.stress_level === 'watch' || t.stress_level === 'approaching' || t.stress_level === 'critical'
  ) || [];

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col">
      <div className="flex-1 relative">
        <canvas
          ref={canvasRef}
          className="w-full h-full"
          style={{ background: '#0a0a0f' }}
        />

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

        {/* Stressed themes indicator */}
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

        {/* Category legend */}
        <div className="absolute bottom-4 left-4 right-4 flex gap-4 justify-center flex-wrap">
          {['Economic', 'Climate', 'Geopolitical', 'Biological'].map((label) => (
            <div
              key={label}
              className="px-4 py-2 rounded-full text-sm bg-surface/80 backdrop-blur border border-surface text-text-secondary"
            >
              {label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
