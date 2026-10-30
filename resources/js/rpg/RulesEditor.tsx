import type { Character } from '../tabletop/types/scene';
import {
    abilityLabels,
    signed,
    breakdownLabel,
    type AbilityKey,
    type CharacterRules,
    type DerivedCharacter,
} from './rules';

export function RulesEditor({
    character: c,
    derived,
    onChange,
}: {
    character: Character;
    derived?: DerivedCharacter;
    onChange: (rules: CharacterRules) => void;
}) {
    const r = c.rules;
    const keys = Object.keys(abilityLabels) as AbilityKey[];
    if (!r)
        return (
            <section className="rules-editor">
                <h4>Характеристики и навыки</h4>
                <p className="hint">
                    Существующие проверки пока используют прежние модификаторы. При включении
                    знакомые ключи будут перенесены; проверьте дополнительные бонусы.
                </p>
                {c.derived?.catalog?.ready === false && (
                    <p className="hint">Сначала импортируйте навыки SRD в компендий.</p>
                )}
                <button
                    type="button"
                    className="secondary-button"
                    disabled={!c.rulesSuggestion}
                    onClick={() => c.rulesSuggestion && onChange(c.rulesSuggestion)}
                >
                    Настроить правила персонажа
                </button>
            </section>
        );
    const stat = (key: string) => derived?.checks.find((s) => s.key === key);
    return (
        <section className="rules-editor" aria-label="Настройка правил персонажа">
            <h4>Характеристики</h4>
            <div className="rules-ability-grid">
                {keys.map((k) => (
                    <label key={k}>
                        {abilityLabels[k]}
                        <input
                            aria-label={abilityLabels[k]}
                            type="number"
                            min={1}
                            max={30}
                            value={r.scores[k]}
                            onChange={(e) =>
                                onChange({
                                    ...r,
                                    scores: { ...r.scores, [k]: Number(e.target.value) },
                                })
                            }
                        />
                        <strong>
                            {derived?.abilityModifiers?.[k] !== undefined
                                ? signed(derived.abilityModifiers[k]!)
                                : stat(k)
                                  ? signed(stat(k)!.modifier)
                                  : '…'}
                        </strong>
                    </label>
                ))}
            </div>
            <label className="rules-proficiency">
                Бонус владения{' '}
                <input
                    aria-label="Бонус владения"
                    type="number"
                    min={0}
                    max={20}
                    value={r.proficiency_bonus}
                    onChange={(e) => onChange({ ...r, proficiency_bonus: Number(e.target.value) })}
                />
            </label>
            <details open>
                <summary>
                    Навыки <small>— / владение / компетентность</small>
                </summary>
                <div className="rules-edit-skills">
                    {(
                        derived?.catalog?.skills ??
                        c.derived?.catalog?.skills ??
                        Object.entries(r.skills).map(([key, skill]) => ({
                            key,
                            name: stat(key)?.label ?? key,
                            ability: skill.ability,
                        }))
                    ).map((definition) => {
                        const key = definition.key;
                        const skill = r.skills[key];
                        if (!skill) return null;
                        return (
                            <div className="rules-edit-row" key={key}>
                                <span>
                                    {definition.name}{' '}
                                    <small>{definition.ability?.toUpperCase()}</small>
                                </span>
                                <div
                                    className="rules-rank-chips"
                                    role="group"
                                    aria-label={`Владение: ${key}`}
                                >
                                    {[0, 1, 2].map((rank) => (
                                        <button
                                            type="button"
                                            key={rank}
                                            aria-label={`${key}: ${['без владения', 'владение', 'компетентность'][rank]}`}
                                            aria-pressed={
                                                (skill.expertise ? 2 : skill.proficient ? 1 : 0) ===
                                                rank
                                            }
                                            onClick={() =>
                                                onChange({
                                                    ...r,
                                                    skills: {
                                                        ...r.skills,
                                                        [key]: {
                                                            ...skill,
                                                            proficient: rank > 0,
                                                            expertise: rank === 2,
                                                        },
                                                    },
                                                })
                                            }
                                        >
                                            {['—', '●', '◆'][rank]}
                                        </button>
                                    ))}
                                </div>
                                <strong
                                    title={stat(key) ? breakdownLabel(stat(key)!.breakdown) : ''}
                                >
                                    {stat(key) ? signed(stat(key)!.modifier) : '…'}
                                </strong>
                                <details>
                                    <summary aria-label={`Дополнительно: ${key}`}>＋</summary>
                                    <p className="hint">
                                        {definition.ability
                                            ? abilityLabels[definition.ability]
                                            : ''}{' '}
                                        · SRD
                                    </p>
                                    <label>
                                        Дополнительный бонус
                                        <input
                                            aria-label={`Бонус: ${key}`}
                                            type="number"
                                            min={-100}
                                            max={100}
                                            value={skill.bonus}
                                            onChange={(e) =>
                                                onChange({
                                                    ...r,
                                                    skills: {
                                                        ...r.skills,
                                                        [key]: {
                                                            ...skill,
                                                            bonus: Number(e.target.value),
                                                        },
                                                    },
                                                })
                                            }
                                        />
                                    </label>
                                </details>
                            </div>
                        );
                    })}
                </div>
            </details>
            <details>
                <summary>Дополнительные бонусы</summary>
                <div className="rules-save-editor">
                    {(
                        [
                            ['ac', 'AC'],
                            ['speed', 'Скорость · ft'],
                            ['spell_attack', 'Атака заклинанием'],
                            ['spell_save_dc', 'Сл заклинаний'],
                        ] as const
                    ).map(([key, label]) => (
                        <label key={key}>
                            {label}
                            <input
                                aria-label={`Дополнительный бонус: ${label}`}
                                type="number"
                                min={-100}
                                max={100}
                                value={r.modifiers?.[key] ?? 0}
                                onChange={(e) =>
                                    onChange({
                                        ...r,
                                        modifiers: {
                                            ...r.modifiers,
                                            [key]: Number(e.target.value),
                                        },
                                    })
                                }
                            />
                        </label>
                    ))}
                </div>
            </details>
            <details>
                <summary>Спасброски</summary>
                <div className="rules-save-editor">
                    {keys.map((k) => (
                        <div key={k}>
                            <label>
                                <input
                                    type="checkbox"
                                    checked={r.saves[k].proficient}
                                    onChange={(e) =>
                                        onChange({
                                            ...r,
                                            saves: {
                                                ...r.saves,
                                                [k]: {
                                                    ...r.saves[k],
                                                    proficient: e.target.checked,
                                                },
                                            },
                                        })
                                    }
                                />
                                {abilityLabels[k]}
                            </label>
                            <strong>
                                {stat(`save_${k}`) ? signed(stat(`save_${k}`)!.modifier) : '…'}
                            </strong>
                            <input
                                aria-label={`Бонус спасброска: ${abilityLabels[k]}`}
                                type="number"
                                min={-100}
                                max={100}
                                value={r.saves[k].bonus}
                                onChange={(e) =>
                                    onChange({
                                        ...r,
                                        saves: {
                                            ...r.saves,
                                            [k]: { ...r.saves[k], bonus: Number(e.target.value) },
                                        },
                                    })
                                }
                            />
                        </div>
                    ))}
                </div>
            </details>
            <details>
                <summary>Заклинательная характеристика</summary>
                <div className="rules-rank-chips">
                    {[null, ...keys].map((k) => (
                        <button
                            type="button"
                            key={k ?? 'none'}
                            aria-pressed={r.spellcasting_ability === k}
                            onClick={() => onChange({ ...r, spellcasting_ability: k })}
                        >
                            {k ? abilityLabels[k] : 'Нет'}
                        </button>
                    ))}
                </div>
                {derived?.spellcasting && (
                    <p>
                        Атака {signed(derived.spellcasting.attackBonus)} · Сл спасброска{' '}
                        {derived.spellcasting.saveDc}
                    </p>
                )}
            </details>
        </section>
    );
}
