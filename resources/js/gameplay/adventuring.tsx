import { useState } from 'react';
import { ApiError, request } from '../api/client';
import { api, commandId } from '../api/workspace';
import type { SceneStore } from '../tabletop/state/SceneStore';
import type { Character, Token } from '../tabletop/types/scene';
import '../../css/adventuring.css';

export interface LifeState {
    status: 'alive' | 'dying' | 'stable' | 'dead' | 'defeated' | 'unconscious';
    successes: number;
    failures: number;
    requiredTurn: string | null;
    resolvedTurn: string | null;
    cause: string | null;
    recoveryHours?: number;
}
export interface HitPointPool {
    die: 'd6' | 'd8' | 'd10' | 'd12';
    max: number;
    current: number;
}
export interface RestState {
    id: string;
    kind: 'short-rest' | 'long-rest';
    status: 'spending' | 'complete' | 'interrupted';
    changes: string[];
    rolls: { die: string; roll: number; con: number; recovered: number }[];
    interruption?: string;
}

export function useAdventuring(store: SceneStore, scope = 'party') {
    const { scene } = store.getSnapshot();
    const key = `ytt:adventuring:${scene.id}:${store.role}:${scope}`;
    const [pending, setPending] = useState<Record<string, unknown> | null>(() => {
        try {
            return JSON.parse(sessionStorage.getItem(key) ?? 'null');
        } catch {
            return null;
        }
    });
    const [busy, setBusy] = useState(false),
        [error, setError] = useState(''),
        [message, setMessage] = useState('');
    const clear = () => {
        setPending(null);
        sessionStorage.removeItem(key);
    };
    const run = async (body: Record<string, unknown>) => {
        const command = body.clientMutationId ? body : { ...body, clientMutationId: commandId() };
        setBusy(true);
        setError('');
        setPending(command);
        sessionStorage.setItem(key, JSON.stringify(command));
        try {
            const r = await request<{
                message?: string;
                roll?: { natural: number; total: number; success: boolean };
            }>(`/scenes/${scene.id}/adventuring`, 'POST', command);
            clear();
            setMessage(
                r.message ??
                    (r.roll
                        ? `${r.roll.natural} → ${r.roll.total} · ${r.roll.success ? 'успех' : 'провал'}`
                        : 'Сохранено'),
            );
            const next = await api.snapshot(scene.id!);
            const current = store.getSnapshot().scene;
            if (next.id === current.id && (next.revision ?? 0) >= (current.revision ?? 0))
                store.reconcile(next);
        } catch (e) {
            setError((e as Error).message);
            if (e instanceof ApiError && e.status >= 400 && e.status < 500) clear();
        } finally {
            setBusy(false);
        }
    };
    return { run, pending, busy, error, message };
}

export function ExhaustionBadge({ level = 0 }: { level?: number }) {
    if (!level) return null;
    return (
        <span
            className="exhaustion-badge"
            title={`D20 Tests −${level * 2} · скорость −${level * 5} ft${level === 6 ? ' · смерть' : ''}`}
        >
            Exhaustion {level} · D20 −{level * 2} · −{level * 5} ft
        </span>
    );
}

export function LifeSummary({ state }: { state?: LifeState }) {
    if (!state || state.status === 'alive') return null;
    const labels = {
        dying: 'Без сознания · Death Saves',
        stable: 'Стабилен · без сознания',
        dead: 'Мёртв',
        defeated: 'Побеждён · решение ГМ',
        unconscious: 'Без сознания',
    };
    return (
        <div className={`life-summary is-${state.status}`} role="status">
            <strong>{labels[state.status]}</strong>
            {state.status === 'dying' && (
                <div className="death-marks">
                    <span aria-label={`Успехи: ${state.successes}`}>
                        Успехи{' '}
                        <b>
                            {'●'.repeat(state.successes)}
                            {'○'.repeat(3 - state.successes)}
                        </b>
                    </span>
                    <span aria-label={`Провалы: ${state.failures}`}>
                        Провалы{' '}
                        <b>
                            {'●'.repeat(state.failures)}
                            {'○'.repeat(3 - state.failures)}
                        </b>
                    </span>
                </div>
            )}
            {state.status === 'dead' && state.cause === 'exhaustion' && (
                <small>Причина смерти: Exhaustion</small>
            )}
        </div>
    );
}

export function AdventuringHUD({
    character,
    actor,
    store,
    disabled,
}: {
    character: Character;
    actor?: Token;
    store: SceneStore;
    disabled: boolean;
}) {
    const cmd = useAdventuring(store, `character:${character.id}`);
    const state = character.lifecycle;
    const { scene, selectedIds } = store.getSnapshot();
    const rest = character.rest;
    const required =
        state?.status === 'dying' &&
        !!state.requiredTurn &&
        state.requiredTurn !== state.resolvedTurn &&
        scene.combat?.status === 'active' &&
        scene.combat.combatants.find(
            (e) =>
                e.id ===
                (scene.combat?.currentTurn && 'combatantId' in scene.combat.currentTurn
                    ? scene.combat.currentTurn.combatantId
                    : ''),
        )?.tokenId === actor?.id;
    const target = scene.tokens.find(
        (t) =>
            selectedIds.includes(t.id) &&
            t.id !== actor?.id &&
            t.conditions?.some((c) => c.key === 'unconscious'),
    );
    const blocked = disabled || cmd.busy || !!cmd.pending;
    return (
        <section className="adventuring-hud" aria-label="Состояние и отдых">
            <ExhaustionBadge level={character.exhaustion} />
            <LifeSummary state={state} />
            {state?.status === 'dying' && (
                <button
                    className="death-save-button"
                    disabled={blocked || !actor || !required}
                    onClick={() => void cmd.run({ action: 'death-save', tokenId: actor!.id })}
                >
                    {required ? 'Бросить Death Save' : 'Death Save · в начале своего хода'}
                </button>
            )}
            {target && actor && (!state || state.status === 'alive') && (
                <button
                    disabled={blocked}
                    onClick={() =>
                        void cmd.run({
                            action: 'stabilize',
                            tokenId: actor.id,
                            targetId: target.id,
                        })
                    }
                >
                    Стабилизировать · {target.name} · Medicine Сл 10
                </button>
            )}
            {rest?.status === 'spending' && (
                <div className="rest-card">
                    <header>
                        <strong>
                            Short Rest · {character.hp} / {character.maxHp} HP
                        </strong>
                        <small>Период отдыха подтверждён ГМ</small>
                    </header>
                    <div className="hit-point-dice">
                        {(character.hitPointDice ?? []).map((p) => (
                            <button
                                className="hit-point-die"
                                key={p.die}
                                disabled={blocked || !actor || !p.current}
                                onClick={() =>
                                    void cmd.run({
                                        action: 'spend-die',
                                        tokenId: actor!.id,
                                        die: p.die,
                                        restId: rest.id,
                                    })
                                }
                            >
                                <b>{p.die}</b>
                                <span>
                                    ×{p.current} / {p.max}
                                </span>
                                <small>Потратить</small>
                            </button>
                        ))}
                    </div>
                    {!character.hitPointDice?.length && <p>ГМ ещё не настроил Hit Point Dice.</p>}
                    {rest.rolls.map((r, i) => (
                        <p className="rest-roll" key={i}>
                            {r.die}: {r.roll} · CON {r.con >= 0 ? '+' : ''}
                            {r.con} · <strong>+{r.recovered} HP</strong>
                        </p>
                    ))}
                    <button
                        disabled={blocked || !actor}
                        onClick={() =>
                            void cmd.run({
                                action: 'finish-rest',
                                tokenId: actor!.id,
                                restId: rest.id,
                            })
                        }
                    >
                        Завершить отдых
                    </button>
                </div>
            )}
            {rest?.status === 'complete' && rest.kind === 'long-rest' && (
                <details className="rest-recovery">
                    <summary>Long Rest завершён</summary>
                    {rest.changes.length ? (
                        rest.changes.map((c, i) => <p key={i}>{c}</p>)
                    ) : (
                        <p>Ресурсы уже полны.</p>
                    )}
                </details>
            )}
            {rest?.status === 'interrupted' && (
                <small>Окно отдыха закрыто · {rest.interruption}</small>
            )}
            {cmd.message && <p role="status">{cmd.message}</p>}
            {cmd.error && <p role="alert">{cmd.error}</p>}
            {cmd.pending && !cmd.busy && (
                <button onClick={() => void cmd.run(cmd.pending!)}>Повторить с тем же ID</button>
            )}
        </section>
    );
}
