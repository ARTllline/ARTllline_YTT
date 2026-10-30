import { useState } from 'react';
import type { SceneStore } from '../../tabletop/state/SceneStore';
import type { Token, Character } from '../../tabletop/types/scene';
import { request } from '../../api/client';
import { commandId, api } from '../../api/workspace';
import { AbilityEditor } from '../../gameplay/AbilityEditor';
import type { Ability } from '../../gameplay/model';
import { combatReason, CombatBudgetView } from '../../gameplay/combat';
export function CombatActorControls({ token, store }: { token: Token; store: SceneStore }) {
    const scene = store.getSnapshot().scene;
    const combat = scene.combat;
    const character = scene.characters?.find((c) => c.id === token.characterId);
    const actorAbilities = character?.abilities ?? token.abilities ?? [];
    const entry = combat?.combatants.find((e) => e.tokenId === token.id);
    const [selected, setSelected] = useState(''),
        [target, setTarget] = useState(''),
        [editing, setEditing] = useState(false),
        [busy, setBusy] = useState(false),
        [error, setError] = useState(''),
        [result, setResult] = useState('');
    const [abilities, setAbilities] = useState<Ability[]>(token.abilities ?? []);
    const [profile, setProfile] = useState<Record<string, unknown>>(token.combatProfile ?? {});
    const refresh = async () => store.reconcile(await api.snapshot(scene.id!));
    const save = async () => {
        setBusy(true);
        setError('');
        try {
            await request(`/tokens/${token.id}`, 'PATCH', {
                ...(!token.characterId ? { abilities } : {}),
                combat_profile: token.characterId
                    ? profile
                    : {
                          ...profile,
                          ability_scores: {
                              str: 10,
                              dex: 10,
                              con: 10,
                              int: 10,
                              wis: 10,
                              cha: 10,
                              ...(profile.ability_scores ?? {}),
                          },
                      },
                clientMutationId: commandId(),
            });
            await refresh();
            setEditing(false);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };
    const run = async () => {
        const a = actorAbilities.find((a) => a.id === selected);
        if (!a) return;
        setBusy(true);
        setError('');
        try {
            const point = scene.tokens.find((t) => t.id === target);
            const choice =
                a.target === 'point'
                    ? point
                        ? { kind: 'point', x: point.x, y: point.y }
                        : null
                    : a.target === 'token'
                      ? { kind: 'token', id: target }
                      : null;
            const r = await request<{
                execution: {
                    success: boolean;
                    roll?: { total: number };
                    outcomes?: { damage: number }[];
                };
            }>(`/scenes/${scene.id}/abilities/execute`, 'POST', {
                ...(token.characterId
                    ? { characterId: token.characterId }
                    : { actorTokenId: token.id }),
                abilityId: a.id,
                epoch: scene.liveRevision ?? 0,
                target: choice,
                rollMode: 'normal',
                clientMutationId: commandId(),
            });
            setResult(
                `${r.execution.success ? 'Применено' : 'Промах'}${r.execution.roll ? ` · Бросок ${r.execution.roll.total}` : ''} · Урон ${r.execution.outcomes?.map((o) => o.damage).join(', ') ?? '—'}`,
            );
            await refresh();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };
    const chosen = actorAbilities.find((a) => a.id === selected);
    const reason = chosen ? combatReason(chosen, entry?.budget) : '';
    const pseudo: Character = {
        id: token.id,
        name: token.name,
        kind: 'npc',
        disposition: token.disposition ?? 'hostile',
        portrait: null,
        ownerUserId: null,
        hp: token.hp ?? 0,
        maxHp: token.maxHp ?? 1,
        checkStats: token.checkStats ?? [],
        abilities,
        resources: [],
    };
    return (
        <div className="combat-actor-controls">
            {entry?.budget && (
                <CombatBudgetView
                    budget={entry.budget}
                    onStand={
                        token.conditions?.some((c) => c.key === 'prone')
                            ? () => store.tokenCombat(token.id, { action: 'stand-up' })
                            : undefined
                    }
                />
            )}
            {combat && entry && (
                <button
                    className="quiet-button"
                    disabled={busy}
                    onClick={() =>
                        store.combatCommand({
                            action: 'override',
                            combatId: combat.id,
                            combatantId: entry.id,
                            action_available: true,
                            bonus_available: true,
                            reaction_available: true,
                            movement_spent: 0,
                        })
                    }
                >
                    Сбросить бюджет участника
                </button>
            )}
            {combat && entry?.budget && (
                <div className="combat-fields">
                    {(['action', 'bonus_action', 'reaction'] as const).map((key, i) => (
                        <button
                            key={key}
                            title="Изменить доступность"
                            onClick={() =>
                                store.combatCommand({
                                    action: 'override',
                                    combatId: combat.id,
                                    combatantId: entry.id,
                                    ...{
                                        [[
                                            'action_available',
                                            'bonus_available',
                                            'reaction_available',
                                        ][i]]: !entry.budget![key],
                                    },
                                })
                            }
                        >
                            {['Действие', 'Бонус', 'Реакция'][i]} {entry.budget![key] ? '●' : '○'}
                        </button>
                    ))}
                    <label>
                        Потрачено ft
                        <input
                            type="number"
                            min={0}
                            max={1000000}
                            key={entry.budget.movementSpent}
                            defaultValue={entry.budget.movementSpent}
                            onBlur={(e) => {
                                const n = Number(e.target.value);
                                if (
                                    Number.isFinite(n) &&
                                    n >= 0 &&
                                    n <= 1000000 &&
                                    n !== entry.budget!.movementSpent
                                )
                                    store.combatCommand({
                                        action: 'override',
                                        combatId: combat.id,
                                        combatantId: entry.id,
                                        movement_spent: n,
                                    });
                            }}
                        />
                    </label>
                </div>
            )}
            {actorAbilities.length > 0 && (!character || character.kind === 'npc') && (
                <>
                    <select
                        aria-label={`Действие NPC ${token.name}`}
                        value={selected}
                        onChange={(e) => setSelected(e.target.value)}
                    >
                        <option value="">Выберите действие NPC</option>
                        {actorAbilities.map((a) => (
                            <option key={a.id} value={a.id}>
                                {a.name}
                            </option>
                        ))}
                    </select>
                    {chosen && ['token', 'point'].includes(chosen.target) && (
                        <select
                            aria-label="Цель NPC"
                            value={target}
                            onChange={(e) => setTarget(e.target.value)}
                        >
                            <option value="">
                                {chosen.target === 'point' ? 'Точка на токене' : 'Выберите цель'}
                            </option>
                            {scene.tokens
                                .filter((t) => !t.isHidden)
                                .map((t) => (
                                    <option key={t.id} value={t.id}>
                                        {t.name}
                                    </option>
                                ))}
                        </select>
                    )}
                    <button
                        className="secondary-button"
                        disabled={
                            busy ||
                            !chosen ||
                            !!reason ||
                            (!!chosen && ['token', 'point'].includes(chosen.target) && !target)
                        }
                        title={reason}
                        onClick={() => void run()}
                    >
                        Применить действие
                    </button>
                </>
            )}
            <button
                className="quiet-button"
                onClick={() => {
                    setAbilities(token.abilities ?? []);
                    setProfile(token.combatProfile ?? {});
                    setEditing(!editing);
                }}
            >
                Настроить боевой профиль{!token.characterId ? ' и действия NPC' : ''}
            </button>
            {editing && (
                <div>
                    {!token.characterId && (
                        <AbilityEditor
                            character={pseudo}
                            campaignId={scene.campaignId!}
                            onChange={setAbilities}
                        />
                    )}
                    {!token.characterId && (
                        <div className="combat-fields">
                            {['str', 'dex', 'con', 'int', 'wis', 'cha'].map((k) => (
                                <label key={k}>
                                    {k.toUpperCase()}
                                    <input
                                        type="number"
                                        min={1}
                                        max={30}
                                        value={
                                            (
                                                profile.ability_scores as
                                                    Record<string, number> | undefined
                                            )?.[k] ?? 10
                                        }
                                        onChange={(e) =>
                                            setProfile({
                                                ...profile,
                                                ability_scores: {
                                                    ...(profile.ability_scores ?? {}),
                                                    [k]: Number(e.target.value),
                                                },
                                            })
                                        }
                                    />
                                </label>
                            ))}
                            <label>
                                Владение +
                                <input
                                    type="number"
                                    min={0}
                                    max={20}
                                    value={Number(profile.proficiency_bonus ?? 0)}
                                    onChange={(e) =>
                                        setProfile({
                                            ...profile,
                                            proficiency_bonus: Number(e.target.value),
                                        })
                                    }
                                />
                            </label>
                            <label>
                                Магия
                                <select
                                    value={String(profile.spellcasting_ability ?? '')}
                                    onChange={(e) =>
                                        setProfile({
                                            ...profile,
                                            spellcasting_ability: e.target.value || null,
                                        })
                                    }
                                >
                                    <option value="">Нет</option>
                                    {['str', 'dex', 'con', 'int', 'wis', 'cha'].map((k) => (
                                        <option key={k}>{k}</option>
                                    ))}
                                </select>
                            </label>
                        </div>
                    )}
                    <p className="hint">Ключи типов через запятую: fire, cold, slashing…</p>
                    {(
                        [
                            ['resistances', 'Сопротивления'],
                            ['vulnerabilities', 'Уязвимости'],
                            ['immunities', 'Иммунитет урона'],
                            ['condition_immunities', 'Иммунитет состояний'],
                        ] as const
                    ).map(([key, label]) => (
                        <label key={key}>
                            {label}
                            <input
                                value={
                                    Array.isArray(profile[key])
                                        ? (profile[key] as string[]).join(', ')
                                        : ''
                                }
                                onChange={(e) =>
                                    setProfile({
                                        ...profile,
                                        [key]: e.target.value
                                            .split(',')
                                            .map((k) => k.trim())
                                            .filter(Boolean),
                                    })
                                }
                            />
                        </label>
                    ))}
                    <button disabled={busy} className="primary-button" onClick={() => void save()}>
                        Сохранить боевой профиль
                    </button>
                </div>
            )}
            {error && (
                <p role="alert" className="form-error">
                    {error}
                </p>
            )}
            {result && <p role="status">{result}</p>}
        </div>
    );
}
