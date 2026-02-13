import { useEffect, useRef } from 'react';

interface MiniChartProps {
  data: number[];
  labels?: string[];
  width?: number;
  height?: number;
  title?: string;
}

export default function MiniChart({ 
  data, 
  labels = [], 
  width = 300, 
  height = 150, 
  title 
}: MiniChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.length < 2) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Handle DPI scaling
    const dpr = window.devicePixelRatio || 1;
    const padding = { top: 30, right: 20, bottom: 40, left: 50 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // Clear
    ctx.fillStyle = '#13131f';
    ctx.fillRect(0, 0, width, height);

    // Calculate min/max
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const yMin = Math.max(0, min - range * 0.1);
    const yMax = max + range * 0.1;
    const yRange = yMax - yMin;

    // Draw grid lines
    ctx.strokeStyle = '#2a2a3a';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (i / 4) * chartHeight;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();

      // Y-axis labels
      const value = yMax - (i / 4) * yRange;
      ctx.fillStyle = '#8b8b9a';
      ctx.font = '11px system-ui';
      ctx.textAlign = 'right';
      ctx.fillText(value.toFixed(1), padding.left - 8, y + 4);
    }

    // Draw bars
    const barWidth = (chartWidth / data.length) * 0.7;
    const barSpacing = (chartWidth / data.length) * 0.3;

    data.forEach((value, index) => {
      const barHeight = ((value - yMin) / yRange) * chartHeight;
      const x = padding.left + index * (barWidth + barSpacing) + barSpacing / 2;
      const y = padding.top + chartHeight - barHeight;

      // Bar color based on value
      let color = '#00d4aa'; // cyan
      if (value > 70) color = '#ff3864'; // red
      else if (value > 40) color = '#ff9f1c'; // amber

      ctx.fillStyle = color;
      ctx.fillRect(x, y, barWidth, barHeight);

      // X-axis labels
      if (labels[index] && index % Math.ceil(data.length / 6) === 0) {
        ctx.fillStyle = '#8b8b9a';
        ctx.font = '10px system-ui';
        ctx.textAlign = 'center';
        ctx.save();
        ctx.translate(x + barWidth / 2, height - padding.bottom + 15);
        ctx.rotate(-Math.PI / 4);
        ctx.fillText(labels[index], 0, 0);
        ctx.restore();
      }
    });

    // Draw title
    if (title) {
      ctx.fillStyle = '#f0f0f5';
      ctx.font = 'bold 14px system-ui';
      ctx.textAlign = 'left';
      ctx.fillText(title, padding.left, 20);
    }

    // Draw axes
    ctx.strokeStyle = '#4a4a5a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top);
    ctx.lineTo(padding.left, height - padding.bottom);
    ctx.lineTo(width - padding.right, height - padding.bottom);
    ctx.stroke();
  }, [data, labels, width, height, title]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width, height }}
      className="rounded-lg border border-surface"
    />
  );
}
