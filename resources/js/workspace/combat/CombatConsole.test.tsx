import { expect, it, vi, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SceneStore } from '../../tabletop/state/SceneStore';
import { SaveQueue } from '../../tabletop/state/SaveQueue';
import { createDemoScene } from '../../tabletop/state/demoScene';
import { CombatPanel } from './CombatPanel';
import { CombatActorControls } from './CombatActorControls';
import { CombatResults } from './CombatResults';
import { GMQuickCheck } from './GMQuickCheck';
import { GMResolutionQueue } from './GMResolutionQueue';
import { eventSummary, logMatches } from './CombatHistory';
import type { SessionResult } from './sessionModel';
import type { Ability } from '../../gameplay/model';
function fixture(role: 'gm' | 'player' = 'gm') {
    const s = createDemoScene();
    s.tokens = s.tokens.map((t) => ({ ...t, ac: 16 }));
    s.id = '1';
    s.campaignId = '1';
    s.combat = {
        id: 'combat',
        status: 'active',
        round: 3,
        currentTurn: { combatantId: 'a' },
        combatants: s.tokens.map((t, i) => ({
            id: i === 0 ? 'a' : String(i),
            tokenId: t.id,
            initiative: 20 - i,
            budget: {
                ownTurn: i === 0,
                action: false,
                bonus_action: true,
                reaction: true,
                movementSpent: 15,
                movementRemaining: 15,
                speed: 30,
                unit: 'ft',
            },
        })),
    };
    return new SceneStore(s, role);
}
afterEach(() => vi.unstubAllGlobals());
it('makes the current turn, round, HP, AC and primary turn command visible together', () => {
    const html = renderToStaticMarkup(<CombatPanel store={fixture()} queue={new SaveQueue()} />);
    expect(html).toContain('РАУНД 3');
    expect(html).toContain('ХОД ');
    expect(html).toContain('combat-row current');
    expect(html).toContain('Следующий ход · N');
    expect(html).toContain('Shift+N');
    expect(html).toContain('AC ');
    expect(html).toContain('± HP');
    expect(html).toContain('Осмотр');
    expect(html).toContain('Ручные шаги');
});
it('does not render GM runtime operations for players', () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
    const store = fixture('player');
    const html = renderToStaticMarkup(<CombatPanel store={store} queue={new SaveQueue()} />);
    expect(html).not.toContain('Следующий ход');
    expect(html).not.toContain('Ручные шаги');
    expect(html).not.toContain('Осмотр');
    expect(renderToStaticMarkup(<GMResolutionQueue store={store} disabled={false} />)).toBe('');
    expect(renderToStaticMarkup(<GMQuickCheck store={store} disabled={false} />)).toBe('');
    expect(
        renderToStaticMarkup(
            <CombatActorControls token={store.getSnapshot().scene.tokens[0]} store={store} />,
        ),
    ).toBe('');
});
it('offers direct NPC action cards with budget reasons instead of token dropdowns', () => {
    const store = fixture();
    const token = store.getSnapshot().scene.tokens[0];
    token.abilities = [
        {
            icon: 'sword',
            description: '',
            category: 'attack',
            target: 'token',
            check: null,
            sort_order: 0,
            id: 'bow',
            name: 'Shortbow',
            enabled: true,
            range: { normal: 80, long: 320 },
            damage: '1d6+3',
            activation: 'action',
            costs: [],
        } as Ability,
    ];
    const html = renderToStaticMarkup(<CombatActorControls store={store} token={token} />);
    expect(html).toContain('80/320 ft');
    expect(html).toContain('1d6+3');
    expect(html).toContain('Действие уже потрачено');
    expect(html).toContain('disabled');
    expect(html).not.toContain('<select');
});
it('shows signed HP, exact set and searchable canonical condition picker in runtime context', () => {
    const html = renderToStaticMarkup(<CombatPanel store={fixture()} queue={new SaveQueue()} />);
    expect(html).toContain('Установить HP');
    expect(html).toContain('Найти состояние');
    expect(html).toContain('Канонические состояния');
    expect(html).toContain('Длительность состояния');
});
it('shows per-target saves and historical HP without substituting current HP', () => {
    const store = fixture(),
        scene = store.getSnapshot().scene;
    const result = {
        actorName: 'Mage',
        abilityName: 'Fireball',
        castLevel: 3,
        roll: null,
        provenance: { breakdown: [{ label: 'CHA', value: 4 }] },
        outcomes: [
            {
                tokenId: scene.tokens[0].id,
                save: { total: 12, dc: 15, success: false },
                damage: 28,
                hpBefore: 30,
                hpAfter: 2,
            },
            {
                tokenId: scene.tokens[1].id,
                save: { total: 17, dc: 15, success: true },
                damage: 14,
                hpBefore: 25,
                hpAfter: 11,
            },
        ],
    } as SessionResult;
    const html = renderToStaticMarkup(<CombatResults result={result} scene={scene} />);
    expect(html).toContain('12 / 15');
    expect(html).toContain('17 / 15');
    expect(html).toContain('30 → 2');
    expect(html).toContain('25 → 11');
    expect(html).toContain('Броски и модификаторы');
    expect(html).toContain('CHA');
});
it('filters routine transport/budget noise while preserving gameplay and rolls filters', () => {
    expect(logMatches('action.spent', 'all')).toBe(false);
    expect(logMatches('movement.spent', 'all')).toBe(false);
    expect(logMatches('ability.resolved', 'all')).toBe(true);
    const scene = fixture().getSnapshot().scene;
    const summary = eventSummary(
        {
            id: '1',
            type: 'ability.resolved',
            createdAt: '',
            data: {
                actorName: 'Керн',
                abilityName: 'Меч',
                result: {
                    category: 'attack',
                    success: true,
                    roll: { total: 18, dc: 15 },
                    outcomes: [{ tokenId: scene.tokens[0].id, damage: 9 }],
                } as SessionResult,
            },
        },
        scene,
    );
    expect(summary).toContain(scene.tokens[0].name);
    expect(summary).toContain('попадание');
    expect(summary).toContain('AC 15');
    expect(logMatches('attack.roll', 'rolls')).toBe(true);
    expect(logMatches('condition.removed', 'conditions')).toBe(true);
    expect(logMatches('budget.override', 'system')).toBe(true);
});
it('explains round transitions, expiration and HP corrections in plain language', () => {
    const scene = fixture().getSnapshot().scene,
        tokenId = scene.tokens[0].id;
    expect(
        eventSummary(
            { id: '1', type: 'turn.started', createdAt: '', data: { tokenId, round: 3 } },
            scene,
        ),
    ).toContain('Раунд 3');
    expect(
        eventSummary(
            {
                id: '1',
                type: 'condition.removed',
                createdAt: '',
                data: { tokenId, key: 'poisoned', reason: 'duration' },
            },
            scene,
        ),
    ).toContain('срок истёк');
    expect(
        eventSummary(
            {
                id: '1',
                type: 'gm.correction',
                createdAt: '',
                data: {
                    tokenId,
                    before: { hp: 20, conditions: [] },
                    after: { hp: 12, conditions: [] },
                },
            },
            scene,
        ),
    ).toContain('20 → 12 HP');
});

it('keeps manual spell work accessible in the session console outside active combat', () => {
    const store = fixture();
    store.getSnapshot().scene.combat = null;
    const html = renderToStaticMarkup(<CombatPanel store={store} queue={new SaveQueue()} />);
    expect(html).toContain('Ручные шаги');
    expect(html).toContain('Проверка / спасбросок');
    expect(html).not.toContain('next-turn');
});
