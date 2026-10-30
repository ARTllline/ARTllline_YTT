import type { Ability } from '../gameplay/model';
export function SpellMetadataEditor({
    ability,
    onChange,
}: {
    ability: Ability;
    onChange: (a: Partial<Ability>) => void;
}) {
    const spell = ability.spell;
    const patch = (v: Partial<NonNullable<Ability['spell']>>) =>
        onChange({
            spell: {
                level: 0,
                school: 'Воплощение',
                classes: [],
                known: true,
                prepared: true,
                ...spell,
                ...v,
            },
        });
    return (
        <details className="spell-metadata-editor">
            <summary>Книга заклинаний и предметы</summary>
            <label>
                <input
                    type="checkbox"
                    checked={!!spell}
                    onChange={(e) =>
                        onChange({
                            spell: e.target.checked
                                ? {
                                      level: 0,
                                      school: 'Воплощение',
                                      classes: [],
                                      known: true,
                                      prepared: true,
                                  }
                                : null,
                        })
                    }
                />{' '}
                Отображать как заклинание
            </label>
            {spell && (
                <>
                    <div className="ability-type-chips" aria-label="Круг заклинания">
                        {Array.from({ length: 10 }, (_, i) => (
                            <button
                                type="button"
                                key={i}
                                aria-pressed={spell.level === i}
                                onClick={() => patch({ level: i })}
                            >
                                {i === 0 ? 'Заговор' : i}
                            </button>
                        ))}
                    </div>
                    <label>
                        Школа
                        <input
                            maxLength={48}
                            value={spell.school}
                            onChange={(e) => patch({ school: e.target.value })}
                        />
                    </label>
                    <label>
                        Классы (через запятую)
                        <input
                            maxLength={180}
                            value={spell.classes.join(', ')}
                            onChange={(e) =>
                                patch({
                                    classes: e.target.value
                                        .split(',')
                                        .map((v) => v.trim())
                                        .filter(Boolean)
                                        .slice(0, 8),
                                })
                            }
                        />
                    </label>
                    <div className="ability-type-chips">
                        {(['known', 'prepared', 'ritual', 'concentration'] as const).map((k, i) => (
                            <button
                                key={k}
                                type="button"
                                aria-pressed={!!spell[k]}
                                onClick={() => patch({ [k]: !spell[k] })}
                            >
                                {['Известно', 'Подготовлено', 'Ритуал', 'Концентрация'][i]}
                            </button>
                        ))}
                    </div>
                </>
            )}
            <label>
                <input
                    type="checkbox"
                    checked={!!ability.item_only}
                    onChange={(e) => onChange({ item_only: e.target.checked })}
                />{' '}
                Только через предмет (нельзя применить отдельно)
            </label>
        </details>
    );
}
