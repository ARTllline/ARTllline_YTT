import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { api } from '../api/workspace';
import type { Character } from '../tabletop/types/scene';
import { interactions, type InteractionResources } from '../workspace/interactions/model';
import { gameplayIcons, gameplayIcon, iconLabels } from './icons';
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
        <section className="gameplay-editor-section">
            <header>
                <div>
                    <span className="eyebrow">ДЕЙСТВИЯ ПЕРСОНАЖА</span>
                    <h4>Способности</h4>
                </div>
                <small>{abilities.length} / 24</small>
            </header>
            <div className="ability-presets">
                {(['attack', 'check', 'effect', 'utility'] as const).map((category) => (
                    <button
                        key={category}
                        type="button"
                        className="secondary-button"
                        disabled={abilities.length >= 24}
                        onClick={() => {
                            const a = newAbility(category, abilities.length);
                            if (category === 'effect') {
                                a.name = 'Лечение';
                                a.icon = 'heart';
                                a.result = { type: 'heal', target: null, amount: 6 };
                            }
                            onChange([...abilities, a]);
                        }}
                    >
                        {
                            {
                                attack: '＋ Атака',
                                check: '＋ Проверка',
                                effect: '＋ Лечение',
                                utility: '＋ Действие',
                            }[category]
                        }
                    </button>
                ))}
            </div>
            {error && (
                <p role="alert" className="error">
                    {error}
                </p>
            )}
            {abilities.map((a, i) => {
                const Icon = gameplayIcon(a.icon),
                    result = a.result!;
                return (
                    <details className="ability-editor-card" key={a.id} open={undefined}>
                        <summary>
                            <Icon size={18} />
                            <strong>{a.name}</strong>
                            <small>{targetLabels[a.target]}</small>
                        </summary>
                        <div className="ability-editor-body">
                            <div className="gameplay-form-row">
                                <label>
                                    Название
                                    <input
                                        value={a.name}
                                        aria-label="Название способности"
                                        maxLength={60}
                                        onChange={(e) => patch(i, { name: e.target.value })}
                                    />
                                </label>
                                <label>
                                    Значок
                                    <select
                                        value={a.icon}
                                        onChange={(e) => patch(i, { icon: e.target.value })}
                                    >
                                        {Object.keys(gameplayIcons).map((k) => (
                                            <option key={k} value={k}>
                                                {iconLabels[k]}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            </div>
                            <label>
                                Описание
                                <textarea
                                    aria-label="Описание способности"
                                    rows={2}
                                    value={a.description ?? ''}
                                    maxLength={800}
                                    onChange={(e) => patch(i, { description: e.target.value })}
                                />
                            </label>
                            <div className="gameplay-form-row">
                                <label>
                                    Тип
                                    <select
                                        value={a.category}
                                        onChange={(e) => {
                                            const category = e.target.value as Ability['category'];
                                            const preset = newAbility(category, i);
                                            patch(i, {
                                                category,
                                                check: preset.check,
                                                target: preset.target,
                                                damage: preset.damage,
                                            });
                                        }}
                                    >
                                        <option value="utility">Действие</option>
                                        <option value="check">Проверка</option>
                                        <option value="attack">Атака</option>
                                        <option value="effect">Эффект</option>
                                    </select>
                                </label>
                                <label>
                                    Цель
                                    <select
                                        value={a.target}
                                        onChange={(e) =>
                                            patch(i, {
                                                target: e.target.value as Ability['target'],
                                            })
                                        }
                                    >
                                        {Object.entries(targetLabels).map(([k, v]) => (
                                            <option value={k} key={k}>
                                                {v}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            </div>
                            {a.check && (
                                <div className="ability-check-fields">
                                    <label>
                                        Модификатор персонажа
                                        <select
                                            value={a.check.stat_key ?? ''}
                                            onChange={(e) =>
                                                patch(i, {
                                                    check: {
                                                        ...a.check!,
                                                        stat_key: e.target.value || null,
                                                    },
                                                })
                                            }
                                        >
                                            <option value="">Фиксированная поправка</option>
                                            {character.checkStats.map((s) => (
                                                <option key={s.key} value={s.key}>
                                                    {s.label} ({s.modifier >= 0 ? '+' : ''}
                                                    {s.modifier})
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                    {!a.check.stat_key && (
                                        <label>
                                            Поправка
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
                                    {a.category === 'attack' && (
                                        <label>
                                            Защита
                                            <select
                                                value={a.check.defense}
                                                onChange={(e) =>
                                                    patch(i, {
                                                        check: {
                                                            ...a.check!,
                                                            defense: e.target.value as
                                                                'ac' | 'fixed',
                                                        },
                                                    })
                                                }
                                            >
                                                <option value="ac">AC цели</option>
                                                <option value="fixed">Заданная защита</option>
                                            </select>
                                        </label>
                                    )}
                                    {(a.category !== 'attack' || a.check.defense === 'fixed') && (
                                        <label>
                                            Сложность
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
                                        Показывать защиту / сложность после броска
                                    </label>
                                </div>
                            )}
                            {a.category === 'attack' && (
                                <label>
                                    Урон при попадании
                                    <input
                                        placeholder="1d8+3 (необязательно)"
                                        value={a.damage ?? ''}
                                        onChange={(e) =>
                                            patch(i, { damage: e.target.value || null })
                                        }
                                    />
                                </label>
                            )}
                            <div className="ability-costs">
                                <span className="eyebrow">СТОИМОСТЬ</span>
                                {(character.resources ?? []).map((r) => {
                                    const cost = a.costs.find((c) => c.key === r.key);
                                    return (
                                        <label key={r.key}>
                                            {r.label}
                                            <input
                                                type="number"
                                                min={0}
                                                max={9999}
                                                value={cost?.amount ?? 0}
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
                            </div>
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
                                    <option value="handout">Показать материал игроку</option>
                                    <option value="cue">Запустить событие Cue</option>
                                </select>
                            </label>
                            {result.type === 'heal' && (
                                <label>
                                    Восстановление
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
                                    {result.type === 'cue'
                                        ? 'Событие (только на своей сцене)'
                                        : 'Материал'}
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
