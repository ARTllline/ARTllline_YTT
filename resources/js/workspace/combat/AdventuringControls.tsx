import { NpcLifecycleEditor } from './NpcLifecycleEditor';
import { useEffect, useState } from 'react';
import type { SceneStore } from '../../tabletop/state/SceneStore';
import type { Token } from '../../tabletop/types/scene';
import { request } from '../../api/client';
import {
    useAdventuring,
    ExhaustionBadge,
    LifeSummary,
    type HitPointPool,
} from '../../gameplay/adventuring';

export function GMRestControls({ store, disabled }: { store: SceneStore; disabled: boolean }) {
    const { scene, selectedIds } = store.getSnapshot();
    const cmd = useAdventuring(store);
    const [kind, setKind] = useState<'short-rest' | 'long-rest' | null>(null);
    const [confirmed, setConfirmed] = useState(false),
        [override, setOverride] = useState(false);
    const selected = scene.tokens
        .filter((t) => selectedIds.includes(t.id))
        .map((t) => t.characterId);
    const party = (scene.characters ?? []).filter(
        (c) => c.kind === 'player_character' && (!selected.length || selected.includes(c.id)),
    );
    const [history, setHistory] = useState<
        {
            id: number;
            result: { message?: string; summary?: { name: string; changes: string[] }[] };
        }[]
    >([]);
    const [historyOpen, setHistoryOpen] = useState(false);
    useEffect(() => {
        if (!historyOpen) return;
        let active = true;
        void request<{ events: typeof history }>(`/scenes/${scene.id}/adventuring/history`)
            .then((r) => {
                if (active) setHistory(r.events);
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, [scene.id, scene.revision, historyOpen]);
    return (
        <section className="gm-rest-controls" aria-label="Отдых группы">
            <div className="rest-actions">
                <strong>Отдых · {selected.length ? 'выбранные герои' : 'группа'}</strong>
                {(['short-rest', 'long-rest'] as const).map((k) => (
                    <button
                        key={k}
                        disabled={disabled || cmd.busy || !!cmd.pending}
                        onClick={() => {
                            setKind(k);
                            setConfirmed(false);
                            setOverride(false);
                        }}
                    >
                        {k === 'short-rest' ? 'Short Rest' : 'Long Rest'}
                    </button>
                ))}
            </div>
            {kind && (
                <div className="rest-confirm">
                    <strong>
                        {kind === 'short-rest'
                            ? 'Short Rest · 1 час'
                            : 'Long Rest · минимум 8 часов'}
                    </strong>
                    <p>{party.map((c) => c.name).join(' · ') || 'Выберите героев на карте'}</p>
                    <p>
                        {kind === 'short-rest'
                            ? 'Лёгкая деятельность; без инициативы, урона и заклинаний кроме cantrips.'
                            : 'Минимум 6 часов сна, до 2 часов лёгкой деятельности; до начала прошло 16 часов после прошлого Long Rest. Прерывания: инициатива, урон, заклинания кроме cantrips, 1 час нагрузки. При продолжении +1 час за прерывание.'}
                    </p>
                    <label>
                        <input
                            type="checkbox"
                            checked={confirmed}
                            onChange={(e) => setConfirmed(e.target.checked)}
                        />{' '}
                        Подтверждаю игровое время, условия и завершение периода отдыха
                    </label>
                    {scene.combat?.status === 'active' && (
                        <label>
                            <input
                                type="checkbox"
                                checked={override}
                                onChange={(e) => setOverride(e.target.checked)}
                            />{' '}
                            GM override: разрешить в бою · будет записано в историю
                        </label>
                    )}
                    <button
                        className="primary-button"
                        disabled={
                            disabled || cmd.busy || !!cmd.pending || !confirmed || !party.length
                        }
                        onClick={() =>
                            void cmd
                                .run({
                                    action: kind,
                                    characterIds: party.map((c) => c.id),
                                    confirmWorldTime: true,
                                    combatOverride: override,
                                })
                                .then(() => setKind(null))
                        }
                    >
                        Подтвердить отдых
                    </button>
                    <button onClick={() => setKind(null)}>Отмена</button>
                </div>
            )}
            {cmd.message && <p role="status">{cmd.message}</p>}
            {cmd.error && <p role="alert">{cmd.error}</p>}
            {cmd.pending && !cmd.busy && (
                <button onClick={() => void cmd.run(cmd.pending!)}>Повторить с тем же ID</button>
            )}
            <details onToggle={(e) => setHistoryOpen(e.currentTarget.open)}>
                <summary>История отдыха и жизненного цикла</summary>
                {history.map((e) => (
                    <div key={e.id}>
                        <strong>{e.result.message ?? 'Жизненный цикл'}</strong>
                        {e.result.summary?.map((s) => (
                            <p key={s.name}>
                                {s.name}: {s.changes.join(' · ') || 'без изменений'}
                            </p>
                        ))}
                    </div>
                ))}
            </details>
        </section>
    );
}

export function GMLifecycleControls({
    token,
    store,
    disabled,
}: {
    token: Token;
    store: SceneStore;
    disabled: boolean;
}) {
    const cmd = useAdventuring(store, `token:${token.id}`);
    const character = store.getSnapshot().scene.characters?.find((c) => c.id === token.characterId);
    const state = token.lifecycle ?? character?.lifecycle;
    const level = token.exhaustion ?? character?.exhaustion ?? 0;
    const [hp, setHp] = useState(1),
        [exhaustion, setExhaustion] = useState(level);
    const [pools, setPools] = useState<HitPointPool[]>(character?.hitPointDice ?? []);
    const [reviving, setReviving] = useState(false);
    const blocked = disabled || cmd.busy || !!cmd.pending;
    const run = (action: string, extra: Record<string, unknown> = {}) =>
        void cmd.run({ action, tokenId: token.id, ...extra });
    return (
        <div className="gm-lifecycle-controls">
            <LifeSummary state={state} />
            <ExhaustionBadge level={level} />
            {state?.status === 'dying' && (
                <button
                    disabled={blocked}
                    onClick={() => run('death-save', { confirmWorldTime: true })}
                >
                    Бросить Death Save
                </button>
            )}
            {state?.status === 'stable' && (
                <button
                    disabled={blocked}
                    title={`ГМ подтверждает: прошло ${state.recoveryHours ?? '1d4'} ч. без нового урона`}
                    onClick={() => run('stable-recovery', { confirmWorldTime: true })}
                >
                    Прошло {state.recoveryHours ?? '1d4'} ч. · восстановить 1 HP
                </button>
            )}
            <details>
                <summary>Жизненный цикл · коррекции ГМ</summary>
                <div className="rest-actions">
                    <button
                        disabled={blocked || token.hp !== 0 || state?.status === 'dead'}
                        onClick={() => run('stable')}
                    >
                        Стабилизировать
                    </button>
                    <button disabled={blocked} onClick={() => run('reset-saves')}>
                        Сбросить Death Saves
                    </button>
                    <button disabled={blocked} onClick={() => setReviving(!reviving)}>
                        Вернуть к жизни / HP
                    </button>
                </div>
                {reviving && (
                    <div>
                        <label>
                            HP{' '}
                            <input
                                type="number"
                                min={1}
                                max={token.maxHp ?? 9999}
                                value={hp}
                                onChange={(e) => setHp(Number(e.target.value))}
                            />
                        </label>
                        <button disabled={blocked} onClick={() => run('revive', { hp })}>
                            Подтвердить GM revival
                        </button>
                    </div>
                )}
                <label>
                    Exhaustion{' '}
                    <input
                        type="number"
                        min={0}
                        max={6}
                        value={exhaustion}
                        onChange={(e) => setExhaustion(Number(e.target.value))}
                    />
                </label>
                <button disabled={blocked} onClick={() => run('exhaustion', { level: exhaustion })}>
                    Установить Exhaustion{exhaustion === 6 ? ' · смерть' : ''}
                </button>
                <button
                    disabled={blocked}
                    title="ГМ подтверждает нокаут ближней атакой по SRD 5.2.1"
                    onClick={() => run('knock-out')}
                >
                    Нокаут ближней атакой · 1 HP
                </button>
                {token.kind === 'npc' && token.hp === 0 && (
                    <div className="rest-actions">
                        {(['dead', 'defeated', 'unconscious'] as const).map((outcome) => (
                            <button
                                key={outcome}
                                disabled={blocked}
                                onClick={() => run('npc-outcome', { outcome })}
                            >
                                {outcome}
                            </button>
                        ))}
                    </div>
                )}
                {character && (
                    <details>
                        <summary>Hit Point Dice · настройка GM</summary>
                        {(['d6', 'd8', 'd10', 'd12'] as const).map((die) => {
                            const p = pools.find((p) => p.die === die);
                            return (
                                <div className="hit-point-pool" key={die}>
                                    <strong>{die}</strong>
                                    <label>
                                        Максимум{' '}
                                        <input
                                            type="number"
                                            min={0}
                                            max={100}
                                            value={p?.max ?? 0}
                                            onChange={(e) => {
                                                const max = Number(e.target.value);
                                                setPools([
                                                    ...pools.filter((p) => p.die !== die),
                                                    ...(max
                                                        ? [
                                                              {
                                                                  die,
                                                                  max,
                                                                  current: Math.min(
                                                                      p?.current ?? max,
                                                                      max,
                                                                  ),
                                                              },
                                                          ]
                                                        : []),
                                                ]);
                                            }}
                                        />
                                    </label>
                                    {p && (
                                        <label>
                                            Осталось{' '}
                                            <input
                                                type="number"
                                                min={0}
                                                max={p.max}
                                                value={p.current}
                                                onChange={(e) =>
                                                    setPools(
                                                        pools.map((p) =>
                                                            p.die === die
                                                                ? {
                                                                      ...p,
                                                                      current: Number(
                                                                          e.target.value,
                                                                      ),
                                                                  }
                                                                : p,
                                                        ),
                                                    )
                                                }
                                            />
                                        </label>
                                    )}
                                </div>
                            );
                        })}
                        <button disabled={blocked} onClick={() => run('configure-dice', { pools })}>
                            Сохранить Hit Point Dice
                        </button>
                    </details>
                )}
            </details>
            <NpcLifecycleEditor
                key={token.id + JSON.stringify(token.combatProfile)}
                token={token}
                store={store}
            />
            {cmd.message && <p role="status">{cmd.message}</p>}
            {cmd.error && <p role="alert">{cmd.error}</p>}
            {cmd.pending && !cmd.busy && (
                <button onClick={() => void cmd.run(cmd.pending!)}>Повторить с тем же ID</button>
            )}
        </div>
    );
}
