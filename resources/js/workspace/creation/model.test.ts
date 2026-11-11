import { expect, it } from 'vitest';
import {
    creationFromAsset,
    placementAppearance,
    placementIdentity,
    repeatsPlacement,
    tokenDraft,
} from './model';
import type { LibraryAsset } from '../../api/preparation';
const asset = { id: '4', name: 'Гоблин', kind: 'token', width: 100, height: 100 } as LibraryAsset;
it('carries character/creature identity through native drag without overwriting a token under the cursor', () => {
    expect(creationFromAsset(asset, JSON.stringify({ assetId: '4', preset: 'enemy' }))).toEqual({
        type: 'token',
        name: 'Гоблин',
        draft: { name: 'Гоблин', kind: 'npc', disposition: 'hostile', hp: 10, asset },
    });
    expect(tokenDraft(asset, true).kind).toBe('player_character');
    expect(creationFromAsset(asset, '{bad')).toBeNull();
    expect(creationFromAsset(asset, JSON.stringify({ assetId: '8', preset: 'hero' }))).toBeNull();
    expect(creationFromAsset(asset, JSON.stringify({ assetId: '4', preset: 'prop' }))).toBeNull();
});

it('repeats independent NPC/object instances while placing a Character only once', () => {
    const npc = {
        type: 'libraryActor',
        library: 'npcs',
        actorId: '9',
        name: 'Guard',
        previewUrl: '/private/portrait',
    } as const;
    expect(repeatsPlacement(npc)).toBe(true);
    expect(repeatsPlacement({ ...npc, library: 'characters' })).toBe(false);
    expect(placementAppearance(npc).url).toBe('/private/portrait');
    const prop = {
        type: 'prop',
        asset: { ...asset, kind: 'prop' as const },
        name: 'Chest',
    } as const;
    expect(repeatsPlacement({ ...prop, purpose: 'container' })).toBe(true);
    expect(repeatsPlacement({ ...prop, purpose: 'interaction' })).toBe(true);
    expect(placementIdentity({ ...prop, purpose: 'container' })).not.toBe(
        placementIdentity({ ...prop, purpose: 'interaction' }),
    );
    expect(placementAppearance(prop).prop).toBe(prop.asset);
});
