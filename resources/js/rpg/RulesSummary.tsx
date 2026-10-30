import type { Character } from '../tabletop/types/scene';
import { abilityLabels, breakdownLabel, signed, type AbilityKey } from './rules';

export function RulesSummary({ character: c }: { character: Character }) {
    const d = c.derived;
    if (!c.rules || !d)
        return (
            <div className="character-checks">
                {c.checkStats.map((s) => (
                    <span key={s.key}>
                        <small>{s.label}</small>
                        <strong>{signed(s.modifier)}</strong>
                    </span>
                ))}
            </div>
        );
    const keys = Object.keys(abilityLabels) as AbilityKey[];
    const skills = d.checks.filter((s) => s.key in c.rules!.skills);
    const custom = d.checks.filter((s) => !s.ability);
    return (
        <section className="character-rules-summary" aria-label="Правила персонажа">
            <div className="rules-core-stats">
                <span title="Сохранённое состояние персонажа">
                    HP{' '}
                    <strong>
                        {d.hp} / {d.maxHp}
                    </strong>
                </span>
                <span title={breakdownLabel(d.coreBreakdown.ac)}>
                    AC <strong>{d.ac ?? '—'}</strong>
                </span>
                <span title={breakdownLabel(d.coreBreakdown.speed)}>
                    Скорость{' '}
                    <strong>
                        {d.speed ?? '—'} {d.speedUnit ?? 'ft'}
                    </strong>
                </span>
                <span>
                    Владение <strong>{signed(d.proficiencyBonus ?? 0)}</strong>
                </span>
            </div>
            {d.catalog?.ready === false && (
                <p className="hint">Навыки SRD пока недоступны в локальном компендии.</p>
            )}
            <div className="rules-ability-grid">
                {keys.map((key) => {
                    const stat = d.checks.find((s) => s.key === key);
                    return (
                        <div key={key} title={stat ? breakdownLabel(stat.breakdown) : ''}>
                            <small>{abilityLabels[key]}</small>
                            <b>{c.rules!.scores[key]}</b>
                            <strong>
                                {d.abilityModifiers?.[key] !== undefined
                                    ? signed(d.abilityModifiers[key]!)
                                    : stat
                                      ? signed(stat.modifier)
                                      : '—'}
                            </strong>
                        </div>
                    );
                })}
            </div>
            <p className="rules-proficiency">
                Бонус владения <strong>{signed(d.proficiencyBonus ?? 0)}</strong>
            </p>
            <h3>Навыки</h3>
            <div className="rules-skill-list">
                {skills.map((s) => (
                    <div key={s.key} title={breakdownLabel(s.breakdown)}>
                        <span
                            className="rules-rank"
                            aria-label={
                                s.expertise
                                    ? 'Компетентность'
                                    : s.proficient
                                      ? 'Владение'
                                      : 'Без владения'
                            }
                        >
                            {s.expertise ? '◆' : s.proficient ? '●' : '○'}
                        </span>
                        <span>
                            {s.label}
                            <small>{s.ability?.toUpperCase()}</small>
                        </span>
                        <strong>{signed(s.modifier)}</strong>
                    </div>
                ))}
            </div>
            <h3>Спасброски</h3>
            <div className="rules-save-grid">
                {keys.map((key) => {
                    const s = d.checks.find((s) => s.key === `save_${key}`);
                    return (
                        <span key={key} title={s ? breakdownLabel(s.breakdown) : ''}>
                            {s?.proficient ? '●' : '○'} {key.toUpperCase()}{' '}
                            <b>{s ? signed(s.modifier) : '—'}</b>
                        </span>
                    );
                })}
            </div>
            {d.spellcasting && (
                <div
                    className="rules-spellcasting"
                    title={breakdownLabel(d.spellcasting.breakdown)}
                >
                    <h3>Магия · {abilityLabels[d.spellcasting.ability]}</h3>
                    <span>
                        Атака <strong>{signed(d.spellcasting.attackBonus)}</strong>
                    </span>
                    <span
                        title={breakdownLabel(
                            d.spellcasting.saveBreakdown ?? d.spellcasting.breakdown,
                        )}
                    >
                        Сложность спасброска <strong>{d.spellcasting.saveDc}</strong>
                    </span>
                </div>
            )}
            {custom.length > 0 && (
                <details>
                    <summary>Особые проверки</summary>
                    {custom.map((s) => (
                        <p key={s.key} title={breakdownLabel(s.breakdown)}>
                            {s.label} <b>{signed(s.modifier)}</b>
                        </p>
                    ))}
                </details>
            )}
        </section>
    );
}
