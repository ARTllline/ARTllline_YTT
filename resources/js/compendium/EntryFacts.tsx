import type { ReactNode } from 'react';
import type { Ability } from '../gameplay/model';
import type { ItemDefinition } from '../rpg/model';
import { propertyLabels } from '../rpg/itemGameplay';
import {
    abilityLabels,
    ammunitionLabel,
    damageLabel,
    masteryLabel,
    spellRange,
    timeLabel,
} from './presentation';

export function FactGrid({ facts }: { facts: [string, ReactNode][] }) {
    return (
        <dl className="catalog-stat-grid">
            {facts.map(([label, value]) => (
                <div
                    key={label}
                    className={
                        typeof value === 'string' && value.length > 70 ? 'is-wide' : undefined
                    }
                >
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                </div>
            ))}
        </dl>
    );
}

export function ItemMechanics({ definition: d }: { definition: ItemDefinition }) {
    const g = d.content?.gates.execute === false ? undefined : d.gameplay,
        w = g?.weapon,
        a = g?.armor;
    const facts: [string, ReactNode][] = [];
    if (w) {
        facts.push(
            ['Урон', `${w.dice} · ${damageLabel(w.damage_type)}`],
            ['Тип атаки', w.kind === 'melee' ? 'Ближний бой' : 'Дальний бой'],
        );
        facts.push([
            'Категория оружия',
            ({ simple: 'Простое', martial: 'Воинское' } as Record<string, string>)[w.category] ??
                w.category,
        ]);
        if (w.versatile_dice) facts.push(['Две руки', w.versatile_dice]);
        if (w.range)
            facts.push([
                'Дистанция',
                `${w.range.normal}${w.range.long ? ` / ${w.range.long}` : ''} ${!w.range.unit || ['ft', 'feet'].includes(w.range.unit) ? 'фут.' : w.range.unit}`,
            ]);
        if (w.throw_range)
            facts.push([
                'Метание',
                `${w.throw_range.normal}${w.throw_range.long ? ` / ${w.throw_range.long}` : ''} фут.`,
            ]);
        if (w.attack_bonus)
            facts.push(['Бонус атаки', `${w.attack_bonus > 0 ? '+' : ''}${w.attack_bonus}`]);
        if (w.damage_bonus)
            facts.push(['Бонус урона', `${w.damage_bonus > 0 ? '+' : ''}${w.damage_bonus}`]);
    }
    if (a) {
        facts.push([
            'Класс доспеха',
            a.category === 'shield'
                ? `+${a.ac_bonus} КД`
                : `${a.base_ac}${a.add_dex ? ` + ЛОВ${a.max_dex_bonus != null ? ` (макс. ${a.max_dex_bonus})` : ''}` : ''}`,
        ]);
        if (a.strength_minimum) facts.push(['Требование силы', a.strength_minimum]);
        if (a.stealth_disadvantage) facts.push(['Скрытность', 'С помехой']);
    }
    if (d.modifiers.ac)
        facts.push(['Бонус защиты', `${d.modifiers.ac > 0 ? '+' : ''}${d.modifiers.ac} КД`]);
    if (d.modifiers.speed)
        facts.push(['Скорость', `${d.modifiers.speed > 0 ? '+' : ''}${d.modifiers.speed} фут.`]);
    if (g?.use) {
        const ability = g.use.ability;
        facts.push(
            [
                'Применение',
                timeLabel(
                    {
                        action: 'Action',
                        bonus_action: 'Bonus Action',
                        reaction: 'Reaction',
                        free: 'Free',
                    }[ability.activation ?? 'action'],
                ),
            ],
            ['Расход', g.use.consume ? 'Один экземпляр' : 'Не расходуется'],
        );
        if (ability.result?.type === 'heal')
            facts.push(['Лечение', ability.result.dice || ability.result.amount]);
    }
    return (
        <>
            {!!facts.length && <FactGrid facts={facts} />}
            {!!w?.properties.length && (
                <div className="catalog-traits" aria-label="Свойства оружия">
                    {w.properties.map((p) => (
                        <span key={p}>{propertyLabels[p.replaceAll('-', '_')] ?? p}</span>
                    ))}
                </div>
            )}
            {w?.mastery && (
                <p className="hint">
                    Мастерство · {masteryLabel(w.mastery)}{' '}
                    <span className="catalog-reference-tag">Справочно</span>
                </p>
            )}
            {(w?.ammunition || g?.ammunition) && (
                <p>Боеприпасы · {ammunitionLabel(w?.ammunition || g?.ammunition || '')}</p>
            )}
            {!!d.modifiers.checks && (
                <p>
                    {Object.entries(d.modifiers.checks)
                        .map(([key, value]) => `${key}: ${value >= 0 ? '+' : ''}${value}`)
                        .join(' · ')}
                </p>
            )}
            {!facts.length && (
                <p className="hint">
                    Автоматические действия не заданы. Свойства из описания разрешает ГМ.
                </p>
            )}
        </>
    );
}

export function SpellCharacteristics({ ability: a }: { ability: Ability }) {
    return (
        <>
            <FactGrid
                facts={[
                    ['Накладывание', timeLabel(a.spell?.casting_time)],
                    ['Дистанция', spellRange(a)],
                    ['Длительность', timeLabel(a.spell?.duration_text)],
                    [
                        'Компоненты',
                        a.spell?.components
                            ?.map((c) => ({ V: 'В', S: 'С', M: 'М' })[c] ?? c)
                            .join(' · ') || '—',
                    ],
                ]}
            />
            {a.spell?.material && (
                <p className="catalog-material">
                    <span>Материалы</span>
                    {a.spell.material}
                </p>
            )}
            {(a.spell?.concentration || a.spell?.ritual) && (
                <div className="catalog-traits">
                    {a.spell.concentration && <span>Концентрация</span>}
                    {a.spell.ritual && <span>Ритуал</span>}
                </div>
            )}
        </>
    );
}

export function SpellResolutionFacts({ ability: a }: { ability: Ability }) {
    const facts: [string, ReactNode][] = [];
    if (a.save) {
        facts.push([
            'Спасбросок',
            `${abilityLabels[a.save.ability] ?? a.save.ability} · ${a.save.dc_source === 'fixed' ? `КС ${a.save.dc}` : 'КС заклинателя'}`,
        ]);
        facts.push([
            'При успехе',
            { negates: 'Без эффекта', half: 'Половина урона', full: 'Полный эффект' }[
                a.save.on_success
            ],
        ]);
    }
    if (a.attack)
        facts.push([
            'Бросок атаки',
            `${abilityLabels[a.attack.ability] ?? a.attack.ability}${a.attack.bonus ? ` ${a.attack.bonus > 0 ? '+' : ''}${a.attack.bonus}` : ''}`,
        ]);
    return facts.length ? <FactGrid facts={facts} /> : null;
}
