import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ContentUseConfirmation } from './ContentUseConfirmation';
import { createDemoScene } from '../../tabletop/state/demoScene';
import type { ResolutionTask } from './sessionModel';

it('shows immutable saved dice and a single automatic confirmation with no editable effect or spend toggles', () => {
    const scene = createDemoScene();
    const task = {
        id: 'preview',
        result: {
            target: { kind: 'token', id: scene.tokens[0].id },
            gmContext: {
                contentUse: {
                    icon: 'heart',
                    inventoryItemId: null,
                    castLevel: 2,
                    costs: [],
                    automatic: {
                        rolls: {
                            success: true,
                            critical: false,
                            roll: null,
                            damageRolls: [],
                            healingRoll: { expression: '4d8+4', rawDice: [2, 3, 4, 5], total: 18 },
                        },
                    },
                },
            },
        },
    } as unknown as ResolutionTask;
    const html = renderToStaticMarkup(
        <ContentUseConfirmation task={task} scene={scene} disabled={false} onConfirm={() => {}} />,
    );
    expect(html).toContain('4d8+4');
    expect(html).toContain('18');
    expect(html).toContain('Подтвердить бросок и применить');
    expect(html).not.toContain('<select');
    expect(html).not.toContain('<input');
    expect(html).toContain('Sap');
});

it('retains the manual GM effect and expenditure controls for unapproved content', () => {
    const task = {
        id: 'manual',
        result: {
            gmContext: {
                contentUse: { icon: 'potion', inventoryItemId: 'item', castLevel: 0, costs: [] },
            },
        },
    } as unknown as ResolutionTask;
    const html = renderToStaticMarkup(
        <ContentUseConfirmation
            task={task}
            scene={createDemoScene()}
            disabled={false}
            onConfirm={() => {}}
        />,
    );
    expect(html).toContain('Эффект GM');
    expect(html).toContain('Израсходовать 1 предмет');
    expect(html).not.toContain('Подтвердить бросок и применить');
});
