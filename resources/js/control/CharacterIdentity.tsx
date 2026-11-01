import { UserRound } from 'lucide-react';
import type { Campaign } from '../api/workspace';
import { AssetPicker } from './AssetLibrary';
import type { Character } from '../tabletop/types/scene';
export function CharacterIdentity({
    draft,
    creating,
    patch,
}: {
    draft: Character;
    campaign: Campaign | null;
    creating: boolean;
    patch: (values: Partial<Character>) => void;
}) {
    return (
        <section className="control-identity">
            <div>
                <div className="control-identity-portrait">
                    {draft.portrait ? (
                        <img src={draft.portrait.url} alt="Портрет персонажа" />
                    ) : (
                        <UserRound size={60} />
                    )}
                </div>
                <p className="hint">Общий портрет персонажа и его токенов на сценах.</p>
            </div>
            <div>
                <label className="field">
                    <span>Имя персонажа</span>
                    <input
                        aria-label="Имя персонажа"
                        value={draft.name}
                        maxLength={80}
                        onChange={(e) => patch({ name: e.target.value })}
                    />
                </label>
                {!creating &&
                    (['species', 'background'] as const).map((key) => (
                        <label className="field" key={key}>
                            <span>{key === 'species' ? 'Вид / происхождение' : 'Предыстория'}</span>
                            <input
                                maxLength={key === 'species' ? 120 : 240}
                                value={draft.origin?.[key] ?? ''}
                                onChange={(e) =>
                                    patch({
                                        origin: {
                                            ...draft.origin,
                                            [key]: e.target.value,
                                        },
                                    })
                                }
                            />
                        </label>
                    ))}
                <AssetPicker
                    value={draft.portrait}
                    label="Выбрать портрет / токен"
                    onChange={(a) => patch({ portrait: a })}
                />
                <button
                    type="button"
                    className="quiet-button"
                    onClick={() => patch({ portrait: null })}
                >
                    Без портрета
                </button>
            </div>
        </section>
    );
}
