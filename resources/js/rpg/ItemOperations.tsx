import { useState } from 'react';
import type { InventoryItem, InventoryState } from './model';
import type { InventoryHook } from './useInventory';
export function ItemOperations({
    item,
    state,
    send,
    busy,
}: {
    item: InventoryItem;
    state: InventoryState;
    send: InventoryHook['send'];
    busy: boolean;
}) {
    const [quantity, setQuantity] = useState(1),
        [recipient, setRecipient] = useState('');
    const w = item.definition.gameplay?.weapon;
    return (
        <div className="item-operations">
            {w && (
                <>
                    <label>
                        Хват
                        <select
                            disabled={busy}
                            value={item.grip ?? 'one'}
                            onChange={(e) =>
                                void send({
                                    action: 'configure',
                                    itemId: item.id,
                                    grip: e.target.value,
                                })
                            }
                        >
                            <option value="one">Одна рука</option>
                            {(w.properties.includes('versatile') ||
                                w.properties.includes('two_handed')) && (
                                <option value="two">Две руки</option>
                            )}
                        </select>
                    </label>
                    {w.properties.includes('finesse') && (
                        <label>
                            Характеристика
                            <select
                                disabled={busy}
                                value={item.attack_ability ?? 'auto'}
                                onChange={(e) =>
                                    void send({
                                        action: 'configure',
                                        itemId: item.id,
                                        attack_ability: e.target.value,
                                    })
                                }
                            >
                                <option value="auto">Лучшая СИЛ / ЛОВ</option>
                                <option value="str">Сила</option>
                                <option value="dex">Ловкость</option>
                            </select>
                        </label>
                    )}
                </>
            )}
            <details>
                <summary>Передать или сбросить</summary>
                <label>
                    Количество
                    <input
                        type="number"
                        min={1}
                        max={item.quantity}
                        value={Math.min(quantity, item.quantity)}
                        onChange={(e) =>
                            setQuantity(
                                Math.max(1, Math.min(item.quantity, Number(e.target.value))),
                            )
                        }
                    />
                </label>
                <label>
                    Получатель
                    <select value={recipient} onChange={(e) => setRecipient(e.target.value)}>
                        <option value="">Выберите персонажа</option>
                        {state.recipients?.map((c) => (
                            <option key={c.id} value={c.id}>
                                {c.name}
                            </option>
                        ))}
                    </select>
                </label>
                <button
                    disabled={busy || !recipient || item.quantity < 1}
                    onClick={() =>
                        void send({
                            action: 'transfer',
                            itemId: item.id,
                            recipientId: Number(recipient),
                            quantity: Math.min(quantity, item.quantity),
                        })
                    }
                >
                    Передать
                </button>
                <button
                    disabled={busy || item.quantity < 1}
                    onClick={() =>
                        void send({
                            action: 'drop',
                            itemId: item.id,
                            quantity: Math.min(quantity, item.quantity),
                        })
                    }
                >
                    Сбросить у токена
                </button>
            </details>
        </div>
    );
}
