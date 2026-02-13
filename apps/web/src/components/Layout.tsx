import { Link, useLocation } from 'react-router-dom'
import { ReactNode } from 'react'

interface LayoutProps {
  children: ReactNode
}

export default function Layout({ children }: LayoutProps) {
  const location = useLocation()
  const isActive = (path: string) => location.pathname === path

  return (
    <div className="min-h-screen bg-void text-text-primary">
      <header className="border-b border-surface">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex items-center justify-between h-16">
            <Link to="/" className="flex items-center gap-2 text-xl font-semibold">
              <span>🌩️</span>
              <span>Polycrisis Intelligence</span>
            </Link>
            
            <div className="flex items-center gap-6">
              <Link
                to="/brief"
                className={`text-sm transition-colors ${
                  isActive('/brief') ? 'text-cyan-500' : 'text-text-secondary hover:text-cyan-500'
                }`}
              >
                Brief
              </Link>
              <Link
                to="/pulse"
                className={`text-sm transition-colors ${
                  isActive('/pulse') ? 'text-cyan-500' : 'text-text-secondary hover:text-cyan-500'
                }`}
              >
                Pulse
              </Link>
              <Link
                to="/network"
                className={`text-sm transition-colors ${
                  isActive('/network') ? 'text-cyan-500' : 'text-text-secondary hover:text-cyan-500'
                }`}
              >
                Network
              </Link>
              <a
                href="https://github.com/TashiikiD/Polycrisis-Intelligence"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-text-secondary hover:text-cyan-500 transition-colors"
              >
                GitHub
              </a>
            </div>
          </nav>
        </div>
      </header>

      <main>{children}</main>

      <footer className="border-t border-surface mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <p className="text-center text-sm text-text-muted">
            Built with 🌩️ by{' '}
            <a href="https://github.com/TashiikiD" className="hover:text-cyan-500">
              Tashi
            </a>{' '}
            + Lodestar
          </p>
        </div>
      </footer>
    </div>
  )
}
