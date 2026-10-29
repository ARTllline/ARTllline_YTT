import type { CharacterResource } from './model';
import { RpgIcon } from './RpgIcon';

export function ResourceRail({
    resources,
    onDetails,
}: {
    resources: CharacterResource[];
    onDetails: () => void;
}) {
    return (
        <div className="hud-resources" aria-label="Ресурсы персонажа">
            {resources.map((r) => (
                <button
                    key={r.key}
                    className={`hud-resource accent-${r.accent}`}
                    onClick={onDetails}
                    title={`${r.label}: ${r.current} / ${r.max}`}
                    aria-label={`${r.label}: ${r.current} из ${r.max}`}
                >
                    <RpgIcon icon={r.key === 'mana' ? 'mana' : r.icon} size={23} />
                    <span className="resource-heading">
                        <small className="resource-name">{r.label}</small>
                        <span className="resource-value" key={r.current}>
                            {r.current}
                            <small>/{r.max}</small>
                        </span>
                    </span>
                    {r.max <= 12 && (
                        <span
                            className={`resource-visual ${r.max <= 6 ? 'is-pips' : 'is-segments'}`}
                            aria-hidden="true"
                        >
                            {Array.from({ length: r.max }, (_, i) => (
                                <i className={i < r.current ? 'is-filled' : ''} key={i} />
                            ))}
                        </span>
                    )}
                </button>
            ))}
        </div>
    );
}
