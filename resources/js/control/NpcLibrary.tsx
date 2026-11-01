import { useEffect, useState } from 'react';
import { Copy, Plus, Users, Heart, Shield } from 'lucide-react';
import { request } from '../api/client';
import { api, commandId, type CampaignSummary, type Campaign } from '../api/workspace';
import type { Character } from '../tabletop/types/scene';
import { NpcEditor } from './NpcEditor';

interface Monster {
    id: number;
    name: string;
    data: { hp?: number; challenge_rating?: number; creature_type?: string };
    source: { name: string; license?: string };
}
export function NpcLibrary({ campaigns }: { campaigns: CampaignSummary[] }) {
    const selected = location.pathname.match(/\/npcs\/(new|\d+)$/)?.[1];
    const [characters, setCharacters] = useState<Character[] | null>(null);
    const [search, setSearch] = useState(''),
        [srd, setSrd] = useState(false),
        [page, setPage] = useState(1);
    const [monsters, setMonsters] = useState<Monster[] | null>(null),
        [pages, setPages] = useState(1);
    const [busy, setBusy] = useState(false),
        [error, setError] = useState('');
    const [placing, setPlacing] = useState<Character>();
    const load = () => {
        setError('');
        void request<{ characters: Character[] }>('/library/npcs')
            .then((r) => setCharacters(r.characters))
            .catch((e) => setError(e.message));
    };
    useEffect(() => {
        const abort = new AbortController();
        void request<{ characters: Character[] }>('/library/npcs', 'GET', undefined, abort.signal)
            .then((r) => setCharacters(r.characters))
            .catch((e) => {
                if (!abort.signal.aborted) setError(e.message);
            });
        return () => abort.abort();
    }, []);
    useEffect(() => {
        if (!srd) return;
        const abort = new AbortController();
        const timer = setTimeout(() => {
            setMonsters(null);
            void request<{ entries: Monster[]; pages: number }>(
                `/library/npcs/monsters?search=${encodeURIComponent(search)}&page=${page}`,
                'GET',
                undefined,
                abort.signal,
            )
                .then((r) => {
                    setMonsters(r.entries);
                    setPages(r.pages);
                })
                .catch((e) => {
                    if (!abort.signal.aborted) setError(e.message);
                });
        }, 200);
        return () => {
            abort.abort();
            clearTimeout(timer);
        };
    }, [search, page, srd]);
    const copy = async (data: { npcId: string } | { entryId: number }) => {
        if (busy) return;
        setBusy(true);
        setError('');
        try {
            const r = await request<{ character: Character }>('/library/npcs/copy', 'POST', {
                ...data,
                clientMutationId: commandId(),
            });
            location.assign(`/control/npcs/${r.character.id}`);
        } catch (e) {
            setError((e as Error).message);
            setBusy(false);
        }
    };
    const character = characters?.find((c) => c.id === selected);
    return (
        <>
            <header className="control-heading">
                <div>
                    <span className="eyebrow">GM HUB / NPC LIBRARY</span>
                    <h1>
                        {selected === 'new'
                            ? 'Новый NPC'
                            : selected
                              ? (character?.name ?? 'NPC')
                              : 'NPCs'}
                    </h1>
                    <p className="muted">
                        Враги, союзники и жители мира. Одна библиотека для любых кампаний.
                    </p>
                </div>
                {!selected && (
                    <a href="/control/npcs/new" className="primary-button">
                        <Plus size={17} />
                        Создать NPC
                    </a>
                )}
            </header>
            {error && (
                <p className="form-error" role="alert">
                    {error} <button onClick={load}>Повторить</button>
                </p>
            )}
            {selected ? (
                characters === null ? (
                    <p role="status">Загрузка NPC…</p>
                ) : selected === 'new' || character ? (
                    <NpcEditor
                        key={selected}
                        initial={character}
                        onSaved={(c) =>
                            setCharacters((all) => [...(all ?? []).filter((a) => a.id !== c.id), c])
                        }
                    />
                ) : (
                    <p>
                        NPC не найден. <a href="/control/npcs">В библиотеку</a>
                    </p>
                )
            ) : (
                <>
                    <div className="control-list-tools">
                        <div className="rest-actions">
                            <button
                                aria-pressed={!srd}
                                onClick={() => {
                                    setSrd(false);
                                    setSearch('');
                                }}
                            >
                                Custom NPCs · {characters?.length ?? '…'}
                            </button>
                            <button
                                aria-pressed={srd}
                                onClick={() => {
                                    setSrd(true);
                                    setSearch('');
                                    setPage(1);
                                }}
                            >
                                SRD Monsters · Copy to custom
                            </button>
                        </div>
                        <input
                            aria-label="Поиск NPC"
                            placeholder="Найти NPC…"
                            value={search}
                            onChange={(e) => {
                                setSearch(e.target.value);
                                setPage(1);
                            }}
                        />
                    </div>
                    {srd ? (
                        <>
                            <p className="hint">
                                SRD доступен только для чтения. Copy to custom создаёт
                                редактируемого NPC с исходным stat block.
                            </p>
                            {monsters === null ? (
                                <p role="status">Загрузка SRD…</p>
                            ) : !monsters.length ? (
                                <p className="control-empty">Монстры не найдены.</p>
                            ) : (
                                <div className="control-character-grid">
                                    {monsters.map((m) => (
                                        <article
                                            className="control-character-card npc-library-card"
                                            key={m.id}
                                        >
                                            <div className="control-portrait">
                                                <Users size={48} />
                                            </div>
                                            <div className="control-card-content">
                                                <span className="eyebrow">
                                                    SRD · {m.data.creature_type}
                                                </span>
                                                <h2>{m.name}</h2>
                                                <p>
                                                    HP {m.data.hp} · CR{' '}
                                                    {m.data.challenge_rating ?? '—'}
                                                </p>
                                                <small>
                                                    {m.source.name} · {m.source.license}
                                                </small>
                                                <button
                                                    disabled={busy}
                                                    className="secondary-button"
                                                    onClick={() => void copy({ entryId: m.id })}
                                                >
                                                    <Copy size={15} />
                                                    Copy to custom
                                                </button>
                                            </div>
                                        </article>
                                    ))}
                                </div>
                            )}
                            <div className="button-row">
                                <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                                    Назад
                                </button>
                                <span>
                                    {page} / {pages}
                                </span>
                                <button
                                    disabled={page >= pages}
                                    onClick={() => setPage((p) => p + 1)}
                                >
                                    Далее
                                </button>
                            </div>
                        </>
                    ) : characters === null ? (
                        <p role="status">Загрузка NPC…</p>
                    ) : (
                        <>
                            <div className="control-character-grid">
                                {characters
                                    .filter((c) =>
                                        c.name
                                            .toLocaleLowerCase()
                                            .includes(search.toLocaleLowerCase()),
                                    )
                                    .map((c) => (
                                        <article
                                            className="control-character-card npc-library-card"
                                            key={c.id}
                                        >
                                            <a
                                                href={`/control/npcs/${c.id}`}
                                                className="control-portrait"
                                            >
                                                {c.portrait ? (
                                                    <img src={c.portrait.url} alt="" />
                                                ) : (
                                                    <Users size={48} />
                                                )}
                                                <span>Редактировать →</span>
                                            </a>
                                            <div className="control-card-content">
                                                <h2>
                                                    <a href={`/control/npcs/${c.id}`}>{c.name}</a>
                                                </h2>
                                                <p>{c.origin?.species || 'Custom NPC'}</p>
                                                <div className="control-card-stats">
                                                    <span>
                                                        <Heart size={14} />
                                                        {c.maxHp}
                                                    </span>
                                                    <span>
                                                        <Shield size={14} />
                                                        {c.derived?.ac ?? c.ac} AC
                                                    </span>
                                                    <span>{c.derived?.speed ?? c.speed} ft</span>
                                                </div>
                                                <div className="button-row">
                                                    <button
                                                        disabled={busy}
                                                        onClick={() => void copy({ npcId: c.id })}
                                                    >
                                                        <Copy size={15} />
                                                        Duplicate
                                                    </button>
                                                    <button
                                                        className="secondary-button"
                                                        disabled={busy}
                                                        onClick={() => setPlacing(c)}
                                                    >
                                                        Добавить в сцену
                                                    </button>
                                                </div>
                                            </div>
                                        </article>
                                    ))}
                            </div>
                            {!characters.length && (
                                <div className="control-empty">
                                    <Users size={42} />
                                    <h2>Населите ваш мир</h2>
                                    <p>Создайте NPC с нуля или скопируйте монстра из SRD.</p>
                                </div>
                            )}
                            {!!characters.length &&
                                !characters.some((c) =>
                                    c.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
                                ) && <p className="control-empty">NPC не найдены.</p>}
                        </>
                    )}
                </>
            )}
            {placing && (
                <NpcPlacement
                    character={placing}
                    campaigns={campaigns}
                    close={() => setPlacing(undefined)}
                />
            )}
        </>
    );
}

function NpcPlacement({
    character,
    campaigns,
    close,
}: {
    character: Character;
    campaigns: CampaignSummary[];
    close: () => void;
}) {
    const [campaignId, setCampaignId] = useState(campaigns[0]?.id ?? '');
    const [campaign, setCampaign] = useState<Campaign>(),
        [sceneId, setSceneId] = useState('');
    const [busy, setBusy] = useState(false),
        [error, setError] = useState(''),
        [placed, setPlaced] = useState('');
    useEffect(() => {
        if (!campaignId) return;
        const abort = new AbortController();
        void api
            .campaign(campaignId, abort.signal)
            .then((c) => {
                setCampaign(c);
                setSceneId(c.activeSceneId ?? c.scenes[0]?.id ?? '');
            })
            .catch((e) => {
                if (!abort.signal.aborted) setError(e.message);
            });
        return () => abort.abort();
    }, [campaignId]);
    const place = async () => {
        setBusy(true);
        setError('');
        try {
            const scene = await api.snapshot(sceneId);
            await request(`/scenes/${sceneId}/npcs`, 'POST', {
                npcId: character.id,
                x: scene.width / 2,
                y: scene.height / 2,
                clientMutationId: commandId(),
            });
            setPlaced(`/campaigns/${campaignId}/scenes/${sceneId}`);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };
    return (
        <div className="npc-placement-backdrop">
            <section
                role="dialog"
                aria-modal="true"
                aria-label="Добавить NPC в сцену"
                className="npc-placement"
            >
                <h2>{character.name} → сцена</h2>
                <p className="hint">
                    Будет создана независимая копия в центре сцены. Текущая сессия продолжает
                    использовать эту сцену.
                </p>
                {error && (
                    <p role="alert" className="form-error">
                        {error}
                    </p>
                )}
                {placed ? (
                    <p role="status">
                        NPC добавлен.{' '}
                        <a className="primary-button" href={placed}>
                            Открыть сцену
                        </a>
                    </p>
                ) : (
                    <fieldset disabled={busy}>
                        <label className="field">
                            Кампания
                            <select
                                value={campaignId}
                                onChange={(e) => {
                                    setCampaignId(e.target.value);
                                    setSceneId('');
                                }}
                            >
                                {campaigns.map((c) => (
                                    <option key={c.id} value={c.id}>
                                        {c.name}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label className="field">
                            Сцена
                            <select value={sceneId} onChange={(e) => setSceneId(e.target.value)}>
                                {campaign?.id === campaignId &&
                                    campaign.scenes.map((s) => (
                                        <option key={s.id} value={s.id}>
                                            {s.name}
                                        </option>
                                    ))}
                            </select>
                        </label>
                        {!campaigns.length && <p>Для размещения нужна кампания с правами GM.</p>}
                        <button
                            className="primary-button"
                            disabled={!sceneId || campaign?.id !== campaignId}
                            onClick={() => void place()}
                        >
                            {busy ? 'Добавление…' : 'Добавить NPC'}
                        </button>
                    </fieldset>
                )}
                <button disabled={busy} className="quiet-button" onClick={close}>
                    Закрыть
                </button>
            </section>
        </div>
    );
}
