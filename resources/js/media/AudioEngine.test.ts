import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from './AudioEngine';
import { playbackPosition, type MediaState, type Track, type SfxEvent } from './model';
const elements: FakeAudio[] = [];
class FakeAudio {
    currentTime = 0;
    readyState = 1;
    paused = true;
    src = '';
    loop = false;
    onloadedmetadata: (() => void) | null = null;
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    play = vi.fn(async () => {
        this.paused = false;
    });
    pause = vi.fn(() => {
        this.paused = true;
    });
    load = vi.fn();
    removeAttribute = vi.fn();
    constructor() {
        elements.push(this);
    }
}
const ramps: ReturnType<typeof vi.fn>[] = [];
class FakeContext {
    state = 'running';
    currentTime = 0;
    resume = vi.fn(async () => {});
    close = vi.fn(async () => {});
    createMediaElementSource() {
        return { connect: vi.fn(), disconnect: vi.fn() };
    }
    createGain() {
        const ramp = vi.fn();
        ramps.push(ramp);
        return {
            connect: vi.fn(),
            disconnect: vi.fn(),
            gain: {
                value: 0,
                cancelAndHoldAtTime: vi.fn(),
                setValueAtTime: vi.fn(),
                linearRampToValueAtTime: ramp,
            },
        };
    }
}
const track = (id = 'a', patch: Partial<Track> = {}): Track => ({
    id,
    assetId: id,
    name: id,
    url: '/api/assets/' + id,
    duration: 60000,
    volume: 1,
    fade: 1000,
    startedAt: 0,
    loop: true,
    paused: false,
    position: 0,
    ...patch,
});
const state = (patch: Partial<MediaState> = {}): MediaState => ({
    revision: 1,
    sceneId: '1',
    epoch: 1,
    serverNow: 10000,
    music: track(),
    ambient: [],
    effects: { rain: 'medium' },
    volumes: { music: 0.5, ambient: 0.6, sfx: 0.8 },
    fade: 1000,
    ...patch,
});
const sfx = (patch: Partial<SfxEvent> = {}): SfxEvent => ({
    type: 'media.sfx',
    eventId: 'hit',
    sceneId: '1',
    epoch: 1,
    track: track('hit', { loop: false, startedAt: 10000 }),
    volume: 0.8,
    expiresAt: 15000,
    ...patch,
});
describe('central audio lifecycle', () => {
    let engine: AudioEngine;
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(10000);
        elements.length = 0;
        ramps.length = 0;
        vi.stubGlobal('Audio', FakeAudio);
        vi.stubGlobal('AudioContext', FakeContext);
        vi.stubGlobal('localStorage', { getItem: vi.fn(() => null), setItem: vi.fn() });
        engine = new AudioEngine();
    });
    afterEach(() => {
        engine.dispose();
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });
    it('hydrates continuous state while locked and never replays locked SFX after unlock', async () => {
        engine.hydrate(state());
        expect(elements).toHaveLength(0);
        expect(engine.sfx(sfx())).toBe(false);
        await engine.unlock();
        expect(elements).toHaveLength(1);
        elements[0].onloadedmetadata?.();
        expect(elements[0].currentTime).toBe(10);
        expect(engine.sfx(sfx())).toBe(false);
    });
    it('crossfades replacement, ignores stale state, and disposes outgoing nodes', async () => {
        await engine.unlock();
        engine.hydrate(state());
        engine.hydrate(state({ revision: 2, music: track('b') }));
        expect(elements).toHaveLength(2);
        expect(elements[0].paused).toBe(false);
        expect(ramps[0]).toHaveBeenLastCalledWith(0, 1);
        expect(engine.hydrate(state())).toBe(false);
        await vi.advanceTimersByTimeAsync(1030);
        expect(elements[0].paused).toBe(true);
        expect(elements[0].removeAttribute).toHaveBeenCalledWith('src');
        expect(elements[1].paused).toBe(false);
    });
    it('preserves independent ambient loops, bounds SFX, and deduplicates events', async () => {
        await engine.unlock();
        engine.hydrate(state({ music: null, ambient: [track('rain'), track('wind')] }));
        engine.hydrate(state({ revision: 2, music: null, ambient: [track('wind')] }));
        await vi.advanceTimersByTimeAsync(1030);
        expect(elements[0].paused).toBe(true);
        expect(elements[1].paused).toBe(false);
        expect(engine.sfx(sfx())).toBe(true);
        expect(engine.sfx(sfx())).toBe(false);
        expect(engine.sfx(sfx({ eventId: 'old', expiresAt: 1000 }))).toBe(false);
        expect(engine.sfx(sfx({ eventId: 'other', epoch: 0 }))).toBe(false);
        for (let i = 0; i < 10; i++)
            engine.sfx(
                sfx({
                    eventId: String(i),
                    track: track(String(i), { loop: false, startedAt: 10000 }),
                }),
            );
        expect(elements.filter((e) => !e.paused)).toHaveLength(9); // Eight SFX and one ambient.
    });
    it('scene switch immediately stops ambient/SFX, keeps music, and rejects old-epoch delivery', async () => {
        await engine.unlock();
        engine.hydrate(state({ ambient: [track('rain')] }));
        engine.sfx(sfx());
        engine.hydrate(state({ revision: 2, sceneId: '2', epoch: 2, ambient: [], effects: {} }));
        expect(elements[0].paused).toBe(false);
        expect(elements[1].paused).toBe(true);
        expect(elements[2].paused).toBe(true);
        expect(engine.sfx(sfx({ eventId: 'late' }))).toBe(false);
        expect(engine.getSnapshot().state?.effects).toEqual({});
    });
    it('pause/resume and reconnect seek only continuous tracks without repeated starts or SFX', async () => {
        await engine.unlock();
        engine.hydrate(state());
        engine.hydrate(
            state({ revision: 2, music: track('a', { paused: true, position: 12000 }) }),
        );
        expect(elements[0].paused).toBe(true);
        engine.hydrate(state({ revision: 3, music: track('a', { startedAt: -2000 }) }));
        expect(elements[0].currentTime).toBe(12);
        engine.hydrate(
            state({ revision: 3, serverNow: 30000, music: track('a', { startedAt: -2000 }) }),
            true,
        );
        expect(elements[0].currentTime).toBe(32);
        expect(elements).toHaveLength(1);
    });
    it('local gains persist without mutating authoritative volumes, and cleanup stops everything', async () => {
        await engine.unlock();
        engine.hydrate(state());
        engine.preference('master', 0.2);
        expect(engine.getSnapshot().state?.volumes.music).toBe(0.5);
        expect(ramps[0]).toHaveBeenLastCalledWith(0.1, 0.12);
        expect(localStorage.setItem).toHaveBeenCalled();
        await engine.preview({
            id: 'preview-asset',
            name: 'preview',
            url: '/local',
            duration: 60000,
        });
        expect(engine.getSnapshot().preview).toBe('preview-asset');
        engine.dispose();
        expect(elements.every((e) => e.paused)).toBe(true);
        expect(engine.getSnapshot().enabled).toBe(false);
    });
    it('wraps loop positions and clamps ended one-shot positions', () => {
        expect(playbackPosition(track(), 125000)).toBe(5000);
        expect(playbackPosition(track('x', { loop: false }), 125000)).toBe(60000);
        expect(playbackPosition(track('x', { paused: true, position: 22000 }), 125000)).toBe(22000);
    });
    it('an atmosphere update cannot shorten an ongoing music fade', async () => {
        await engine.unlock();
        engine.hydrate(state());
        engine.hydrate(state({ revision: 2, music: track('b', { fade: 5000 }), fade: 5000 }));
        const calls = ramps[1].mock.calls.length;
        engine.hydrate(
            state({
                revision: 3,
                music: track('b', { fade: 5000 }),
                effects: { embers: 'strong' },
                fade: 0,
            }),
        );
        expect(ramps[1]).toHaveBeenLastCalledWith(0.4, 5);
        expect(ramps[1].mock.calls).toHaveLength(calls);
        engine.preference('master', 0);
        expect(ramps[0]).toHaveBeenLastCalledWith(0, 5);
    });
    it('campaign activation clears old scene playback before a lost media broadcast is repaired', async () => {
        await engine.unlock();
        engine.hydrate(state({ ambient: [track('rain')] }));
        engine.alignScene('2', 2);
        expect(elements[1].paused).toBe(true);
        expect(elements[0].paused).toBe(false);
        expect(engine.hydrate(state())).toBe(false);
        expect(engine.sfx(sfx())).toBe(false);
        expect(engine.getSnapshot().state?.effects).toEqual({});
    });
    it('rejects a still-unexpired SFX delayed across reconnect, without stopping music', async () => {
        await engine.unlock();
        engine.hydrate(state());
        vi.setSystemTime(11000);
        engine.transientBoundary();
        expect(engine.sfx(sfx())).toBe(false);
        expect(elements).toHaveLength(1);
        expect(elements[0].paused).toBe(false);
        expect(
            engine.sfx(
                sfx({ eventId: 'fresh', track: track('fresh', { startedAt: 11001, loop: false }) }),
            ),
        ).toBe(true);
    });
});
