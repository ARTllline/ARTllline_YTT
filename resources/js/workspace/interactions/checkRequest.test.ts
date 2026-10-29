import { describe, expect, it, vi } from 'vitest';
import { checkRequest } from './checkRequest';
import { checkPresentation, checkTimings } from './checkPresentation';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { CheckDialog } from './CheckDialog';

describe('check request recovery and presentation', () => {
    it('retains one UUID across a lost response, new dialog and reconnect; scopes it to player and action', () => {
        const values = new Map<string, string>();
        const storage = {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => {
                values.set(key, value);
            },
            removeItem: (key: string) => {
                values.delete(key);
            },
        };
        const first = checkRequest('player:scene:action', storage);
        expect(checkRequest('player:scene:action', storage).id).toBe(first.id);
        expect(checkRequest('other:scene:action', storage).id).not.toBe(first.id);
        expect(checkRequest('player:scene:other', storage).id).not.toBe(first.id);
        first.complete();
        expect(checkRequest('player:scene:action', storage).id).not.toBe(first.id);
    });
    it('has no animation delays in reduced motion and defers Handout presentation until dismissal', () => {
        expect(Object.values(checkTimings(true))).toEqual([0, 0, 0]);
        expect(checkTimings(false).roll).toBeGreaterThan(0);
        const listener = vi.fn();
        const off = checkPresentation.subscribe(listener);
        checkPresentation.setActive(true);
        expect(checkPresentation.getSnapshot()).toBe(true);
        checkPresentation.setActive(false);
        expect(checkPresentation.getSnapshot()).toBe(false);
        expect(listener).toHaveBeenCalledTimes(2);
        off();
    });
    it('shows only public check information before the server roll', () => {
        const invocation = {
            action: {
                id: 'a',
                label: 'Осмотреть',
                icon: 'search' as const,
                check: {
                    enabled: true,
                    label: 'Внимательность',
                    modifier: 99,
                    dc: 15,
                    dc_visible: false,
                },
            },
            sceneId: 's',
            kind: 'prop' as const,
            objectId: 'p',
            epoch: 0,
            userId: 'u',
        };
        const html = renderToStaticMarkup(
            createElement(CheckDialog, { invocation, onClose: vi.fn(), onHandout: vi.fn() }),
        );
        expect(html).toContain('Внимательность');
        expect(html).toContain('Бросить');
        expect(html).not.toContain('DC 15');
        expect(html).not.toContain('99');
        expect(html).not.toContain('УСПЕХ');
    });
});
