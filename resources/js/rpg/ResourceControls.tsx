import { useRef, useState } from 'react';
import type { Character } from '../tabletop/types/scene';
import { gameplayApi } from '../gameplay/model';
import { RpgIcon } from '../gameplay/RpgIcon';
import { ApiError } from '../api/client';
import { commandId } from '../api/workspace';
export function ResourceControls({
    campaign,
    character,
    onChanged,
}: {
    campaign: string;
    character: Character;
    onChanged: () => void;
}) {
    const [busy, setBusy] = useState(false),
        [error, setError] = useState(''),
        [uncertain, setUncertain] = useState(false);
    const pending = useRef<{ key: string; delta: number; id: string } | null>(null),
        lock = useRef(false);
    const adjust = async (key: string, delta: number) => {
        if (lock.current) return;
        pending.current ??= { key, delta, id: commandId() };
        lock.current = true;
        setBusy(true);
        setUncertain(true);
        setError('');
        try {
            const p = pending.current;
            await gameplayApi.resource(campaign, character.id, p.key, p.delta, p.id);
            pending.current = null;
            setUncertain(false);
            onChanged();
        } catch (e) {
            if (e instanceof ApiError && e.status > 0 && e.status < 500) {
                pending.current = null;
                setUncertain(false);
            }
            setError((e as Error).message);
        } finally {
            lock.current = false;
            setBusy(false);
        }
    };
    return (
        <section className="character-resource-controls" aria-label="Ресурсы героя">
            {character.resources?.map((r) => (
                <div key={r.key}>
                    <RpgIcon icon={r.key === 'mana' ? 'mana' : r.icon} size={23} />
                    <span>{r.label}</span>
                    <strong>
                        {r.current}
                        <small> / {r.max}</small>
                    </strong>
                    {r.player_adjustable && (
                        <>
                            <button
                                aria-label={`Уменьшить ${r.label}`}
                                disabled={busy || uncertain}
                                onClick={() => void adjust(r.key, -1)}
                            >
                                −
                            </button>
                            <button
                                aria-label={`Увеличить ${r.label}`}
                                disabled={busy || uncertain}
                                onClick={() => void adjust(r.key, 1)}
                            >
                                ＋
                            </button>
                        </>
                    )}
                </div>
            ))}
            {error && (
                <p className="error" role="alert">
                    {error}
                    {uncertain && (
                        <button
                            disabled={busy}
                            onClick={() =>
                                void adjust(pending.current!.key, pending.current!.delta)
                            }
                        >
                            Повторить
                        </button>
                    )}
                </p>
            )}
        </section>
    );
}
