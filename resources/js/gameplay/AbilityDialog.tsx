import { RpgDice } from './RpgDice';
import { breakdownLabel } from '../rpg/rules';
import { RpgIcon } from './RpgIcon';
import { usePlayerDice } from './PlayerDiceProvider';
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
    inventoryItemId?: string;
    ability: Ability;
    target: AbilityTarget | null;
    targetName?: string;
    retained?: PendingAbility;
    auto?: boolean;
    mode?: RollMode;
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
    const cinematic = !!usePlayerDice() && !!(ability.check || ability.damage);
    const slot = abilitySlot(userId, campaignId, character.id);
    const dialog = useRef<HTMLDialogElement>(null);
    const [retained, setRetained] = useState<PendingAbility | null>(
        () => invocation.retained ?? readPendingAbility(slot),
    );
    const pending = useRef<PendingAbility | null>(retained);
    const [mode, setMode] = useState<RollMode>(
        retained?.command.rollMode ?? invocation.mode ?? 'normal',
    );
    const [phase, setPhase] = useState<
        'ready' | 'rolling' | 'settle' | 'total' | 'outcome' | 'damage'
    >('ready');
    const [result, setResult] = useState<AbilityResult | null>(null);
    const [error, setError] = useState('');
    const lock = useRef(false),
        alive = useRef(true);
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const visualSettled = useRef<(() => void) | null>(null);
    const busy = !['ready', 'damage'].includes(phase) && !(phase === 'outcome' && !result?.damage);
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
                ...(invocation.inventoryItemId
                    ? { inventoryItemId: invocation.inventoryItemId }
                    : {}),
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
                setPhase('settle');
                timer.current = setTimeout(
                    () => {
                        setPhase('total');
                        timer.current = setTimeout(
                            () => {
                                setPhase('outcome');
                                if (response.execution.damage)
                                    timer.current = setTimeout(
                                        () => {
                                            setPhase('damage');
                                            lock.current = false;
                                        },
                                        reduced ? 0 : 480,
                                    );
                                else lock.current = false;
                            },
                            reduced ? 0 : 260,
                        );
                    },
                    reduced ? 0 : 200,
                );
            };
            visualSettled.current = settle;
            setResult(response.execution);
            if (!response.execution.roll)
                timer.current = setTimeout(
                    settle,
                    Math.max(0, (reduced ? 0 : 450) - (performance.now() - start)),
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
    const autoExecute = useRef(execute);
    useEffect(() => {
        autoExecute.current = execute;
    });
    useEffect(() => {
        if (invocation.auto) queueMicrotask(() => void autoExecute.current());
    }, [invocation.auto]);
    const close = () => {
        if (result) onAccepted(result);
        onClose();
    };
    const roll = result?.roll;
    const showingDamage = phase === 'damage' && !!result?.damage;
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
            className={`check-dialog ability-dialog rpg-dice-dialog ${cinematic ? 'player-check-stage' : ''} phase-${phase} ${naturalClass} ${phase === 'outcome' ? (result?.success ? 'is-success' : 'is-failure') : ''}`}
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
            <h2 id="ability-roll-title">
                {cinematic && ability.category === 'check'
                    ? (character.checkStats.find((s) => s.key === ability.check?.stat_key)?.label ??
                      ability.name)
                    : ability.name}
            </h2>
            <p className="check-label">
                {invocation.targetName ??
                    (ability.target === 'self' ? 'На себя' : ability.description)}
            </p>
            {ability.check && !invocation.auto && phase === 'ready' && (
                <div className="roll-mode-chips" aria-label="Режим броска способности">
                    {Object.entries(rollModes).map(([k, v]) => (
                        <button
                            key={k}
                            disabled={!!retained}
                            aria-pressed={mode === k}
                            onClick={() => setMode(k as RollMode)}
                        >
                            {v}
                        </button>
                    ))}
                </div>
            )}
            {roll && (
                <div className="rpg-roll-context">
                    {roll.dc !== undefined && <span>Сложность {roll.dc}</span>}
                    <strong>
                        {roll.modifier >= 0 ? '+' : '−'}
                        {Math.abs(roll.modifier)}{' '}
                        {character.checkStats.find((s) => s.key === ability.check?.stat_key)
                            ?.label ?? 'Модификатор'}
                    </strong>
                </div>
            )}
            {ability.check || showingDamage ? (
                <RpgDice
                    dice={showingDamage ? result!.damage!.rawDice : roll?.rawDice}
                    sides={
                        showingDamage
                            ? Number(result!.damage!.expression.match(/d(\d+)/)?.[1] ?? 6)
                            : 20
                    }
                    selected={showingDamage ? 0 : roll?.selectedDie}
                    mode={mode}
                    phase={phase}
                    onSettled={showingDamage ? undefined : () => visualSettled.current?.()}
                />
            ) : (
                phase !== 'damage' && (
                    <div className="ability-sigil" aria-hidden="true">
                        <RpgIcon icon={ability.icon} size={76} />
                    </div>
                )
            )}
            <div className="check-equation" aria-live="polite">
                {roll && ['total', 'outcome', 'damage'].includes(phase) ? (
                    <span className="check-sum">
                        <span className="sum-face">{roll.natural}</span>{' '}
                        <span className="sum-modifier">
                            {roll.modifier < 0 ? '−' : '+'} {Math.abs(roll.modifier)}
                        </span>{' '}
                        <span className="check-equals">=</span> <strong>{roll.total}</strong>
                    </span>
                ) : (
                    <span className="check-hint">
                        {busy
                            ? 'Мир ждёт исхода…'
                            : result
                              ? 'Действие принято'
                              : 'Ваш следующий ход'}
                    </span>
                )}
            </div>
            {roll?.dc !== undefined && ['total', 'outcome', 'damage'].includes(phase) && (
                <span className="check-dc">ПРОТИВ {roll.dc}</span>
            )}
            {result?.provenance?.breakdown && ['total', 'outcome', 'damage'].includes(phase) && (
                <p className="hint">{breakdownLabel(result.provenance.breakdown)}</p>
            )}
            <div className="check-outcome" role="status">
                {['outcome', 'damage'].includes(phase) && (
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
            {phase === 'damage' && result?.damage && (
                <div className="ability-damage">
                    <span>
                        {result.damage.expression} · [{result.damage.rawDice.join(', ')}]
                    </span>
                    <strong>
                        {result.damage.total} <small>УРОНА</small>
                    </strong>
                </div>
            )}
            {['outcome', 'damage'].includes(phase) && !!result?.healing && (
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
