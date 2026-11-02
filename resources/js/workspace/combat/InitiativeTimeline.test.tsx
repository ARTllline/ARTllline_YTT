import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SceneStore } from '../../tabletop/state/SceneStore';
import { createDemoScene } from '../../tabletop/state/demoScene';
import { InitiativeTimeline } from './InitiativeTimeline';

function fixture() {
    const scene = createDemoScene();
    scene.combat = {
        id: 'combat',
        status: 'active',
        round: 3,
        currentTurn: { combatantId: 'a' },
        combatants: scene.tokens.map((t, i) => ({
            id: i === 0 ? 'a' : String(i),
            tokenId: t.id,
            initiative: 20 - i,
        })),
    };
    return new SceneStore(scene, 'player');
}

it('shows current and next combatants without encounter controls and follows token selection', () => {
    const store = fixture();
    const [current, next] = store.getSnapshot().scene.tokens;
    store.select(next.id);
    const html = renderToStaticMarkup(<InitiativeTimeline store={store} />);
    expect(html).toContain('Раунд 3');
    expect(html).toContain(`Ход: ${current.name}`);
    expect(html).toContain(`Далее: ${next.name}`);
    expect(html).toContain(`data-token-id="${current.id}"`);
    expect(html).toContain('aria-current="step"');
    expect(html).toContain(`data-token-id="${next.id}"`);
    expect(html).toContain('aria-pressed="true"');
    expect(html).not.toContain('Следующий ход');
    expect(html).not.toContain('Инициатива ГМ');
});

it('keeps a hidden GM turn anonymous, including when no participants are visible', () => {
    const store = fixture();
    const scene = store.getSnapshot().scene;
    store.reconcile({
        ...scene,
        combat: { ...scene.combat!, combatants: [], currentTurn: { gmHiddenTurn: true } },
    });
    const html = renderToStaticMarkup(<InitiativeTimeline store={store} />);
    expect(html).toContain('Ход ГМ');
    expect(html).not.toContain('Далее:');
    expect(html).not.toContain('timeline-card ');
    expect(html).not.toContain(scene.tokens[0].name);
});

it('reflects authoritative turn/HP/lifecycle changes after reconciliation and disappears outside combat', () => {
    const store = fixture();
    const scene = store.getSnapshot().scene;
    const token = scene.tokens[1];
    token.hp = 0;
    token.lifecycle = {
        status: 'dead',
        successes: 0,
        failures: 3,
        requiredTurn: null,
        resolvedTurn: null,
        cause: null,
    };
    token.conditions = [{ id: 'c', key: 'poisoned', label: 'Отравлен' }];
    store.reconcile({
        ...scene,
        combat: { ...scene.combat!, round: 4, currentTurn: { combatantId: '1' } },
    });
    const html = renderToStaticMarkup(<InitiativeTimeline store={store} />);
    expect(html).toContain(`Ход: ${token.name}`);
    expect(html).toContain('Раунд 4');
    expect(html).toContain('is-dead');
    expect(html).toContain('Мёртв');
    expect(html).toContain('Отравлен');
    store.reconcile({ ...scene, combat: null });
    expect(renderToStaticMarkup(<InitiativeTimeline store={store} />)).toBe('');
});
