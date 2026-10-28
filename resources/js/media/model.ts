import { request } from '../api/client';
import { commandId } from '../api/workspace';
export type Channel = 'music' | 'ambient' | 'sfx';
export type Effect = 'rain' | 'snow' | 'embers' | 'haze';
export type Intensity = 'light' | 'medium' | 'strong';
export interface Track {
    id: string;
    assetId: string;
    name: string;
    url: string;
    duration: number;
    volume: number;
    loop: boolean;
    fade: number;
    startedAt: number;
    paused: boolean;
    position: number;
}
export interface MediaState {
    revision: number;
    sceneId: string | null;
    epoch: number;
    serverNow: number;
    music: Track | null;
    ambient: Track[];
    effects: Partial<Record<Effect, Intensity>>;
    volumes: Record<Channel, number>;
    fade: number;
}
export interface SfxEvent {
    type: 'media.sfx';
    eventId: string;
    sceneId: string;
    epoch: number;
    track: Track;
    volume: number;
    expiresAt: number;
}
export const channelNames = { music: 'Музыка', ambient: 'Атмосфера', sfx: 'Звуки' };
export const effectNames = { rain: 'Дождь', snow: 'Снег', embers: 'Угли', haze: 'Дымка' };
export const intensityNames = { light: 'Лёгкий', medium: 'Средний', strong: 'Сильный' };
export const isAudio = (kind: string) => ['music', 'ambient', 'sfx'].includes(kind);
export const durationLabel = (ms = 0) =>
    `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
export const playbackPosition = (track: Track, now: number) => {
    const elapsed = Math.max(0, track.paused ? track.position : now - track.startedAt);
    return track.loop ? elapsed % Math.max(1, track.duration) : Math.min(elapsed, track.duration);
};
export const mediaApi = {
    get: (campaign: string, signal?: AbortSignal) =>
        request<MediaState>(`/campaigns/${campaign}/media`, 'GET', undefined, signal),
    command: (campaign: string, action: string, config: object, id: string = commandId()) =>
        request<MediaState | { played: boolean }>(`/campaigns/${campaign}/media`, 'POST', {
            action,
            ...config,
            clientMutationId: id,
        }),
};
