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
        expect(prep.left).toBe('scenes');
        const assets = workspaceReducer(prep, { type: 'left', panel: 'assets' });
        expect(assets.left).toBe('assets');
        expect(workspaceReducer(assets, { type: 'selection', key: 'prop-1' }).left).toBeNull();
        expect(workspaceReducer(assets, { type: 'selection', key: '' }).left).toBe('assets');
    });
    it('keeps the live plan beside one dock on desktop, but only one drawer on tablet', () => {
        const live = workspaceReducer(initialWorkspace, { type: 'mode', mode: 'session' });
        const audio = workspaceReducer(live, { type: 'right', panel: 'audio' });
        expect(audio.left).toBe('session');
        expect(audio.right).toBe('audio');
        const combat = workspaceReducer(audio, { type: 'right', panel: 'combat', compact: true });
        expect(combat.left).toBeNull();
        expect(combat.right).toBe('combat');
        expect(combat.mode).toBe('session');
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
