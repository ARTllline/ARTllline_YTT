import { useState } from 'react';
import type { SceneStore } from '../../tabletop/state/SceneStore';
import type { Token, Character } from '../../tabletop/types/scene';
import { request } from '../../api/client';
import { api, commandId } from '../../api/workspace';
import { AbilityEditor } from '../../gameplay/AbilityEditor';
import type { Ability } from '../../gameplay/model';

/** Preparation belongs in Inspector; the combat console uses runtime actions. */
export function CombatProfileEditor({ token, store }: { token: Token; store: SceneStore }) {
    const scene = store.getSnapshot().scene;
    const [abilities, setAbilities] = useState<Ability[]>(token.abilities ?? []);
    const [profile, setProfile] = useState<Record<string, unknown>>(token.combatProfile ?? {});
    const [busy, setBusy] = useState(false),
        [error, setError] = useState('');
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
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };
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
    if (store.role !== 'gm' || token.characterId) return null;
    return (
        <details className="combat-profile-editor">
            <summary>Боевой профиль и действия NPC</summary>
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
            {error && <p role="alert">{error}</p>}
        </details>
    );
}
