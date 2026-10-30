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
                        <strong>{stat(k) ? signed(stat(k)!.modifier) : '…'}</strong>
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
                    {Object.entries(r.skills).map(([key, skill]) => (
                        <div className="rules-edit-row" key={key}>
                            <span>
                                {stat(key)?.label ??
                                    c.derived?.checks.find((s) => s.key === key)?.label ??
                                    key}
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
                            <strong title={stat(key) ? breakdownLabel(stat(key)!.breakdown) : ''}>
                                {stat(key) ? signed(stat(key)!.modifier) : '…'}
                            </strong>
                            <details>
                                <summary aria-label={`Дополнительно: ${key}`}>＋</summary>
                                <label>
                                    Характеристика
                                    <select
                                        aria-label={`Характеристика: ${key}`}
                                        value={skill.ability}
                                        onChange={(e) =>
                                            onChange({
                                                ...r,
                                                skills: {
                                                    ...r.skills,
                                                    [key]: {
                                                        ...skill,
                                                        ability: e.target.value as AbilityKey,
                                                    },
                                                },
                                            })
                                        }
                                    >
                                        {keys.map((k) => (
                                            <option key={k} value={k}>
                                                {abilityLabels[k]}
                                            </option>
                                        ))}
                                    </select>
                                </label>
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
