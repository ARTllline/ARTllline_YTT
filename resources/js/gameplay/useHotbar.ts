import { useEffect, useRef, useState } from 'react';
import { request } from '../api/client';
import { defaultSlots, type HotbarSlots } from './hotbarModel';

export function useHotbar(campaign: string, character: string, ids: string[]) {
    const [slots, setSlots] = useState<HotbarSlots>(() => defaultSlots(ids));
    const [loaded, setLoaded] = useState(false),
        [saving, setSaving] = useState(false),
        [error, setError] = useState('');
    const desired = useRef(slots),
        running = useRef(false),
        alive = useRef(true);
    const url = `/campaigns/${campaign}/characters/${character}/hotbar`;
    const read = () =>
        request<{ slots: HotbarSlots }>(url)
            .then((r) => {
                if (alive.current) {
                    desired.current = r.slots;
                    setSlots(r.slots);
                    setLoaded(true);
                    setError('');
                }
            })
            .catch((e) => {
                if (alive.current) setError(e.message);
            });
    useEffect(() => {
        alive.current = true;
        const abort = new AbortController();
        void request<{ slots: HotbarSlots }>(url, 'GET', undefined, abort.signal)
            .then((r) => {
                if (!abort.signal.aborted) {
                    desired.current = r.slots;
                    setSlots(r.slots);
                    setLoaded(true);
                }
            })
            .catch((e) => {
                if (!abort.signal.aborted) setError(e.message);
            });
        return () => {
            alive.current = false;
            abort.abort();
        };
    }, [url]);
    const pump = async () => {
        if (running.current || !loaded) return;
        running.current = true;
        setSaving(true);
        setError('');
        try {
            let accepted: string;
            do {
                const value = [...desired.current];
                accepted = JSON.stringify(value);
                await request(url, 'PUT', { slots: value });
            } while (alive.current && accepted !== JSON.stringify(desired.current));
        } catch (e) {
            if (alive.current) setError((e as Error).message);
        } finally {
            running.current = false;
            if (alive.current) setSaving(false);
        }
    };
    const change = (next: HotbarSlots) => {
        if (!loaded) return;
        desired.current = next;
        setSlots(next);
        void pump();
    };
    return {
        slots,
        change,
        loaded,
        saving,
        error,
        retry: () => (loaded ? void pump() : void read()),
    };
}
