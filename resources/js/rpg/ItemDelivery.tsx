import { useEffect, useState } from 'react';
import type { Character } from '../tabletop/types/scene';
import type { ItemDefinition } from './model';
import { inventoryApi } from './model';
import { lootApi } from './loot';
import { request } from '../api/client';
export function ItemDelivery({
    campaign,
    definition,
    characters,
}: {
    campaign: string;
    definition: ItemDefinition;
    characters: Character[];
}) {
    const [character, setCharacter] = useState(''),
        [container, setContainer] = useState(''),
        [quantity, setQuantity] = useState(1),
        [proficient, setProficient] = useState(false),
        [containers, setContainers] = useState<{ id: string; name: string }[]>([]),
        [busy, setBusy] = useState(false),
        [message, setMessage] = useState('');
    useEffect(() => {
        const c = new AbortController();
        void request<{ containers: { id: string; name: string }[] }>(
            `/campaigns/${campaign}/loot/catalog`,
            'GET',
            undefined,
            c.signal,
        )
            .then((r) => {
                if (!c.signal.aborted) setContainers(r.containers);
            })
            .catch(() => {});
        return () => c.abort();
    }, [campaign]);
    const give = async (to: 'character' | 'container') => {
        setBusy(true);
        try {
            if (to === 'character')
                await inventoryApi.command(campaign, character, {
                    action: 'give',
                    definitionId: definition.id,
                    quantity,
                    weapon_proficient: proficient,
                });
            else
                await lootApi.command(campaign, {
                    action: 'give',
                    containerId: container,
                    definitionId: definition.id,
                    quantity,
                });
            setMessage('Предметы переданы.');
        } catch (e) {
            setMessage((e as Error).message);
        } finally {
            setBusy(false);
        }
    };
    return (
        <section className="item-delivery">
            <strong>{definition.name} · экземпляры</strong>
            <label>
                Количество
                <input
                    type="number"
                    min={1}
                    max={999}
                    value={quantity}
                    onChange={(e) =>
                        setQuantity(Math.max(1, Math.min(999, Number(e.target.value))))
                    }
                />
            </label>
            <label>
                Персонаж
                <select value={character} onChange={(e) => setCharacter(e.target.value)}>
                    <option value="">Выберите персонажа</option>
                    {characters.map((c) => (
                        <option key={c.id} value={c.id}>
                            {c.name}
                        </option>
                    ))}
                </select>
            </label>
            {definition.gameplay?.weapon && (
                <label>
                    <input
                        type="checkbox"
                        checked={proficient}
                        onChange={(e) => setProficient(e.target.checked)}
                    />
                    Подтвердить владение оружием
                </label>
            )}
            <button disabled={busy || !character} onClick={() => void give('character')}>
                Выдать персонажу
            </button>
            <label>
                Контейнер
                <select value={container} onChange={(e) => setContainer(e.target.value)}>
                    <option value="">Подготовленный контейнер</option>
                    {containers.map((c) => (
                        <option key={c.id} value={c.id}>
                            {c.name}
                        </option>
                    ))}
                </select>
            </label>
            <button disabled={busy || !container} onClick={() => void give('container')}>
                Положить в контейнер
            </button>
            {message && <p role="status">{message}</p>}
        </section>
    );
}
