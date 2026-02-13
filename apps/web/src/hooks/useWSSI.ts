import { useQuery } from '@tanstack/react-query';
import { fetchCurrentWSSI, fetchWSSIHistory, fetchThemes, checkAPIHealth } from '../utils/api';

// Hook for current WSSI data
export function useWSSI() {
  return useQuery({
    queryKey: ['wssi', 'current'],
    queryFn: fetchCurrentWSSI,
    refetchInterval: 1000 * 60 * 5, // Refetch every 5 minutes
  });
}

// Hook for WSSI history
export function useWSSIHistory(days: number = 30) {
  return useQuery({
    queryKey: ['wssi', 'history', days],
    queryFn: () => fetchWSSIHistory(days),
  });
}

// Hook for themes
export function useThemes() {
  return useQuery({
    queryKey: ['themes'],
    queryFn: fetchThemes,
    refetchInterval: 1000 * 60 * 5,
  });
}

// Hook for API health status
export function useAPIHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: checkAPIHealth,
    refetchInterval: 1000 * 30, // Check every 30 seconds
  });
}
