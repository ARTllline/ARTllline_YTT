import {
    abilityLabels,
    signed,
    type AbilityKey,
    type CharacterRules,
    type DerivedCharacter,
} from '../rpg/rules';

export const standardArray = [15, 14, 13, 12, 10, 8];
export const pointCosts: Record<number, number> = {
    8: 0,
    9: 1,
    10: 2,
    11: 3,
    12: 4,
    13: 5,
    14: 7,
    15: 9,
};
export const pointRemaining = (scores: CharacterRules['scores']) =>
    27 - Object.values(scores).reduce((sum, score) => sum + (pointCosts[score] ?? Infinity), 0);
export const validArray = (scores: CharacterRules['scores']) =>
    Object.values(scores)
        .sort((a, b) => b - a)
        .join() === standardArray.join();
export type ScoreMethod = 'array' | 'point' | 'manual';

export function AbilityBuilder({
    rules,
    method,
    derived,
    onChange,
    onMethod,
}: {
    method: ScoreMethod;
    rules: CharacterRules;
    derived?: DerivedCharacter;
    onChange: (rules: CharacterRules) => void;
    onMethod: (method: ScoreMethod) => void;
}) {
    const keys = Object.keys(abilityLabels) as AbilityKey[];
    return (
        <section className="ability-builder">
            <h2>Распределите характеристики</h2>
            <p className="hint">
                Выберите подход к герою. Модификаторы рассчитывает сервер по правилам кампании.
            </p>
            <div className="builder-methods" role="group" aria-label="Метод характеристик">
                {(
                    [
                        ['array', 'Standard Array', '15 · 14 · 13 · 12 · 10 · 8'],
                        ['point', 'Point Buy', '27 очков · от 8 до 15'],
                        ['manual', 'Вручную', 'Advanced · от 1 до 30'],
                    ] as const
                ).map(([id, title, hint]) => (
                    <button
                        key={id}
                        aria-pressed={method === id}
                        onClick={() => {
                            onMethod(id);
                            onChange({
                                ...rules,
                                scores: Object.fromEntries(
                                    keys.map((key, i) => [
                                        key,
                                        id === 'array'
                                            ? standardArray[i]
                                            : id === 'point'
                                              ? 8
                                              : rules.scores[key],
                                    ]),
                                ) as CharacterRules['scores'],
                            });
                        }}
                    >
                        <strong>{title}</strong>
                        <small>{hint}</small>
                    </button>
                ))}
            </div>
            {method === 'array' && (
                <p>
                    Каждое значение используется один раз. Выбор занятого значения меняет
                    характеристики местами.
                </p>
            )}
            {method === 'point' && (
                <p role="status">
                    Осталось очков: <strong>{pointRemaining(rules.scores)} / 27</strong> · 14 стоит
                    7, 15 стоит 9 очков. Можно оставить очки нераспределёнными.
                </p>
            )}
            <div className="builder-scores">
                {keys.map((key) => (
                    <label key={key}>
                        <small>{key.toUpperCase()}</small>
                        <span>{abilityLabels[key]}</span>
                        {method === 'manual' ? (
                            <input
                                aria-label={abilityLabels[key]}
                                type="number"
                                min={1}
                                max={30}
                                value={rules.scores[key]}
                                onChange={(e) =>
                                    onChange({
                                        ...rules,
                                        scores: { ...rules.scores, [key]: Number(e.target.value) },
                                    })
                                }
                            />
                        ) : (
                            <select
                                aria-label={abilityLabels[key]}
                                value={rules.scores[key]}
                                onChange={(e) => {
                                    const value = Number(e.target.value);
                                    const scores = { ...rules.scores, [key]: value };
                                    if (method === 'array') {
                                        const other = keys.find(
                                            (k) => k !== key && rules.scores[k] === value,
                                        );
                                        if (other) scores[other] = rules.scores[key];
                                    }
                                    onChange({ ...rules, scores });
                                }}
                            >
                                {(method === 'array'
                                    ? standardArray
                                    : Object.keys(pointCosts).map(Number)
                                ).map((value) => (
                                    <option
                                        key={value}
                                        value={value}
                                        disabled={
                                            method === 'point' &&
                                            pointRemaining({ ...rules.scores, [key]: value }) < 0
                                        }
                                    >
                                        {value}
                                    </option>
                                ))}
                            </select>
                        )}
                        <strong>
                            {derived?.abilityModifiers?.[key] === undefined
                                ? '…'
                                : signed(derived.abilityModifiers[key]!)}
                        </strong>
                    </label>
                ))}
            </div>
        </section>
    );
}
