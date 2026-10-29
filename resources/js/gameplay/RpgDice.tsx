import { useEffect, useRef, useState } from 'react';
import { DiceRuntime, type DiceStatus } from './DiceRuntime';
import { usePlayerDice } from './PlayerDiceProvider';

export function RpgDice({
    dice,
    selected = 0,
    mode = 'normal',
    phase,
    onSettled,
    sides = 20,
}: {
    dice?: number[];
    selected?: number;
    mode?: string;
    phase: string;
    onSettled?: () => void;
    sides?: number;
}) {
    const shared = usePlayerDice();
    const [local] = useState(() => (shared ? null : new DiceRuntime(false)));
    const runtime = shared ?? local!;
    const host = useRef<HTMLDivElement>(null),
        parking = useRef<HTMLDivElement>(null);
    const complete = useRef(onSettled);
    const [state, setState] = useState<'waiting' | 'preparing' | 'rolling' | DiceStatus>('waiting');
    const count = mode === 'normal' ? 1 : 2;
    useEffect(() => {
        complete.current = onSettled;
    });
    useEffect(() => {
        const anchor = host.current!;
        let alive = true;
        if (local) local.mount(parking.current!);
        runtime.attach(anchor);
        if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
            void runtime
                .prepare()
                .then(() => {
                    if (alive && !dice) runtime.preview(count);
                })
                .catch(() => {});
        }
        return () => {
            alive = false;
            runtime.release(anchor);
            local?.dispose();
        };
        // Renderer ownership follows the mounted presentation, not result/phase changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [runtime, local]);
    useEffect(() => {
        if (!dice && phase === 'ready') runtime.preview(count);
    }, [runtime, dice, count, phase]);
    const key = dice?.join(',') ?? '';
    useEffect(() => {
        if (!key) return;
        let alive = true,
            completeOnce = false;
        const timeout = setTimeout(() => {
            if (alive && !completeOnce) {
                runtime.abort();
                finish('static');
            }
        }, 10000);
        const media = matchMedia('(prefers-reduced-motion: reduce)');
        const finish = (status: DiceStatus) => {
            if (!alive || completeOnce) return;
            completeOnce = true;
            clearTimeout(timeout);
            setState(status);
            complete.current?.();
        };
        const reduced = () => {
            if (media.matches) {
                runtime.abort();
                finish('static');
            }
        };
        media.addEventListener('change', reduced);
        if (media.matches) queueMicrotask(() => finish('static'));
        else {
            queueMicrotask(() => setState('preparing'));
            void runtime
                .prepare()
                .then(() => {
                    if (!alive || completeOnce) return;
                    setState('rolling');
                    return runtime.roll(key.split(',').map(Number), sides).then(finish);
                })
                .catch(() => finish('static'));
        }
        return () => {
            alive = false;
            clearTimeout(timeout);
            media.removeEventListener('change', reduced);
        };
    }, [key, runtime, sides]);
    const values = dice ?? Array.from({ length: count }, () => null);
    return (
        <div
            className={`physical-dice-stage ${shared ? 'is-player-stage' : ''} state-${state}`}
            data-phase={phase}
            data-runtime={runtime.id}
            aria-label={`Кубики d${sides}`}
        >
            <div className="physical-dice-canvas" ref={host} aria-hidden="true" />
            {local && <div className="player-dice-park" ref={parking} aria-hidden="true" />}
            {(!dice || state === 'waiting' || state === 'preparing') && (
                <div className="dice-awaiting">
                    <small>
                        {state === 'preparing'
                            ? 'ПОДГОТАВЛИВАЕМ КУБИКИ…'
                            : phase === 'rolling'
                              ? 'СЕРВЕР ОПРЕДЕЛЯЕТ РЕЗУЛЬТАТ…'
                              : 'НАЖМИТЕ «БРОСИТЬ»'}
                    </small>
                </div>
            )}
            <div className="physical-dice-values" aria-live="polite">
                {dice &&
                    ['settled', 'static'].includes(state) &&
                    values.map((value, index) => (
                        <figure
                            key={index}
                            className={`${sides === 20 && values.length > 1 && index !== selected ? 'is-discarded' : 'is-used'} ${sides === 20 && value === 20 ? 'natural-high' : sides === 20 && value === 1 ? 'natural-low' : ''}`}
                        >
                            <strong>{value}</strong>
                            <figcaption>
                                {sides === 20 && values.length > 1
                                    ? index === selected
                                        ? 'В ЗАЧЁТ'
                                        : 'ОТБРОШЕН'
                                    : `d${sides}`}
                            </figcaption>
                        </figure>
                    ))}
            </div>
            {state === 'static' && <small className="dice-fallback-label">Результат сервера</small>}
        </div>
    );
}
