import { describe, expect, it, vi } from 'vitest';
import { DirectorState, type DirectorEvent } from './DirectorState';
import { DirectorCamera } from './DirectorCamera';
import type { Camera } from '../tabletop/renderer/camera/Camera';
import { newStep, reorder } from '../workspace/cues/model';
const event = (patch: Partial<DirectorEvent> = {}): DirectorEvent => ({
    type: 'director.action',
    sceneId: '1',
    epoch: 3,
    runId: 'run',
    eventId: 'step',
    sequence: 0,
    action: 'camera.focus',
    config: { x: 400, y: 300, duration: 500 },
    sentAt: 1000,
    expiresAt: 71000,
    ...patch,
});
describe('director presentation', () => {
    it('a delayed terminal event from a previous run cannot clear the new run', () => {
        const state = new DirectorState('1', 3);
        state.accept(event(), 1000);
        state.accept(event({ runId: 'new-run', eventId: 'new', sentAt: 2000 }), 2000);
        expect(
            state.accept(
                event({ eventId: 'old-clear', action: 'clear', sequence: 9, sentAt: 1500 }),
                2100,
            ),
        ).toBe(false);
        expect(state.getSnapshot().directed).toBe(true);
    });
    it('deduplicates, orders and isolates activation without changing scene state', () => {
        const state = new DirectorState('1', 3);
        state.onCamera = vi.fn();
        expect(state.accept(event(), 1000)).toBe(true);
        expect(state.accept(event(), 1001)).toBe(false);
        expect(state.accept(event({ eventId: 'late', sequence: -1 }), 1001)).toBe(false);
        expect(state.accept(event({ eventId: 'other', epoch: 2 }), 1001)).toBe(false);
        expect(state.onCamera).toHaveBeenCalledTimes(1);
    });
    it('clears automatically on completion and rejects delayed actions from that run', () => {
        const state = new DirectorState('1', 3);
        state.onCamera = vi.fn();
        state.accept(event(), 1000);
        state.accept(event({ eventId: 'done', sequence: 2, action: 'clear', config: {} }), 1100);
        expect(state.getSnapshot().directed).toBe(false);
        expect(state.onCamera).toHaveBeenLastCalledWith(null);
        expect(state.accept(event({ eventId: 'late', sequence: 1 }), 1200)).toBe(false);
    });
    it('expires leases/messages and allows failed-step retry without replay', () => {
        const state = new DirectorState('1', 3);
        state.accept(
            event({ action: 'message', config: { text: '<b>plain</b>', duration: 500 } }),
            1000,
        );
        expect(state.getSnapshot().message?.text).toBe('<b>plain</b>');
        state.tick(1501);
        expect(state.getSnapshot().message).toBeNull();
        state.accept(
            event({ eventId: 'failed', action: 'clear', config: { terminal: false } }),
            1600,
        );
        expect(state.accept(event({ eventId: 'retry', sequence: 1 }), 1700)).toBe(true);
        state.tick(71001);
        expect(state.getSnapshot().directed).toBe(false);
    });
    it('local Escape suppresses the current run; reconnect resets presentation only', () => {
        const state = new DirectorState('1', 3);
        state.accept(event(), 1000);
        state.release();
        expect(state.accept(event({ eventId: 'next', sequence: 2 }), 1100)).toBe(false);
        state.accept(event({ runId: 'next-run', eventId: 'new' }), 1200);
        state.reset();
        expect(state.getSnapshot()).toMatchObject({
            directed: false,
            blackout: false,
            message: null,
        });
        expect(state.accept(event({ runId: 'next-run', eventId: 'new' }), 1300)).toBe(false);
    });
    it('interpolates world focus and zoom in ticker, releases without camera drift', () => {
        const camera = {
            state: { x: 0, y: 0, zoom: 1 },
            directed: false,
            stop: vi.fn(),
        } as unknown as Camera;
        const director = new DirectorCamera(camera);
        director.apply(event(), 1000, 800, false);
        director.tick(250);
        expect(camera.state).toEqual({ x: 50, y: 50, zoom: 1 });
        director.tick(250);
        expect(camera.state).toEqual({ x: 100, y: 100, zoom: 1 });
        director.apply(
            event({ action: 'camera.zoom', config: { zoom: 2, duration: 500 } }),
            1000,
            800,
            true,
        );
        expect(camera.state).toEqual({ x: -300, y: -200, zoom: 2 });
        director.release();
        director.tick(1000);
        expect(camera.directed).toBe(false);
        expect(director.offset).toEqual({ x: 0, y: 0 });
    });
    it('editor reorders immutable drafts and supplies safe action defaults', () => {
        const steps = [newStep('wait'), newStep('message'), newStep('camera.release')];
        expect(reorder(steps, 0, 2).map((s) => s.type)).toEqual([
            'message',
            'camera.release',
            'wait',
        ]);
        expect(steps[0].type).toBe('wait');
        expect(newStep('camera.zoom').config.zoom).toBe(1.5);
    });
});
