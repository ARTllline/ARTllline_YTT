import type { LibraryAsset } from '../../api/preparation';
import type { ContentTemplate } from '../../api/objects';
import type { Token } from '../../tabletop/types/scene';

export const presets = {
    hero: { label: 'Герой', kind: 'player_character', disposition: 'friendly' },
    ally: { label: 'Союзник', kind: 'npc', disposition: 'friendly' },
    neutral: { label: 'Нейтральный', kind: 'npc', disposition: 'neutral' },
    enemy: { label: 'Враг', kind: 'npc', disposition: 'hostile' },
} as const;
export interface TokenDraft {
    name: string;
    kind: Token['kind'];
    disposition: NonNullable<Token['disposition']>;
    hp: number;
    asset?: LibraryAsset;
}
export type Placement =
    | { type: 'token'; draft: TokenDraft; name: string }
    | { type: 'prop'; asset: LibraryAsset; name: string }
    | { type: 'template'; template: Pick<ContentTemplate, 'id' | 'kind' | 'name'>; name: string }
    | { type: 'note' | 'region'; name: string };
export const CREATION_MIME = 'application/x-ytt-creation';
export function tokenDraft(asset: LibraryAsset | undefined, hero: boolean): TokenDraft {
    const { kind, disposition } = hero ? presets.hero : presets.enemy;
    return { name: asset?.name.slice(0, 80) ?? '', kind, disposition, hp: 10, asset };
}
export function creationFromAsset(asset: LibraryAsset, raw: string): Placement | null {
    try {
        const data = JSON.parse(raw);
        if (data.assetId !== asset.id) return null;
        if (asset.kind === 'prop' && data.preset === 'prop')
            return { type: 'prop', asset, name: asset.name };
        if (asset.kind === 'token' && ['hero', 'enemy'].includes(data.preset))
            return {
                type: 'token',
                name: asset.name,
                draft: tokenDraft(asset, data.preset === 'hero'),
            };
    } catch {
        /* Ignore unrelated native drag payloads. */
    }
    return null;
}
