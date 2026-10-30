import { useEffect, useState } from 'react';
import type { Character } from '../tabletop/types/scene';
import { RpgIcon } from '../gameplay/RpgIcon';
import { inventoryApi, type ItemDefinition } from './model';
import { useInventory } from './useInventory';
const slots: Record<string, string> = {
    head: 'Голова',
    armor: 'Доспех',
    cloak: 'Плащ',
    gloves: 'Перчатки',
    boots: 'Сапоги',
    amulet: 'Амулет',
    ring_1: 'Кольцо I',
    ring_2: 'Кольцо II',
    main_hand: 'Основная рука',
    off_hand: 'Вторая рука',
    ranged: 'Дальний бой',
};
const icons = [
    'item_sword',
    'item_shield',
    'item_potion',
    'item_scroll',
    'item_armor',
    'item_boots',
    'item_helmet',
    'item_ring',
    'item_amulet',
    'item_cloak',
    'item_gloves',
];
const empty: Omit<ItemDefinition, 'id'> = {
    name: 'Новый предмет',
    icon: 'item_sword',
    description: '',
    category: 'weapon',
    rarity: 'common',
    width: 1,
    height: 1,
    max_stack: 1,
    equipment_slots: ['main_hand'],
    modifiers: {},
    use_ability_id: null,
};
export function ItemAuthoring({
    campaignId,
    character,
}: {
    campaignId: string;
    character: Character;
}) {
    const [catalog, setCatalog] = useState<ItemDefinition[]>([]),
        [draft, setDraft] = useState<Partial<ItemDefinition> | null>(null),
        [quantity, setQuantity] = useState(1),
        [error, setError] = useState(''),
        [saving, setSaving] = useState(false);
    const inventory = useInventory(campaignId, character, () => {});
    useEffect(() => {
        let alive = true;
        void inventoryApi
            .definitions(campaignId)
            .then((r) => {
                if (alive) setCatalog(r.definitions);
            })
            .catch((e) => {
                if (alive) setError(e.message);
            });
        return () => {
            alive = false;
        };
    }, [campaignId]);
    const patch = (v: Partial<ItemDefinition>) => setDraft((d) => ({ ...d, ...v }));
    const save = async () => {
        if (!draft) return;
        setSaving(true);
        setError('');
        try {
            const r = await inventoryApi.save(campaignId, draft);
            setCatalog((list) => [...list.filter((d) => d.id !== r.definition.id), r.definition]);
            setDraft(null);
            void inventory.refresh();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setSaving(false);
        }
    };
    return (
        <details className="item-authoring">
            <summary>Предметы и снаряжение персонажа</summary>
            <p>Определения общие для кампании. Выданные экземпляры принадлежат этому персонажу.</p>
            {(error || inventory.error) && (
                <p className="error" role="alert">
                    {error || inventory.error}
                    <button type="button" onClick={inventory.retry}>
                        Повторить
                    </button>
                </p>
            )}
            <div className="gm-item-catalog">
                {catalog.map((d) => (
                    <article key={d.id}>
                        <button type="button" onClick={() => setDraft(d)}>
                            <RpgIcon icon={d.icon} size={48} />
                            <strong>{d.name}</strong>
                            <small>
                                {d.width}×{d.height}
                            </small>
                        </button>
                        <button
                            type="button"
                            disabled={inventory.busy}
                            onClick={() =>
                                void inventory.send({
                                    action: 'give',
                                    definitionId: d.id,
                                    quantity,
                                })
                            }
                        >
                            ＋ Выдать
                        </button>
                    </article>
                ))}
            </div>
            <label>
                Количество при выдаче
                <input
                    aria-label="Количество выдаваемых предметов"
                    type="number"
                    min={1}
                    max={99}
                    value={quantity}
                    onChange={(e) => setQuantity(Math.max(1, Math.min(99, Number(e.target.value))))}
                />
            </label>
            <button type="button" onClick={() => setDraft({ ...empty })}>
                ＋ Создать предмет
            </button>
            <div className="gm-held-items">
                {inventory.data?.items
                    .filter((i) => i.quantity > 0)
                    .map((i) => (
                        <span key={i.id}>
                            {i.definition.name} ×{i.quantity}
                            <button
                                type="button"
                                disabled={inventory.busy}
                                onClick={() =>
                                    void inventory.send({ action: 'remove', itemId: i.id })
                                }
                            >
                                Убрать
                            </button>
                        </span>
                    ))}
            </div>
            {draft && (
                <div className="gm-item-editor">
                    <div className="gm-item-preview">
                        <RpgIcon icon={draft.icon ?? 'item_sword'} size={88} />
                        <strong>{draft.name}</strong>
                        <small>
                            {draft.width} × {draft.height}
                        </small>
                    </div>
                    <label>
                        Название
                        <input
                            aria-label="Название предмета"
                            maxLength={80}
                            value={draft.name ?? ''}
                            onChange={(e) => patch({ name: e.target.value })}
                        />
                    </label>
                    <label>
                        Описание
                        <textarea
                            maxLength={1000}
                            value={draft.description ?? ''}
                            onChange={(e) => patch({ description: e.target.value })}
                        />
                    </label>
                    <div className="ability-icon-choices">
                        {icons.map((icon) => (
                            <button
                                type="button"
                                key={icon}
                                aria-label={`Предмет: ${icon}`}
                                aria-pressed={draft.icon === icon}
                                onClick={() => patch({ icon })}
                            >
                                <RpgIcon icon={icon} size={34} />
                            </button>
                        ))}
                    </div>
                    <div className="ability-type-chips">
                        {['weapon', 'armor', 'consumable', 'scroll', 'trinket'].map(
                            (category, i) => (
                                <button
                                    type="button"
                                    key={category}
                                    aria-pressed={draft.category === category}
                                    onClick={() => patch({ category })}
                                >
                                    {['Оружие', 'Броня', 'Расходник', 'Свиток', 'Артефакт'][i]}
                                </button>
                            ),
                        )}
                    </div>
                    <div className="ability-type-chips">
                        {['common', 'uncommon', 'rare', 'epic', 'legendary'].map((rarity, i) => (
                            <button
                                type="button"
                                key={rarity}
                                aria-pressed={draft.rarity === rarity}
                                onClick={() => patch({ rarity })}
                            >
                                {['Обычный', 'Необычный', 'Редкий', 'Эпический', 'Легендарный'][i]}
                            </button>
                        ))}
                    </div>
                    <div className="gameplay-form-row">
                        {(['max_stack'] as const).map((key) => (
                            <label key={key}>
                                В стопке
                                <input
                                    type="number"
                                    min={1}
                                    max={99}
                                    value={draft[key] ?? 1}
                                    onChange={(e) => patch({ [key]: Number(e.target.value) })}
                                />
                            </label>
                        ))}
                    </div>
                    <details>
                        <summary>Совместимость и бонусы</summary>
                        <div className="ability-type-chips">
                            {Object.entries(slots).map(([key, label]) => (
                                <button
                                    type="button"
                                    key={key}
                                    aria-pressed={draft.equipment_slots?.includes(key)}
                                    onClick={() =>
                                        patch({
                                            equipment_slots: draft.equipment_slots?.includes(key)
                                                ? draft.equipment_slots.filter((v) => v !== key)
                                                : [...(draft.equipment_slots ?? []), key],
                                        })
                                    }
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                        {(['ac', 'speed'] as const).map((key) => (
                            <label key={key}>
                                {key === 'ac' ? 'Бонус AC' : 'Бонус скорости'}
                                <input
                                    type="number"
                                    value={draft.modifiers?.[key] ?? 0}
                                    onChange={(e) =>
                                        patch({
                                            modifiers: {
                                                ...draft.modifiers,
                                                [key]: Number(e.target.value),
                                            },
                                        })
                                    }
                                />
                            </label>
                        ))}
                        {character.checkStats.map((s) => (
                            <label key={s.key}>
                                Бонус: {s.label}
                                <input
                                    type="number"
                                    min={-20}
                                    max={20}
                                    value={draft.modifiers?.checks?.[s.key] ?? 0}
                                    onChange={(e) =>
                                        patch({
                                            modifiers: {
                                                ...draft.modifiers,
                                                checks: {
                                                    ...draft.modifiers?.checks,
                                                    [s.key]: Number(e.target.value),
                                                },
                                            },
                                        })
                                    }
                                />
                            </label>
                        ))}
                    </details>
                    <details>
                        <summary>Действие при использовании</summary>
                        <div className="ability-type-chips">
                            <button
                                type="button"
                                aria-pressed={!draft.use_ability_id}
                                onClick={() => patch({ use_ability_id: null })}
                            >
                                Нет
                            </button>
                            {character.abilities?.map((a) => (
                                <button
                                    type="button"
                                    key={a.id}
                                    aria-pressed={draft.use_ability_id === a.id}
                                    onClick={() => patch({ use_ability_id: a.id })}
                                >
                                    {a.name}
                                    {a.item_only ? ' · предмет' : ''}
                                </button>
                            ))}
                        </div>
                        <p>
                            Для расходника создайте Ability «Только через предмет», чтобы её нельзя
                            было применить бесплатно.
                        </p>
                    </details>
                    <button type="button" disabled={saving} onClick={() => void save()}>
                        Сохранить предмет
                    </button>
                    <button type="button" disabled={saving} onClick={() => setDraft(null)}>
                        Отмена
                    </button>
                </div>
            )}
        </details>
    );
}
