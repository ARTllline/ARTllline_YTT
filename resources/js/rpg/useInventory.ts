import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client';
import { commandId } from '../api/workspace';
import type { Character } from '../tabletop/types/scene';
import { inventoryApi, type InventoryState } from './model';
export function useInventory(campaign: string, character: Character | null, onChanged: () => void) {
    const [data, setData] = useState<InventoryState | null>(null),
        [error, setError] = useState(''),
        [busy, setBusy] = useState(false);
    const alive = useRef(true),
        pending = useRef<{ data: Record<string, unknown>; id: string } | null>(null),
        lock = useRef(false),
        changed = useRef(onChanged);
    useEffect(() => {
        changed.current = onChanged;
    });
    const refresh = () =>
        character
            ? inventoryApi
                  .read(campaign, character.id)
                  .then((v) => {
                      if (alive.current) {
                          setData(v);
                          if (!pending.current) setError('');
                      }
                  })
                  .catch((e) => {
                      if (alive.current) setError(e.message);
                  })
            : Promise.resolve();
    useEffect(() => {
        alive.current = true;
        if (!character) return;
        const abort = new AbortController();
        void inventoryApi
            .read(campaign, character.id, abort.signal)
            .then((v) => {
                if (!abort.signal.aborted) {
                    setData(v);
                    if (!pending.current) setError('');
                }
            })
            .catch((e) => {
                if (!abort.signal.aborted) setError(e.message);
            });
        return () => {
            alive.current = false;
            abort.abort();
        };
    }, [campaign, character]);
    const send = async (command: Record<string, unknown>) => {
        if (!character) return;
        if (lock.current) return;
        lock.current = true;
        setBusy(true);
        setError('');
        pending.current ??= { data: command, id: commandId() };
        try {
            const p = pending.current;
            const v = await inventoryApi.command(campaign, character.id, p.data, p.id);
            pending.current = null;
            if (alive.current) {
                setData(v);
                changed.current();
            }
        } catch (e) {
            if (e instanceof ApiError && e.status > 0 && e.status < 500) pending.current = null;
            if (alive.current) setError((e as Error).message);
        } finally {
            lock.current = false;
            if (alive.current) setBusy(false);
        }
    };
    return {
        data,
        error,
        busy,
        send,
        refresh,
        retry: () => (pending.current ? void send(pending.current.data) : void refresh()),
    };
}
export type InventoryHook = ReturnType<typeof useInventory>;
