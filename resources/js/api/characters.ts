import { request } from './client';
import { commandId } from './workspace';
import type { Character } from '../tabletop/types/scene';
import type { DerivedCharacter } from '../rpg/rules';

export interface CharacterRoster {
    characters: Character[];
    activeCharacterId: string | null;
}
export const charactersApi = {
    preview: (campaign: string, character: Character, signal?: AbortSignal) =>
        request<{ derived: DerivedCharacter }>(
            `/campaigns/${campaign}/character-rules/preview`,
            'POST',
            {
                id: character.id,
                rules: character.rules,
                ac: character.ac ?? null,
                speed: character.speed ?? null,
                check_stats: character.checkStats,
            },
            signal,
        ),
    list: (campaign: string, signal?: AbortSignal) =>
        request<CharacterRoster>(`/campaigns/${campaign}/characters`, 'GET', undefined, signal),
    save: (campaign: string, character: Character) =>
        request<{ character: Character }>(`/campaigns/${campaign}/characters`, 'POST', {
            id: character.id,
            name: character.name,
            rules: character.rules,
            owner_user_id: character.ownerUserId,
            check_stats: character.checkStats,
            ac: character.ac ?? null,
            speed: character.speed ?? null,
            resources: character.resources ?? [],
            abilities: character.abilities ?? [],
            clientMutationId: commandId(),
        }),
    select: (campaign: string, id: string | null) =>
        request<CharacterRoster>(`/campaigns/${campaign}/active-character`, 'PUT', {
            character_id: id,
        }),
};
