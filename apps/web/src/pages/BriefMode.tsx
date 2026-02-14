import { useWSSI, useWSSIHistory } from '../hooks/useWSSI';
import Sparkline from '../components/Sparkline';
import { useState } from 'react';

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

// Flash point type definition
interface FlashPoint {
  id: string;
  title: string;
  description: string;
  severity: 'watch' | 'approaching' | 'critical';
  themes: string[];
  timestamp: string;
}

// Mock flash points data (would come from API in production)
const mockFlashPoints: FlashPoint[] = [
  {
    id: 'fp-1',
    title: 'Food System + Weather Correlation',
    description: 'Food System Fragility (100.0) and Extreme Weather Events showing synchronized elevation. Historical correlation suggests compounding risk.',
    severity: 'approaching',
    themes: ['Food System Fragility', 'Extreme Weather Events'],
    timestamp: '2026-02-12T17:00:00Z',
  },
  {
    id: 'fp-2',
    title: 'Governance Decay Cluster',
    description: 'Three governance indicators (Polity, Corruption, Inequality) trending upward simultaneously.',
    severity: 'watch',
    themes: ['Governance Decay', 'Resource Competition'],
    timestamp: '2026-02-11T12:00:00Z',
  },
];

// Generate mock historical data for sparklines
function generateSparklineData(currentValue: number, points: number = 20): number[] {
  const data: number[] = [];
  let value = currentValue * 0.8;
  
  for (let i = 0; i < points; i++) {
    value += (Math.random() - 0.4) * 5;
    value = Math.max(0, Math.min(100, value));
    data.push(value);
  }
  
  data[data.length - 1] = currentValue;
  return data;
}

export default function BriefMode() {
  const { data: wssi, isLoading, error } = useWSSI();
  const { data: history } = useWSSIHistory(30);
  const [sortBy, setSortBy] = useState<'score' | 'name' | 'status'>('status');

  const handleExportPDF = () => {
    // PDF generation placeholder - would integrate with html2canvas + jsPDF
    const reportData = {
      timestamp: new Date().toISOString(),
      wssiScore: wssi?.wssi_score,
      themes: wssi?.theme_signals,
    };
    console.log('PDF Export:', reportData);
    alert('PDF Export functionality - would generate report with current WSSI data');
  };

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

  // Sort themes based on selected criteria
  const sortedThemes = [...wssi.theme_signals].sort((a, b) => {
    if (sortBy === 'score') {
      return b.normalized_score - a.normalized_score;
    }
    if (sortBy === 'name') {
      return a.theme_name.localeCompare(b.theme_name);
    }
    // Default: sort by status severity
    const order = { critical: 0, approaching: 1, watch: 2, stable: 3 };
    return (order[a.stress_level as keyof typeof order] || 4) - (order[b.stress_level as keyof typeof order] || 4);
  });

  // Generate sparkline color based on trend
  const getSparklineColor = (theme: any): string => {
    if (theme.stress_level === 'critical') return '#ff3864';
    if (theme.stress_level === 'approaching') return '#ff6b35';
    if (theme.stress_level === 'watch') return '#ff9f1c';
    return '#00d4aa';
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">Brief Mode</h1>
          <p className="text-text-secondary">Executive dashboard with tabular data and trend analysis.</p>
        </div>
        <button
          onClick={handleExportPDF}
          className="px-4 py-2 bg-surface border border-surface hover:border-cyan-500/50 text-text-primary rounded-lg transition-colors flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Export PDF
        </button>
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
                  <th 
                    className="px-6 py-3 text-left text-sm font-medium text-text-muted cursor-pointer hover:text-cyan-500 transition-colors"
                    onClick={() => setSortBy('name')}
                  >
                    Theme {sortBy === 'name' && '↓'}
                  </th>
                  <th className="px-6 py-3 text-left text-sm font-medium text-text-muted">Category</th>
                  <th 
                    className="px-6 py-3 text-right text-sm font-medium text-text-muted cursor-pointer hover:text-cyan-500 transition-colors"
                    onClick={() => setSortBy('score')}
                  >
                    Score {sortBy === 'score' && '↓'}
                  </th>
                  <th className="px-6 py-3 text-center text-sm font-medium text-text-muted">Trend (30d)</th>
                  <th 
                    className="px-6 py-3 text-center text-sm font-medium text-text-muted cursor-pointer hover:text-cyan-500 transition-colors"
                    onClick={() => setSortBy('status')}
                  >
                    Status {sortBy === 'status' && '↓'}
                  </th>
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
                    <td className={`px-6 py-4 text-right font-mono text-sm ${
                      theme.normalized_score > 50 ? 'text-amber-500' : 'text-cyan-500'
                    }`}>
                      {theme.normalized_score.toFixed(1)}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <Sparkline 
                        data={generateSparklineData(theme.normalized_score)}
                        width={100}
                        height={24}
                        color={getSparklineColor(theme)}
                      />
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

        {/* Flash Points Section */}
        <div className="bg-surface border border-surface rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-void flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <h2 className="text-lg font-semibold">Flash Points</h2>
            </div>
            <div className="text-sm text-text-muted">
              {mockFlashPoints.length} active correlation{mockFlashPoints.length !== 1 ? 's' : ''}
            </div>
          </div>
          
          <div className="divide-y divide-void">
            {mockFlashPoints.map((point) => (
              <div key={point.id} className="px-6 py-4 hover:bg-void/30 transition-colors">
                <div className="flex items-start justify-between mb-2">
                  <div className="font-medium text-text-primary">{point.title}</div>
                  <span className={`px-2 py-0.5 rounded text-xs font-medium border ${
                    statusBgColors[point.severity]
                  }`}>
                    {point.severity.charAt(0).toUpperCase() + point.severity.slice(1)}
                  </span>
                </div>
                <p className="text-sm text-text-secondary mb-2">{point.description}</p>
                <div className="flex items-center gap-2 text-xs text-text-muted">
                  <span>Themes: {point.themes.join(', ')}</span>
                  <span>•</span>
                  <span>{new Date(point.timestamp).toLocaleDateString()}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Sort Controls & Footer */}
        <div className="flex items-center justify-between pt-4 border-t border-void">
          <div className="flex items-center gap-4">
            <span className="text-sm text-text-muted">Sort by:</span>
            <div className="flex gap-2">
              {(['status', 'score', 'name'] as const).map((sort) => (
                <button
                  key={sort}
                  onClick={() => setSortBy(sort)}
                  className={`px-3 py-1 text-sm rounded transition-colors ${
                    sortBy === sort
                      ? 'bg-cyan-500/20 text-cyan-500 border border-cyan-500/50'
                      : 'bg-surface text-text-secondary border border-surface hover:border-cyan-500/30'
                  }`}
                >
                  {sort.charAt(0).toUpperCase() + sort.slice(1)}
                </button>
              ))}
            </div>
          </div>
          
          {wssi.calculation_timestamp && (
            <div className="text-sm text-text-muted">
              Last updated: {new Date(wssi.calculation_timestamp).toLocaleString()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
