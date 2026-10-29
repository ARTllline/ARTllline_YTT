import { useEffect, useRef, useState } from 'react';
import { Dices, X } from 'lucide-react';
import { ApiError } from '../api/client';
import { commandId } from '../api/workspace';
import type { Character } from '../tabletop/types/scene';
import { checkPresentation } from '../workspace/interactions/checkPresentation';
import { rollModes, type RollMode } from '../workspace/interactions/actingToken';
import { gameplayApi, type Ability, type AbilityResult, type AbilityTarget } from './model';
import {
    abilitySlot,
    clearAbility,
    readPendingAbility,
    retainAbility,
    type PendingAbility,
} from './pendingAbility';

export interface AbilityInvocation {
    ability: Ability;
    target: AbilityTarget | null;
    targetName?: string;
    retained?: PendingAbility;
}
export function AbilityDialog({
    invocation,
    character,
    sceneId,
    campaignId,
    epoch,
    userId,
    onClose,
    onAccepted,
}: {
    invocation: AbilityInvocation;
    character: Character;
    sceneId: string;
    campaignId: string;
    epoch: number;
    userId: string;
    onClose: () => void;
    onAccepted: (result: AbilityResult) => void;
}) {
    const { ability } = invocation;
    const slot = abilitySlot(userId, campaignId, character.id);
    const dialog = useRef<HTMLDialogElement>(null);
    const [retained, setRetained] = useState<PendingAbility | null>(
        () => invocation.retained ?? readPendingAbility(slot),
    );
    const pending = useRef<PendingAbility | null>(retained);
    const [mode, setMode] = useState<RollMode>(retained?.command.rollMode ?? 'normal');
    const [phase, setPhase] = useState<'ready' | 'rolling' | 'settle' | 'outcome'>('ready');
    const [result, setResult] = useState<AbilityResult | null>(null);
    const [error, setError] = useState('');
    const lock = useRef(false),
        alive = useRef(true);
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const busy = phase === 'rolling' || phase === 'settle';
    useEffect(() => {
        alive.current = true;
        dialog.current?.showModal();
        checkPresentation.setActive(true);
        return () => {
            alive.current = false;
            clearTimeout(timer.current);
            checkPresentation.setActive(false);
        };
    }, []);
    const execute = async () => {
        if (lock.current || result) return;
        lock.current = true;
        setError('');
        setPhase('rolling');
        pending.current ??= {
            sceneId,
            name: ability.name,
            command: {
                clientMutationId: commandId(),
                characterId: character.id,
                abilityId: ability.id,
                epoch,
                target: invocation.target,
                rollMode: mode,
            },
        };
        retainAbility(slot, pending.current);
        setRetained(pending.current);
        const start = performance.now(),
            reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
        try {
            const response = await gameplayApi.execute(
                pending.current.sceneId,
                pending.current.command,
            );
            clearAbility(slot);
            if (!alive.current) return;
            const settle = () => {
                setResult(response.execution);
                setPhase('settle');
                timer.current = setTimeout(
                    () => {
                        setPhase('outcome');
                        lock.current = false;
                    },
                    reduced ? 0 : 260,
                );
            };
            timer.current = setTimeout(
                settle,
                Math.max(0, (reduced ? 0 : 850) - (performance.now() - start)),
            );
        } catch (e) {
            if (e instanceof ApiError && e.status > 0 && e.status < 500) {
                clearAbility(slot);
                pending.current = null;
                setRetained(null);
            }
            if (!alive.current) return;
            lock.current = false;
            setPhase('ready');
            setError((e as Error).message);
        }
    };
    const close = () => {
        if (result) onAccepted(result);
        onClose();
    };
    const roll = result?.roll;
    const naturalClass =
        roll?.natural === 20 ? 'natural-high' : roll?.natural === 1 ? 'natural-low' : '';
    const label =
        result?.category === 'attack'
            ? result.success
                ? 'ПОПАДАНИЕ'
                : 'ПРОМАХ'
            : result?.roll
              ? result.success
                  ? 'УСПЕХ'
                  : 'ПРОВАЛ'
              : 'ГОТОВО';
    return (
        <dialog
            ref={dialog}
            className={`check-dialog ability-dialog phase-${phase} ${naturalClass} ${phase === 'outcome' ? (result?.success ? 'is-success' : 'is-failure') : ''}`}
            aria-labelledby="ability-roll-title"
            onCancel={(e) => {
                e.preventDefault();
                if (!busy) close();
            }}
            onKeyDown={(e) => e.stopPropagation()}
        >
            <button
                className="icon-button check-close"
                disabled={busy}
                aria-label="Закрыть действие"
                onClick={close}
            >
                <X size={18} />
            </button>
            <div className="ability-roll-actor">
                <span className="actor-portrait">
                    {character.portrait ? (
                        <img src={character.portrait.url} alt="" />
                    ) : (
                        character.name.slice(0, 1)
                    )}
                </span>
                <div>
                    <span className="eyebrow">ДЕЙСТВУЮЩИЙ ПЕРСОНАЖ</span>
                    <strong>{result?.actorName ?? character.name}</strong>
                </div>
            </div>
            <span className="eyebrow">
                {ability.category === 'attack' ? 'АТАКА' : ability.check ? 'ПРОВЕРКА' : 'ДЕЙСТВИЕ'}
            </span>
            <h2 id="ability-roll-title">{ability.name}</h2>
            <p className="check-label">
                {invocation.targetName ??
                    (ability.target === 'self' ? 'На себя' : ability.description)}
            </p>
            {ability.check && (
                <label className="check-mode">
                    Режим броска
                    <select
                        aria-label="Режим броска способности"
                        value={mode}
                        disabled={busy || !!result || !!retained}
                        onChange={(e) => setMode(e.target.value as RollMode)}
                    >
                        {Object.entries(rollModes).map(([k, v]) => (
                            <option value={k} key={k}>
                                {v}
                            </option>
                        ))}
                    </select>
                </label>
            )}
            <div className={`check-dice ${mode !== 'normal' && ability.check ? 'is-pair' : ''}`}>
                {(
                    roll?.rawDice ?? (mode === 'normal' || !ability.check ? [null] : [null, null])
                ).map((die, i) => (
                    <div
                        key={i}
                        className={`check-die ${roll ? (i === roll.selectedDie ? 'is-used' : 'is-discarded') : ''}`}
                    >
                        <svg viewBox="0 0 160 176" fill="none" aria-hidden="true">
                            <path d="M80 4 150 45 150 128 80 172 10 128 10 45Z M80 4 38 62 10 128 M80 4 122 62 150 128 M10 45 38 62 80 145 122 62 150 45 M10 128 80 145 150 128 M80 145 80 172 M38 62 122 62" />
                        </svg>
                        <strong>{die ?? (ability.check ? 'd20' : '✦')}</strong>
                    </div>
                ))}
            </div>
            <div className="check-equation" aria-live="polite">
                {roll ? (
                    <span>
                        {roll.natural} {roll.modifier < 0 ? '−' : '+'} {Math.abs(roll.modifier)}{' '}
                        <span className="check-equals">=</span> <strong>{roll.total}</strong>
                    </span>
                ) : (
                    <span className="check-hint">
                        {busy ? 'Мир ждёт исхода…' : 'Ваш следующий ход'}
                    </span>
                )}
            </div>
            {roll?.dc !== undefined && <span className="check-dc">ПРОТИВ {roll.dc}</span>}
            <div className="check-outcome" role="status">
                {phase === 'outcome' && (
                    <>
                        <strong>{label}</strong>
                        <small>
                            {roll?.natural === 20
                                ? 'Натуральная 20'
                                : roll?.natural === 1
                                  ? 'Натуральная 1'
                                  : 'Действие завершено'}
                        </small>
                    </>
                )}
            </div>
            {phase === 'outcome' && result?.damage && (
                <div className="ability-damage">
                    <span>
                        {result.damage.expression} · [{result.damage.rawDice.join(', ')}]
                    </span>
                    <strong>
                        {result.damage.total} <small>УРОНА</small>
                    </strong>
                </div>
            )}
            {phase === 'outcome' && !!result?.healing && (
                <div className="ability-damage is-heal">
                    <strong>
                        +{result.healing} <small>HP</small>
                    </strong>
                </div>
            )}
            {!!ability.costs.length && !result && (
                <p className="hint">
                    Стоимость:{' '}
                    {ability.costs
                        .map(
                            (c) =>
                                `${character.resources?.find((r) => r.key === c.key)?.label ?? c.key} −${c.amount}`,
                        )
                        .join(' · ')}
                </p>
            )}
            {error && (
                <p className="error" role="alert">
                    {error}
                </p>
            )}
            {error && retained && (
                <p className="hint">
                    Ответ не подтверждён. Повтор использует тот же запрос и бросок.
                </p>
            )}
            <button
                className="primary-button check-roll"
                disabled={busy}
                onClick={result ? close : () => void execute()}
            >
                <Dices size={18} />
                {busy
                    ? 'Решается…'
                    : result
                      ? 'Продолжить'
                      : error
                        ? 'Повторить запрос'
                        : ability.check
                          ? 'Бросить'
                          : 'Выполнить'}
            </button>
        </dialog>
    );
}
