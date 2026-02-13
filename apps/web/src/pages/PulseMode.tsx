import { useEffect, useRef } from 'react'

export default function PulseMode() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Set canvas size
    const resize = () => {
      canvas.width = canvas.offsetWidth * window.devicePixelRatio
      canvas.height = canvas.offsetHeight * window.devicePixelRatio
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio)
    }
    resize()
    window.addEventListener('resize', resize)

    // Animation
    let animationId: number
    let time = 0

    const animate = () => {
      time += 0.02
      const width = canvas.offsetWidth
      const height = canvas.offsetHeight
      const centerX = width / 2
      const centerY = height / 2

      // Clear
      ctx.fillStyle = '#0a0a0f'
      ctx.fillRect(0, 0, width, height)

      // Draw pulsing orb
      const baseRadius = 60
      const pulse = Math.sin(time) * 10
      const radius = baseRadius + pulse

      // Outer glow
      const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius * 2)
      gradient.addColorStop(0, 'rgba(0, 212, 170, 0.3)')
      gradient.addColorStop(0.5, 'rgba(0, 212, 170, 0.1)')
      gradient.addColorStop(1, 'rgba(0, 212, 170, 0)')
      
      ctx.beginPath()
      ctx.arc(centerX, centerY, radius * 2, 0, Math.PI * 2)
      ctx.fillStyle = gradient
      ctx.fill()

      // Core orb
      ctx.beginPath()
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2)
      ctx.fillStyle = '#00d4aa'
      ctx.fill()

      // Orbiting nodes
      const nodes = 11
      for (let i = 0; i < nodes; i++) {
        const angle = (i / nodes) * Math.PI * 2 + time * 0.5
        const orbitRadius = 120 + Math.sin(time + i) * 10
        const x = centerX + Math.cos(angle) * orbitRadius
        const y = centerY + Math.sin(angle) * orbitRadius

        ctx.beginPath()
        ctx.arc(x, y, 8, 0, Math.PI * 2)
        ctx.fillStyle = i < 3 ? '#ff9f1c' : '#4a4a5a'
        ctx.fill()
      }

      // WSSI text
      ctx.font = 'bold 48px system-ui'
      ctx.fillStyle = '#f0f0f5'
      ctx.textAlign = 'center'
      ctx.fillText('27.8', centerX, centerY + 200)
      
      ctx.font = '16px system-ui'
      ctx.fillStyle = '#8b8b9a'
      ctx.fillText('WSSI Score', centerX, centerY + 230)

      animationId = requestAnimationFrame(animate)
    }

    animate()

    return () => {
      window.removeEventListener('resize', resize)
      cancelAnimationFrame(animationId)
    }
  }, [])

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
        </div>

        <div className="absolute bottom-4 left-4 right-4 flex gap-4 justify-center">
          {['Food', 'Assets', 'Weather', 'Debt', 'Climate', 'Conflict'].map((label, i) => (
            <div
              key={label}
              className={`px-4 py-2 rounded-full text-sm ${
                i < 3 ? 'bg-amber-500/20 text-amber-500 border border-amber-500/50' : 'bg-surface text-text-secondary'
              }`}
            >
              {label}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
