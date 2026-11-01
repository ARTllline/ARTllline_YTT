import { request } from './client';
import { commandId } from './workspace';
import type { Character } from '../tabletop/types/scene';
import type { DerivedCharacter } from '../rpg/rules';

export interface CharacterRoster {
    characters: Character[];
    activeCharacterId: string | null;
}
export const charactersApi = {
    preview: (campaign: string | null, character: Character, signal?: AbortSignal) =>
        request<{ derived: DerivedCharacter }>(
            campaign
                ? `/campaigns/${campaign}/character-rules/preview`
                : '/library/character-rules/preview',
            'POST',
            {
                id: character.id || undefined,
                rules: character.rules,
                ac: character.ac ?? null,
                speed: character.speed ?? null,
                check_stats: character.checkStats,
            },
            signal,
        ),
    library: (signal?: AbortSignal) =>
        request<CharacterRoster>('/library/characters', 'GET', undefined, signal),
    list: (campaign: string, signal?: AbortSignal) =>
        request<CharacterRoster>(`/campaigns/${campaign}/characters`, 'GET', undefined, signal),
    save: (
        campaign: string | null,
        character: Character,
        loadout?: {
            starting_items: { definitionId: string; quantity: number }[];
            starting_spells: number[];
        },
    ) =>
        request<{ character: Character }>(
            campaign ? `/campaigns/${campaign}/characters` : '/library/characters',
            'POST',
            {
                ...(!campaign ? { campaign_id: character.campaignId ?? null } : {}),
                id: character.id || undefined,
                ...loadout,
                origin: character.origin,
                name: character.name,
                portrait_asset_id: character.portrait?.id ?? null,
                hp: character.hp,
                max_hp: character.maxHp,
                exhaustion: character.exhaustion,
                hit_point_dice: character.hitPointDice,
                rules: character.rules,
                owner_user_id: character.ownerUserId,
                check_stats: character.checkStats,
                ac: character.ac ?? null,
                speed: character.speed ?? null,
                resources: character.resources ?? [],
                abilities: character.abilities ?? [],
                clientMutationId: commandId(),
            },
        ),
    delete: (campaign: string | null, id: string) =>
        request(
            campaign ? `/campaigns/${campaign}/characters/${id}` : `/library/characters/${id}`,
            'DELETE',
            {
                clientMutationId: commandId(),
            },
        ),
    select: (campaign: string, id: string | null) =>
        request<CharacterRoster>(`/campaigns/${campaign}/active-character`, 'PUT', {
            character_id: id,
        }),
};
