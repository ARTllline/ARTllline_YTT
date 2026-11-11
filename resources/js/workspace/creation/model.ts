import type { LibraryAsset } from '../../api/preparation';
import type { ContentTemplate } from '../../api/objects';
import type { Token } from '../../tabletop/types/scene';
import type { ObjectPreset } from '../../tabletop/objects/collider';

export const presets = {
    hero: { label: 'Герой', kind: 'player_character', disposition: 'friendly' },
    ally: { label: 'Союзник', kind: 'npc', disposition: 'friendly' },
    neutral: { label: 'Нейтральный', kind: 'npc', disposition: 'neutral' },
    enemy: { label: 'Враг', kind: 'npc', disposition: 'hostile' },
} as const;
export interface TokenDraft {
    characterId?: string;
    name: string;
    kind: Token['kind'];
    disposition: NonNullable<Token['disposition']>;
    hp: number;
    asset?: LibraryAsset;
}
export type Placement =
    | { type: 'composition'; preset: import('../../api/compositions').CompositionPreset; name: string }
    | {
          type: 'libraryActor';
          encounter?: {id: string; groupId: string};
          actorId: string;
          library: 'characters' | 'npcs';
          name: string;
          previewUrl?: string;
      }
    | { type: 'token'; draft: TokenDraft; name: string }
    | { type: 'prop'; asset: LibraryAsset; name: string; purpose?: 'container' | 'interaction' }
    | {
          type: 'objectPreset';
          preset: ObjectPreset;
          name: string;
          rotation: number;
          scaleFactor: number;
      }
    | { type: 'template'; template: Pick<ContentTemplate, 'id' | 'kind' | 'name'>; name: string }
    | { type: 'note' | 'region'; name: string };
export const CREATION_MIME = 'application/x-ytt-creation';
export const repeatsPlacement = (item: Placement) =>
    item.type === 'composition' ||
    item.type === 'prop' ||
    item.type === 'objectPreset' ||
    (item.type === 'libraryActor' && item.library === 'npcs');
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

export function placementAppearance(item: Placement) {
    const asset =
        item.type === 'token' ? item.draft.asset : item.type === 'prop' ? item.asset : undefined;
    const preset = item.type === 'objectPreset' ? item.preset : undefined;
    return {
        url: item.type === 'libraryActor' ? item.previewUrl : (preset?.asset.url ?? asset?.url),
        prop: item.type === 'prop' ? item.asset : undefined,
        settings: preset?.settings,
        rotation: item.type === 'objectPreset' ? item.rotation : 0,
        scale: item.type === 'objectPreset' ? item.scaleFactor : 1,
    };
}

export function placementIdentity(item: Placement): string {
    if (item.type === 'composition') return `composition:${item.preset.id}`;
    if (item.type === 'libraryActor') return `${item.library}:${item.actorId}`;
    if (item.type === 'prop') return `prop:${item.purpose ?? 'prop'}:${item.asset.id}`;
    if (item.type === 'objectPreset') return `preset:${item.preset.id}`;
    return item.type;
}
