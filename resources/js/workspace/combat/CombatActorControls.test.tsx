import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CombatActorControls } from './CombatActorControls';
import { SceneStore } from '../../tabletop/state/SceneStore';
import { createDemoScene } from '../../tabletop/state/demoScene';
import type { Ability } from '../../gameplay/model';

it('offers the persistent NPC actions when token projection has no private ability copy', () => {
    const scene = createDemoScene();
    const token = { ...scene.tokens[2], characterId: 'npc', abilities: [] };
    const ability = { id: 'attack', name: 'Shortbow', target: 'token' } as Ability;
    scene.characters = [
        { id: 'npc', kind: 'npc', abilities: [ability] } as NonNullable<
            typeof scene.characters
        >[number],
    ];
    const store = new SceneStore(scene);
    const html = renderToStaticMarkup(<CombatActorControls token={token} store={store} />);
    expect(html).toContain('Shortbow');
    expect(html).toContain('Действия NPC');
    expect(html).not.toContain('Цель NPC');
    expect(html).not.toContain('<select');
});
