import { useEffect } from 'react';
import { checkServerVersion } from '@/shared/config/serverCompat';
import { getServerHealth } from '@/shared/queries';
import { useMaintenanceStore } from '@/shared/stores/maintenanceStore';

export function useHealthCheck() {
  const { isMaintenanceMode, setMaintenanceMode } = useMaintenanceStore();

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const health = await getServerHealth();
        setMaintenanceMode(false);
        checkServerVersion(health.version);
      } catch (error: any) {
        if (error?.response?.status === 503) {
          setMaintenanceMode(true);
        }
      }
    };

    checkHealth();
  }, [setMaintenanceMode]);

  // Poll while in maintenance mode to detect recovery
  useEffect(() => {
    if (!isMaintenanceMode) return;

    const interval = setInterval(async () => {
      try {
        await getServerHealth();
        setMaintenanceMode(false);
      } catch {
        // still in maintenance
      }
    }, 30_000);

    return () => clearInterval(interval);
  }, [isMaintenanceMode, setMaintenanceMode]);

  return isMaintenanceMode;
}
