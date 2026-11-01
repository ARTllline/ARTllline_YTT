import type { Character } from '../tabletop/types/scene';
import type { Campaign } from '../api/workspace';
export function CharacterAccess({
    draft,
    campaign,
    patch,
}: {
    draft: Character;
    campaign: Campaign;
    patch: (values: Partial<Character>) => void;
}) {
    return (
        <section>
            {' '}
            <label className="field">
                <span>Игрок · доступ к персонажу</span>
                <select
                    aria-label="Игрок персонажа"
                    value={draft.ownerUserId ?? ''}
                    onChange={(e) => patch({ ownerUserId: e.target.value || null })}
                >
                    <option value="">Только GM</option>
                    {campaign.members
                        ?.filter((m) => m.role === 'player')
                        .map((m) => (
                            <option key={m.id} value={m.id}>
                                {m.name}
                            </option>
                        ))}
                </select>
            </label>
            <p className="hint">
                Назначенный игрок получает персонажа в HUD, инвентарь и доступные действия.
                Остальные игроки не получают его приватные данные.
            </p>
        </section>
    );
}
