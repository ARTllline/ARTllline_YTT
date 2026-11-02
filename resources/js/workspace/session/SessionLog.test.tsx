import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SessionLog, mergeLog } from './SessionLog';
import { eventSummary } from '../combat/CombatHistory';
import type { CombatEvent } from '../combat/sessionModel';
import { createDemoScene } from '../../tabletop/state/demoScene';

const event = (id: string): CombatEvent => ({
    id,
    type: 'gm.check',
    data: {},
    createdAt: '2026-11-02 12:00:00',
});
it('merges reconnect bursts and older pages without duplicating or losing loaded history', () => {
    expect(mergeLog([event('9'), event('2')], [event('10'), event('9')]).map((e) => e.id)).toEqual([
        '10',
        '9',
        '2',
    ]);
});
it('starts closed without mounting a feed or resizing the workspace', () => {
    const html = renderToStaticMarkup(<SessionLog scene={createDemoScene()} />);
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('<section');
});
it('uses saved identities and authoritative outcomes, including failed saves and unknown DC', () => {
    const scene = createDemoScene();
    expect(
        eventSummary(
            {
                ...event('1'),
                data: {
                    stat: 'save_dex',
                    outcomes: [
                        {
                            tokenId: 'gone',
                            name: 'Керн',
                            roll: { total: 12, dc: 15, success: false },
                        },
                    ],
                },
            },
            scene,
        ),
    ).toContain('Керн: 12 против Сл 15 · провал');
    const noDc = eventSummary(
        {
            ...event('1'),
            data: {
                stat: 'perception',
                outcomes: [{ tokenId: 'gone', name: 'Керн', roll: { total: 17 } }],
            },
        },
        scene,
    );
    expect(noDc).toContain('Керн: 17');
    expect(noDc).not.toMatch(/успех|провал/);
    expect(
        eventSummary(
            {
                ...event('2'),
                type: 'turn.started',
                data: { round: 3, tokenId: 'gone', names: { gone: 'Гоблин' } },
            },
            scene,
        ),
    ).toBe('Раунд 3 · ход Гоблин');
});
