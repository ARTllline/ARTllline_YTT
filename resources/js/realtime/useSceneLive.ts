import { t } from '../i18n';
import { useEffect, useState } from 'react';
import type { SceneStore } from '../tabletop/state/SceneStore';
import type { SaveQueue } from '../tabletop/state/SaveQueue';
import type { LiveEcho, ConnectionState } from './useCampaignLive';
import { SceneSubscriber } from './SceneSubscriber';
export function useSceneLive(
    echo: LiveEcho | null,
    channel: string | null,
    store: SceneStore,
    queue: SaveQueue,
    connection: ConnectionState,
) {
    const [status, setStatus] = useState(t('Syncing scene…'));
    useEffect(() => {
        const transport = echo?.connector.pusher.connection;
        const stop = ({ current }: { current: string }) => {
            if (current !== 'connected') {
                store.spatial.setConnected(false);
                if (store.role === 'player') store.setMovementEnabled(false);
            }
            if (current !== 'connected' && store.getSnapshot().directControl) {
                store.stopDirectControl?.();
                store.setDirectNotice('Связь прервана. Включите WASD снова после синхронизации.');
            }
        };
        // Pusher emits this immediately on close, but leaves state='connected'
        // throughout its one-second retry delay. Do not keep accepting input then.
        const retry = () => stop({ current: 'connecting' });
        transport?.bind('state_change', stop);
        transport?.bind('connecting_in', retry);
        return () => {
            transport?.unbind('state_change', stop);
            transport?.unbind('connecting_in', retry);
        };
    }, [echo, store]);
    useEffect(() => {
        if (!echo || !channel) return;
        const subscriber = new SceneSubscriber(echo, channel, store, queue, setStatus);
        return () => subscriber.destroy();
    }, [echo, channel, store, queue]);
    useEffect(() => {
        store.spatial.setConnected(connection === 'connected');
        const update = () => {
            if (store.role === 'player')
                store.setMovementEnabled(
                    connection === 'connected' &&
                        status === '' &&
                        queue.getSnapshot().status !== 'failed',
                );
        };
        update();
        return queue.subscribe(update);
    }, [store, queue, connection, status]);
    return status;
}
