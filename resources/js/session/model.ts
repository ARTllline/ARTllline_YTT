import { request } from '../api/client';
import { commandId } from '../api/workspace';
export const itemLabels = {
    scene: 'Сцена',
    cue: 'Событие',
    handout: 'Материал',
    encounter: 'Столкновение',
    note: 'Заметка',
    chapter: 'Глава',
};
export type ItemType = keyof typeof itemLabels;
export type ReferenceType = Exclude<ItemType, 'note' | 'chapter'>;
export interface SessionItem {
    id: string;
    type: ItemType;
    referenceId: string | null;
    title: string;
    notes: string;
    name: string;
    sceneId: string | null;
    missing: boolean;
}
export interface GameSession {
    id: string;
    name: string;
    status: 'planned' | 'active' | 'completed';
    planRevision: number;
    currentItemId: string | null;
    autoPreload: boolean;
    notes: string;
    items: SessionItem[];
    startedAt: string | null;
    endedAt: string | null;
}
export type SessionSummary = Omit<GameSession, 'items' | 'notes'>;
export interface Resource {
    id: string;
    name: string;
    sceneId: string | null;
}
export const sessions = {
    list: (campaign: string, signal?: AbortSignal) =>
        request<{ sessions: SessionSummary[]; activeId: number | null }>(
            `/campaigns/${campaign}/sessions`,
            'GET',
            undefined,
            signal,
        ),
    get: (campaign: string, id: string, signal?: AbortSignal) =>
        request<GameSession>(`/campaigns/${campaign}/sessions/${id}`, 'GET', undefined, signal),
    command: (campaign: string, action: string, data: object, id = commandId()) =>
        request<{ session: GameSession }>(`/campaigns/${campaign}/sessions/${action}`, 'POST', {
            ...data,
            clientMutationId: id,
        }),
    resources: (
        campaign: string,
        type: ReferenceType,
        search: string,
        page: number,
        signal?: AbortSignal,
    ) =>
        request<{ items: Resource[]; pages: number }>(
            `/campaigns/${campaign}/session-resources?${new URLSearchParams({ type, search, page: String(page) })}`,
            'GET',
            undefined,
            signal,
        ),
};
export function moveItem(items: SessionItem[], id: string, index: number) {
    const found = items.find((i) => i.id === id);
    if (!found) return items;
    const next = items.filter((i) => i.id !== id);
    next.splice(Math.max(0, Math.min(index, next.length)), 0, found);
    return next;
}
export function nextScene(
    session: Pick<GameSession, 'items' | 'currentItemId'>,
): SessionItem | undefined {
    const position = session.items.findIndex((i) => i.id === session.currentItemId);
    return session.items
        .slice(position + 1)
        .find((i) => i.type === 'scene' && !i.missing && i.referenceId);
}
export const itemTitle = (item: SessionItem) =>
    item.title || item.name || (item.missing ? 'Материал удалён' : itemLabels[item.type]);
