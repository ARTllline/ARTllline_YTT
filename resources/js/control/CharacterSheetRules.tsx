import { useState } from 'react';
import type { Character } from '../tabletop/types/scene';
import { RulesEditor } from '../rpg/RulesEditor';
import {
    abilityLabels,
    breakdownLabel,
    signed,
    type AbilityKey,
    type CharacterRules,
    type DerivedCharacter,
} from '../rpg/rules';

const keys = Object.keys(abilityLabels) as AbilityKey[];
const ranks = ['Без владения', 'Владение', 'Компетентность'];

export function CharacterSheetRules({
    character,
    derived,
    view,
    onChange,
}: {
    character: Character;
    derived?: DerivedCharacter;
    view: 'attributes' | 'skills';
    onChange: (rules: CharacterRules) => void;
}) {
    const [query, setQuery] = useState('');
    const [trainedOnly, setTrainedOnly] = useState(false);
    const r = character.rules;
    if (!r)
        return (
            <RulesEditor character={character} derived={derived} view={view} onChange={onChange} />
        );
    const bonus = (key: string) => {
        const check = derived?.checks.find((c) => c.key === key);
        return (
            <strong
                className="sheet-bonus"
                title={check ? breakdownLabel(check.breakdown) : 'Ожидаем расчёт сервера'}
            >
                {check ? signed(check.modifier) : '…'}
            </strong>
        );
    };
    const definitions =
        derived?.catalog?.skills ??
        character.derived?.catalog?.skills ??
        Object.entries(r.skills).map(([key, skill]) => ({
            key,
            name: key,
            ability: skill.ability,
        }));
    return (
        <section className="character-sheet-rules">
            <header className="sheet-heading">
                <div>
                    <span className="eyebrow">CHARACTER SHEET</span>
                    <h2>
                        {view === 'attributes' ? 'Характеристики героя' : 'Навыки и спасброски'}
                    </h2>
                </div>
                <div className="sheet-proficiency">
                    <small>Бонус владения</small>
                    <strong>
                        {derived?.proficiencyBonus == null ? '…' : signed(derived.proficiencyBonus)}
                    </strong>
                </div>
            </header>
            {view === 'attributes' ? (
                <div className="sheet-abilities">
                    {keys.map((key) => (
                        <article className="sheet-ability" key={key}>
                            <small>{key.toUpperCase()}</small>
                            <h3>{abilityLabels[key]}</h3>
                            <strong className="sheet-ability-modifier">
                                {derived?.abilityModifiers?.[key] === undefined
                                    ? '…'
                                    : signed(derived.abilityModifiers[key]!)}
                            </strong>
                            <small>Модификатор</small>
                            <div className="sheet-counter">
                                <button
                                    type="button"
                                    aria-label={`Уменьшить: ${abilityLabels[key]}`}
                                    disabled={r.scores[key] <= 1}
                                    onClick={() =>
                                        onChange({
                                            ...r,
                                            scores: { ...r.scores, [key]: r.scores[key] - 1 },
                                        })
                                    }
                                >
                                    −
                                </button>
                                <input
                                    aria-label={abilityLabels[key]}
                                    type="number"
                                    min={1}
                                    max={30}
                                    value={r.scores[key]}
                                    onChange={(e) =>
                                        onChange({
                                            ...r,
                                            scores: { ...r.scores, [key]: Number(e.target.value) },
                                        })
                                    }
                                />
                                <button
                                    type="button"
                                    aria-label={`Увеличить: ${abilityLabels[key]}`}
                                    disabled={r.scores[key] >= 30}
                                    onClick={() =>
                                        onChange({
                                            ...r,
                                            scores: { ...r.scores, [key]: r.scores[key] + 1 },
                                        })
                                    }
                                >
                                    +
                                </button>
                            </div>
                        </article>
                    ))}
                </div>
            ) : (
                <>
                    <h3>Спасброски</h3>
                    <div className="sheet-saves">
                        {keys.map((key) => (
                            <div className="sheet-check" key={key}>
                                <span>
                                    <b>{abilityLabels[key]}</b>
                                    <small>{key.toUpperCase()}</small>
                                </span>
                                <button
                                    type="button"
                                    className="sheet-training"
                                    aria-label={`Владение спасброском: ${abilityLabels[key]}`}
                                    aria-pressed={r.saves[key].proficient}
                                    onClick={() =>
                                        onChange({
                                            ...r,
                                            saves: {
                                                ...r.saves,
                                                [key]: {
                                                    ...r.saves[key],
                                                    proficient: !r.saves[key].proficient,
                                                },
                                            },
                                        })
                                    }
                                >
                                    {r.saves[key].proficient ? '● Владение' : '○ Без владения'}
                                </button>
                                {bonus(`save_${key}`)}
                            </div>
                        ))}
                    </div>
                    <div className="sheet-skill-tools">
                        <h3>Навыки</h3>
                        <input
                            type="search"
                            aria-label="Найти навык"
                            placeholder="Найти навык…"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                        />
                        <button
                            type="button"
                            aria-pressed={trainedOnly}
                            onClick={() => setTrainedOnly(!trainedOnly)}
                        >
                            Только с владением
                        </button>
                    </div>
                    <p className="hint">
                        ○ без владения · ● владение · ◆ компетентность. Наведите на итоговый бонус,
                        чтобы увидеть его источники.
                    </p>
                    <div className="sheet-skills">
                        {definitions
                            .filter(
                                (d) =>
                                    d.name
                                        .toLocaleLowerCase()
                                        .includes(query.toLocaleLowerCase()) &&
                                    (!trainedOnly ||
                                        r.skills[d.key]?.proficient ||
                                        r.skills[d.key]?.expertise),
                            )
                            .map((d) => {
                                const skill = r.skills[d.key];
                                if (!skill) return null;
                                const rank = skill.expertise ? 2 : skill.proficient ? 1 : 0;
                                const ability = d.ability ?? skill.ability;
                                return (
                                    <div className="sheet-check" key={d.key}>
                                        <span>
                                            <b>{d.name}</b>
                                            <small>
                                                {ability
                                                    ? `${ability.toUpperCase()} · ${abilityLabels[ability]}`
                                                    : 'Особый навык'}
                                                {skill.bonus !== 0 ? ' · ручной бонус' : ''}
                                            </small>
                                        </span>
                                        <div
                                            className="rules-rank-chips"
                                            role="group"
                                            aria-label={`Владение: ${d.name}`}
                                        >
                                            {[0, 1, 2].map((n) => (
                                                <button
                                                    type="button"
                                                    key={n}
                                                    title={ranks[n]}
                                                    aria-label={`${d.name}: ${ranks[n]}`}
                                                    aria-pressed={rank === n}
                                                    onClick={() =>
                                                        onChange({
                                                            ...r,
                                                            skills: {
                                                                ...r.skills,
                                                                [d.key]: {
                                                                    ...skill,
                                                                    proficient: n > 0,
                                                                    expertise: n === 2,
                                                                },
                                                            },
                                                        })
                                                    }
                                                >
                                                    {['○', '●', '◆'][n]}
                                                </button>
                                            ))}
                                        </div>
                                        {bonus(d.key)}
                                    </div>
                                );
                            })}
                    </div>
                    {!definitions.some(
                        (d) =>
                            r.skills[d.key] &&
                            d.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()) &&
                            (!trainedOnly ||
                                r.skills[d.key].proficient ||
                                r.skills[d.key].expertise),
                    ) && <p className="hint">Навыки не найдены. Измените поиск или фильтр.</p>}
                </>
            )}
            <details className="sheet-advanced">
                <summary>
                    Advanced ·{' '}
                    {view === 'attributes'
                        ? 'бонус владения и ручные модификаторы'
                        : 'ручные бонусы навыков и спасбросков'}
                </summary>
                {view === 'attributes' ? (
                    <>
                        <label className="field">
                            Бонус владения
                            <input
                                aria-label="Бонус владения"
                                type="number"
                                min={0}
                                max={20}
                                value={r.proficiency_bonus}
                                onChange={(e) =>
                                    onChange({ ...r, proficiency_bonus: Number(e.target.value) })
                                }
                            />
                        </label>
                        <div className="sheet-manual-grid">
                            {(
                                [
                                    ['ac', 'AC'],
                                    ['speed', 'Скорость · ft'],
                                    ['spell_attack', 'Атака заклинанием'],
                                    ['spell_save_dc', 'Сл заклинаний'],
                                ] as const
                            ).map(([key, label]) => (
                                <label className="field" key={key}>
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
                    </>
                ) : (
                    <div className="sheet-manual-grid">
                        {definitions.map(
                            (d) =>
                                r.skills[d.key] && (
                                    <label className="field" key={d.key}>
                                        {d.name}
                                        <input
                                            aria-label={`Бонус: ${d.key}`}
                                            type="number"
                                            min={-100}
                                            max={100}
                                            value={r.skills[d.key].bonus}
                                            onChange={(e) =>
                                                onChange({
                                                    ...r,
                                                    skills: {
                                                        ...r.skills,
                                                        [d.key]: {
                                                            ...r.skills[d.key],
                                                            bonus: Number(e.target.value),
                                                        },
                                                    },
                                                })
                                            }
                                        />
                                    </label>
                                ),
                        )}
                        {keys.map((key) => (
                            <label className="field" key={key}>
                                Спасбросок · {abilityLabels[key]}
                                <input
                                    aria-label={`Бонус спасброска: ${abilityLabels[key]}`}
                                    type="number"
                                    min={-100}
                                    max={100}
                                    value={r.saves[key].bonus}
                                    onChange={(e) =>
                                        onChange({
                                            ...r,
                                            saves: {
                                                ...r.saves,
                                                [key]: {
                                                    ...r.saves[key],
                                                    bonus: Number(e.target.value),
                                                },
                                            },
                                        })
                                    }
                                />
                            </label>
                        ))}
                    </div>
                )}
            </details>
        </section>
    );
}
