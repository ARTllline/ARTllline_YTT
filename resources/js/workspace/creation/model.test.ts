import { expect, it } from 'vitest';
import { creationFromAsset, tokenDraft } from './model';
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
