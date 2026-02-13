import { useWSSI } from '../hooks/useWSSI';

const categoryColors: Record<string, string> = {
  'Economic-Financial': 'text-blue-400',
  'Climate-Environmental': 'text-green-400',
  'Geopolitical-Conflict': 'text-purple-400',
  'Biological-Health': 'text-orange-400',
};

const statusColors: Record<string, string> = {
  'stable': 'text-cyan-500',
  'watch': 'text-amber-500',
  'approaching': 'text-orange-500',
  'critical': 'text-red-500',
};

const statusBgColors: Record<string, string> = {
  'stable': 'bg-cyan-500/20 text-cyan-500 border-cyan-500/50',
  'watch': 'bg-amber-500/20 text-amber-500 border-amber-500/50',
  'approaching': 'bg-orange-500/20 text-orange-500 border-orange-500/50',
  'critical': 'bg-red-500/20 text-red-500 border-red-500/50',
};

export default function BriefMode() {
  const { data: wssi, isLoading, error } = useWSSI();

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="animate-pulse text-text-secondary">Loading Brief data...</div>
      </div>
    );
  }

  if (error || !wssi) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-red-500">Error loading data. Please try again.</div>
      </div>
    );
  }

  const getStressLevel = (score: number) => {
    if (score >= 75) return 'Critical';
    if (score >= 50) return 'Elevated';
    if (score >= 25) return 'Moderate';
    return 'Low';
  };

  const stressLevel = getStressLevel(wssi.wssi_score);
  const stressColor = wssi.wssi_score >= 50 ? 'text-red-500' : wssi.wssi_score >= 25 ? 'text-amber-500' : 'text-cyan-500';

  // Sort themes by stress level (watch/approaching first)
  const sortedThemes = [...wssi.theme_signals].sort((a, b) => {
    const order = { critical: 0, approaching: 1, watch: 2, stable: 3 };
    return (order[a.stress_level as keyof typeof order] || 4) - (order[b.stress_level as keyof typeof order] || 4);
  });

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
              <div className="text-5xl font-bold text-cyan-500">{wssi.wssi_score.toFixed(1)}</div>
              <div className={`mt-1 ${wssi.trend === 'up' ? 'text-amber-500' : 'text-cyan-500'}`}>
                {wssi.trend === 'up' ? '↑' : wssi.trend === 'down' ? '↓' : '→'} 
                {wssi.wssi_delta > 0 ? '+' : ''}{wssi.wssi_delta.toFixed(1)} from last week
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm text-text-muted">Status</div>
              <div className={`text-xl ${stressColor}`}>{stressLevel}</div>
              <div className="text-sm text-text-secondary mt-1">
                {wssi.dominant_category || 'Multiple categories'}
              </div>
            </div>
          </div>
          
          <div className="h-2 bg-void rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-cyan-500 via-amber-500 to-red-500 transition-all duration-500" 
              style={{ width: `${Math.min(wssi.wssi_score, 100)}%` }}
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
          <div className="px-6 py-4 border-b border-void flex items-center justify-between">
            <h2 className="text-lg font-semibold">Active Themes</h2>
            <div className="text-sm text-text-muted">
              {sortedThemes.filter(t => t.stress_level !== 'stable').length} at elevated risk
            </div>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-void">
                  <th className="px-6 py-3 text-left text-sm font-medium text-text-muted">Theme</th>
                  <th className="px-6 py-3 text-left text-sm font-medium text-text-muted">Category</th>
                  <th className="px-6 py-3 text-right text-sm font-medium text-text-muted">Raw Value</th>
                  <th className="px-6 py-3 text-right text-sm font-medium text-text-muted">Normalized</th>
                  <th className="px-6 py-3 text-center text-sm font-medium text-text-muted">Status</th>
                </tr>
              </thead>
              <tbody>
                {sortedThemes.map((theme) => (
                  <tr 
                    key={theme.theme_id} 
                    className="border-b border-void last:border-0 hover:bg-void/50 transition-colors"
                  >
                    <td className="px-6 py-4 font-medium">{theme.theme_name}</td>
                    <td className={`px-6 py-4 text-sm ${categoryColors[theme.category] || 'text-text-secondary'}`}>
                      {theme.category}
                    </td>
                    <td className="px-6 py-4 text-right font-mono text-sm">
                      {theme.raw_value.toFixed(2)}
                    </td>
                    <td className={`px-6 py-4 text-right font-mono text-sm ${
                      theme.normalized_value > 0 ? 'text-amber-500' : 'text-cyan-500'
                    }`}>
                      {theme.normalized_value > 0 ? '+' : ''}{theme.normalized_value.toFixed(2)}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className={`px-3 py-1 rounded-full text-xs font-medium border ${
                        statusBgColors[theme.stress_level] || 'bg-surface text-text-secondary'
                      }`}>
                        {theme.stress_level.charAt(0).toUpperCase() + theme.stress_level.slice(1)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {wssi.calculation_timestamp && (
          <div className="text-sm text-text-muted">
            Last updated: {new Date(wssi.calculation_timestamp).toLocaleString()}
          </div>
        )}
      </div>
    </div>
  );
}
