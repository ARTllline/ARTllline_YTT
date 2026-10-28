import { useEffect, useState, useSyncExternalStore } from 'react';
import type { LiveEcho, ConnectionState } from '../realtime/useCampaignLive';
import { audioEngine } from './AudioEngine';
import { mediaApi, type MediaState, type SfxEvent } from './model';

export function useLiveMedia(
    campaignId: string,
    userId: string,
    echo: LiveEcho | null,
    connection: ConnectionState,
    sceneId: string | null,
    epoch: number,
) {
    const snapshot = useSyncExternalStore(audioEngine.subscribe, audioEngine.getSnapshot);
    const [syncError, setSyncError] = useState('');
    useEffect(() => () => audioEngine.dispose(), [campaignId]);
    useEffect(() => {
        audioEngine.alignScene(sceneId, epoch);
    }, [sceneId, epoch]);
    useEffect(() => {
        let alive = true,
            busy = false;
        audioEngine.transientBoundary();
        const abort = new AbortController();
        const refresh = () => {
            if (busy || !alive || !navigator.onLine) return;
            busy = true;
            void mediaApi
                .get(campaignId, abort.signal)
                .then((state) => {
                    if (alive) {
                        audioEngine.hydrate(state, true);
                        setSyncError('');
                    }
                })
                .catch(() => {
                    if (alive) setSyncError('Не удалось обновить звук. Повторяем подключение…');
                })
                .finally(() => {
                    busy = false;
                });
        };
        const receive = (event: { type: string; state?: MediaState } | SfxEvent) => {
            if (!alive || !navigator.onLine || connection !== 'connected') return;
            if (event.type === 'media.state' && 'state' in event && event.state)
                audioEngine.hydrate(event.state);
            if (event.type === 'media.sfx') audioEngine.sfx(event as SfxEvent);
        };
        const channel = echo?.private(`campaign.${campaignId}.media.user.${userId}`);
        channel?.listen('.tabletop', receive).subscribed(refresh);
        refresh();
        const probe = setInterval(refresh, 15000);
        const online = () => {
            audioEngine.transientBoundary();
            refresh();
        };
        window.addEventListener('online', online);
        window.addEventListener('offline', audioEngine.transientBoundary);
        return () => {
            alive = false;
            abort.abort();
            clearInterval(probe);
            window.removeEventListener('online', online);
            window.removeEventListener('offline', audioEngine.transientBoundary);
            channel?.stopListening('.tabletop', receive);
        };
    }, [campaignId, userId, echo, connection, epoch]);
    return { ...snapshot, syncError };
}
