import { useEffect, useState } from 'react';
import { CircleUserRound, Plus, Settings2 } from 'lucide-react';
import { api } from '../../api/workspace';
import { charactersApi } from '../../api/characters';
import type { Character } from '../../tabletop/types/scene';
import { CheckStatsEditor } from '../interactions/TokenCheckEditor';
import type { Placement } from './model';

export function CharacterBrowser({
    campaignId,
    onPlace,
}: {
    campaignId: string;
    onPlace: (item: Placement) => void;
}) {
    const [characters, setCharacters] = useState<Character[]>([]);
    const [members, setMembers] = useState<{ id: string; name: string; role: string }[]>([]);
    const [draft, setDraft] = useState<Character | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    useEffect(() => {
        const abort = new AbortController();
        void Promise.all([
            charactersApi.list(campaignId, abort.signal),
            api.campaign(campaignId, abort.signal),
        ])
            .then(([roster, campaign]) => {
                if (!abort.signal.aborted) {
                    setCharacters(roster.characters);
                    setMembers(campaign.members ?? []);
                    setLoading(false);
                }
            })
            .catch((e) => {
                if (!abort.signal.aborted) {
                    setError(e.message);
                    setLoading(false);
                }
            });
        return () => abort.abort();
    }, [campaignId]);
    const save = async () => {
        if (!draft) return;
        setBusy(true);
        setError('');
        try {
            const result = await charactersApi.save(campaignId, draft);
            setCharacters((all) =>
                all.map((c) => (c.id === result.character.id ? result.character : c)),
            );
            setDraft(null);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };
    return (
        <section className="character-browser" aria-label="Персонажи кампании">
            <h3>Персонажи кампании</h3>
            <p className="hint">
                Один персонаж — разные сцены. Имя, портрет, игрок, проверки и HP общие; положение и
                видимость независимы.
            </p>
            {loading && <p role="status">Загрузка персонажей…</p>}
            {error && (
                <p className="form-error" role="alert">
                    {error}
                </p>
            )}
            {!loading && !characters.length && (
                <p className="hint">
                    Создайте героя ниже. Затем его можно разместить в любой сцене.
                </p>
            )}
            {characters.map((c) => (
                <div className="character-browser-row" key={c.id}>
                    <span className="actor-portrait">
                        {c.portrait ? (
                            <img src={c.portrait.url} alt="" />
                        ) : (
                            <CircleUserRound size={20} />
                        )}
                    </span>
                    <div>
                        <strong>{c.name}</strong>
                        <small>
                            {members.find((m) => m.id === c.ownerUserId)?.name ??
                                'Игрок не назначен'}{' '}
                            · {c.hp}/{c.maxHp} HP
                        </small>
                    </div>
                    <button
                        className="icon-button"
                        aria-label={`Настроить ${c.name}`}
                        disabled={busy}
                        onClick={() => setDraft(c)}
                    >
                        <Settings2 size={15} />
                    </button>
                    <button
                        className="secondary-button"
                        disabled={busy}
                        onClick={() =>
                            onPlace({
                                type: 'token',
                                name: c.name,
                                draft: {
                                    characterId: c.id,
                                    name: c.name,
                                    hp: c.hp,
                                    kind: c.kind,
                                    disposition: c.disposition,
                                },
                            })
                        }
                    >
                        <Plus size={14} /> На сцену
                    </button>
                </div>
            ))}
            {draft && (
                <div className="character-editor">
                    <label className="field">
                        <span>Имя персонажа</span>
                        <input
                            aria-label="Имя персонажа"
                            value={draft.name}
                            maxLength={80}
                            disabled={busy}
                            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                        />
                    </label>
                    <label className="field">
                        <span>Игрок</span>
                        <select
                            aria-label="Игрок персонажа"
                            disabled={busy}
                            value={draft.ownerUserId ?? ''}
                            onChange={(e) =>
                                setDraft({ ...draft, ownerUserId: e.target.value || null })
                            }
                        >
                            <option value="">Не назначен</option>
                            {members
                                .filter((m) => m.role === 'player')
                                .map((m) => (
                                    <option value={m.id} key={m.id}>
                                        {m.name}
                                    </option>
                                ))}
                        </select>
                    </label>
                    <CheckStatsEditor
                        stats={draft.checkStats}
                        save={(checkStats) => setDraft({ ...draft, checkStats })}
                        disabled={busy}
                    />
                    <p className="hint">
                        Портрет и состояние меняются в Inspector размещённого токена; HP — через
                        существующие действия Combat.
                    </p>
                    <div className="button-row">
                        <button
                            className="primary-button"
                            disabled={busy || !draft.name.trim()}
                            onClick={() => void save()}
                        >
                            {busy ? 'Сохранение…' : 'Сохранить персонажа'}
                        </button>
                        <button
                            className="quiet-button"
                            disabled={busy}
                            onClick={() => setDraft(null)}
                        >
                            Отмена
                        </button>
                    </div>
                </div>
            )}
        </section>
    );
}
