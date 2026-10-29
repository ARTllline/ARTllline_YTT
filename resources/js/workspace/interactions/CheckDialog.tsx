import { useEffect, useRef, useState } from 'react';
import { Dices, X } from 'lucide-react';
import { ApiError } from '../../api/client';
import { interactions, type ObjectInteraction, type CheckResult } from './model';
import { checkPresentation, checkTimings, type CheckPhase } from './checkPresentation';
import { ActorPicker, ActorPortrait } from './ActorPicker';
import { rollModes, signedModifier, type RollMode } from './actingToken';
import type { Token } from '../../tabletop/types/scene';
import { checkRequest, readCheckRequest } from './checkRequest';
import type { Handout } from '../../api/preparation';

export interface CheckInvocation {
    action: ObjectInteraction;
    sceneId: string;
    kind: 'token' | 'prop';
    objectId: string;
    epoch: number;
    userId: string;
}
export function CheckDialog({
    invocation,
    actors,
    actorRequired = false,
    actor,
    onActorChange,
    onClose,
    onHandout,
}: {
    invocation: CheckInvocation;
    actors: readonly Token[];
    actorRequired?: boolean;
    actor?: Token;
    onActorChange: (id: string) => void;
    onClose: () => void;
    onHandout: (handout: Handout) => void;
}) {
    const requestKey = `${invocation.userId}:${invocation.sceneId}:${invocation.epoch}:${invocation.kind}:${invocation.objectId}:${invocation.action.id}`;
    const [retained, setRetained] = useState(() => readCheckRequest(requestKey));
    const [mode, setMode] = useState<RollMode>(retained?.context?.rollMode ?? 'normal');
    const acting = retained?.context
        ? actors.find((t) => t.id === retained.context!.actorTokenId)
        : actor;
    const stat = acting?.checkStats?.find((s) => s.key === invocation.action.check?.stat_key);
    const missingActor = actorRequired && !acting;
    const missingStat = !!invocation.action.check?.stat_key && !stat;
    const dialog = useRef<HTMLDialogElement>(null);
    const locked = useRef(false);
    const alive = useRef(true);
    const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
    const pending = useRef<ReturnType<typeof checkRequest> | null>(null);
    const [phase, setPhase] = useState<CheckPhase>('ready');
    const [result, setResult] = useState<CheckResult | null>(null);
    const [error, setError] = useState('');
    const [preview, setPreview] = useState<Handout | null>(null);
    const busy = phase !== 'ready' && phase !== 'outcome';
    const reduced = useRef(false);
    useEffect(() => {
        alive.current = true;
        const scheduled = timers.current;
        reduced.current = matchMedia('(prefers-reduced-motion: reduce)').matches;
        checkPresentation.setActive(true);
        dialog.current?.showModal();
        return () => {
            alive.current = false;
            scheduled.forEach(clearTimeout);
            checkPresentation.setActive(false);
        };
    }, []);
    const close = () => {
        if (locked.current) return;
        onClose();
        if (preview) onHandout(preview);
    };
    const roll = async () => {
        if (locked.current || result || ((missingStat || missingActor) && !retained?.context))
            return;
        locked.current = true;
        setError('');
        setPhase('rolling');
        const { sceneId, kind, objectId, action, epoch } = invocation;
        pending.current ??= checkRequest(requestKey, undefined, {
            actorTokenId: acting?.id,
            rollMode: mode,
        });
        setRetained({ id: pending.current.id, context: pending.current.context });
        const timing = checkTimings(reduced.current);
        const started = performance.now();
        try {
            const response = await interactions.run(
                sceneId,
                kind,
                objectId,
                action.id,
                epoch,
                pending.current.id,
                pending.current.context?.actorTokenId,
                pending.current.context?.rollMode,
            );
            if (!response.check)
                throw new Error(
                    'Настройки действия изменились. Закройте окно и откройте действие снова.',
                );
            pending.current.complete();
            if (!alive.current) return;
            setPreview(response.handout ?? null);
            const settle = () => {
                setResult(response.check!);
                setPhase('settle');
                timers.current.push(
                    setTimeout(() => {
                        setPhase('total');
                        timers.current.push(
                            setTimeout(() => {
                                locked.current = false;
                                setPhase('outcome');
                            }, timing.total),
                        );
                    }, timing.settle),
                );
            };
            timers.current.push(
                setTimeout(settle, Math.max(0, timing.roll - (performance.now() - started))),
            );
        } catch (e) {
            if (e instanceof ApiError && e.status > 0 && e.status < 500) {
                pending.current.complete();
                pending.current = null;
                setRetained(null);
            }
            if (!alive.current) return;
            locked.current = false;
            setPhase('ready');
            setError((e as Error).message);
        }
    };
    const check = invocation.action.check!;
    const showTotal = phase === 'total' || phase === 'outcome';
    const natural = result?.natural;
    return (
        <dialog
            ref={dialog}
            className={`check-dialog phase-${phase} ${phase === 'outcome' ? (result?.success ? 'is-success' : 'is-failure') : ''}`}
            aria-labelledby="check-title"
            aria-describedby="check-label"
            onCancel={(e) => {
                e.preventDefault();
                if (!busy) close();
            }}
            onKeyDown={(e) => e.stopPropagation()}
        >
            <button
                className="icon-button check-close"
                aria-label="Закрыть проверку"
                disabled={busy}
                onClick={close}
            >
                <X size={18} />
            </button>
            {result ? (
                <div className="actor-picker check-actor-result">
                    <ActorPortrait token={actors.find((t) => t.id === result.provenance.tokenId)} />
                    <label>
                        <span>БРОСОК ПЕРСОНАЖА</span>
                        <strong>{result.provenance.tokenName ?? 'Игрок'}</strong>
                    </label>
                </div>
            ) : (
                <ActorPicker
                    tokens={actors}
                    actor={acting}
                    onChange={onActorChange}
                    disabled={busy || !!retained?.context}
                />
            )}
            <span className="eyebrow">ВЗАИМОДЕЙСТВИЕ</span>
            <h2 id="check-title">{invocation.action.label}</h2>
            <p id="check-label" className="check-label">
                Проверка · {check.label}
            </p>
            <div className="check-source">
                <strong>
                    {result || stat ? signedModifier(result?.modifier ?? stat!.modifier) : '—'}
                </strong>
                <span>
                    {result
                        ? `${result.provenance.tokenName ?? 'Игрок'} · ${result.provenance.statLabel}`
                        : stat
                          ? `${acting?.name} · ${stat.label}`
                          : check.stat_key
                            ? `Не настроено: ${check.stat_key}`
                            : 'Task 16B · фиксированный модификатор'}
                </span>
            </div>
            {(missingStat || missingActor) && !result && (
                <p className="hint">
                    {acting
                        ? 'Попросите GM настроить эту проверку персонажа.'
                        : 'Выберите действующего персонажа.'}
                </p>
            )}
            <label className="check-mode">
                Режим броска
                <select
                    aria-label="Режим броска"
                    value={result?.rollMode ?? mode}
                    disabled={busy || !!result || !!retained?.context}
                    onChange={(e) => setMode(e.target.value as RollMode)}
                >
                    {Object.entries(rollModes).map(([key, label]) => (
                        <option key={key} value={key}>
                            {label}
                        </option>
                    ))}
                </select>
            </label>
            {retained?.context && !result && (
                <p className="hint">
                    Сохранён запрос: персонаж и режим закреплены до ответа сервера.
                </p>
            )}
            {check.dc !== undefined && check.dc_visible !== false && (
                <span className="check-dc">DC {check.dc}</span>
            )}
            <div
                className={`check-dice ${(result?.rawDice.length ?? (mode === 'normal' ? 1 : 2)) > 1 ? 'is-pair' : ''}`}
            >
                {(result?.rawDice ?? (mode === 'normal' ? [null] : [null, null])).map(
                    (die, index) => (
                        <div
                            key={index}
                            className={`check-die ${result ? (index === result.selectedDie ? 'is-used' : 'is-discarded') : ''}`}
                        >
                            <svg viewBox="0 0 160 176" fill="none" aria-hidden="true">
                                <path d="M80 4 150 45 150 128 80 172 10 128 10 45Z M80 4 38 62 10 128 M80 4 122 62 150 128 M10 45 38 62 80 145 122 62 150 45 M10 128 80 145 150 128 M80 145 80 172 M38 62 122 62" />
                            </svg>
                            <strong>{die ?? 'd20'}</strong>
                            {result && (
                                <small>
                                    {index === result.selectedDie ? 'В зачёт' : 'Отброшен'}
                                </small>
                            )}
                        </div>
                    ),
                )}
            </div>
            <div className="check-equation" aria-live="polite">
                {showTotal && result ? (
                    <span>
                        {natural} {result.modifier < 0 ? '−' : '+'} {Math.abs(result.modifier)}{' '}
                        <span className="check-equals">=</span> <strong>{result.total}</strong>
                    </span>
                ) : (
                    <span className="check-hint">
                        {phase === 'rolling'
                            ? 'Кубик в движении…'
                            : phase === 'settle'
                              ? 'Кубик остановился'
                              : 'Один миг решает всё'}
                    </span>
                )}
            </div>
            <div className="check-outcome" role="status">
                {phase === 'outcome' && result && (
                    <>
                        <strong>{result.success ? 'УСПЕХ' : 'ПРОВАЛ'}</strong>
                        <small>
                            {natural === 20
                                ? 'Натуральная 20'
                                : natural === 1
                                  ? 'Натуральная 1'
                                  : 'Проверка завершена'}
                        </small>
                    </>
                )}
            </div>
            {error && (
                <p className="error" role="alert">
                    {error}
                </p>
            )}
            {phase === 'outcome' ? (
                <button className="primary-button check-roll" onClick={close}>
                    Продолжить
                </button>
            ) : (
                <button
                    className="primary-button check-roll"
                    disabled={busy || ((missingStat || missingActor) && !retained?.context)}
                    onClick={() => void roll()}
                >
                    <Dices size={18} />
                    {busy ? 'Бросок…' : error ? 'Повторить запрос' : 'Бросить'}
                </button>
            )}
        </dialog>
    );
}
