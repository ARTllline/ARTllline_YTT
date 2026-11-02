import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SelectionContext } from './SelectionContext';
import { SceneStore } from '../../tabletop/state/SceneStore';
import { createDemoScene } from '../../tabletop/state/demoScene';
import type { Ability } from '../../gameplay/model';

it('presents projected vitals and existing runtime actions without authoring fields', () => {
    const scene = createDemoScene();
    const token = { ...scene.tokens[0], hp: 12, maxHp: 20, ac: 17, characterId: 'hero' };
    scene.characters = [
        {
            id: 'hero',
            kind: 'player_character',
            abilities: [{ id: 'dodge', name: 'Dodge', target: 'self' } as Ability],
        } as NonNullable<typeof scene.characters>[number],
    ];
    const store = new SceneStore(scene);
    const html = renderToStaticMarkup(
        <SelectionContext
            token={token}
            store={store}
            disabled={false}
            onExpand={() => {}}
            onClose={() => {}}
        />,
    );
    expect(html).toContain('AC 17');
    expect(html).toContain('12');
    expect(html).toContain('20');
    expect(html).toContain('Dodge');
    expect(html).toContain('Урон:');
    expect(html).toContain('Лечение:');
    expect(html).toContain('Состояние +');
    expect(html).toContain('runtime-health-bar');
    expect(html).not.toContain('Установить HP');
    expect(html).not.toContain('Token name');
    expect(html).not.toContain('combat-profile-editor');
});

it('blocks quick mutations while the authoritative save queue is unresolved', () => {
    const store = new SceneStore(createDemoScene());
    const html = renderToStaticMarkup(
        <SelectionContext
            token={store.getSnapshot().scene.tokens[0]}
            store={store}
            disabled
            onExpand={() => {}}
            onClose={() => {}}
        />,
    );
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Урон:/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Лечение:/);
});
