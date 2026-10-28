import { useEffect, useState } from 'react';
import Echo from 'laravel-echo';
import Pusher from 'pusher-js';
import { api, realtimeConfig, type Campaign } from '../api/workspace';
import { bindSocket, getCsrf } from '../api/client';
export type LiveEcho = Echo<'reverb'>;
export type Member = { id: string; name: string; role: string };
export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'offline';
export function useCampaignLive(id: string, onCampaign: (campaign: Campaign) => void) {
    const [echo, setEcho] = useState<LiveEcho | null>(null);
    const [connection, setConnection] = useState<ConnectionState>('connecting');
    const [members, setMembers] = useState<Member[]>([]);
    useEffect(() => {
        let alive = true;
        let generation = 0;
        let controller: AbortController | undefined;
        const refresh = () => {
            if (!alive) return;
            const current = ++generation;
            controller?.abort();
            controller = new AbortController();
            void api
                .campaign(id, controller.signal)
                .then((c) => {
                    if (alive && current === generation) onCampaign(c);
                })
                .catch(() => {
                    /* Scene sync and connection badge expose transient failures. */
                });
        };
        const config = realtimeConfig;
        const client = new Echo<'reverb'>({
            broadcaster: 'reverb',
            Pusher,
            key: config.key,
            wsHost: config.host,
            wsPort: config.port,
            wssPort: config.port,
            forceTLS: config.scheme === 'https',
            enabledTransports: ['ws', 'wss'],
            disableStats: true,
            authEndpoint: '/broadcasting/auth',
            auth: { headers: { 'X-CSRF-TOKEN': getCsrf(), Accept: 'application/json' } },
        });
        bindSocket(() => client.socketId());
        const transport = client.connector.pusher.connection;
        let connectedOnce = false;
        const state = ({ current }: { current: string }) => {
            if (!alive) return;
            if (current === 'connected') {
                connectedOnce = true;
                setEcho(client);
                setConnection('connected');
                refresh();
            } else {
                setMembers([]);
                setConnection(
                    current === 'failed' || current === 'unavailable'
                        ? 'offline'
                        : connectedOnce
                          ? 'reconnecting'
                          : 'connecting',
                );
            }
        };
        transport.bind('state_change', state);
        client.private(`campaign.${id}.control`).listen('.tabletop', refresh).subscribed(refresh);
        client
            .join(`campaign.${id}`)
            .here((all: Member[]) => {
                if (alive) setMembers(all);
            })
            .joining((member: Member) => {
                if (alive)
                    setMembers((previous) => [
                        ...previous.filter((m) => m.id !== member.id),
                        member,
                    ]);
            })
            .leaving((member: Member) => {
                if (alive) setMembers((previous) => previous.filter((m) => m.id !== member.id));
            });
        // Also repairs a missed final broadcast when HTTP committed during a broker outage.
        const probe = setInterval(refresh, 15000);
        window.addEventListener('online', refresh);
        return () => {
            alive = false;
            controller?.abort();
            clearInterval(probe);
            window.removeEventListener('online', refresh);
            transport.unbind('state_change', state);
            client.disconnect();
            bindSocket(() => undefined);
        };
    }, [id, onCampaign]);
    return { echo, connection, members };
}
