/**
 * Invisible component: syncs CNY/KZT rate from open.er-api.com once per day at 00:03.
 * Mounted inside AppShell so it only runs when authenticated.
 */
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { settingsApi } from '../api/client';
import { startCnyAutoSync } from '../utils/cnyAutoRate';

const CnyRateSync = () => {
  const queryClient = useQueryClient();

  useEffect(() => {
    const onNewRate = async (rate) => {
      // Use dedicated CNY rate endpoint
      await settingsApi.setCnyRate(rate);
      // Invalidate queries that depend on the rate
      queryClient.invalidateQueries({ queryKey: ['settings-row'] });
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success(`Курс юаня обновлён: ${rate.toLocaleString('ru-RU')} ₸/¥`, {
        icon: '💱',
        duration: 4000,
        id: 'cny-rate-updated',
      });
    };

    const { cleanup } = startCnyAutoSync(onNewRate);
    return cleanup;
  }, [queryClient]);

  return null;
};

export default CnyRateSync;
