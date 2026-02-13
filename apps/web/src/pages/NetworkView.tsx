import { useThemes } from '../hooks/useWSSI';
import CrisisNetworkGraph from '../components/CrisisNetworkGraph';

// Generate mock correlation data between themes
function generateNetworkData(themes: any[]) {
  const nodes = themes.map(theme => ({
    id: theme.theme_id,
    name: theme.theme_name,
    category: theme.category_name || 'Unknown',
    priority: theme.stress_level === 'critical' ? 'P0' :
              theme.stress_level === 'approaching' ? 'P1' :
              theme.stress_level === 'watch' ? 'P2' : 'P3',
    value: (theme.normalized_score || 0) / 100,
    stress_level: theme.stress_level,
    color: theme.category_name === 'Economic-Financial' ? '#ff3864' :
           theme.category_name === 'Climate-Environmental' ? '#00d4aa' :
           theme.category_name === 'Geopolitical-Conflict' ? '#ff9f1c' :
           theme.category_name === 'Technological' ? '#3b82f6' :
           theme.category_name === 'Biological-Health' ? '#a855f7' : '#6b7280'
  }));

  // Generate links based on category relationships
  const links: any[] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const n1 = nodes[i];
      const n2 = nodes[j];

      // Higher correlation for same category
      let correlation = 0.3;
      let type = 'cross_domain';

      if (n1.category === n2.category) {
        correlation = 0.8;
        type = 'intra_system';
      } else if (
        (n1.category === 'Economic-Financial' && n2.category === 'Geopolitical-Conflict') ||
        (n1.category === 'Geopolitical-Conflict' && n2.category === 'Economic-Financial')
      ) {
        correlation = 0.6;
        type = 'conflict_economic';
      } else if (
        (n1.category === 'Climate-Environmental' && n2.category === 'Biological-Health') ||
        (n1.category === 'Biological-Health' && n2.category === 'Climate-Environmental')
      ) {
        correlation = 0.55;
        type = 'climate_health';
      }

      // Only add link if correlation is significant
      if (correlation >= 0.3) {
        links.push({
          source: n1.id,
          target: n2.id,
          value: correlation,
          type
        });
      }
    }
  }

  return { nodes, links };
}

export default function NetworkView() {
  const { data: themes, isLoading } = useThemes();

  if (isLoading) {
    return (
      <div className="h-[calc(100vh-4rem)] flex items-center justify-center">
        <div className="text-text-secondary">Loading network visualization...</div>
      </div>
    );
  }

  const networkData = themes ? generateNetworkData(themes) : { nodes: [], links: [] };

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-surface">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">🔗 Crisis Correlation Network</h1>
            <p className="text-sm text-text-secondary mt-1">
              Visualizing interconnections between polycrisis themes
            </p>
          </div>
          <div className="text-sm text-text-muted">
            {networkData.nodes.length} nodes | {networkData.links.length} links
          </div>
        </div>
      </div>

      {/* Graph */}
      <div className="flex-1 relative overflow-hidden">
        <CrisisNetworkGraph
          data={networkData}
          width={typeof window !== 'undefined' ? window.innerWidth : 1200}
          height={typeof window !== 'undefined' ? window.innerHeight - 140 : 600}
        />

        {/* Flash Points Banner */}
        <div className="absolute top-4 right-4 bg-gradient-to-r from-red-600/80 to-orange-600/80 backdrop-blur rounded-lg p-4 text-white max-w-sm">
          <h3 className="text-sm font-semibold mb-1">⚡ Flash Point Detected</h3>
          <p className="text-xs opacity-90">
            Food System Fragility + Extreme Weather Events correlation spike
          </p>
          <p className="text-xs font-medium mt-1">Correlation: 0.87</p>
        </div>
      </div>
    </div>
  );
}
