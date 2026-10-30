import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CombatBudgetView, combatReason, type TurnResources } from './combat';
import { ConditionList } from '../workspace/combat/TokenCombatControls';
import { createDemoScene } from '../tabletop/state/demoScene';
import { reduceEvent } from '../realtime/protocol';
const budget: TurnResources = {
    ownTurn: true,
    action: true,
    bonus_action: true,
    reaction: true,
    movementSpent: 10,
    movementRemaining: 20,
    speed: 30,
    unit: 'ft',
};
describe('combat presentation and authoritative updates', () => {
    it('shows remaining movement and visibly spent action resources', () => {
        const html = renderToStaticMarkup(
            <CombatBudgetView budget={{ ...budget, action: false }} />,
        );
        expect(html).toContain('20 / 30 ft');
        expect(html).toContain('Действие: недоступно');
        expect(html).toContain('class="spent"');
        expect(html).toContain('Реакция: доступно');
    });
    it('explains each activation cost and preserves out-of-turn reactions and free actions', () => {
        expect(combatReason({}, { ...budget, action: false })).toBe('Действие уже потрачено');
        expect(
            combatReason({ activation: 'bonus_action' }, { ...budget, bonus_action: false }),
        ).toBe('Бонусное действие уже потрачено');
        expect(combatReason({ activation: 'reaction' }, { ...budget, ownTurn: false })).toBe('');
        expect(combatReason({ activation: 'reaction' }, { ...budget, reaction: false })).toBe(
            'Реакция недоступна',
        );
        expect(combatReason({ activation: 'free' }, { ...budget, ownTurn: false })).toBe('');
        expect(combatReason({}, { ...budget, ownTurn: false })).toBe(
            'Сейчас ход другого участника',
        );
        expect(combatReason({ activation: 'free' }, { ...budget, incapacitated: true })).toBe(
            'Персонаж не может действовать',
        );
        expect(combatReason({}, undefined)).toBe('');
    });
    it('offers standing only when supplied by an allowed actor', () => {
        expect(renderToStaticMarkup(<CombatBudgetView budget={budget} />)).not.toContain('Встать');
        expect(
            renderToStaticMarkup(<CombatBudgetView budget={budget} onStand={() => {}} />),
        ).toContain('Встать');
    });
    it('shows canonical condition duration without player removal controls', () => {
        const token = {
            ...createDemoScene().tokens[0],
            conditions: [
                {
                    id: 'a',
                    key: 'poisoned',
                    label: 'Poisoned',
                    durationMode: 'rounds',
                    remainingRounds: 2,
                },
            ],
        };
        const html = renderToStaticMarkup(<ConditionList token={token} />);
        expect(html).toContain('2 раунд.');
        expect(html).not.toContain('<button');
    });
    it('applies movement, action and condition expiry together and ignores duplicate events', () => {
        const initial = { ...createDemoScene(), id: '5', revision: 10 };
        const token = { ...initial.tokens[0], x: 500, conditions: [] };
        const combat = {
            id: '1',
            status: 'active' as const,
            round: 1,
            currentTurn: { combatantId: '1' },
            combatants: [
                {
                    id: '1',
                    tokenId: token.id,
                    initiative: 20,
                    budget: { ...budget, action: false },
                },
            ],
        };
        const event = {
            sceneId: '5',
            revision: 11,
            mutationId: 'a',
            type: 'ability.resolved',
            payload: { combat, tokens: [token] },
        };
        const next = reduceEvent(initial, event);
        expect(next).not.toBe('gap');
        if (next === 'gap') return;
        expect(next.combat?.combatants[0].budget?.action).toBe(false);
        expect(next.combat?.combatants[0].budget?.movementRemaining).toBe(20);
        expect(next.tokens.find((t) => t.id === token.id)?.conditions).toEqual([]);
        expect(next.tokens.find((t) => t.id === token.id)?.x).toBe(500);
        expect(reduceEvent(next, event)).toBe(next);
    });
});
