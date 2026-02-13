export default function BriefMode() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Brief Mode</h1>
        <p className="text-text-secondary">Executive dashboard with tabular data and trend analysis.</p>
      </div>

      <div className="grid gap-6">
        {/* WSSI Score Card */}
        <div className="p-6 bg-surface border border-surface rounded-xl">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-sm text-text-muted mb-1">WSSI Score</div>
              <div className="text-5xl font-bold text-cyan-500">27.8</div>
              <div className="text-amber-500 mt-1">↑ +2.3 from last week</div>
            </div>
            <div className="text-right">
              <div className="text-sm text-text-muted">Status</div>
              <div className="text-xl text-amber-500">Moderate</div>
            </div>
          </div>
          
          <div className="h-2 bg-void rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-cyan-500 via-amber-500 to-red-500" 
              style={{ width: '27.8%' }}
            />
          </div>
          <div className="flex justify-between text-xs text-text-muted mt-2">
            <span>Low</span>
            <span>Moderate</span>
            <span>Elevated</span>
            <span>Critical</span>
          </div>
        </div>

        {/* Theme Table */}
        <div className="bg-surface border border-surface rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-void">
            <h2 className="text-lg font-semibold">Active Themes</h2>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-void">
                  <th className="px-6 py-3 text-left text-sm font-medium text-text-muted">Theme</th>
                  <th className="px-6 py-3 text-left text-sm font-medium text-text-muted">Category</th>
                  <th className="px-6 py-3 text-right text-sm font-medium text-text-muted">Value</th>
                  <th className="px-6 py-3 text-right text-sm font-medium text-text-muted">Status</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { name: 'Food System Fragility', category: 'Biological', value: 100.0, status: 'Watch', statusColor: 'text-amber-500' },
                  { name: 'Real Asset Bubbles', category: 'Economic', value: 64.53, status: 'Watch', statusColor: 'text-amber-500' },
                  { name: 'Extreme Weather Events', category: 'Climate', value: 0.0, status: 'Approaching', statusColor: 'text-orange-500' },
                  { name: 'Sovereign Debt Stress', category: 'Economic', value: 2.70, status: 'Stable', statusColor: 'text-cyan-500' },
                  { name: 'Tipping Point Proximity', category: 'Climate', value: 12.38, status: 'Stable', statusColor: 'text-cyan-500' },
                ].map((theme, i) => (
                  <tr key={i} className="border-b border-void last:border-0 hover:bg-void/50">
                    <td className="px-6 py-4">{theme.name}</td>
                    <td className="px-6 py-4 text-text-secondary">{theme.category}</td>
                    <td className="px-6 py-4 text-right font-mono">{theme.value}</td>
                    <td className={`px-6 py-4 text-right font-medium ${theme.statusColor}`}>
                      {theme.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
