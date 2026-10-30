import { useEffect, useState } from 'react';
import { request } from '../api/client';
import type { Ability } from './model';
export const durationOptions = [
    ['until_removed', 'До удаления'],
    ['until_start_of_source_turn', 'До начала хода источника'],
    ['until_end_of_source_turn', 'До конца хода источника'],
    ['until_start_of_target_turn', 'До начала хода цели'],
    ['until_end_of_target_turn', 'До конца хода цели'],
    ['rounds', 'Раунды'],
] as const;
export function CombatAbilityEditor({
    ability: a,
    campaignId,
    onChange,
}: {
    ability: Ability;
    campaignId: string;
    onChange: (p: Partial<Ability>) => void;
}) {
    const [catalog, setCatalog] = useState<{
        damageTypes: string[];
        conditions: { key: string; name: string }[];
    }>({ damageTypes: [], conditions: [] });
    const [error, setError] = useState('');
    useEffect(() => {
        const abort = new AbortController();
        void request<typeof catalog>(
            `/campaigns/${campaignId}/character-rules/catalog`,
            'GET',
            undefined,
            abort.signal,
        )
            .then((d) => {
                if (!abort.signal.aborted) setCatalog(d);
            })
            .catch((e: Error) => {
                if (!abort.signal.aborted) setError(e.message);
            });
        return () => abort.abort();
    }, [campaignId]);
    return (
        <details className="combat-ability-editor">
            <summary>Боевое применение</summary>
            {error && <p role="alert">{error}</p>}
            <label>
                <input
                    type="checkbox"
                    checked={a.requires_sight ?? false}
                    onChange={(e) => onChange({ requires_sight: e.target.checked })}
                />
                Проверка требует зрения
            </label>
            <label>
                Активация
                <select
                    aria-label="Стоимость действия"
                    value={a.activation ?? 'action'}
                    onChange={(e) =>
                        onChange({ activation: e.target.value as Ability['activation'] })
                    }
                >
                    {[
                        ['action', 'Действие'],
                        ['bonus_action', 'Бонусное действие'],
                        ['reaction', 'Реакция'],
                        ['free', 'Без действия'],
                    ].map(([k, n]) => (
                        <option key={k} value={k}>
                            {n}
                        </option>
                    ))}
                </select>
            </label>
            <label>
                Атака
                <select
                    aria-label="Характеристика атаки"
                    value={a.attack?.ability ?? ''}
                    onChange={(e) =>
                        onChange(
                            e.target.value
                                ? {
                                      attack: {
                                          ability: e.target.value as NonNullable<
                                              Ability['attack']
                                          >['ability'],
                                          proficient: true,
                                          bonus: 0,
                                      },
                                      save: null,
                                      category: 'attack',
                                      target: 'token',
                                      area: null,
                                  }
                                : { attack: null },
                        )
                    }
                >
                    <option value="">Существующая проверка / без атаки</option>
                    {['str', 'dex', 'con', 'int', 'wis', 'cha', 'spellcasting'].map((k) => (
                        <option key={k} value={k}>
                            {k === 'spellcasting' ? 'Заклинательная' : k.toUpperCase()}
                        </option>
                    ))}
                </select>
            </label>
            {a.attack && (
                <>
                    <label>
                        <input
                            type="checkbox"
                            checked={a.attack.proficient}
                            onChange={(e) =>
                                onChange({ attack: { ...a.attack!, proficient: e.target.checked } })
                            }
                        />
                        Владение
                    </label>
                    <label>
                        Бонус атаки
                        <input
                            type="number"
                            min={-100}
                            max={100}
                            value={a.attack.bonus}
                            onChange={(e) =>
                                onChange({
                                    attack: { ...a.attack!, bonus: Number(e.target.value) },
                                })
                            }
                        />
                    </label>
                </>
            )}
            <label>
                Спасбросок цели
                <select
                    aria-label="Спасбросок цели"
                    value={a.save?.ability ?? ''}
                    onChange={(e) =>
                        onChange(
                            e.target.value
                                ? {
                                      save: {
                                          ability: e.target.value as NonNullable<
                                              Ability['save']
                                          >['ability'],
                                          dc_source: 'fixed',
                                          dc: 12,
                                          on_success: 'half',
                                          on_failure: 'full',
                                      },
                                      attack: null,
                                      category: 'effect',
                                      target: a.area ? 'point' : 'token',
                                  }
                                : { save: null },
                        )
                    }
                >
                    <option value="">Нет</option>
                    {['str', 'dex', 'con', 'int', 'wis', 'cha'].map((k) => (
                        <option key={k}>{k}</option>
                    ))}
                </select>
            </label>
            {a.save && (
                <>
                    <label>
                        Источник Сл
                        <select
                            value={a.save.dc_source}
                            onChange={(e) =>
                                onChange({
                                    save: {
                                        ...a.save!,
                                        dc_source: e.target.value as 'fixed' | 'spellcasting',
                                    },
                                })
                            }
                        >
                            <option value="fixed">Фиксированная</option>
                            <option value="spellcasting">Сл заклинаний источника</option>
                        </select>
                    </label>
                    {a.save.dc_source === 'fixed' && (
                        <input
                            aria-label="Сл спасброска"
                            type="number"
                            min={0}
                            max={999}
                            value={a.save.dc}
                            onChange={(e) =>
                                onChange({ save: { ...a.save!, dc: Number(e.target.value) } })
                            }
                        />
                    )}
                    <label>
                        При успехе
                        <select
                            value={a.save.on_success}
                            onChange={(e) =>
                                onChange({
                                    save: {
                                        ...a.save!,
                                        on_success: e.target.value as 'negates' | 'half' | 'full',
                                    },
                                })
                            }
                        >
                            <option value="negates">Без урона</option>
                            <option value="half">Половина урона</option>
                            <option value="full">Полный урон</option>
                        </select>
                    </label>
                    <label>
                        При провале
                        <select
                            value={a.save.on_failure}
                            onChange={(e) =>
                                onChange({
                                    save: {
                                        ...a.save!,
                                        on_failure: e.target.value as 'full' | 'none',
                                    },
                                })
                            }
                        >
                            <option value="full">Полный урон</option>
                            <option value="none">Без урона</option>
                        </select>
                    </label>
                </>
            )}
            <h5>Типизированный урон</h5>
            {a.damage_components?.map((c, i) => (
                <div className="combat-fields" key={i}>
                    <input
                        aria-label={`Кубики урона ${i + 1}`}
                        value={c.dice}
                        onChange={(e) =>
                            onChange({
                                damage_components: a.damage_components!.map((v, n) =>
                                    n === i ? { ...v, dice: e.target.value } : v,
                                ),
                            })
                        }
                    />
                    <select
                        aria-label={`Тип урона ${i + 1}`}
                        value={c.type}
                        onChange={(e) =>
                            onChange({
                                damage_components: a.damage_components!.map((v, n) =>
                                    n === i ? { ...v, type: e.target.value } : v,
                                ),
                            })
                        }
                    >
                        {catalog.damageTypes.map((t) => (
                            <option key={t}>{t}</option>
                        ))}
                    </select>
                    <button
                        type="button"
                        onClick={() =>
                            onChange({
                                damage_components: a.damage_components!.filter((_, n) => n !== i),
                            })
                        }
                    >
                        ×
                    </button>
                </div>
            ))}
            <button
                type="button"
                disabled={!catalog.damageTypes.length || (a.damage_components?.length ?? 0) >= 4}
                onClick={() =>
                    onChange({
                        damage: null,
                        damage_components: [
                            ...(a.damage_components ?? []),
                            { dice: '1d6', type: catalog.damageTypes[0] },
                        ],
                    })
                }
            >
                ＋ Компонент урона
            </button>
            <h5>Состояния</h5>
            {a.condition_effects?.map((c, i) => {
                const patch = (p: Partial<typeof c>) =>
                    onChange({
                        condition_effects: a.condition_effects!.map((v, n) =>
                            n === i ? { ...v, ...p } : v,
                        ),
                    });
                return (
                    <div className="combat-fields" key={i}>
                        <select
                            aria-label={`Состояние ${i + 1}`}
                            value={c.key}
                            onChange={(e) => patch({ key: e.target.value })}
                        >
                            {catalog.conditions.map((v) => (
                                <option value={v.key} key={v.key}>
                                    {v.name}
                                </option>
                            ))}
                        </select>
                        <select
                            value={c.when}
                            onChange={(e) => patch({ when: e.target.value as typeof c.when })}
                        >
                            {[
                                ['hit', 'При попадании'],
                                ['failed_save', 'Провал save'],
                                ['successful_save', 'Успех save'],
                                ['always', 'Всегда'],
                            ].map(([v, n]) => (
                                <option key={v} value={v}>
                                    {n}
                                </option>
                            ))}
                        </select>
                        <select
                            value={c.duration_mode}
                            onChange={(e) => patch({ duration_mode: e.target.value })}
                        >
                            {durationOptions.map(([v, n]) => (
                                <option key={v} value={v}>
                                    {n}
                                </option>
                            ))}
                        </select>
                        {c.duration_mode === 'rounds' && (
                            <input
                                aria-label="Число раундов"
                                type="number"
                                min={1}
                                max={100}
                                value={c.rounds ?? 1}
                                onChange={(e) => patch({ rounds: Number(e.target.value) })}
                            />
                        )}
                        <button
                            type="button"
                            onClick={() =>
                                onChange({
                                    condition_effects: a.condition_effects!.filter(
                                        (_, n) => n !== i,
                                    ),
                                })
                            }
                        >
                            ×
                        </button>
                    </div>
                );
            })}
            <button
                type="button"
                disabled={!catalog.conditions.length || (a.condition_effects?.length ?? 0) >= 4}
                onClick={() =>
                    onChange({
                        condition_effects: [
                            ...(a.condition_effects ?? []),
                            {
                                key: catalog.conditions[0].key,
                                when: a.save ? 'failed_save' : 'hit',
                                duration_mode: 'until_removed',
                            },
                        ],
                    })
                }
            >
                ＋ Состояние
            </button>
        </details>
    );
}
