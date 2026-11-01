import type { Character } from '../tabletop/types/scene';
import type { DerivedCharacter } from '../rpg/rules';
import { ResourceEditor } from '../gameplay/ResourceEditor';
import { breakdownLabel } from '../rpg/rules';
export function CharacterCombat({
    draft,
    includeResources,
    derived,
    patch,
}: {
    includeResources: boolean;
    draft: Character;
    derived?: DerivedCharacter;
    patch: (values: Partial<Character>) => void;
}) {
    return (
        <>
            <h2>Готовность к игре</h2>
            <div className="sheet-combat-summary">
                <article>
                    <small>Здоровье</small>
                    <strong>
                        {draft.hp} <small>/ {draft.maxHp}</small>
                    </strong>
                    <progress aria-label="Здоровье" value={draft.hp} max={draft.maxHp} />
                    <div className="sheet-counter">
                        <button
                            type="button"
                            aria-label="Уменьшить HP"
                            disabled={draft.hp <= 0}
                            onClick={() => patch({ hp: draft.hp - 1 })}
                        >
                            −
                        </button>
                        <button
                            type="button"
                            aria-label="Увеличить HP"
                            disabled={draft.hp >= draft.maxHp}
                            onClick={() => patch({ hp: draft.hp + 1 })}
                        >
                            +
                        </button>
                        <button
                            type="button"
                            disabled={draft.hp >= draft.maxHp}
                            onClick={() => patch({ hp: draft.maxHp })}
                        >
                            До максимума
                        </button>
                    </div>
                </article>
                <article title={derived ? breakdownLabel(derived.coreBreakdown.ac) : undefined}>
                    <small>Класс защиты</small>
                    <strong>{derived?.ac ?? '—'}</strong>
                    <small>Со снаряжением и эффектами</small>
                </article>
                <article title={derived ? breakdownLabel(derived.coreBreakdown.speed) : undefined}>
                    <small>Скорость</small>
                    <strong>
                        {derived?.speed ?? '—'} <small>ft</small>
                    </strong>
                    <small>Со снаряжением и эффектами</small>
                </article>
            </div>
            <div className="control-combat-grid">
                {(
                    [
                        { key: 'hp', label: 'Текущие HP', max: 9999, min: 0 },
                        { key: 'maxHp', label: 'Максимум HP', max: 9999, min: 1 },
                        { key: 'exhaustion', label: 'Истощение', max: 6, min: 0 },
                    ] as const
                ).map((f) => (
                    <label className="field" key={f.key}>
                        <span>{f.label}</span>
                        <input
                            aria-label={f.label}
                            type="number"
                            min={f.min}
                            max={f.max}
                            value={draft[f.key] ?? ''}
                            onChange={(e) =>
                                patch({
                                    [f.key]: Number(e.target.value),
                                })
                            }
                        />
                    </label>
                ))}
            </div>
            <details className="sheet-advanced">
                <summary>Advanced · базовые защита и скорость</summary>
                <div className="sheet-manual-grid">
                    {(
                        [
                            { key: 'ac', label: 'Базовая AC', max: 99 },
                            { key: 'speed', label: 'Базовая скорость · ft', max: 999 },
                        ] as const
                    ).map((f) => (
                        <label className="field" key={f.key}>
                            {f.label}
                            <input
                                aria-label={f.label}
                                type="number"
                                min={0}
                                max={f.max}
                                value={draft[f.key] ?? ''}
                                onChange={(e) =>
                                    patch({
                                        [f.key]:
                                            e.target.value === '' ? null : Number(e.target.value),
                                    })
                                }
                            />
                        </label>
                    ))}
                </div>
            </details>
            <p className="hint">
                С учётом снаряжения и эффектов: AC {derived?.ac ?? '—'} · скорость{' '}
                {derived?.speed ?? '—'} ft. Истощение 6 приводит к смерти; возврат к жизни
                выполняется через Combat.
            </p>
            <h3>Кости здоровья</h3>
            {(['d6', 'd8', 'd10', 'd12'] as const).map((die) => {
                const pool = draft.hitPointDice?.find((p) => p.die === die);
                return (
                    <div className="control-dice-row" key={die}>
                        <strong>{die}</strong>
                        <label>
                            Максимум
                            <input
                                aria-label={`Максимум ${die}`}
                                type="number"
                                min={0}
                                max={100}
                                value={pool?.max ?? 0}
                                onChange={(e) => {
                                    const max = Number(e.target.value);
                                    patch({
                                        hitPointDice: [
                                            ...(draft.hitPointDice ?? []).filter(
                                                (p) => p.die !== die,
                                            ),
                                            ...(max
                                                ? [
                                                      {
                                                          die,
                                                          max,
                                                          current: Math.min(
                                                              pool?.current ?? max,
                                                              max,
                                                          ),
                                                      },
                                                  ]
                                                : []),
                                        ],
                                    });
                                }}
                            />
                        </label>
                        <label>
                            Осталось
                            <input
                                aria-label={`Осталось ${die}`}
                                type="number"
                                disabled={!pool}
                                min={0}
                                max={pool?.max ?? 0}
                                value={pool?.current ?? 0}
                                onChange={(e) =>
                                    patch({
                                        hitPointDice: draft.hitPointDice?.map((p) =>
                                            p.die === die
                                                ? {
                                                      ...p,
                                                      current: Number(e.target.value),
                                                  }
                                                : p,
                                        ),
                                    })
                                }
                            />
                        </label>
                    </div>
                );
            })}
            {includeResources && (
                <ResourceEditor
                    sheet
                    resources={draft.resources ?? []}
                    onChange={(resources) => patch({ resources })}
                />
            )}
        </>
    );
}
