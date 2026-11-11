import { describe, expect, it } from 'vitest';
import { contextualPanel, initialWorkspace, workspaceReducer } from './workspaceState';

describe('workspace navigation', () => {
    it('opens a clean table with no empty inspector', () => {
        expect(initialWorkspace.left).toBeNull();
        expect(contextualPanel(initialWorkspace, '')).toBeNull();
        expect(contextualPanel(initialWorkspace, 'token-1')).toBe('context');
    });
    it('replaces the inspector with combat and restores the selection when closed', () => {
        const combat = workspaceReducer(initialWorkspace, { type: 'right', panel: 'combat' });
        expect(contextualPanel(combat, 'token-1')).toBe('combat');
        expect(
            workspaceReducer(combat, { type: 'right', panel: 'combat', force: true }).right,
        ).toBe('combat');
        const selected = workspaceReducer(combat, { type: 'selection', key: 'token-2' });
        expect(contextualPanel(selected, 'token-2')).toBe('combat');
        const closed = workspaceReducer(selected, { type: 'close-right', selection: 'token-2' });
        expect(contextualPanel(closed, 'token-2')).toBe('context');
    });
    it('dismisses an inspector until a different selection is made', () => {
        const closed = workspaceReducer(initialWorkspace, { type: 'close-right', selection: 'a' });
        expect(contextualPanel(closed, 'a')).toBeNull();
        expect(contextualPanel(closed, 'b')).toBe('context');
        expect(contextualPanel(closed, '')).toBeNull();
    });
    it('keeps one secondary preparation workspace and returns space on selection', () => {
        const prep = workspaceReducer(initialWorkspace, { type: 'mode', mode: 'prepare' });
        expect(prep.left).toBeNull();
        expect(contextualPanel(prep, '')).toBe('entities');
        const assets = workspaceReducer(prep, { type: 'left', panel: 'assets' });
        expect(assets.left).toBe('assets');
        expect(workspaceReducer(assets, { type: 'selection', key: 'prop-1' }).left).toBeNull();
        expect(workspaceReducer(assets, { type: 'selection', key: '' }).left).toBe('assets');
    });
    it('starts Session with only the map and opens runtime surfaces explicitly', () => {
        const live = workspaceReducer(initialWorkspace, { type: 'mode', mode: 'session' });
        expect(live.left).toBeNull();
        expect(contextualPanel(live, '')).toBeNull();
        const plan = workspaceReducer(live, { type: 'left', panel: 'session' });
        expect(contextualPanel(plan, 'token')).toBeNull();
        expect(
            contextualPanel(workspaceReducer(plan, { type: 'left', panel: null }), 'token'),
        ).toBe('context');
        const audio = workspaceReducer(live, { type: 'right', panel: 'audio' });
        expect(audio.left).toBeNull();
        expect(audio.right).toBe('audio');
        const combat = workspaceReducer(audio, { type: 'right', panel: 'combat', compact: true });
        expect(combat.left).toBeNull();
        expect(combat.right).toBe('combat');
        expect(combat.mode).toBe('session');
    });
    it('discloses details, collapses back to context, and then dismisses selection', () => {
        const live = workspaceReducer(initialWorkspace, { type: 'mode', mode: 'session' });
        const details = workspaceReducer(live, { type: 'expand', value: true });
        expect(details.expanded).toBe(true);
        const compact = workspaceReducer(details, { type: 'close-right', selection: 'token' });
        expect(compact.expanded).toBe(false);
        expect(contextualPanel(compact, 'token')).toBe('context');
        expect(
            contextualPanel(
                workspaceReducer(compact, { type: 'close-right', selection: 'token' }),
                'token',
            ),
        ).toBeNull();
    });
    it('keeps pinned details until explicitly collapsed and resets floating details on selection', () => {
        const details = workspaceReducer(initialWorkspace, { type: 'expand', value: true });
        expect(workspaceReducer(details, { type: 'selection', key: 'next' }).expanded).toBe(false);
        const pinned = workspaceReducer(details, { type: 'pin' });
        expect(pinned.pinned).toBe(true);
        expect(contextualPanel(workspaceReducer(pinned, { type: 'selection', key: '' }), '')).toBe(
            'context',
        );
        expect(workspaceReducer(pinned, { type: 'selection', key: 'next' }).expanded).toBe(true);
        expect(workspaceReducer(pinned, { type: 'pin' }).pinned).toBe(false);
        expect(workspaceReducer(pinned, { type: 'expand', value: false }).pinned).toBe(false);
        expect(workspaceReducer(pinned, { type: 'right', panel: 'combat' }).pinned).toBe(false);
    });
    it('returns from any busy layout to the clean table and keeps library distinct', () => {
        const live = workspaceReducer(initialWorkspace, { type: 'mode', mode: 'session' });
        const combat = workspaceReducer(live, { type: 'right', panel: 'combat' });
        expect(workspaceReducer(combat, { type: 'mode', mode: 'table' })).toEqual(initialWorkspace);
        const library = workspaceReducer(combat, { type: 'mode', mode: 'library' });
        expect(library.left).toBe('assets');
        expect(library.right).toBe('context');
    });
});

it('returns catalog space to Inspector on selection and closes an empty catalog explicitly', () => {
    const prep = workspaceReducer(initialWorkspace, { type: 'mode', mode: 'prepare' });
    const catalog = workspaceReducer(prep, { type: 'right', panel: 'entities', force: true });
    const selected = workspaceReducer(catalog, { type: 'selection', key: 'npc' });
    expect(contextualPanel(selected, 'npc')).toBe('context');
    expect(contextualPanel(workspaceReducer(selected, { type: 'selection', key: '' }), '')).toBe(
        'entities',
    );
    const closed = workspaceReducer(catalog, { type: 'close-right', selection: '' });
    expect(contextualPanel(closed, '')).toBeNull();
    expect(
        contextualPanel(workspaceReducer(closed, { type: 'right', panel: 'entities' }), ''),
    ).toBe('entities');
});
