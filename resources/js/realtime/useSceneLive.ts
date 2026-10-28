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
    const [status, setStatus] = useState('Syncing scene…');
    useEffect(() => {
        if (!echo || !channel) return;
        const subscriber = new SceneSubscriber(echo, channel, store, queue, setStatus);
        return () => subscriber.destroy();
    }, [echo, channel, store, queue]);
    useEffect(() => {
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
