import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { api } from '../api/workspace';
import type { Character } from '../tabletop/types/scene';
import { interactions, type InteractionResources } from '../workspace/interactions/model';
import { gameplayIcons, gameplayIcon, iconLabels } from './icons';
import { AbilityGeometryEditor } from './AbilityGeometryEditor';
import { SpellMetadataEditor } from '../rpg/SpellMetadataEditor';
import { newAbility, targetLabels, type Ability } from './model';

export function AbilityEditor({
    character,
    campaignId,
    onChange,
}: {
    character: Character;
    campaignId: string;
    onChange: (abilities: Ability[]) => void;
}) {
    const abilities = character.abilities ?? [];
    const [options, setOptions] = useState<InteractionResources>({ handouts: [], cues: [] });
    const [error, setError] = useState('');
    useEffect(() => {
        const abort = new AbortController();
        void api
            .campaign(campaignId, abort.signal)
            .then((c) =>
                Promise.all(
                    c.scenes.map(async (s) => {
                        const r = await interactions.resources(s.id, abort.signal);
                        return {
                            ...r,
                            cues: r.cues.map((q) => ({ ...q, name: `${s.name} · ${q.name}` })),
                        };
                    }),
                ),
            )
            .then((all) => {
                if (!abort.signal.aborted)
                    setOptions({
                        handouts: all[0]?.handouts ?? [],
                        cues: all.flatMap((r) => r.cues),
                    });
            })
            .catch((e) => {
                if (!abort.signal.aborted) setError(e.message);
            });
        return () => abort.abort();
    }, [campaignId]);
    const patch = (i: number, data: Partial<Ability>) =>
        onChange(abilities.map((a, n) => (n === i ? { ...a, ...data } : a)));
    const move = (i: number, delta: number) => {
        const next = [...abilities];
        [next[i], next[i + delta]] = [next[i + delta], next[i]];
        onChange(next.map((a, n) => ({ ...a, sort_order: n })));
    };
    return (
        <section className="gameplay-editor-section visual-ability-editor">
            <header>
                <div>
                    <span className="eyebrow">ДЕЙСТВИЯ ПЕРСОНАЖА</span>
                    <h4>Способности</h4>
                </div>
                <small>{abilities.length} / 24</small>
            </header>
            <div className="ability-presets">
                {(['melee', 'ranged', 'spell', 'check', 'utility'] as const).map((type) => (
                    <button
                        type="button"
                        className="secondary-button"
                        key={type}
                        disabled={abilities.length >= 24}
                        onClick={() => {
                            const category =
                                type === 'spell'
                                    ? 'effect'
                                    : type === 'check'
                                      ? 'check'
                                      : type === 'utility'
                                        ? 'utility'
                                        : 'attack';
                            const a = newAbility(category, abilities.length);
                            a.attack_type = type;
                            a.icon =
                                type === 'ranged' ? 'bow' : type === 'spell' ? 'flame' : a.icon;
                            a.name = {
                                melee: 'Удар',
                                ranged: 'Выстрел',
                                spell: 'Новое заклинание',
                                check: 'Новая проверка',
                                utility: 'Новое действие',
                            }[type];
                            if (type === 'melee' || type === 'ranged')
                                a.range = {
                                    normal: type === 'melee' ? 5 : 60,
                                    long: type === 'ranged' ? 120 : null,
                                };
                            if (type === 'spell') {
                                a.target = 'point';
                                a.area = { shape: 'circle', size: 20, width: 20 };
                                a.range = { normal: 150, long: null };
                                a.damage = '2d6';
                            }
                            onChange([...abilities, a]);
                        }}
                    >
                        {
                            {
                                melee: '＋ Ближняя',
                                ranged: '＋ Выстрел',
                                spell: '＋ Заклинание',
                                check: '＋ Проверка',
                                utility: '＋ Действие',
                            }[type]
                        }
                    </button>
                ))}
            </div>
            {error && (
                <p className="error" role="alert">
                    {error}
                </p>
            )}
            {abilities.map((a, i) => {
                const Icon = gameplayIcon(a.icon),
                    result = a.result!;
                return (
                    <details
                        key={a.id}
                        className="ability-editor-card"
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                            const value = e.dataTransfer.getData('application/ytt-ability-order');
                            if (!value) return;
                            const from = Number(value);
                            if (
                                !Number.isInteger(from) ||
                                from < 0 ||
                                from >= abilities.length ||
                                from === i
                            )
                                return;
                            const next = [...abilities];
                            next.splice(i, 0, next.splice(from, 1)[0]);
                            onChange(next.map((a, n) => ({ ...a, sort_order: n })));
                        }}
                    >
                        <summary
                            draggable
                            onDragStart={(e) =>
                                e.dataTransfer.setData('application/ytt-ability-order', String(i))
                            }
                        >
                            <Icon size={20} />
                            <strong>{a.name}</strong>
                            <small>
                                {a.range
                                    ? `${a.range.normal}${a.range.long ? ` / ${a.range.long}` : ''}`
                                    : targetLabels[a.target]}
                            </small>
                        </summary>
                        <div className="ability-editor-body">
                            <label>
                                Название
                                <input
                                    aria-label="Название способности"
                                    maxLength={60}
                                    value={a.name}
                                    onChange={(e) => patch(i, { name: e.target.value })}
                                />
                            </label>
                            <div className="ability-icon-choices">
                                {Object.entries(gameplayIcons).map(([key, Choice]) => (
                                    <button
                                        type="button"
                                        key={key}
                                        title={iconLabels[key]}
                                        aria-label={`Значок: ${iconLabels[key]}`}
                                        aria-pressed={a.icon === key}
                                        onClick={() => patch(i, { icon: key })}
                                    >
                                        <Choice size={19} />
                                    </button>
                                ))}
                            </div>
                            <div
                                className="ability-type-chips"
                                role="group"
                                aria-label="Тип способности"
                            >
                                {(['melee', 'ranged', 'spell', 'check', 'utility'] as const).map(
                                    (type) => (
                                        <button
                                            type="button"
                                            key={type}
                                            aria-pressed={a.attack_type === type}
                                            onClick={() => {
                                                if (type === 'melee' || type === 'ranged')
                                                    patch(i, {
                                                        attack_type: type,
                                                        category: 'attack',
                                                        target: 'token',
                                                        area: null,
                                                        range: {
                                                            normal: type === 'melee' ? 5 : 60,
                                                            long: type === 'ranged' ? 120 : null,
                                                        },
                                                        check: a.check ?? {
                                                            stat_key: null,
                                                            modifier: 0,
                                                            dc: 10,
                                                            dc_visible: true,
                                                            defense: 'ac',
                                                        },
                                                        damage: a.damage ?? '1d8+3',
                                                    });
                                                else if (type === 'spell')
                                                    patch(i, {
                                                        attack_type: type,
                                                        category: 'effect',
                                                        target: 'point',
                                                        range: { normal: 150, long: null },
                                                        area: {
                                                            shape: 'circle',
                                                            size: 20,
                                                            width: 20,
                                                        },
                                                        check: null,
                                                        damage: a.damage ?? '2d6',
                                                    });
                                                else
                                                    patch(i, {
                                                        attack_type: type,
                                                        category:
                                                            type === 'check' ? 'check' : 'utility',
                                                        target: type === 'check' ? 'none' : 'self',
                                                        range: null,
                                                        area: null,
                                                        damage: null,
                                                        check:
                                                            type === 'check'
                                                                ? {
                                                                      stat_key: null,
                                                                      modifier: 0,
                                                                      dc: 10,
                                                                      dc_visible: true,
                                                                      defense: 'fixed',
                                                                  }
                                                                : null,
                                                    });
                                            }}
                                        >
                                            {
                                                {
                                                    melee: 'Ближняя',
                                                    ranged: 'Дальняя',
                                                    spell: 'Заклинание',
                                                    check: 'Проверка',
                                                    utility: 'Действие',
                                                }[type]
                                            }
                                        </button>
                                    ),
                                )}
                            </div>
                            <SpellMetadataEditor
                                ability={a}
                                onChange={(value) => patch(i, value)}
                            />
                            <AbilityGeometryEditor
                                ability={a}
                                onChange={(data) => patch(i, data)}
                            />
                            {(!a.area || a.area.shape === 'none') && (
                                <div className="ability-target-chips">
                                    {Object.entries(targetLabels).map(([key, label]) => (
                                        <button
                                            type="button"
                                            key={key}
                                            aria-pressed={a.target === key}
                                            onClick={() =>
                                                patch(i, { target: key as Ability['target'] })
                                            }
                                        >
                                            {label}
                                        </button>
                                    ))}
                                </div>
                            )}
                            {a.check && (
                                <section className="ability-check-fields">
                                    <span className="eyebrow">БРОСОК</span>
                                    <div className="stat-chips">
                                        {character.checkStats.map((stat) => (
                                            <button
                                                type="button"
                                                key={stat.key}
                                                aria-pressed={a.check?.stat_key === stat.key}
                                                onClick={() =>
                                                    patch(i, {
                                                        check: { ...a.check!, stat_key: stat.key },
                                                    })
                                                }
                                            >
                                                {stat.label}{' '}
                                                <b>
                                                    {stat.modifier >= 0 ? '+' : ''}
                                                    {stat.modifier}
                                                </b>
                                            </button>
                                        ))}
                                        <button
                                            type="button"
                                            aria-pressed={!a.check.stat_key}
                                            onClick={() =>
                                                patch(i, { check: { ...a.check!, stat_key: null } })
                                            }
                                        >
                                            Свой модификатор
                                        </button>
                                    </div>
                                    {!a.check.stat_key && (
                                        <label>
                                            Модификатор
                                            <input
                                                type="number"
                                                min={-100}
                                                max={100}
                                                value={a.check.modifier ?? 0}
                                                onChange={(e) =>
                                                    patch(i, {
                                                        check: {
                                                            ...a.check!,
                                                            modifier: Number(e.target.value),
                                                        },
                                                    })
                                                }
                                            />
                                        </label>
                                    )}
                                    {character.rules && a.check.stat_key && (
                                        <div className="gameplay-form-row">
                                            {[
                                                'str',
                                                'dex',
                                                'con',
                                                'int',
                                                'wis',
                                                'cha',
                                                'strength',
                                                'dexterity',
                                                'constitution',
                                                'intelligence',
                                                'wisdom',
                                                'charisma',
                                            ].includes(a.check.stat_key) && (
                                                <label>
                                                    <input
                                                        type="checkbox"
                                                        checked={a.check.proficient ?? false}
                                                        onChange={(e) =>
                                                            patch(i, {
                                                                check: {
                                                                    ...a.check!,
                                                                    proficient: e.target.checked,
                                                                },
                                                            })
                                                        }
                                                    />
                                                    Добавить бонус владения
                                                </label>
                                            )}
                                            <label>
                                                Дополнительный бонус действия
                                                <input
                                                    aria-label="Дополнительный бонус действия"
                                                    type="number"
                                                    min={-100}
                                                    max={100}
                                                    value={a.check.bonus ?? 0}
                                                    onChange={(e) =>
                                                        patch(i, {
                                                            check: {
                                                                ...a.check!,
                                                                bonus: Number(e.target.value),
                                                            },
                                                        })
                                                    }
                                                />
                                            </label>
                                        </div>
                                    )}
                                    {a.category === 'attack' && (
                                        <div className="stat-chips">
                                            <button
                                                type="button"
                                                aria-pressed={a.check.defense === 'ac'}
                                                onClick={() =>
                                                    patch(i, {
                                                        check: { ...a.check!, defense: 'ac' },
                                                    })
                                                }
                                            >
                                                AC цели
                                            </button>
                                            <button
                                                type="button"
                                                aria-pressed={a.check.defense === 'fixed'}
                                                onClick={() =>
                                                    patch(i, {
                                                        check: { ...a.check!, defense: 'fixed' },
                                                    })
                                                }
                                            >
                                                Своя защита
                                            </button>
                                        </div>
                                    )}
                                    {(a.category !== 'attack' || a.check.defense === 'fixed') && (
                                        <label>
                                            Сложность / защита
                                            <input
                                                type="number"
                                                min={0}
                                                max={999}
                                                value={a.check.dc ?? 10}
                                                onChange={(e) =>
                                                    patch(i, {
                                                        check: {
                                                            ...a.check!,
                                                            dc: Number(e.target.value),
                                                        },
                                                    })
                                                }
                                            />
                                        </label>
                                    )}
                                    <label className="gameplay-checkbox">
                                        <input
                                            type="checkbox"
                                            checked={a.check.dc_visible ?? false}
                                            onChange={(e) =>
                                                patch(i, {
                                                    check: {
                                                        ...a.check!,
                                                        dc_visible: e.target.checked,
                                                    },
                                                })
                                            }
                                        />{' '}
                                        Показывать сложность после броска
                                    </label>
                                </section>
                            )}
                            {(a.category === 'attack' || a.area) && (
                                <section>
                                    <span className="eyebrow">УРОН</span>
                                    <div className="range-presets">
                                        {['1d6', '1d8+3', '2d6', '3d6+2'].map((d) => (
                                            <button
                                                type="button"
                                                key={d}
                                                aria-pressed={a.damage === d}
                                                onClick={() => patch(i, { damage: d })}
                                            >
                                                {d}
                                            </button>
                                        ))}
                                    </div>
                                    <input
                                        aria-label="Формула урона"
                                        placeholder="Без урона"
                                        value={a.damage ?? ''}
                                        onChange={(e) =>
                                            patch(i, { damage: e.target.value || null })
                                        }
                                    />
                                </section>
                            )}
                            {!!character.resources?.length && (
                                <section className="ability-costs">
                                    <span className="eyebrow">СТОИМОСТЬ</span>
                                    {character.resources.map((r) => {
                                        const amount =
                                            a.costs.find((c) => c.key === r.key)?.amount ?? 0;
                                        return (
                                            <label key={r.key}>
                                                {r.label} <b>{amount}</b>
                                                <input
                                                    type="range"
                                                    aria-label={`Стоимость: ${r.label}`}
                                                    min={0}
                                                    max={r.max}
                                                    value={amount}
                                                    onChange={(e) =>
                                                        patch(i, {
                                                            costs: [
                                                                ...a.costs.filter(
                                                                    (c) => c.key !== r.key,
                                                                ),
                                                                ...(Number(e.target.value) > 0
                                                                    ? [
                                                                          {
                                                                              key: r.key,
                                                                              amount: Number(
                                                                                  e.target.value,
                                                                              ),
                                                                          },
                                                                      ]
                                                                    : []),
                                                            ],
                                                        })
                                                    }
                                                />
                                            </label>
                                        );
                                    })}
                                </section>
                            )}
                            <details className="ability-precise">
                                <summary>Описание и дополнительные результаты</summary>
                                <label>
                                    Описание
                                    <textarea
                                        aria-label="Описание способности"
                                        rows={2}
                                        maxLength={800}
                                        value={a.description ?? ''}
                                        onChange={(e) => patch(i, { description: e.target.value })}
                                    />
                                </label>
                                <label>
                                    Результат при успехе
                                    <select
                                        value={result.type}
                                        onChange={(e) =>
                                            patch(i, {
                                                result: {
                                                    type: e.target.value as typeof result.type,
                                                    target: null,
                                                    amount: e.target.value === 'heal' ? 6 : 0,
                                                },
                                            })
                                        }
                                    >
                                        <option value="nothing">Только действие / бросок</option>
                                        <option value="heal">Восстановить HP</option>
                                        <option value="handout">Показать материал</option>
                                        <option value="cue">Запустить Cue</option>
                                    </select>
                                </label>
                                {result.type === 'heal' && (
                                    <label>
                                        Восстановить HP
                                        <input
                                            type="number"
                                            min={1}
                                            max={9999}
                                            value={result.amount}
                                            onChange={(e) =>
                                                patch(i, {
                                                    result: {
                                                        ...result,
                                                        amount: Number(e.target.value),
                                                    },
                                                })
                                            }
                                        />
                                    </label>
                                )}
                                {(result.type === 'cue' || result.type === 'handout') && (
                                    <label>
                                        Материал / событие
                                        <select
                                            value={result.target ?? ''}
                                            onChange={(e) =>
                                                patch(i, {
                                                    result: {
                                                        ...result,
                                                        target: Number(e.target.value) || null,
                                                    },
                                                })
                                            }
                                        >
                                            <option value="">Выберите…</option>
                                            {(result.type === 'cue'
                                                ? options.cues
                                                : options.handouts
                                            ).map((o) => (
                                                <option key={o.id} value={o.id}>
                                                    {o.name}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                )}
                            </details>
                            <footer>
                                <label className="gameplay-checkbox">
                                    <input
                                        type="checkbox"
                                        checked={a.enabled}
                                        onChange={(e) => patch(i, { enabled: e.target.checked })}
                                    />{' '}
                                    Доступна игроку
                                </label>
                                <button
                                    type="button"
                                    className="icon-button"
                                    aria-label="Выше"
                                    disabled={!i}
                                    onClick={() => move(i, -1)}
                                >
                                    <ArrowUp size={14} />
                                </button>
                                <button
                                    type="button"
                                    className="icon-button"
                                    aria-label="Ниже"
                                    disabled={i === abilities.length - 1}
                                    onClick={() => move(i, 1)}
                                >
                                    <ArrowDown size={14} />
                                </button>
                                <button
                                    type="button"
                                    className="icon-button"
                                    aria-label={`Удалить ${a.name}`}
                                    onClick={() => onChange(abilities.filter((_, n) => n !== i))}
                                >
                                    <Trash2 size={14} />
                                </button>
                            </footer>
                        </div>
                    </details>
                );
            })}
        </section>
    );
}
