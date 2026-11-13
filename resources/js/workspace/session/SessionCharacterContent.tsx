import { useState } from 'react';
import { api } from '../../api/workspace';
import { ContentUsePanel, type ContentSelection } from '../../gameplay/ContentUsePanel';
import { RpgIcon } from '../../gameplay/RpgIcon';
import { useInventory } from '../../rpg/useInventory';
import type { SceneStore } from '../../tabletop/state/SceneStore';
import type { Character } from '../../tabletop/types/scene';

export function SessionCharacterContent({
    character,
    store,
    disabled,
}: {
    character: Character;
    store: SceneStore;
    disabled: boolean;
}) {
    const { scene } = store.getSnapshot();
    const inventory = useInventory(scene.campaignId!, character, () => {
        void api.snapshot(scene.id!).then((s) => store.reconcile(s));
    });
    const [selection, setSelection] = useState<ContentSelection | null>(null);
    const [tab, setTab] = useState('items');
    return (
        <details className="runtime-details-section">
            <summary>Инвентарь и книга заклинаний</summary>
            <div className="rpg-chips">
                <button aria-pressed={tab === 'items'} onClick={() => setTab('items')}>
                    Предметы
                </button>
                <button aria-pressed={tab === 'spells'} onClick={() => setTab('spells')}>
                    Заклинания
                </button>
            </div>
            {inventory.error && (
                <p role="alert">
                    {inventory.error}
                    <button onClick={inventory.retry}>Повторить</button>
                </p>
            )}
            <div className="session-content-list">
                {tab === 'items' ? (
                    !inventory.data ? (
                        <p role="status">Загрузка…</p>
                    ) : (
                        inventory.data.items
                            .filter((i) => i.quantity > 0)
                            .map((item) => (
                                <button
                                    key={item.id}
                                    disabled={
                                        disabled ||
                                        (!item.action?.ability &&
                                            item.definition.content?.gates.execute !== false)
                                    }
                                    onClick={() => setSelection({ item })}
                                >
                                    <RpgIcon icon={item.definition.icon} size={28} />
                                    <span>
                                        {item.definition.name} × {item.quantity}
                                    </span>
                                    <small>Использовать</small>
                                </button>
                            ))
                    )
                ) : (
                    character.abilities
                        ?.filter((a) => a.enabled && a.spell?.known)
                        .map((ability) => (
                            <button
                                key={ability.id}
                                disabled={disabled || !ability.spell?.prepared}
                                onClick={() => setSelection({ ability })}
                            >
                                <RpgIcon icon={ability.icon} size={28} />
                                <span>{ability.name}</span>
                                <small>Использовать</small>
                            </button>
                        ))
                )}
            </div>
            {selection && (
                <ContentUsePanel
                    selection={selection}
                    character={character}
                    store={store}
                    onClose={() => setSelection(null)}
                />
            )}
        </details>
    );
}
