import { useEffect, useState } from 'react';
import { request } from '../api/client';
import { AbilityEditor } from '../gameplay/AbilityEditor';
import { newAbility } from '../gameplay/model';
import type { Character } from '../tabletop/types/scene';
import type { ItemDefinition } from './model';
import { propertyLabels, type ItemGameplay } from './itemGameplay';
export function ItemGameplayEditor({
    draft,
    patch,
    character,
    campaignId,
}: {
    draft: Partial<ItemDefinition>;
    patch: (d: Partial<ItemDefinition>) => void;
    character: Character;
    campaignId: string;
}) {
    const [types, setTypes] = useState<string[]>([]);
    useEffect(() => {
        const c = new AbortController();
        void request<{ damageTypes: string[] }>(
            `/campaigns/${campaignId}/character-rules/catalog`,
            'GET',
            undefined,
            c.signal,
        )
            .then((r) => {
                if (!c.signal.aborted) setTypes(r.damageTypes);
            })
            .catch(() => {});
        return () => c.abort();
    }, [campaignId]);
    const g = draft.gameplay ?? {},
        w = g.weapon,
        a = g.armor;
    const save = (data: Partial<ItemGameplay>) => patch({ gameplay: { ...g, ...data } });
    return (
        <section className="item-gameplay-editor">
            <h4>Игровые свойства</h4>
            {draft.category === 'weapon' && (
                <>
                    {!w ? (
                        <button
                            type="button"
                            onClick={() => {
                                patch({
                                    equipment_slots: ['main_hand'],
                                    max_stack: 1,
                                    gameplay: {
                                        ...g,
                                        weapon: {
                                            dice: '1d8',
                                            damage_type: types.includes('slashing')
                                                ? 'slashing'
                                                : (types[0] ?? 'slashing'),
                                            kind: 'melee',
                                            category: 'custom',
                                            properties: [],
                                            range: { normal: 5, long: null },
                                            attack_bonus: 0,
                                            damage_bonus: 0,
                                        },
                                    },
                                });
                            }}
                        >
                            Настроить боевое оружие
                        </button>
                    ) : (
                        <>
                            <div className="gameplay-form-row">
                                <label>
                                    Кубики урона
                                    <input
                                        value={w.dice}
                                        onChange={(e) =>
                                            save({ weapon: { ...w, dice: e.target.value } })
                                        }
                                    />
                                </label>
                                <label>
                                    Тип урона
                                    <select
                                        value={w.damage_type}
                                        onChange={(e) =>
                                            save({ weapon: { ...w, damage_type: e.target.value } })
                                        }
                                    >
                                        {types.map((t) => (
                                            <option key={t}>{t}</option>
                                        ))}
                                    </select>
                                </label>
                            </div>
                            <div className="gameplay-form-row">
                                <label>
                                    Тип оружия
                                    <select
                                        value={w.kind}
                                        onChange={(e) =>
                                            save({
                                                weapon: {
                                                    ...w,
                                                    kind: e.target.value as typeof w.kind,
                                                },
                                            })
                                        }
                                    >
                                        <option value="melee">Рукопашное</option>
                                        <option value="ranged">Дальнобойное</option>
                                    </select>
                                </label>
                                <label>
                                    Категория
                                    <select
                                        value={w.category}
                                        onChange={(e) =>
                                            save({ weapon: { ...w, category: e.target.value } })
                                        }
                                    >
                                        <option value="simple">Простое</option>
                                        <option value="martial">Воинское</option>
                                        <option value="custom">Особое</option>
                                    </select>
                                </label>
                            </div>
                            <div className="ability-type-chips">
                                {Object.entries(propertyLabels).map(([key, label]) => (
                                    <button
                                        type="button"
                                        key={key}
                                        aria-pressed={w.properties.includes(key)}
                                        onClick={() =>
                                            save({
                                                weapon: {
                                                    ...w,
                                                    properties: w.properties.includes(key)
                                                        ? w.properties.filter((p) => p !== key)
                                                        : [...w.properties, key],
                                                },
                                            })
                                        }
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                            <div className="gameplay-form-row">
                                {(['normal', 'long'] as const).map((k) => (
                                    <label key={k}>
                                        {k === 'normal' ? 'Дистанция ft' : 'Дальняя ft'}
                                        <input
                                            type="number"
                                            min={0}
                                            max={10000}
                                            value={w.range?.[k] ?? ''}
                                            onChange={(e) =>
                                                save({
                                                    weapon: {
                                                        ...w,
                                                        range: {
                                                            normal: w.range?.normal ?? 5,
                                                            ...w.range,
                                                            [k]:
                                                                e.target.value === ''
                                                                    ? null
                                                                    : Number(e.target.value),
                                                        },
                                                    },
                                                })
                                            }
                                        />
                                    </label>
                                ))}
                            </div>
                            {w.properties.includes('versatile') && (
                                <label>
                                    Урон двумя руками
                                    <input
                                        value={w.versatile_dice ?? ''}
                                        placeholder="1d10"
                                        onChange={(e) =>
                                            save({
                                                weapon: {
                                                    ...w,
                                                    versatile_dice: e.target.value || null,
                                                },
                                            })
                                        }
                                    />
                                </label>
                            )}
                            {w.properties.includes('thrown') && (
                                <div className="gameplay-form-row">
                                    {(['normal', 'long'] as const).map((k) => (
                                        <label key={k}>
                                            {k === 'normal' ? 'Бросок ft' : 'Дальний бросок ft'}
                                            <input
                                                type="number"
                                                min={1}
                                                value={w.throw_range?.[k] ?? ''}
                                                onChange={(e) =>
                                                    save({
                                                        weapon: {
                                                            ...w,
                                                            throw_range: {
                                                                normal: 20,
                                                                ...w.throw_range,
                                                                [k]: Number(e.target.value),
                                                            },
                                                        },
                                                    })
                                                }
                                            />
                                        </label>
                                    ))}
                                </div>
                            )}
                            {w.properties.includes('ammunition') && (
                                <label>
                                    Ключ боеприпасов
                                    <input
                                        value={w.ammunition ?? ''}
                                        placeholder="arrows / bolts"
                                        onChange={(e) =>
                                            save({
                                                weapon: {
                                                    ...w,
                                                    ammunition: e.target.value || null,
                                                },
                                            })
                                        }
                                    />
                                </label>
                            )}
                            <div className="gameplay-form-row">
                                {(['attack_bonus', 'damage_bonus'] as const).map((k) => (
                                    <label key={k}>
                                        {k === 'attack_bonus' ? 'Бонус атаки' : 'Бонус урона'}
                                        <input
                                            type="number"
                                            min={-20}
                                            max={20}
                                            value={w[k] ?? 0}
                                            onChange={(e) =>
                                                save({
                                                    weapon: { ...w, [k]: Number(e.target.value) },
                                                })
                                            }
                                        />
                                    </label>
                                ))}
                            </div>
                            <label>
                                Мастерство · справочно
                                <input
                                    value={w.mastery ?? ''}
                                    onChange={(e) =>
                                        save({ weapon: { ...w, mastery: e.target.value || null } })
                                    }
                                />
                            </label>
                            <p className="hint">
                                Владение назначается конкретному персонажу ниже. Light и мастерство
                                сохраняются без автоматических дополнительных атак.
                            </p>
                        </>
                    )}
                </>
            )}
            {['armor', 'shield'].includes(draft.category ?? '') && (
                <>
                    <label>
                        Тип защиты
                        <select
                            value={a?.category ?? ''}
                            onChange={(e) => {
                                const key = e.target.value as NonNullable<
                                    ItemGameplay['armor']
                                >['category'];
                                if (!key) {
                                    save({ armor: null });
                                    return;
                                }
                                patch({
                                    category: key === 'shield' ? 'shield' : 'armor',
                                    equipment_slots: [key === 'shield' ? 'off_hand' : 'armor'],
                                    max_stack: 1,
                                    gameplay: {
                                        ...g,
                                        armor: {
                                            category: key,
                                            base_ac: key === 'shield' ? null : 11,
                                            ac_bonus: key === 'shield' ? 2 : null,
                                            ac_semantics: key === 'shield' ? 'bonus' : 'base',
                                            add_dex: ['light_armor', 'medium_armor'].includes(key),
                                            max_dex_bonus: key === 'medium_armor' ? 2 : null,
                                            strength_minimum: 0,
                                            stealth_disadvantage: false,
                                        },
                                    },
                                });
                            }}
                        >
                            <option value="">Пользовательские бонусы без формулы</option>
                            <option value="light_armor">Лёгкая</option>
                            <option value="medium_armor">Средняя</option>
                            <option value="heavy_armor">Тяжёлая</option>
                            <option value="shield">Щит</option>
                        </select>
                    </label>
                    {a && (
                        <>
                            <label>
                                {a.category === 'shield' ? 'Бонус AC' : 'Базовая AC'}
                                <input
                                    type="number"
                                    min={0}
                                    max={40}
                                    value={(a.category === 'shield' ? a.ac_bonus : a.base_ac) ?? 0}
                                    onChange={(e) =>
                                        save({
                                            armor: {
                                                ...a,
                                                [a.category === 'shield' ? 'ac_bonus' : 'base_ac']:
                                                    Number(e.target.value),
                                            },
                                        })
                                    }
                                />
                            </label>
                            <label>
                                Минимальная Сила
                                <input
                                    type="number"
                                    min={0}
                                    max={30}
                                    value={a.strength_minimum ?? 0}
                                    onChange={(e) =>
                                        save({
                                            armor: {
                                                ...a,
                                                strength_minimum: Number(e.target.value),
                                            },
                                        })
                                    }
                                />
                            </label>
                            <label>
                                <input
                                    type="checkbox"
                                    checked={a.stealth_disadvantage ?? false}
                                    onChange={(e) =>
                                        save({
                                            armor: { ...a, stealth_disadvantage: e.target.checked },
                                        })
                                    }
                                />
                                Помеха Скрытности
                            </label>
                            <p className="hint">
                                Обучение броне и время надевания подтверждает ГМ. Формула AC
                                применяется сервером.
                            </p>
                        </>
                    )}
                </>
            )}
            {draft.category === 'ammunition' && (
                <label>
                    Ключ типа боеприпасов
                    <input
                        value={g.ammunition ?? ''}
                        placeholder="arrows"
                        onChange={(e) => save({ ammunition: e.target.value || null })}
                    />
                </label>
            )}
            {['consumable', 'scroll', 'other', 'adventuring_gear', 'trinket'].includes(
                draft.category ?? '',
            ) && (
                <details>
                    <summary>Действие предмета</summary>
                    {!g.use ? (
                        <button
                            type="button"
                            onClick={() =>
                                save({ use: { consume: true, ability: newAbility('utility', 0) } })
                            }
                        >
                            Добавить действие
                        </button>
                    ) : (
                        <>
                            <label>
                                <input
                                    type="checkbox"
                                    checked={g.use.consume}
                                    onChange={(e) =>
                                        save({ use: { ...g.use!, consume: e.target.checked } })
                                    }
                                />
                                Расходовать экземпляр
                            </label>
                            {g.use.ability.result?.type === 'heal' && (
                                <label>
                                    Кубики восстановления HP
                                    <input
                                        value={g.use.ability.result.dice ?? ''}
                                        placeholder="2d4+2"
                                        onChange={(e) =>
                                            save({
                                                use: {
                                                    ...g.use!,
                                                    ability: {
                                                        ...g.use!.ability,
                                                        result: {
                                                            ...g.use!.ability.result!,
                                                            dice: e.target.value || null,
                                                        },
                                                    },
                                                },
                                            })
                                        }
                                    />
                                </label>
                            )}
                            <AbilityEditor
                                campaignId={campaignId}
                                character={{ ...character, abilities: [g.use.ability] }}
                                onChange={(abilities) =>
                                    save({
                                        use: abilities[0]
                                            ? { ...g.use!, ability: abilities[0] }
                                            : null,
                                    })
                                }
                            />
                        </>
                    )}
                </details>
            )}
        </section>
    );
}
