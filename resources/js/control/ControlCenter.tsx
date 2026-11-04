import { useEffect, useState } from 'react';
import { ObjectPresetLibrary } from '../workspace/maps/ObjectPresetLibrary';
import { ArrowLeft, ArrowUpRight, Box, Plus, Users, Heart, Shield, BookOpen } from 'lucide-react';
import { api, type CampaignSummary } from '../api/workspace';
import { charactersApi } from '../api/characters';
import type { Character } from '../tabletop/types/scene';
import { SpellLibrary } from './SpellLibrary';
import { ItemLibrary } from './ItemLibrary';
import { NpcLibrary } from './NpcLibrary';
import { AssetLibrary } from './AssetLibrary';
import { CharacterEditor } from './CharacterEditor';
import '../../css/control-center.css';

export function ControlCenter() {
    const base = '/control/characters';
    const assetsPage = location.pathname === '/control/assets';
    const npcsPage = location.pathname.startsWith('/control/npcs');
    const spellsPage = location.pathname === '/control/spells';
    const itemsPage = location.pathname === '/control/items';
    const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
    const [filter, setFilter] = useState(
        new URLSearchParams(location.search).get('campaign') ?? '',
    );
    const selected = location.pathname.match(/\/characters\/(new|\d+)$/)?.[1];
    const [characters, setCharacters] = useState<Character[] | null>(null);
    const [error, setError] = useState('');
    const [search, setSearch] = useState('');
    const load = () => {
        setError('');
        void charactersApi
            .library()
            .then((r) => setCharacters(r.characters))
            .catch((e) => setError(e.message));
    };
    useEffect(() => {
        const abort = new AbortController();
        void api
            .campaigns()
            .then((r) => {
                if (!abort.signal.aborted) setCampaigns(r.campaigns.filter((c) => c.role === 'gm'));
            })
            .catch((e) => {
                if (!abort.signal.aborted) setError(e.message);
            });
        void charactersApi
            .library(abort.signal)
            .then((r) => setCharacters(r.characters))
            .catch((e) => {
                if (!abort.signal.aborted) setError(e.message);
            });
        return () => abort.abort();
    }, []);
    const character = characters?.find((c) => c.id === selected);
    const visible =
        characters?.filter(
            (c) => !filter || (filter === 'unassigned' ? !c.campaignId : c.campaignId === filter),
        ) ?? [];
    return (
        <div className="control-center">
            <header className="control-hub-header">
                <a href="/" className="brand">
                    <Box size={22} /> YTT <small>GM HUB</small>
                </a>
                <div>
                    <span className="eyebrow">GM CONTROL CENTER</span>
                    <strong>
                        {assetsPage
                            ? 'Asset Library'
                            : npcsPage
                              ? 'NPC Library'
                              : spellsPage
                                ? 'Библиотека заклинаний'
                                : itemsPage
                                  ? 'Коллекция предметов'
                                  : 'Личная библиотека персонажей'}
                    </strong>
                </div>
                <a
                    className="secondary-button"
                    href={campaigns.some((c) => c.id === filter) ? `/campaigns/${filter}` : '/'}
                >
                    {campaigns.some((c) => c.id === filter)
                        ? 'Открыть кампанию'
                        : 'Кампании и сессии'}{' '}
                    <ArrowUpRight size={16} />
                </a>
            </header>
            <aside className="control-sidebar">
                <a className="brand" href="/">
                    <Box size={25} />
                    <strong>YTT /</strong>
                </a>
                <div className="control-campaign">
                    <span className="eyebrow">PREPARE</span>
                    <h2>Ваши герои</h2>
                    <p>Создавайте независимо от кампаний</p>
                </div>
                <nav aria-label="Разделы GM Hub">
                    <a href="/control/assets" aria-current={assetsPage ? 'page' : undefined}>
                        <Box size={18} />
                        Assets
                    </a>
                    <a href="/control/npcs" aria-current={npcsPage ? 'page' : undefined}>
                        <Users size={18} />
                        NPCs
                    </a>
                    <a
                        href={base}
                        aria-current={
                            !assetsPage && !itemsPage && !spellsPage && !npcsPage
                                ? 'page'
                                : undefined
                        }
                    >
                        <Users size={18} />
                        Персонажи
                    </a>
                    <a href="/control/items" aria-current={itemsPage ? 'page' : undefined}>
                        <Box size={18} />
                        Предметы
                    </a>
                    <a href="/control/spells" aria-current={spellsPage ? 'page' : undefined}>
                        <BookOpen size={18} />
                        Заклинания
                    </a>
                </nav>
                <div className="control-return">
                    <a href="/">
                        <ArrowLeft size={15} />
                        Главный экран
                    </a>
                </div>
            </aside>
            <main className="control-main">
                {assetsPage ? (
                    <>
                        <ObjectPresetLibrary />
                        <AssetLibrary />
                    </>
                ) : npcsPage ? (
                    <NpcLibrary campaigns={campaigns} />
                ) : spellsPage ? (
                    <SpellLibrary />
                ) : itemsPage ? (
                    <ItemLibrary />
                ) : (
                    <>
                        <header className="control-heading">
                            <div>
                                <span className="eyebrow">GM HUB / CHARACTER LIBRARY</span>
                                <h1>
                                    {selected === 'new'
                                        ? 'Новый персонаж'
                                        : selected
                                          ? (character?.name ?? 'Персонаж')
                                          : 'Персонажи'}
                                </h1>
                                <p className="muted">
                                    Ваши персонажи. Кампанию и игрока можно назначить, когда герой
                                    готов к игре.
                                </p>
                            </div>
                            {!selected && (
                                <a
                                    className="primary-button"
                                    href={`${base}/new${filter && filter !== 'unassigned' ? `?campaign=${filter}` : ''}`}
                                >
                                    <Plus size={17} />
                                    Создать персонажа
                                </a>
                            )}
                        </header>
                        {error && (
                            <p role="alert" className="form-error">
                                {error} <button onClick={load}>Повторить</button>
                            </p>
                        )}
                        {characters === null ? (
                            <p role="status">Загрузка персонажей…</p>
                        ) : selected ? (
                            selected === 'new' || character ? (
                                <CharacterEditor
                                    campaigns={campaigns}
                                    initialCampaignId={
                                        filter && filter !== 'unassigned' ? filter : undefined
                                    }
                                    initial={character}
                                    onSaved={(saved) =>
                                        setCharacters((all) => [
                                            ...(all ?? []).filter((c) => c.id !== saved.id),
                                            saved,
                                        ])
                                    }
                                />
                            ) : (
                                <div className="control-empty">
                                    <h2>Персонаж не найден</h2>
                                    <a href={base}>Вернуться к списку</a>
                                </div>
                            )
                        ) : (
                            <>
                                <div className="control-list-tools">
                                    <label className="field">
                                        <span>Назначение</span>
                                        <select
                                            aria-label="Кампания библиотеки"
                                            value={filter}
                                            onChange={(e) => {
                                                setFilter(e.target.value);
                                                history.replaceState(
                                                    null,
                                                    '',
                                                    base +
                                                        (e.target.value
                                                            ? `?campaign=${e.target.value}`
                                                            : ''),
                                                );
                                            }}
                                        >
                                            <option value="">
                                                Все персонажи · {characters.length}
                                            </option>
                                            <option value="unassigned">Без кампании</option>
                                            {campaigns.map((c) => (
                                                <option key={c.id} value={c.id}>
                                                    {c.name}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                    <input
                                        aria-label="Найти персонажа"
                                        placeholder="Найти персонажа…"
                                        value={search}
                                        onChange={(e) => setSearch(e.target.value)}
                                    />
                                </div>
                                {!visible.length ? (
                                    <div className="control-empty">
                                        <Users size={38} />
                                        <h2>
                                            {characters.length
                                                ? 'В этом разделе пока нет героев'
                                                : 'У каждой истории есть герои'}
                                        </h2>
                                        <p>
                                            Создайте героя сейчас. Назначьте кампанию и игрока перед
                                            первой сессией.
                                        </p>
                                        <a
                                            className="primary-button"
                                            href={`${base}/new${filter && filter !== 'unassigned' ? `?campaign=${filter}` : ''}`}
                                        >
                                            <Plus size={16} />
                                            Создать первого персонажа
                                        </a>
                                    </div>
                                ) : (
                                    <div className="control-character-grid">
                                        {visible
                                            .filter((c) =>
                                                c.name
                                                    .toLocaleLowerCase()
                                                    .includes(search.toLocaleLowerCase()),
                                            )
                                            .map((c) => (
                                                <a
                                                    className="control-character-card"
                                                    key={c.id}
                                                    href={`${base}/${c.id}`}
                                                >
                                                    <div className="control-portrait">
                                                        {c.portrait ? (
                                                            <img src={c.portrait.url} alt="" />
                                                        ) : (
                                                            <Users size={38} />
                                                        )}
                                                        <span>
                                                            Редактировать <ArrowUpRight size={14} />
                                                        </span>
                                                    </div>
                                                    <div className="control-card-content">
                                                        <h2>{c.name}</h2>
                                                        <p>
                                                            {c.campaignName ?? 'Без кампании'}
                                                            {c.ownerUserId
                                                                ? ' · Назначен игроку'
                                                                : ' · Только GM'}
                                                        </p>
                                                        <div className="control-card-stats">
                                                            <span>
                                                                <Heart size={14} />
                                                                {c.hp} / {c.maxHp}
                                                            </span>
                                                            <span>
                                                                <Shield size={14} />
                                                                {c.derived?.ac ?? '—'} AC
                                                            </span>
                                                            <span>
                                                                {c.derived?.speed ?? '—'} ft
                                                            </span>
                                                        </div>
                                                        <div className="control-scores">
                                                            {Object.entries(
                                                                c.rules?.scores ?? {},
                                                            ).map(([key, score]) => (
                                                                <span key={key}>
                                                                    {key.toUpperCase()}{' '}
                                                                    <b>{score}</b>
                                                                </span>
                                                            ))}
                                                        </div>
                                                    </div>
                                                </a>
                                            ))}
                                    </div>
                                )}
                                {visible.length > 0 &&
                                    !visible.some((c) =>
                                        c.name
                                            .toLocaleLowerCase()
                                            .includes(search.toLocaleLowerCase()),
                                    ) && (
                                        <p className="control-empty">
                                            По этому имени никого не найдено.
                                        </p>
                                    )}
                            </>
                        )}
                    </>
                )}
            </main>
        </div>
    );
}
