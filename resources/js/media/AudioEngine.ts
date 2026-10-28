import {
    playbackPosition,
    type Channel,
    type MediaState,
    type SfxEvent,
    type Track,
} from './model';
type Preferences = Record<Channel | 'master', number>;
interface Voice {
    element: HTMLAudioElement;
    source: MediaElementAudioSourceNode;
    gain: GainNode;
    channel: Channel;
    track: Track;
    retiring: boolean;
    target: number;
    retireAt?: number;
    timer?: ReturnType<typeof setTimeout>;
}
const defaults: Preferences = { master: 0.8, music: 1, ambient: 1, sfx: 1 };

/** Owns every audio element, AudioContext, fade and cleanup timer in this application. */
export class AudioEngine {
    private context?: AudioContext;
    private voices = new Map<string, Voice>();
    private retiring = new Set<Voice>();
    private seen = new Set<string>();
    private listeners = new Set<() => void>();
    private offset = 0;
    private sfxSince = Date.now();
    private snapshot: {
        enabled: boolean;
        error: string;
        preview: string | null;
        preferences: Preferences;
        state: MediaState | null;
    };
    constructor() {
        let saved = {};
        try {
            saved = JSON.parse(localStorage.getItem('ytt.audio.v1') ?? '{}');
        } catch {
            /* Private browsing or malformed local preferences. */
        }
        const preferences = { ...defaults };
        for (const key of Object.keys(defaults) as (keyof Preferences)[]) {
            const value = (saved as Preferences)?.[key];
            if (typeof value === 'number' && Number.isFinite(value))
                preferences[key] = Math.max(0, Math.min(1, value));
        }
        this.snapshot = { enabled: false, error: '', preview: null, preferences, state: null };
    }
    getSnapshot = () => this.snapshot;
    subscribe = (fn: () => void) => {
        this.listeners.add(fn);
        return () => {
            this.listeners.delete(fn);
        };
    };
    private emit(patch: Partial<typeof this.snapshot>) {
        this.snapshot = { ...this.snapshot, ...patch };
        this.listeners.forEach((fn) => fn());
    }
    async unlock() {
        try {
            if (!this.context) {
                const context = new AudioContext();
                this.context = context;
                context.onstatechange = () => {
                    if (this.context === context)
                        this.emit({ enabled: context.state === 'running' });
                };
            }
            await this.context.resume();
            this.emit({ enabled: this.context.state === 'running', error: '' });
            this.reconcile(true);
        } catch {
            this.emit({
                enabled: false,
                error: 'Браузер ещё не разрешил звук. Нажмите «Включить звук».',
            });
        }
    }
    preference(key: keyof Preferences, value: number) {
        const old = this.snapshot.preferences;
        const preferences = { ...this.snapshot.preferences, [key]: value };
        try {
            localStorage.setItem('ytt.audio.v1', JSON.stringify(preferences));
        } catch {
            /* Settings still work for this tab. */
        }
        this.emit({ preferences });
        for (const voice of this.voices.values()) this.gain(voice, this.level(voice), 120);
        for (const voice of this.retiring) {
            if (!this.context) continue;
            const ratio =
                (preferences.master * preferences[voice.channel]) /
                Math.max(0.0001, old.master * old[voice.channel]);
            const param = voice.gain.gain,
                now = this.context.currentTime;
            param.cancelAndHoldAtTime(now);
            param.setValueAtTime(param.value * ratio, now);
            param.linearRampToValueAtTime(0, Math.max(now, voice.retireAt ?? now));
        }
    }
    hydrate(state: MediaState, force = false) {
        const previous = this.snapshot.state;
        if (previous && (state.epoch < previous.epoch || state.revision < previous.revision))
            return false;
        this.offset = state.serverNow - Date.now();
        if (!force && previous?.revision === state.revision) return false;
        if (previous && state.epoch !== previous.epoch) {
            for (const voice of this.voices.values())
                if (voice.channel !== 'music' && voice.track.id !== 'preview') this.remove(voice);
        }
        this.emit({ state });
        this.reconcile(force);
        return true;
    }
    alignScene(sceneId: string | null, epoch: number) {
        const state = this.snapshot.state;
        if (!state || epoch <= state.epoch) return;
        for (const voice of [...this.voices.values(), ...this.retiring]) {
            if (voice.channel !== 'music' && voice.track.id !== 'preview') this.remove(voice);
        }
        this.emit({ state: { ...state, sceneId, epoch, ambient: [], effects: {} } });
    }
    transientBoundary = () => {
        this.sfxSince = Date.now();
        for (const voice of this.voices.values()) {
            if (voice.channel === 'sfx' && voice.track.id !== 'preview') this.remove(voice);
        }
    };
    private level(voice: Voice) {
        const p = this.snapshot.preferences;
        return (
            p.master *
            p[voice.channel] *
            voice.track.volume *
            (voice.track.id === 'preview' ? 1 : (this.snapshot.state?.volumes[voice.channel] ?? 1))
        );
    }
    private gain(voice: Voice, target: number, ms: number) {
        if (!this.context || voice.target === target) return;
        voice.target = target;
        const param = voice.gain.gain,
            now = this.context.currentTime;
        param.cancelAndHoldAtTime(now);
        param.linearRampToValueAtTime(target, now + ms / 1000);
    }
    private reconcile(force: boolean) {
        const state = this.snapshot.state;
        if (!state || !this.snapshot.enabled) return;
        const wanted = new Map<string, { track: Track; channel: Channel }>();
        if (state.music) wanted.set(state.music.id, { track: state.music, channel: 'music' });
        state.ambient.forEach((track) => wanted.set(track.id, { track, channel: 'ambient' }));
        for (const [id, voice] of this.voices) {
            if (voice.channel === 'sfx') this.gain(voice, this.level(voice), 120);
            if (id !== 'preview' && voice.channel !== 'sfx' && !wanted.has(id))
                this.retire(voice, state.fade);
        }
        for (const [id, { track, channel }] of wanted) {
            const voice = this.voices.get(id);
            if (!voice) {
                this.create(track, channel);
                continue;
            }
            const changedPause = voice.track.paused !== track.paused;
            voice.track = track;
            this.gain(voice, this.level(voice), 120);
            if (track.paused) voice.element.pause();
            else if (force || changedPause) this.start(voice, true);
        }
    }
    private create(track: Track, channel: Channel) {
        if (!this.context || !this.snapshot.enabled) return;
        if (!track.loop && playbackPosition(track, Date.now() + this.offset) >= track.duration)
            return;
        const element = new Audio();
        element.preload = 'metadata';
        element.loop = track.loop;
        const source = this.context.createMediaElementSource(element),
            gain = this.context.createGain();
        source.connect(gain);
        gain.connect(this.context.destination);
        gain.gain.value = 0;
        const voice: Voice = { element, source, gain, channel, track, retiring: false, target: -1 };
        this.voices.set(track.id, voice);
        element.onloadedmetadata = () => {
            if (voice.retiring) return;
            if (track.id !== 'preview') {
                try {
                    element.currentTime =
                        playbackPosition(voice.track, Date.now() + this.offset) / 1000;
                } catch {
                    /* Browser retries when media becomes seekable. */
                }
            }
        };
        element.onended = () => this.remove(voice);
        element.onerror = () =>
            this.emit({
                error: `Не удалось загрузить «${track.name}». Проверьте соединение или формат записи.`,
            });
        element.src = track.url;
        this.gain(voice, this.level(voice), track.fade);
        if (!track.paused) this.start(voice, false);
    }
    private start(voice: Voice, seek: boolean) {
        if (voice.element.error && seek) voice.element.load();
        if (seek && voice.element.readyState >= 1) {
            try {
                const position = playbackPosition(voice.track, Date.now() + this.offset) / 1000;
                if (voice.element.paused || Math.abs(voice.element.currentTime - position) > 2)
                    voice.element.currentTime = position;
            } catch {
                /* Metadata handler also seeks. */
            }
        }
        void voice.element.play().catch((error: DOMException) => {
            if (voice.retiring || !this.voices.has(voice.track.id) || error.name === 'AbortError')
                return;
            this.emit({
                ...(error.name === 'NotAllowedError' ? { enabled: false } : {}),
                error: 'Звук не запущен. Нажмите «Включить звук» для повторной попытки.',
            });
        });
    }
    sfx(event: SfxEvent) {
        const state = this.snapshot.state;
        if (
            !state ||
            event.sceneId !== state.sceneId ||
            event.epoch !== state.epoch ||
            event.expiresAt <= Date.now() + this.offset ||
            event.track.startedAt < this.sfxSince + this.offset ||
            this.seen.has(event.eventId)
        )
            return false;
        this.seen.add(event.eventId);
        if (this.seen.size > 256) this.seen.delete(this.seen.values().next().value!);
        if (!this.snapshot.enabled) return false; // Never queue missed one-shots behind autoplay.
        const active = [...this.voices.values()].filter((v) => v.channel === 'sfx');
        if (active.length >= 8) this.remove(active[0]);
        this.create({ ...event.track, startedAt: Date.now() + this.offset }, 'sfx');
        return true;
    }
    async preview(asset: { id: string; url: string; name: string; duration?: number | null }) {
        if (this.snapshot.preview === asset.id) {
            this.stopPreview();
            return;
        }
        await this.unlock();
        this.stopPreview();
        this.emit({ preview: asset.id });
        this.create(
            {
                id: 'preview',
                assetId: asset.id,
                name: asset.name,
                url: asset.url,
                duration: asset.duration ?? 1000,
                volume: 0.6,
                loop: false,
                fade: 100,
                startedAt: Date.now() + this.offset,
                paused: false,
                position: 0,
            },
            'sfx',
        );
    }
    stopPreview() {
        const voice = this.voices.get('preview');
        if (voice) this.remove(voice);
        this.emit({ preview: null });
    }
    private retire(voice: Voice, ms: number) {
        this.voices.delete(voice.track.id);
        voice.retiring = true;
        this.retiring.add(voice);
        if (this.retiring.size > 6) this.remove(this.retiring.values().next().value!);
        voice.retireAt = (this.context?.currentTime ?? 0) + ms / 1000;
        this.gain(voice, 0, ms);
        voice.timer = setTimeout(() => this.remove(voice), ms + 30);
    }
    private remove(voice: Voice) {
        voice.retiring = true;
        clearTimeout(voice.timer);
        voice.element.onloadedmetadata = voice.element.onended = voice.element.onerror = null;
        voice.element.pause();
        voice.element.removeAttribute('src');
        voice.element.load();
        voice.source.disconnect();
        voice.gain.disconnect();
        if (this.voices.get(voice.track.id) === voice) this.voices.delete(voice.track.id);
        this.retiring.delete(voice);
        if (voice.track.id === 'preview') this.emit({ preview: null });
    }
    dispose() {
        [...this.voices.values(), ...this.retiring].forEach((voice) => this.remove(voice));
        void this.context?.close();
        this.context = undefined;
        this.seen.clear();
        this.emit({ enabled: false, state: null, preview: null, error: '' });
    }
}
export const audioEngine = new AudioEngine();
