import { useEffect, useState } from 'react';
import { inventoryApi, type ItemDefinition } from './model';
import type { Ability } from '../gameplay/model';
export function SpellEffectEditor({
    ability,
    onChange,
    campaignId,
}: {
    ability: Ability;
    onChange: (a: Partial<Ability>) => void;
    campaignId?: string;
}) {
    const [materials, setMaterials] = useState<ItemDefinition[]>([]);
    useEffect(() => {
        let alive = true;
        if (campaignId)
            void inventoryApi
                .definitions(campaignId)
                .then((r) => {
                    if (alive) setMaterials(r.definitions);
                })
                .catch(() => {});
        return () => {
            alive = false;
        };
    }, [campaignId]);
    const s = ability.spell;
    if (!s) return null;
    const patch = (p: Partial<NonNullable<Ability['spell']>>) =>
        onChange({ spell: { ...s, ...p } });
    const effects = s.effects ?? [];
    return (
        <div className="spell-effect-editor">
            <label>
                <input
                    type="checkbox"
                    checked={s.available ?? true}
                    onChange={(e) => patch({ available: e.target.checked })}
                />
                Доступ к сотворению
            </label>
            <label>
                <input
                    type="checkbox"
                    checked={s.manual_allowed ?? false}
                    onChange={(e) => patch({ manual_allowed: e.target.checked })}
                />
                GM разрешает ручное разрешение
            </label>
            <label>
                Статус автоматизации
                <select
                    value={s.coverage ?? 'PARTIAL'}
                    onChange={(e) => patch({ coverage: e.target.value as typeof s.coverage })}
                >
                    <option>FULL</option>
                    <option>PARTIAL</option>
                    <option>MANUAL</option>
                </select>
            </label>
            <label>
                Время сотворения
                <input
                    value={s.casting_time ?? 'Action'}
                    onChange={(e) => patch({ casting_time: e.target.value })}
                />
            </label>
            <label>
                Длительность
                <select
                    value={s.duration?.mode ?? 'instantaneous'}
                    onChange={(e) =>
                        patch({
                            duration: {
                                mode: e.target.value as NonNullable<typeof s.duration>['mode'],
                                amount: s.duration?.amount ?? 0,
                            },
                        })
                    }
                >
                    <option value="instantaneous">Мгновенно</option>
                    <option value="rounds">Раунды</option>
                    <option value="seconds">Секунды вне боя</option>
                    <option value="source_start">До начала следующего хода источника</option>
                    <option value="manual">Пока не снято GM</option>
                </select>
                <input
                    aria-label="Количество длительности"
                    type="number"
                    min={0}
                    value={s.duration?.amount ?? 0}
                    onChange={(e) =>
                        patch({
                            duration: {
                                mode: s.duration?.mode ?? 'rounds',
                                amount: Number(e.target.value),
                            },
                        })
                    }
                />
            </label>
            <div className="rpg-chips">
                {['V', 'S', 'M'].map((c) => (
                    <button
                        key={c}
                        type="button"
                        aria-pressed={s.components?.includes(c) ?? false}
                        onClick={() =>
                            patch({
                                components: s.components?.includes(c)
                                    ? s.components.filter((v) => v !== c)
                                    : [...(s.components ?? []), c],
                            })
                        }
                    >
                        {c}
                    </button>
                ))}
            </div>
            <label>
                Материальный компонент
                <input
                    value={s.material ?? ''}
                    onChange={(e) => patch({ material: e.target.value })}
                />
            </label>
            <label>
                Предмет-компонент (проверено GM)
                <select
                    value={s.material_definition_id ?? ''}
                    onChange={(e) =>
                        patch({
                            material_definition_id: e.target.value ? Number(e.target.value) : null,
                        })
                    }
                >
                    <option value="">Материал проверяет GM</option>
                    {materials.map((m) => (
                        <option key={m.id} value={m.id}>
                            {m.name}
                        </option>
                    ))}
                </select>
            </label>
            {s.material_definition_id && (
                <>
                    <label>
                        Количество компонента
                        <input
                            type="number"
                            min={1}
                            max={99}
                            value={s.material_quantity ?? 1}
                            onChange={(e) => patch({ material_quantity: Number(e.target.value) })}
                        />
                    </label>
                    <label>
                        <input
                            type="checkbox"
                            checked={s.consume_material ?? false}
                            onChange={(e) => patch({ consume_material: e.target.checked })}
                        />
                        Расходуется при сотворении
                    </label>
                </>
            )}
            {(['damage', 'healing', 'temporary_hp'] as const).map((key) => (
                <label key={key}>
                    Прибавка за круг · {key}
                    <input
                        placeholder="1d6 или 5"
                        value={s.scaling?.[key]?.per_level ?? ''}
                        onChange={(e) =>
                            patch({
                                scaling: {
                                    ...s.scaling,
                                    [key]: {
                                        ...s.scaling?.[key],
                                        per_level: e.target.value || null,
                                    },
                                },
                            })
                        }
                    />
                    {key !== 'temporary_hp' && (
                        <span>
                            <input
                                type="checkbox"
                                checked={s.scaling?.[key]?.spellcasting ?? false}
                                onChange={(e) =>
                                    patch({
                                        scaling: {
                                            ...s.scaling,
                                            [key]: {
                                                ...s.scaling?.[key],
                                                spellcasting: e.target.checked,
                                            },
                                        },
                                    })
                                }
                            />{' '}
                            + характеристика заклинаний
                        </span>
                    )}
                </label>
            ))}
            <p>
                Дополнительные эффекты. Атака, спасбросок, типизированный урон и состояния
                настраиваются в боевых свойствах выше.
            </p>
            {effects.map((e, i) => (
                <div className="gameplay-form-row" key={i}>
                    <select
                        aria-label={`Тип эффекта ${i + 1}`}
                        value={e.type}
                        onChange={(v) =>
                            patch({
                                effects: effects.map((n, j) =>
                                    j === i ? { ...n, type: v.target.value as typeof n.type } : n,
                                ),
                            })
                        }
                    >
                        <option value="modifier">Модификатор</option>
                        <option value="temporary_hp">Временные HP</option>
                        <option value="remove_condition">Снять состояние</option>
                    </select>
                    <select
                        aria-label={`Свойство эффекта ${i + 1}`}
                        value={e.key ?? 'ac'}
                        onChange={(v) =>
                            patch({
                                effects: effects.map((n, j) =>
                                    j === i ? { ...n, key: v.target.value } : n,
                                ),
                            })
                        }
                    >
                        {[
                            'ac',
                            'speed',
                            'attack',
                            'save',
                            'blinded',
                            'deafened',
                            'paralyzed',
                            'poisoned',
                            'prone',
                        ].map((k) => (
                            <option key={k}>{k}</option>
                        ))}
                    </select>
                    <input
                        aria-label={`Поправка эффекта ${i + 1}`}
                        type="number"
                        value={e.value ?? 0}
                        onChange={(v) =>
                            patch({
                                effects: effects.map((n, j) =>
                                    j === i ? { ...n, value: Number(v.target.value) } : n,
                                ),
                            })
                        }
                    />
                    <input
                        aria-label={`Кубики эффекта ${i + 1}`}
                        placeholder="1d4"
                        value={e.dice ?? ''}
                        onChange={(v) =>
                            patch({
                                effects: effects.map((n, j) =>
                                    j === i ? { ...n, dice: v.target.value || null } : n,
                                ),
                            })
                        }
                    />
                    <button
                        type="button"
                        onClick={() => patch({ effects: effects.filter((_, j) => j !== i) })}
                    >
                        Убрать эффект
                    </button>
                </div>
            ))}
            <button
                type="button"
                disabled={effects.length >= 8}
                onClick={() =>
                    patch({
                        effects: [
                            ...effects,
                            { type: 'modifier', key: 'ac', value: 1, when: 'always' },
                        ],
                    })
                }
            >
                ＋ Эффект
            </button>
        </div>
    );
}
