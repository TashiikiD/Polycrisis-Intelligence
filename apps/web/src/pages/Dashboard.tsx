import { Link } from 'react-router-dom'

export default function Dashboard() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="text-center mb-12">
        <h1 className="text-4xl md:text-5xl font-bold mb-4 bg-gradient-to-r from-white to-cyan-500 bg-clip-text text-transparent">
          See the Synchronization
        </h1>
        <p className="text-lg text-text-secondary max-w-2xl mx-auto">
          Real-time monitoring of global systemic risk. WSSI measures when economic, 
          climate, and geopolitical stresses align into compound crises.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-6 mb-12">
        <Link
          to="/brief"
          className="group p-8 bg-surface border border-surface rounded-xl hover:border-cyan-500 transition-all"
        >
          <div className="text-4xl mb-4">📊</div>
          <h2 className="text-xl font-semibold mb-2 group-hover:text-cyan-500">Brief Mode</h2>
          <p className="text-text-secondary">
            Bloomberg-style executive view with sortable tables, sparklines, and PDF export.
          </p>
        </Link>

        <Link
          to="/pulse"
          className="group p-8 bg-surface border border-surface rounded-xl hover:border-cyan-500 transition-all"
        >
          <div className="text-4xl mb-4">🔮</div>
          <h2 className="text-xl font-semibold mb-2 group-hover:text-cyan-500">Pulse Mode</h2>
          <p className="text-text-secondary">
            Living visualization with real-time orb, stress topology, and correlation maps.
          </p>
        </Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-6 bg-surface border border-surface rounded-lg text-center">
          <div className="text-sm text-text-muted mb-1">WSSI Score</div>
          <div className="text-3xl font-bold text-cyan-500">27.8</div>
          <div className="text-sm text-amber-500">↑ +2.3</div>
        </div>

        <div className="p-6 bg-surface border border-surface rounded-lg text-center">
          <div className="text-sm text-text-muted mb-1">Active Themes</div>
          <div className="text-3xl font-bold">11</div>
          <div className="text-sm text-text-secondary">4 categories</div>
        </div>

        <div className="p-6 bg-surface border border-surface rounded-lg text-center">
          <div className="text-sm text-text-muted mb-1">Watch Level</div>
          <div className="text-3xl font-bold text-amber-500">3</div>
          <div className="text-sm text-text-secondary">themes</div>
        </div>

        <div className="p-6 bg-surface border border-surface rounded-lg text-center">
          <div className="text-sm text-text-muted mb-1">Data Sources</div>
          <div className="text-3xl font-bold">23</div>
          <div className="text-sm text-text-secondary">indicators</div>
        </div>
      </div>
    </div>
  )
}
