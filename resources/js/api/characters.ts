import { request } from './client';
import { commandId } from './workspace';
import type { Character } from '../tabletop/types/scene';

export interface CharacterRoster {
    characters: Character[];
    activeCharacterId: string | null;
}
export const charactersApi = {
    list: (campaign: string, signal?: AbortSignal) =>
        request<CharacterRoster>(`/campaigns/${campaign}/characters`, 'GET', undefined, signal),
    save: (campaign: string, character: Character) =>
        request<{ character: Character }>(`/campaigns/${campaign}/characters`, 'POST', {
            id: character.id,
            name: character.name,
            owner_user_id: character.ownerUserId,
            check_stats: character.checkStats,
            clientMutationId: commandId(),
        }),
    select: (campaign: string, id: string | null) =>
        request<CharacterRoster>(`/campaigns/${campaign}/active-character`, 'PUT', {
            character_id: id,
        }),
};
