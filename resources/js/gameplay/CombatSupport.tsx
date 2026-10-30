import { Footprints, Shield, Swords, Compass } from 'lucide-react';
import type { Character, Token } from '../tabletop/types/scene';
import { currentTokenId, type Combat } from '../tabletop/types/combat';

/** Read-only presentation of the existing player-filtered state. */
export function CombatSupport({
    character,
    actor,
    combat,
    disabled,
    onDetails,
}: {
    character: Character;
    actor?: Token;
    combat?: Combat | null;
    disabled: boolean;
    onDetails: () => void;
}) {
    const active = combat?.status === 'active';
    const speed =
        character.lifecycle && character.lifecycle.status !== 'alive' ? 0 : character.speed;
    const ownTurn = active && !!actor && currentTokenId(combat) === actor.id;
    const status = disabled
        ? 'Синхронизация…'
        : !actor
          ? 'Вне сцены'
          : ownTurn
            ? 'Ваш ход'
            : active
              ? 'Ожидание хода'
              : combat
                ? 'Подготовка боя'
                : 'Исследование';
    return (
        <aside
            className={`deck-combat-support ${ownTurn ? 'is-current' : ''}`}
            aria-label="Боевой контекст"
        >
            <span className="combat-context-heading">
                {active ? `РАУНД ${combat.round}` : actor ? 'НА СЦЕНЕ' : 'ГЕРОЙ'}
            </span>
            <button
                className="combat-defense"
                onClick={onDetails}
                aria-label={`Защита: ${character.ac ?? 'не задана'}`}
            >
                <Shield aria-hidden="true" />
                <span>
                    <small>ЗАЩИТА</small>
                    <strong>{character.ac ?? '—'}</strong>
                </span>
            </button>
            <span className="combat-movement" aria-label={`Скорость: ${speed ?? 'не задана'}`}>
                <Footprints size={14} />
                <strong>{speed ?? '—'}</strong>
                <small>скорость</small>
            </span>
            <div className="combat-context-state" role="status">
                {active ? <Swords size={14} /> : <Compass size={14} />}
                <span>{status}</span>
            </div>
        </aside>
    );
}
