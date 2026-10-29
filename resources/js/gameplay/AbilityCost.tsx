import type { Ability, CharacterResource } from './model';
import { RpgIcon } from './RpgIcon';

export function AbilityCost({
    ability,
    resources,
}: {
    ability: Ability;
    resources: CharacterResource[];
}) {
    return (
        <span className="slot-cost">
            {ability.costs.map((c) => {
                const r = resources.find((r) => r.key === c.key);
                return (
                    <span
                        key={c.key}
                        className={`accent-${r?.accent ?? 'violet'}`}
                        title={`${r?.label ?? c.key}: ${c.amount}`}
                    >
                        <RpgIcon
                            icon={r?.key === 'mana' ? 'mana' : (r?.icon ?? 'spark')}
                            size={17}
                        />
                        {c.amount}
                    </span>
                );
            })}
        </span>
    );
}
