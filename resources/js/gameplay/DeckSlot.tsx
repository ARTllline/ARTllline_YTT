import { Plus, X } from 'lucide-react';
import type { Ability, CharacterResource } from './model';
import { canAfford } from './model';
import { abilityBinding } from './hotbarModel';
import type { GameplayDrag } from './useGameplayDrag';
import { AbilityCost } from './AbilityCost';
import { RpgIcon } from './RpgIcon';

export function DeckSlot({
    ability: a,
    index,
    resources,
    drag,
    edit,
    selected,
    disabled,
    worldAvailable,
    shortcutActive,
    onClear,
    onPick,
    onChoose,
}: {
    ability?: Ability;
    index: number;
    resources: CharacterResource[];
    drag: GameplayDrag;
    edit: boolean;
    selected?: string;
    disabled: boolean;
    worldAvailable: boolean;
    shortcutActive: boolean;
    onClear: () => void;
    onPick: () => void;
    onChoose: (a: Ability) => void;
}) {
    const missing =
        a?.costs.filter((c) => (resources.find((r) => r.key === c.key)?.current ?? 0) < c.amount) ??
        [];
    const unavailable =
        a &&
        (disabled ||
            !canAfford(a, resources) ||
            (!worldAvailable && ['token', 'prop', 'point'].includes(a.target)));
    const reason = missing.length
        ? `Недостаточно: ${missing.map((c) => resources.find((r) => r.key === c.key)?.label ?? c.key).join(', ')}`
        : !worldAvailable && a && ['token', 'prop', 'point'].includes(a.target)
          ? 'Нужен токен персонажа на сцене'
          : disabled
            ? 'Действие сейчас недоступно'
            : '';
    const key = shortcutActive ? `${index % 16 >= 8 ? '⇧' : ''}${(index % 8) + 1}` : `${index + 1}`;
    return (
        <div
            className={`rpg-slot ${drag.over === index ? 'is-drop-target' : ''} ${a && drag.lifted === a.id ? 'is-lifted' : ''} ${drag.dropped === index ? 'is-settling' : ''}`}
            data-hotbar-slot={index}
            {...drag.destination(index)}
        >
            <button
                aria-label={a?.name ?? `Пустая ячейка ${index + 1}`}
                aria-pressed={!!a && selected === a.id}
                aria-disabled={!edit && !!unavailable}
                className={!edit && unavailable ? 'is-unavailable' : ''}
                aria-describedby={`deck-tip-${index}`}
                {...(a ? drag.source(abilityBinding(a.id)) : {})}
                onKeyDown={(e) => {
                    if (a && ['Delete', 'Backspace'].includes(e.key)) {
                        e.preventDefault();
                        e.stopPropagation();
                        onClear();
                    }
                }}
                onClick={() => {
                    if (drag.consumeClick()) return;
                    if (!a || edit) onPick();
                    else if (!unavailable) onChoose(a);
                }}
            >
                <span
                    className="slot-key"
                    title={`Ячейка ${index + 1} · ${index % 16 >= 8 ? 'Shift + ' : ''}${(index % 8) + 1}`}
                >
                    {key}
                </span>
                {a ? (
                    <>
                        <RpgIcon icon={a.icon} size={64} />
                        <AbilityCost ability={a} resources={resources} />
                    </>
                ) : (
                    <Plus size={18} />
                )}
                {!!unavailable && !edit && (
                    <span className="slot-unavailable-mark" aria-hidden="true">
                        ×
                    </span>
                )}
            </button>
            {edit && a && (
                <button
                    className="slot-remove"
                    aria-label={`Убрать ${a.name} из панели`}
                    onClick={onClear}
                >
                    <X size={12} />
                </button>
            )}
            <div className="rpg-slot-tooltip" role="tooltip" id={`deck-tip-${index}`}>
                <strong>{a?.name ?? `Ячейка ${index + 1}`}</strong>
                {a ? (
                    <>
                        <span>{a.description}</span>
                        <AbilityCost ability={a} resources={resources} />
                        {reason && <em>{reason}</em>}
                        <small>Удерживайте и перетащите · Delete убирает из панели</small>
                    </>
                ) : (
                    <span>Перетащите способность сюда или нажмите для выбора.</span>
                )}
            </div>
        </div>
    );
}
