import { useEffect, useState } from 'react';
import { Plus, Users } from 'lucide-react';
import { request } from '../../api/client';
import type { Character } from '../../tabletop/types/scene';
import type { Placement } from './model';

export function SceneActorLibrary({
    campaignId,
    kind,
    onPlace,
}: {
    campaignId: string;
    kind: 'characters' | 'npcs';
    onPlace: (item: Placement) => void;
}) {
    const [actors, setActors] = useState<Character[]>();
    const [search, setSearch] = useState(''),
        [error, setError] = useState('');
    useEffect(() => {
        const abort = new AbortController();
        const paths =
            kind === 'npcs'
                ? ['/library/npcs']
                : ['/library/characters', `/campaigns/${campaignId}/characters`];
        void Promise.all(
            paths.map((path) =>
                request<{ characters: Character[] }>(path, 'GET', undefined, abort.signal),
            ),
        )
            .then((results) => {
                if (!abort.signal.aborted)
                    setActors([
                        ...new Map(
                            results
                                .flatMap((r) => r.characters)
                                .filter((c) => kind === 'npcs' || c.kind === 'player_character')
                                .map((c) => [c.id, c]),
                        ).values(),
                    ]);
            })
            .catch((e) => {
                if (!abort.signal.aborted) setError(e.message);
            });
        return () => abort.abort();
    }, [campaignId, kind]);
    const filtered = actors?.filter((c) =>
        c.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
    );
    return (
        <section
            className="character-browser"
            aria-label={kind === 'npcs' ? 'Глобальная NPC Library' : 'Глобальная Character Library'}
        >
            <h3>{kind === 'npcs' ? 'NPC Library' : 'Characters Library'}</h3>
            <p className="hint">
                {kind === 'npcs'
                    ? 'Каждое размещение — независимый NPC. Шаблон в библиотеке не меняется.'
                    : 'Герои этой кампании используют общее состояние. Остальные добавляются независимыми копиями; исходный герой остаётся в библиотеке.'}
            </p>
            <label className="field">
                <span>Поиск по имени</span>
                <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
            </label>
            {error && (
                <p className="form-error" role="alert">
                    {error}
                </p>
            )}
            {!actors && !error && <p role="status">Загружаем библиотеку…</p>}
            {filtered?.map((c) => (
                <div className="character-browser-row" key={c.id}>
                    <span className="actor-portrait">
                        {c.portrait ? <img src={c.portrait.url} alt="" /> : <Users size={20} />}
                    </span>
                    <div>
                        <strong>{c.name}</strong>
                        <small>
                            {c.hp}/{c.maxHp} HP ·{' '}
                            {kind === 'npcs' || c.campaignId !== campaignId
                                ? 'Независимая копия'
                                : 'Герой кампании'}
                        </small>
                    </div>
                    <button
                        className="secondary-button"
                        onClick={() =>
                            onPlace({
                                type: 'libraryActor',
                                name: c.name,
                                actorId: c.id,
                                library: kind,
                            })
                        }
                    >
                        <Plus size={14} /> На сцену
                    </button>
                </div>
            ))}
            {filtered?.length === 0 && (
                <p className="hint">{search ? 'Никого не найдено.' : 'Библиотека пока пуста.'}</p>
            )}
            <a className="text-button" href={`/control/${kind}`}>
                Открыть глобальную библиотеку
            </a>
        </section>
    );
}
