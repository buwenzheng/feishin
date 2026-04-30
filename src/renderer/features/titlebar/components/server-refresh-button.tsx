import { useQueryClient } from '@tanstack/react-query';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { RefreshButton } from '/@/renderer/features/shared/components/refresh-button';
import { useCurrentServerId } from '/@/renderer/store/auth.store';
import { toast } from '/@/shared/components/toast/toast';

export const ServerRefreshButton = memo(() => {
    const serverId = useCurrentServerId();
    const queryClient = useQueryClient();
    const { t } = useTranslation();
    const [isRefreshing, setIsRefreshing] = useState(false);

    const handleRefresh = useCallback(async () => {
        if (!serverId) return;

        setIsRefreshing(true);

        try {
            queryClient.removeQueries({
                predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === serverId,
            });

            toast.success({
                message: t('common.refreshCompleted', { postProcess: 'sentenceCase' }),
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            toast.error({
                message: `${t('common.refreshFailed', { postProcess: 'sentenceCase' })}: ${message}`,
            });
        } finally {
            setIsRefreshing(false);
        }
    }, [serverId, queryClient, t]);

    if (!serverId) {
        return null;
    }

    return <RefreshButton disabled={isRefreshing} loading={isRefreshing} onClick={handleRefresh} />;
});
