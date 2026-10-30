import type { InventoryItem, ItemDefinition } from './model';
export interface ItemGameplay {
    source_key?: string | null;
    ammunition?: string | null;
    weapon?: {
        dice: string;
        damage_type: string;
        kind: 'melee' | 'ranged';
        category: string;
        properties: string[];
        mastery?: string | null;
        range?: { normal: number; long?: number | null; unit?: string } | null;
        throw_range?: { normal: number; long?: number | null } | null;
        versatile_dice?: string | null;
        ammunition?: string | null;
        attack_bonus?: number;
        damage_bonus?: number;
    } | null;
    armor?: {
        category: 'light_armor' | 'medium_armor' | 'heavy_armor' | 'shield';
        base_ac?: number | null;
        ac_bonus?: number | null;
        add_dex: boolean;
        max_dex_bonus?: number | null;
        strength_minimum?: number | null;
        stealth_disadvantage?: boolean;
        ac_semantics?: 'base' | 'bonus';
    } | null;
    use?: { consume: boolean; ability: import('../gameplay/model').Ability } | null;
}
export const itemCategories: Record<string, string> = {
    weapon: 'Оружие',
    armor: 'Броня',
    shield: 'Щит',
    ammunition: 'Боеприпасы',
    consumable: 'Расходник',
    adventuring_gear: 'Снаряжение',
    other: 'Прочее',
    scroll: 'Свиток',
    trinket: 'Особый предмет',
};
export const propertyLabels: Record<string, string> = {
    finesse: 'Фехтовальное',
    versatile: 'Универсальное',
    thrown: 'Метательное',
    two_handed: 'Двуручное',
    ammunition: 'Боеприпасы',
    loading: 'Заряжание',
    heavy: 'Тяжёлое',
    light: 'Лёгкое',
    reach: 'Досягаемость',
};
export function equipmentDropReason(
    i: InventoryItem,
    slot: string,
    items: InventoryItem[],
): string {
    if (i.quantity !== 1 || !i.definition.equipment_slots.includes(slot))
        return 'Предмет не подходит слоту';
    const equipped = items.filter((v) => v.id !== i.id && v.quantity > 0 && v.equipped_slot);
    const w = i.definition.gameplay?.weapon;
    if (
        slot === 'main_hand' &&
        (i.grip === 'two' || w?.properties.includes('two_handed')) &&
        equipped.some((v) => v.equipped_slot === 'off_hand')
    )
        return 'Освободите вторую руку';
    if (
        slot === 'off_hand' &&
        equipped.some(
            (v) =>
                v.equipped_slot === 'main_hand' &&
                (v.grip === 'two' ||
                    v.definition.gameplay?.weapon?.properties.includes('two_handed')),
        )
    )
        return 'Основное оружие занимает две руки';
    return '';
}
export function ItemFacts({
    definition: d,
    item,
}: {
    definition: ItemDefinition;
    item?: InventoryItem;
}) {
    const g = d.gameplay,
        w = g?.weapon,
        a = g?.armor;
    return (
        <div className="item-gameplay-facts">
            {w && (
                <>
                    <strong>
                        {w.category === 'martial'
                            ? 'Воинское'
                            : w.category === 'simple'
                              ? 'Простое'
                              : 'Особое'}{' '}
                        · {w.kind === 'ranged' ? 'дальнобойное' : 'рукопашное'} оружие
                    </strong>
                    <span>
                        {w.dice} · {w.damage_type}
                        {w.versatile_dice ? ` · Две руки: ${w.versatile_dice}` : ''}
                    </span>
                    {w.range && (
                        <span>
                            Дистанция {w.range.normal}
                            {w.range.long ? ` / ${w.range.long}` : ''} ft
                        </span>
                    )}
                    {w.throw_range && (
                        <span>
                            Бросок {w.throw_range.normal} /{' '}
                            {w.throw_range.long ?? w.throw_range.normal} ft
                        </span>
                    )}
                    <span>{w.properties.map((p) => propertyLabels[p] ?? p).join(' · ')}</span>
                    {w.ammunition && <span>Боеприпасы: {w.ammunition}</span>}
                    {w.mastery && (
                        <span title="Мастерство сохранено как справочная информация; автоматический эффект не применяется">
                            Мастерство: {w.mastery} · справочно
                        </span>
                    )}
                    {item && (
                        <span>
                            {item.weapon_proficient
                                ? 'Владение: подтверждено ГМ'
                                : 'Владение: бонус не назначен'}{' '}
                            · {item.grip === 'two' ? 'Две руки' : 'Одна рука'}
                        </span>
                    )}
                </>
            )}
            {a && (
                <>
                    <strong>
                        {a.category === 'shield'
                            ? 'Щит'
                            : a.category === 'light_armor'
                              ? 'Лёгкая броня'
                              : a.category === 'medium_armor'
                                ? 'Средняя броня'
                                : 'Тяжёлая броня'}
                    </strong>
                    <span>
                        {a.category === 'shield'
                            ? `+${a.ac_bonus} AC`
                            : `AC ${a.base_ac}${a.add_dex ? ` + ЛОВ${a.max_dex_bonus !== null && a.max_dex_bonus !== undefined ? ` (макс. ${a.max_dex_bonus})` : ''}` : ''}`}
                    </span>
                    {!!a.strength_minimum && (
                        <span>Сила {a.strength_minimum} · иначе скорость −10 ft</span>
                    )}
                    {a.stealth_disadvantage && <span>Помеха Скрытности</span>}
                    <small>Обучение броне подтверждает ГМ</small>
                </>
            )}
            {g?.ammunition && <span>Тип боеприпасов: {g.ammunition}</span>}
            {g?.use && (
                <span>
                    {g.use.consume ? 'Расходуется при применении' : 'Многоразовое применение'} ·{' '}
                    {
                        {
                            action: 'Действие',
                            bonus_action: 'Бонусное действие',
                            reaction: 'Реакция',
                            free: 'Без действия',
                        }[g.use.ability.activation ?? 'action']
                    }
                </span>
            )}
            {item?.action?.ammunition !== undefined && item.action.ammunition !== null && (
                <span>Осталось боеприпасов: {item.action.ammunition}</span>
            )}
            {g?.source_key && <small>Копия SRD · {g.source_key}</small>}
        </div>
    );
}
