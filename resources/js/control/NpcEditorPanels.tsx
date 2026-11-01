import { useEffect, useState } from 'react';
import { request } from '../api/client';
import { Users } from 'lucide-react';
import type { Character } from '../tabletop/types/scene';
import type { DerivedCharacter } from '../rpg/rules';
import { AssetPicker } from './AssetLibrary';
import { ResourceEditor } from '../gameplay/ResourceEditor';
type Patch = (values: Partial<Character>) => void;
export function NpcIdentity({ draft, patch }: { draft: Character; patch: Patch }) {
    return (
        <section className="control-identity">
            <div>
                <div className="control-identity-portrait">
                    {draft.portrait ? (
                        <img src={draft.portrait.url} alt="Портрет NPC" />
                    ) : (
                        <Users size={60} />
                    )}
                </div>
                <p className="hint">Портрет используется токеном на сцене.</p>
            </div>
            <div>
                <label className="field">
                    Имя NPC
                    <input
                        aria-label="Имя NPC"
                        maxLength={80}
                        value={draft.name}
                        onChange={(e) => patch({ name: e.target.value })}
                    />
                </label>
                <label className="field">
                    Вид / описание
                    <input
                        maxLength={120}
                        value={draft.origin?.species ?? ''}
                        onChange={(e) =>
                            patch({
                                origin: { ...draft.origin, species: e.target.value },
                            })
                        }
                    />
                </label>
                <label className="field">
                    Заметка GM
                    <textarea
                        maxLength={240}
                        value={draft.origin?.background ?? ''}
                        onChange={(e) =>
                            patch({
                                origin: { ...draft.origin, background: e.target.value },
                            })
                        }
                    />
                </label>
                <label className="field">
                    Отношение
                    <select
                        value={draft.disposition}
                        onChange={(e) =>
                            patch({
                                disposition: e.target.value as Character['disposition'],
                            })
                        }
                    >
                        <option value="friendly">Союзник</option>
                        <option value="neutral">Нейтральный</option>
                        <option value="hostile">Противник</option>
                    </select>
                </label>
                <AssetPicker
                    value={draft.portrait}
                    label="Выбрать портрет / токен"
                    onChange={(a) => patch({ portrait: a })}
                />
                <button type="button" onClick={() => patch({ portrait: null })}>
                    Без портрета
                </button>
            </div>
        </section>
    );
}
export function NpcCombat({
    draft,
    derived,
    patch,
}: {
    draft: Character;
    derived?: DerivedCharacter;
    patch: Patch;
}) {
    const profile = draft.combatProfile ?? {};
    return (
        <>
            <h2>Боевой профиль</h2>
            <div className="sheet-combat-summary">
                <article>
                    <small>HP</small>
                    <strong>
                        {draft.hp} / {draft.maxHp}
                    </strong>
                </article>
                <article>
                    <small>AC со снаряжением</small>
                    <strong>{derived?.ac ?? draft.ac}</strong>
                </article>
                <article>
                    <small>Скорость · ft</small>
                    <strong>{derived?.speed ?? draft.speed}</strong>
                </article>
            </div>
            <div className="control-combat-grid">
                {(
                    [
                        { key: 'hp', label: 'HP', min: 0, max: 9999 },
                        { key: 'maxHp', label: 'Максимум HP', min: 1, max: 9999 },
                        { key: 'ac', label: 'Базовая AC', min: 0, max: 99 },
                        { key: 'speed', label: 'Скорость · ft', min: 0, max: 999 },
                    ] as const
                ).map((f) => (
                    <label className="field" key={f.key}>
                        {f.label}
                        <input
                            aria-label={f.label}
                            type="number"
                            min={f.min}
                            max={f.max}
                            value={draft[f.key] ?? 0}
                            onChange={(e) => patch({ [f.key]: Number(e.target.value) })}
                        />
                    </label>
                ))}
            </div>
            <NpcDefenses profile={profile} onChange={(combatProfile) => patch({ combatProfile })} />
            <ResourceEditor
                sheet
                resources={draft.resources ?? []}
                onChange={(resources) => patch({ resources })}
            />
            <details>
                <summary>Advanced · правило 0 HP</summary>
                <select
                    aria-label="Правило 0 HP"
                    value={String(profile.zero_hp_policy ?? 'immediate_death')}
                    onChange={(e) =>
                        patch({
                            combatProfile: {
                                ...profile,
                                zero_hp_policy: e.target.value,
                            },
                        })
                    }
                >
                    <option value="immediate_death">Смерть при 0 HP</option>
                    <option value="death_saves">Death Saves</option>
                    <option value="manual">Решение GM</option>
                </select>
            </details>
        </>
    );
}
export function NpcSlots({
    character,
    patch,
}: {
    character: Character;
    patch: (c: Partial<Character>) => void;
}) {
    const state = character.spellcasting ?? {
        slots: {},
        cantrip_tier: 1,
        scroll_list: [],
        scroll_max_level: 0,
        verbal_blocked: false,
    };
    return (
        <section>
            <h3>Ячейки заклинаний</h3>
            <p className="hint">Задаются вручную. Каждая копия NPC расходует собственные ячейки.</p>
            <div className="spell-slot-editor">
                {Array.from({ length: 9 }, (_, i) => i + 1).map((level) => (
                    <label key={level}>
                        Уровень {level}
                        <input
                            aria-label={`Ячейки уровня ${level}`}
                            type="number"
                            min={0}
                            max={99}
                            value={state.slots[level]?.max ?? 0}
                            onChange={(e) => {
                                const max = Number(e.target.value);
                                patch({
                                    spellcasting: {
                                        ...state,
                                        slots: { ...state.slots, [level]: { max, current: max } },
                                    },
                                });
                            }}
                        />
                    </label>
                ))}
            </div>
        </section>
    );
}

function NpcDefenses({
    profile,
    onChange,
}: {
    profile: Record<string, unknown>;
    onChange: (profile: Record<string, unknown>) => void;
}) {
    const [catalog, setCatalog] = useState<{
        damageTypes: string[];
        conditions: { key: string; name: string }[];
    }>();
    const [error, setError] = useState('');
    useEffect(() => {
        const abort = new AbortController();
        void request<{ damageTypes: string[]; conditions: { key: string; name: string }[] }>(
            '/library/character-rules/catalog',
            'GET',
            undefined,
            abort.signal,
        )
            .then(setCatalog)
            .catch((e) => {
                if (!abort.signal.aborted) setError(e.message);
            });
        return () => abort.abort();
    }, []);
    return (
        <section>
            <h3>Защита</h3>
            {error && <p role="alert">{error}</p>}
            {!catalog && !error && <p role="status">Загрузка типов защиты…</p>}
            {(
                [
                    ['resistances', 'Сопротивления'],
                    ['vulnerabilities', 'Уязвимости'],
                    ['immunities', 'Иммунитет урона'],
                    ['condition_immunities', 'Иммунитет состояний'],
                ] as const
            ).map(([key, label]) => {
                const selected = Array.isArray(profile[key]) ? (profile[key] as string[]) : [];
                const options =
                    key === 'condition_immunities'
                        ? (catalog?.conditions ?? [])
                        : (catalog?.damageTypes ?? []).map((key) => ({ key, name: key }));
                return (
                    <details key={key}>
                        <summary>
                            {label} · {selected.length ? selected.join(', ') : 'Нет'}
                        </summary>
                        <div className="npc-defense-options" role="group" aria-label={label}>
                            {options.map((option) => (
                                <button
                                    type="button"
                                    key={option.key}
                                    aria-pressed={selected.includes(option.key)}
                                    onClick={() =>
                                        onChange({
                                            ...profile,
                                            [key]: selected.includes(option.key)
                                                ? selected.filter((k) => k !== option.key)
                                                : [...selected, option.key],
                                        })
                                    }
                                >
                                    {option.name}
                                </button>
                            ))}
                        </div>
                    </details>
                );
            })}
        </section>
    );
}
