import { ItemDelivery } from '../rpg/ItemDelivery';
import type { ItemDefinition } from '../rpg/model';
import { useEffect, useState } from 'react';
import { request } from '../api/client';
import { commandId } from '../api/workspace';
import { charactersApi } from '../api/characters';
import type { Character } from '../tabletop/types/scene';
import './compendium.css';

interface Source {
    id: number;
    name: string;
    version: string;
    license: string;
    last_synced_at: string | null;
    metadata: { attribution: string; license_url: string; api_ruleset: string };
}
interface Entry {
    id: number;
    name: string;
    entity_type: string;
    external_key: string;
    source: Source;
    normalized_data?: Record<string, unknown> & { description?: string };
    raw_data?: unknown;
}
interface Results {
    entries: Entry[];
    sources: Source[];
    total: number;
    pages: number;
}
const labels: Record<string, string> = {
    spells: 'Заклинания',
    items: 'Снаряжение',
    weapons: 'Оружие',
    armor: 'Доспехи',
    monsters: 'Существа',
    conditions: 'Состояния',
    skills: 'Навыки',
    rules: 'Правила и справка',
};

export function CompendiumBrowser({ campaignId }: { campaignId: string }) {
    const base = `/campaigns/${campaignId}/compendium`;
    const [search, setSearch] = useState('');
    const [type, setType] = useState('');
    const [source, setSource] = useState('');
    const [page, setPage] = useState(1);
    const [results, setResults] = useState<Results>({
        entries: [],
        sources: [],
        total: 0,
        pages: 1,
    });
    const [selected, setSelected] = useState<number | null>(null);
    const [entry, setEntry] = useState<Entry | null>(null);
    const [characters, setCharacters] = useState<Character[]>([]);
    const [character, setCharacter] = useState('');
    const [loading, setLoading] = useState(true);
    const [detailLoading, setDetailLoading] = useState(false);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [copiedItem, setCopiedItem] = useState<ItemDefinition | null>(null);
    useEffect(() => {
        const abort = new AbortController();
        void charactersApi
            .list(campaignId, abort.signal)
            .then((r) => {
                if (!abort.signal.aborted) setCharacters(r.characters);
            })
            .catch((e: Error) => {
                if (!abort.signal.aborted) setError(e.message);
            });
        return () => abort.abort();
    }, [campaignId]);
    useEffect(() => {
        const abort = new AbortController();
        const timer = setTimeout(() => {
            const params = new URLSearchParams({ search, page: String(page) });
            if (type) params.set('type', type);
            if (source) params.set('source', source);
            void request<Results>(`${base}?${params}`, 'GET', undefined, abort.signal)
                .then((r) => {
                    if (!abort.signal.aborted) {
                        setResults(r);
                        setError('');
                        setLoading(false);
                    }
                })
                .catch((e: Error) => {
                    if (!abort.signal.aborted) {
                        setError(e.message);
                        setLoading(false);
                    }
                });
        }, 200);
        return () => {
            clearTimeout(timer);
            abort.abort();
        };
    }, [base, search, type, source, page]);
    useEffect(() => {
        if (selected === null) return;
        const abort = new AbortController();
        void request<{ entry: Entry }>(`${base}/${selected}`, 'GET', undefined, abort.signal)
            .then((r) => {
                if (!abort.signal.aborted) {
                    setEntry(r.entry);
                    setDetailLoading(false);
                }
            })
            .catch((e: Error) => {
                if (!abort.signal.aborted) {
                    setError(e.message);
                    setDetailLoading(false);
                }
            });
        return () => abort.abort();
    }, [base, selected]);
    const reset = () => {
        setPage(1);
        setLoading(true);
        setCopiedItem(null);
        setSelected(null);
        setEntry(null);
        setMessage('');
    };
    const copy = async () => {
        if (!entry) return;
        setBusy(true);
        setError('');
        setMessage('');
        try {
            const copied = await request<{ character?: Character; definition?: ItemDefinition }>(
                `${base}/copy`,
                'POST',
                {
                    entry_id: entry.id,
                    character_id: entry.entity_type === 'spells' ? Number(character) : null,
                    clientMutationId: commandId(),
                },
            );
            setCopiedItem(copied.definition ?? null);
            if (copied.character) {
                const npc = copied.character;
                setCharacters((all) => [...all, npc]);
            }
            setMessage(
                entry.entity_type === 'spells'
                    ? 'Заклинание добавлено. Откройте персонажа → Способности: проверьте настройки и включите его.'
                    : entry.entity_type === 'monsters'
                      ? 'NPC сохранён в «Персонажи». Его можно редактировать и размещать на сценах.'
                      : 'Предмет сохранён в каталоге кампании. Откройте персонажа → Предметы для редактирования.',
            );
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };
    return (
        <section className="compendium-browser" aria-label="Компендий SRD">
            <p className="hint">
                Локальный справочник. Создайте независимую редактируемую копию в кампании.
            </p>
            <label className="field">
                <span>Поиск по названию</span>
                <input
                    value={search}
                    placeholder="Fireball, Longsword…"
                    onChange={(e) => {
                        setSearch(e.target.value);
                        reset();
                    }}
                />
            </label>
            <div className="compendium-filters">
                <label className="field">
                    <span>Тип записи</span>
                    <select
                        value={type}
                        onChange={(e) => {
                            setType(e.target.value);
                            reset();
                        }}
                    >
                        <option value="">Все типы</option>
                        {Object.entries(labels).map(([key, label]) => (
                            <option key={key} value={key}>
                                {label}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="field">
                    <span>Источник / версия</span>
                    <select
                        value={source}
                        onChange={(e) => {
                            setSource(e.target.value);
                            reset();
                        }}
                    >
                        <option value="">Все источники</option>
                        {results.sources.map((s) => (
                            <option key={s.id} value={s.id}>
                                {s.name}
                            </option>
                        ))}
                    </select>
                </label>
            </div>
            {error && (
                <p className="form-error" role="alert">
                    {error}
                </p>
            )}
            {loading ? (
                <p role="status">Загрузка справочника…</p>
            ) : (
                <>
                    <p className="hint">Найдено: {results.total}</p>
                    {!results.entries.length && (
                        <p>Записей нет. Измените поиск или синхронизируйте SRD на сервере.</p>
                    )}
                    <div className="compendium-results">
                        {results.entries.map((e) => (
                            <button
                                key={e.id}
                                className="secondary-button"
                                aria-pressed={selected === e.id}
                                disabled={busy}
                                onClick={() => {
                                    setCopiedItem(null);
                                    setSelected(e.id);
                                    setEntry(null);
                                    setDetailLoading(true);
                                    setMessage('');
                                }}
                            >
                                <strong>{e.name}</strong>
                                <small>
                                    {labels[e.entity_type]} · {e.source.version}
                                </small>
                            </button>
                        ))}
                    </div>
                    {results.pages > 1 && (
                        <div className="asset-pagination">
                            <button
                                disabled={page === 1 || busy}
                                aria-label="Предыдущая страница компендия"
                                onClick={() => {
                                    setPage(page - 1);
                                    setLoading(true);
                                }}
                            >
                                ←
                            </button>
                            <span>
                                {page} / {results.pages}
                            </span>
                            <button
                                disabled={page >= results.pages || busy}
                                aria-label="Следующая страница компендия"
                                onClick={() => {
                                    setPage(page + 1);
                                    setLoading(true);
                                }}
                            >
                                →
                            </button>
                        </div>
                    )}
                </>
            )}
            {detailLoading && <p role="status">Загрузка записи…</p>}
            {entry && (
                <article className="compendium-detail">
                    <h3>{entry.name}</h3>
                    <p className="hint">
                        {entry.source.name} · {entry.source.license}
                    </p>
                    <p className="compendium-description">
                        {entry.normalized_data?.description ||
                            'Описание отсутствует; доступные поля приведены ниже.'}
                    </p>
                    {entry.entity_type === 'spells' && (
                        <>
                            <label className="field">
                                <span>Персонаж для заклинания</span>
                                <select
                                    value={character}
                                    onChange={(e) => setCharacter(e.target.value)}
                                    disabled={busy}
                                >
                                    <option value="">Выберите персонажа</option>
                                    {characters.map((c) => (
                                        <option key={c.id} value={c.id}>
                                            {c.name}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <p className="hint">
                                Сохраняется выключенным до проверки GM. Спасброски и условные
                                эффекты требуют ручного разрешения.
                            </p>
                        </>
                    )}
                    {['spells', 'items', 'weapons', 'armor', 'monsters'].includes(
                        entry.entity_type,
                    ) && (
                        <button
                            className="primary-button"
                            disabled={busy || (entry.entity_type === 'spells' && !character)}
                            onClick={() => void copy()}
                        >
                            {busy
                                ? 'Создание…'
                                : entry.entity_type === 'monsters'
                                  ? 'Создать NPC кампании'
                                  : entry.entity_type === 'spells'
                                    ? 'Создать способность / заклинание'
                                    : 'Создать предмет кампании'}
                        </button>
                    )}
                    {copiedItem && (
                        <ItemDelivery
                            campaign={campaignId}
                            definition={copiedItem}
                            characters={characters}
                        />
                    )}
                    {message && <p role="status">{message}</p>}
                    <details>
                        <summary>Поля YTT</summary>
                        <pre>{JSON.stringify(entry.normalized_data, null, 2)}</pre>
                    </details>
                    <details>
                        <summary>Исходные данные SRD</summary>
                        <pre>{JSON.stringify(entry.raw_data, null, 2)}</pre>
                    </details>
                    <details>
                        <summary>Источник и атрибуция</summary>
                        <p>{entry.source.metadata.attribution}</p>
                        <p>{entry.source.metadata.api_ruleset}</p>
                        <a
                            href="https://creativecommons.org/licenses/by/4.0/legalcode"
                            target="_blank"
                            rel="noreferrer"
                        >
                            CC BY 4.0
                        </a>
                    </details>
                </article>
            )}
        </section>
    );
}
