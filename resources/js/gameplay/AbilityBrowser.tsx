import { Grip, X } from 'lucide-react';
import { useState } from 'react';
import type { Ability, CharacterResource } from './model';
import { abilityBinding } from './hotbarModel';
import type { GameplayDrag } from './useGameplayDrag';
import { AbilityCost } from './AbilityCost';
import { RpgIcon } from './RpgIcon';

const filters = {
    all: 'Все',
    attack: 'Атаки',
    spell: 'Заклинания',
    utility: 'Действия',
    check: 'Навыки',
};
export function AbilityBrowser({
    abilities,
    resources,
    drag,
    destination,
    onClose,
    onSelect,
    initialFilter,
}: {
    abilities: Ability[];
    resources: CharacterResource[];
    drag: GameplayDrag;
    destination: number | null;
    onClose: () => void;
    onSelect: (a: Ability) => void;
    initialFilter?: 'spell';
}) {
    const [filter, setFilter] = useState<keyof typeof filters>(initialFilter ?? 'all');
    const shown = abilities
        .filter((a) => !a.item_only)
        .filter(
            (a) =>
                filter === 'all' ||
                (filter === 'spell'
                    ? !!a.spell || a.attack_type === 'spell'
                    : filter === 'attack'
                      ? a.category === 'attack' && a.attack_type !== 'spell'
                      : filter === 'utility'
                        ? ['utility', 'effect'].includes(a.category)
                        : a.category === 'check'),
        );
    return (
        <section className="ability-browser" aria-label="Браузер способностей">
            <header>
                <div>
                    <span className="eyebrow">АРСЕНАЛ ПЕРСОНАЖА</span>
                    <h3>Способности</h3>
                </div>
                <button
                    className="icon-button"
                    aria-label="Закрыть браузер способностей"
                    onClick={onClose}
                >
                    <X size={18} />
                </button>
            </header>
            <div className="ability-filters" role="group" aria-label="Категории способностей">
                {Object.entries(filters).map(([k, label]) => (
                    <button
                        key={k}
                        aria-pressed={filter === k}
                        onClick={() => setFilter(k as keyof typeof filters)}
                    >
                        {label}
                    </button>
                ))}
            </div>
            <p>
                {destination !== null
                    ? `Выберите способность для ячейки ${destination + 1}`
                    : 'Перетащите на панель. Нажмите, чтобы применить.'}
            </p>
            <div className="ability-browser-grid">
                {shown.map((a) => (
                    <button
                        key={a.id}
                        className={drag.lifted === a.id ? 'is-lifted' : ''}
                        {...drag.source(abilityBinding(a.id))}
                        onClick={() => {
                            if (!drag.consumeClick()) onSelect(a);
                        }}
                        aria-label={`Способность: ${a.name}`}
                    >
                        <RpgIcon icon={a.icon} size={48} />
                        <strong>{a.name}</strong>
                        <small>{a.description}</small>
                        <AbilityCost ability={a} resources={resources} />
                        <span className="browser-drag-hint">
                            <Grip size={13} /> В панель
                        </span>
                    </button>
                ))}
            </div>
            {!shown.length && <p>В этой категории пока нет способностей.</p>}
        </section>
    );
}
