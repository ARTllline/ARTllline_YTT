import { useEffect, useRef, useState } from 'react';
import { Dices, X } from 'lucide-react';
import { ApiError } from '../../api/client';
import { interactions, type ObjectInteraction, type CheckResult } from './model';
import { checkPresentation, checkTimings, type CheckPhase } from './checkPresentation';
import { checkRequest } from './checkRequest';
import type { Handout } from '../../api/preparation';

export interface CheckInvocation {
    action: ObjectInteraction;
    sceneId: string;
    kind: 'token' | 'prop';
    objectId: string;
    epoch: number;
    userId: string;
    actorTokenId?: string;
}
export function CheckDialog({
    invocation,
    onClose,
    onHandout,
}: {
    invocation: CheckInvocation;
    onClose: () => void;
    onHandout: (handout: Handout) => void;
}) {
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
        if (locked.current || result) return;
        locked.current = true;
        setError('');
        setPhase('rolling');
        const { sceneId, kind, objectId, action, epoch, userId, actorTokenId } = invocation;
        pending.current ??= checkRequest(
            `${userId}:${sceneId}:${epoch}:${kind}:${objectId}:${action.id}`,
        );
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
                actorTokenId,
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
            <span className="eyebrow">ВЗАИМОДЕЙСТВИЕ</span>
            <h2 id="check-title">{invocation.action.label}</h2>
            <p id="check-label" className="check-label">
                Проверка · {check.label}
            </p>
            {check.dc !== undefined && check.dc_visible !== false && (
                <span className="check-dc">DC {check.dc}</span>
            )}
            <div
                className={`check-die ${natural === 20 ? 'natural-twenty' : natural === 1 ? 'natural-one' : ''}`}
                aria-hidden="true"
            >
                <svg viewBox="0 0 160 176" fill="none">
                    <path d="M80 4 150 45 150 128 80 172 10 128 10 45Z M80 4 38 62 10 128 M80 4 122 62 150 128 M10 45 38 62 80 145 122 62 150 45 M10 128 80 145 150 128 M80 145 80 172 M38 62 122 62" />
                </svg>
                <strong>{result ? natural : 'd20'}</strong>
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
                    disabled={busy}
                    onClick={() => void roll()}
                >
                    <Dices size={18} />
                    {busy ? 'Бросок…' : error ? 'Повторить запрос' : 'Бросить'}
                </button>
            )}
        </dialog>
    );
}
