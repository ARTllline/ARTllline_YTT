import { useEffect, useState } from 'react';
import { request } from '../api/client';
import type { ConnectionState, LiveEcho } from '../realtime/useCampaignLive';
import { resourceCache, type PreloadManifest } from './ResourceCache';

export function usePlayerPreload(
    campaignId: string,
    echo: LiveEcho | null,
    connection: ConnectionState,
) {
    const [status, setStatus] = useState('');
    const [retry, setRetry] = useState(0);
    useEffect(() => {
        let alive = true,
            pending = false,
            activeId = '',
            loaded = 0;
        let state: 'waiting' | 'loading' | 'ready' | 'failed' = 'waiting';
        let download: AbortController | undefined;
        const read = new AbortController(),
            clientId = crypto.randomUUID();
        const base = `/campaigns/${campaignId}/preload`;
        let lastAck = 0;
        let acknowledgements = Promise.resolve();
        const acknowledge = async () => {
            if (!alive || !activeId || !navigator.onLine) return;
            lastAck = Date.now();
            const data = {
                batchId: activeId,
                clientId,
                status: state,
                loaded,
            };
            acknowledgements = acknowledgements.then(async () => {
                if (!alive || data.batchId !== activeId) return;
                await request(`${base}/readiness`, 'POST', data, read.signal).catch(
                    () => undefined,
                );
            });
            await acknowledgements;
        };
        const refresh = async () => {
            if (!alive || pending || !navigator.onLine || connection !== 'connected') return;
            pending = true;
            try {
                const { manifest } = await request<{ manifest: PreloadManifest | null }>(
                    base,
                    'GET',
                    undefined,
                    read.signal,
                );
                if (!alive) return;
                if (!manifest) {
                    download?.abort();
                    activeId = '';
                    setStatus('');
                    return;
                }
                if (activeId !== manifest.id) {
                    download?.abort();
                    download = new AbortController();
                    const task = download;
                    activeId = manifest.id;
                    loaded = 0;
                    state = 'loading';
                    setStatus('Подготовка следующей сцены…');
                    await acknowledge();
                    void resourceCache
                        .prepare(manifest, task.signal, (count) => {
                            loaded = count;
                            if (Date.now() - lastAck > 1000) void acknowledge();
                        })
                        .then(() => {
                            if (!alive || task.signal.aborted) return;
                            state = 'ready';
                            setStatus('');
                            void acknowledge();
                        })
                        .catch(() => {
                            if (!alive || task.signal.aborted) return;
                            task.abort();
                            state = 'failed';
                            setStatus('Подготовка не завершена');
                            void acknowledge();
                        });
                } else await acknowledge();
            } catch {
                /* Connection badge owns transport errors; next probe repairs. */
            } finally {
                pending = false;
            }
        };
        const changed = () => {
            void refresh();
        };
        const offline = () => {
            download?.abort();
            activeId = '';
            setStatus('');
        };
        const channel = echo?.private(`campaign.${campaignId}.control`);
        channel?.listen('.tabletop', changed);
        const timer = setInterval(changed, 5000);
        window.addEventListener('online', changed);
        window.addEventListener('offline', offline);
        changed();
        return () => {
            alive = false;
            read.abort();
            download?.abort();
            clearInterval(timer);
            channel?.stopListening('.tabletop', changed);
            window.removeEventListener('online', changed);
            window.removeEventListener('offline', offline);
        };
    }, [campaignId, echo, connection, retry]);
    useEffect(() => () => resourceCache.clear(), [campaignId]);
    return { status, retry: () => setRetry((n) => n + 1) };
}
