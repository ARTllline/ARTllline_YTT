import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AdventuringHUD, ExhaustionBadge, LifeSummary, type LifeState } from './adventuring';
import { GMRestControls, GMLifecycleControls } from '../workspace/combat/AdventuringControls';
import { SceneStore } from '../tabletop/state/SceneStore';
import { createDemoScene } from '../tabletop/state/demoScene';
import { reduceEvent } from '../realtime/protocol';
import type { Character } from '../tabletop/types/scene';

const dying: LifeState = {
    status: 'dying',
    successes: 2,
    failures: 1,
    requiredTurn: '1:3',
    resolvedTurn: null,
    cause: 'zero_hp',
};
function fixture(state: LifeState = dying) {
    const scene = createDemoScene();
    scene.id = '1';
    scene.campaignId = '1';
    scene.revision = 5;
    const character: Character = {
        id: '5',
        name: 'Kern',
        portrait: null,
        ownerUserId: '2',
        kind: 'player_character',
        disposition: 'friendly',
        hp: 0,
        maxHp: 30,
        checkStats: [],
        lifecycle: state,
        exhaustion: 2,
    };
    const actor = {
        ...scene.tokens[0],
        id: 'actor',
        characterId: '5',
        hp: 0,
        maxHp: 30,
        lifecycle: state,
        exhaustion: 2,
    };
    scene.tokens = [actor];
    scene.characters = [character];
    scene.combat = {
        id: '1',
        status: 'active',
        round: 1,
        currentTurn: { combatantId: 'entry' },
        combatants: [{ id: 'entry', tokenId: actor.id, initiative: 20 }],
    };
    return { scene, character, actor, store: new SceneStore(scene, 'gm') };
}
it('shows separate successes and failures and a prominent required death save', () => {
    const f = fixture();
    const html = renderToStaticMarkup(<AdventuringHUD {...f} disabled={false} />);
    expect(html).toContain('Успехи: 2');
    expect(html).toContain('Провалы: 1');
    expect(html).toContain('Бросить Death Save');
    expect(html).not.toContain('death-save-button" disabled');
});
it('does not offer another death save on the same turn', () => {
    const f = fixture({ ...dying, resolvedTurn: dying.requiredTurn });
    const html = renderToStaticMarkup(<AdventuringHUD {...f} disabled={false} />);
    expect(html).toContain('death-save-button" disabled');
});
it('keeps stable and dead states restrained and excludes death save controls', () => {
    for (const status of ['stable', 'dead'] as const) {
        const f = fixture({ ...dying, status });
        const html = renderToStaticMarkup(<AdventuringHUD {...f} disabled={false} />);
        expect(html).toContain(status === 'stable' ? 'Стабилен' : 'Мёртв');
        expect(html).not.toContain('death-save-button');
    }
    expect(renderToStaticMarkup(<LifeSummary state={{ ...dying, status: 'alive' }} />)).toBe('');
});
it('shows exhaustion mechanics instead of requiring remembered penalties', () => {
    const html = renderToStaticMarkup(<ExhaustionBadge level={3} />);
    expect(html).toContain('Exhaustion 3');
    expect(html).toContain('D20 Tests −6');
    expect(html).toContain('−15 ft');
    expect(renderToStaticMarkup(<ExhaustionBadge level={0} />)).toBe('');
});
it('renders multiple die pools and server roll provenance during short rest', () => {
    const f = fixture({ ...dying, status: 'alive' });
    f.character.hitPointDice = [
        { die: 'd10', max: 4, current: 2 },
        { die: 'd6', max: 2, current: 1 },
    ];
    f.character.rest = {
        id: 'rest',
        kind: 'short-rest',
        status: 'spending',
        changes: [],
        rolls: [{ die: 'd10', roll: 7, con: 2, recovered: 9 }],
    };
    const html = renderToStaticMarkup(<AdventuringHUD {...f} disabled={false} />);
    expect(html).toContain('d10');
    expect(html).toContain('d6');
    expect(html).toContain('×2 / 4');
    expect(html).toContain('CON +2');
    expect(html).toContain('+9');
    expect(html).toContain('Завершить отдых');
});
it('long rest summary includes only actual server changes', () => {
    const f = fixture({ ...dying, status: 'alive' });
    f.character.rest = {
        id: 'rest',
        kind: 'long-rest',
        status: 'complete',
        changes: ['HP 10 → 30', 'Exhaustion 2 → 1'],
        rolls: [],
    };
    const html = renderToStaticMarkup(<AdventuringHUD {...f} disabled={false} />);
    expect(html).toContain('Long Rest завершён');
    expect(html).toContain('HP 10 → 30');
    expect(html).not.toContain('Spell Slots restored');
});
it('puts rest and lifecycle corrections directly in the GM console', () => {
    const f = fixture();
    const html = renderToStaticMarkup(
        <>
            <GMRestControls store={f.store} disabled={false} />
            <GMLifecycleControls token={f.actor} store={f.store} disabled={false} />
        </>,
    );
    for (const label of [
        'Short Rest',
        'Long Rest',
        'Стабилизировать',
        'Сбросить Death Saves',
        'Вернуть к жизни',
        'Exhaustion',
        'Hit Point Dice',
    ])
        expect(html).toContain(label);
});
it('realtime reconstructs persistent lifecycle and rest without local counters', () => {
    const f = fixture();
    const updated = {
        ...f.character,
        lifecycle: { ...dying, status: 'stable' as const, successes: 0, failures: 0 },
        exhaustion: 1,
    };
    const next = reduceEvent(f.scene, {
        type: 'lifecycle.updated',
        sceneId: '1',
        revision: 6,
        mutationId: 'id',
        payload: { scene: { characters: [updated] } },
    });
    expect(next).not.toBe('gap');
    if (next !== 'gap') {
        expect(next.characters?.[0].lifecycle?.status).toBe('stable');
        expect(next.characters?.[0].exhaustion).toBe(1);
    }
});
