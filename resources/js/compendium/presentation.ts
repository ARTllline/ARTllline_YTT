import type { Ability } from '../gameplay/model';
import type { ItemDefinition } from '../rpg/model';
import { itemCategories } from '../rpg/itemGameplay';

// Display-only vocabulary. Never write these labels back to domain/API values.
export const schoolLabels: Record<string, string> = {
    abjuration: 'Ограждение',
    conjuration: 'Вызов',
    divination: 'Прорицание',
    enchantment: 'Очарование',
    evocation: 'Воплощение',
    illusion: 'Иллюзия',
    necromancy: 'Некромантия',
    transmutation: 'Преобразование',
};
export const rarityLabels: Record<string, string> = {
    common: 'Обычный',
    uncommon: 'Необычный',
    rare: 'Редкий',
    epic: 'Эпический',
    very_rare: 'Очень редкий',
    legendary: 'Легендарный',
    artifact: 'Артефакт',
    varies: 'Зависит от варианта',
    unknown: 'Не указана',
};
const damageLabels: Record<string, string> = {
    acid: 'кислота',
    bludgeoning: 'дробящий',
    cold: 'холод',
    fire: 'огонь',
    force: 'силовое поле',
    lightning: 'электричество',
    necrotic: 'некротический',
    piercing: 'колющий',
    poison: 'яд',
    psychic: 'психический',
    radiant: 'излучение',
    slashing: 'рубящий',
    thunder: 'звуковой',
};
const masteryLabels: Record<string, string> = {
    cleave: 'Рассечение',
    graze: 'Скользящий удар',
    nick: 'Подрезание',
    push: 'Толчок',
    sap: 'Ослабление',
    slow: 'Замедление',
    topple: 'Опрокидывание',
    vex: 'Досаждение',
};
const ammunitionLabels: Record<string, string> = {
    arrow: 'Стрелы',
    arrows: 'Стрелы',
    bolt: 'Болты',
    bolts: 'Болты',
    sling_bullets: 'Пули для пращи',
    blowgun_needles: 'Иглы для духовой трубки',
};
const token = (value: string) => value.trim().toLowerCase().replaceAll('-', '_');
export const schoolLabel = (value: string) => schoolLabels[token(value)] ?? value;
export const damageLabel = (value: string) => damageLabels[token(value)] ?? value;
export const masteryLabel = (value: string) => masteryLabels[token(value)] ?? value;
export const ammunitionLabel = (value: string) => ammunitionLabels[token(value)] ?? value;
export const levelLabel = (level: number) => (level === 0 ? 'Заговор' : `Круг ${level}`);
export const abilityLabels: Record<string, string> = {
    str: 'СИЛ',
    dex: 'ЛОВ',
    con: 'ТЕЛ',
    int: 'ИНТ',
    wis: 'МДР',
    cha: 'ХАР',
    spellcasting: 'Характеристика заклинателя',
};

export function timeLabel(value?: string | null): string {
    if (!value) return 'По описанию';
    const fixed: Record<string, string> = {
        action: 'Действие',
        '1 action': 'Действие',
        'bonus action': 'Бонусное действие',
        '1 bonus action': 'Бонусное действие',
        reaction: 'Реакция',
        '1 reaction': 'Реакция',
        free: 'Без действия',
        instantaneous: 'Мгновенно',
        special: 'Особая',
        'until dispelled': 'До рассеивания',
        'until dispelled or triggered': 'До рассеивания или срабатывания',
    };
    const key = value.trim().toLowerCase();
    if (fixed[key]) return fixed[key];
    const match = key.match(
        /^(concentration,?\s*)?(up to\s*)?(\d+)\s+(rounds?|seconds?|minutes?|hours?|days?)$/,
    );
    if (!match) return value; // Unknown text/conditions remain verbatim, including rule prose.
    const [, concentration, upTo, count, unit] = match;
    const forms: Record<string, string[]> = {
        round: ['раунд', 'раунда', 'раундов'],
        second: ['секунда', 'секунды', 'секунд'],
        minute: ['минута', 'минуты', 'минут'],
        hour: ['час', 'часа', 'часов'],
        day: ['день', 'дня', 'дней'],
    };
    const n = Number(count),
        f = forms[unit.replace(/s$/, '')];
    const index =
        n % 100 >= 11 && n % 100 <= 14 ? 2 : n % 10 === 1 ? 0 : n % 10 >= 2 && n % 10 <= 4 ? 1 : 2;
    const noun = upTo ? (index === 0 ? f[1] : f[2]) : f[index];
    return `${concentration ? 'Концентрация, ' : ''}${upTo ? 'до ' : ''}${count} ${noun}`;
}

export function spellRange(a: Ability) {
    const source = a.spell?.content?.range_text;
    if (a.spell?.content?.gates.execute === false && source) {
        return (
            (
                { Self: 'На себя', Touch: 'Касание', Unlimited: 'Без ограничений' } as Record<
                    string,
                    string
                >
            )[source] ?? source.replace(/ feet$/, ' фут.')
        );
    }
    return a.target === 'self' ? 'На себя' : a.range ? `${a.range.normal} фут.` : 'По описанию';
}
export function spellSummary(a: Ability): string[] {
    const result = [timeLabel(a.spell?.casting_time), spellRange(a)];
    if (a.damage_components?.length)
        result.unshift(
            a.damage_components.map((c) => `${c.dice} ${damageLabel(c.type)}`).join(' + '),
        );
    else if (a.damage) result.unshift(a.damage);
    else if (a.result?.type === 'heal')
        result.unshift(`Лечение ${a.result.dice || a.result.amount}`);
    return result;
}
export function itemCategoryLabel(d: ItemDefinition): string {
    if (d.content?.gates.execute === false) {
        if (d.content.catalog_type === 'weapons') return 'Оружие · справочно';
        if (d.content.catalog_type === 'armor') return 'Доспехи и щиты · справочно';
        if (d.content.rarity_text) return 'Магический предмет';
    }
    return itemCategories[d.category] ?? d.category;
}
export function itemSummary(d: ItemDefinition): string[] {
    const g = d.gameplay;
    if (d.content?.gates.execute === false) return ['Справочный предмет', 'Решение ГМ'];
    if (g?.weapon)
        return [
            `${g.weapon.dice} · ${damageLabel(g.weapon.damage_type)}`,
            g.weapon.kind === 'ranged' ? 'Дальний бой' : 'Ближний бой',
        ];
    if (g?.armor)
        return [
            g.armor.category === 'shield'
                ? `+${g.armor.ac_bonus} КД`
                : `КД ${g.armor.base_ac}${g.armor.add_dex ? ' + ЛОВ' : ''}`,
            g.armor.stealth_disadvantage ? 'Помеха скрытности' : 'Защита',
        ];
    if (g?.use)
        return [
            g.use.ability.result?.type === 'heal'
                ? `Лечение ${g.use.ability.result.dice || g.use.ability.result.amount}`
                : 'Применение',
            timeLabel(
                {
                    action: 'Action',
                    bonus_action: 'Bonus Action',
                    reaction: 'Reaction',
                    free: 'Free',
                }[g.use.ability.activation ?? 'action'],
            ),
        ];
    if (d.modifiers.ac)
        return [`${d.modifiers.ac > 0 ? '+' : ''}${d.modifiers.ac} КД`, 'Модификатор'];
    if (g?.ammunition) return [ammunitionLabel(g.ammunition), `Стопка до ${d.max_stack}`];
    return [d.max_stack > 1 ? `Стопка до ${d.max_stack}` : 'В рюкзаке'];
}
