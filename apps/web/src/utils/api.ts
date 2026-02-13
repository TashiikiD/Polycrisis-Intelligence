// API client for WSSI data
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export interface WSSIResponse {
  wssi_value: number;
  wssi_score: number;
  wssi_delta: number;
  trend: 'up' | 'down' | 'stable';
  stress_level: string;
  active_themes: number;
  above_warning: number;
  calculation_timestamp: string;
  theme_signals: ThemeSignal[];
  dominant_category?: string;
}

export interface ThemeSignal {
  theme_id: string;
  theme_name: string;
  category: string;
  raw_value: number;
  normalized_value: number;
  stress_level: 'stable' | 'watch' | 'approaching' | 'critical';
  weight: number;
  weighted_contribution: number;
}

export interface HistoricalData {
  dates: string[];
  wssi_scores: number[];
  wssi_values: number[];
}

// Fetch current WSSI data
export async function fetchCurrentWSSI(): Promise<WSSIResponse> {
  try {
    const response = await fetch(`${API_BASE_URL}/wssi/current`);
    if (!response.ok) throw new Error('Failed to fetch WSSI data');
    return response.json();
  } catch (error) {
    console.warn('API unavailable, using fallback data:', error);
    // Fallback to local JSON file
    const response = await fetch('/dashboard/v2/data/wssi-latest.json');
    return response.json();
  }
}

// Fetch historical WSSI data
export async function fetchWSSIHistory(days: number = 30): Promise<HistoricalData> {
  try {
    const response = await fetch(`${API_BASE_URL}/wssi/history?days=${days}`);
    if (!response.ok) throw new Error('Failed to fetch history');
    return response.json();
  } catch (error) {
    console.warn('API unavailable for history:', error);
    return { dates: [], wssi_scores: [], wssi_values: [] };
  }
}

// Fetch all themes
export async function fetchThemes(): Promise<ThemeSignal[]> {
  try {
    const response = await fetch(`${API_BASE_URL}/themes`);
    if (!response.ok) throw new Error('Failed to fetch themes');
    return response.json();
  } catch (error) {
    console.warn('API unavailable for themes:', error);
    const wssi = await fetchCurrentWSSI();
    return wssi.theme_signals;
  }
}

// Health check
export async function checkAPIHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/health`, { 
      method: 'HEAD',
      signal: AbortSignal.timeout(3000)
    });
    return response.ok;
  } catch {
    return false;
  }
}
