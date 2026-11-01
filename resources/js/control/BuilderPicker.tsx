import { useEffect, useState } from 'react';
import { request } from '../api/client';
import type { ItemDefinition } from '../rpg/model';

export interface BuilderChoice {
    id: string;
    name: string;
    quantity: number;
}
export function BuilderPicker({
    campaignId,
    mode,
    selected,
    onChange,
}: {
    campaignId: string;
    mode: 'items' | 'spells';
    selected: BuilderChoice[];
    onChange: (choices: BuilderChoice[]) => void;
}) {
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1),
        [pages, setPages] = useState(1);
    const [entries, setEntries] = useState<{ id: string; name: string }[]>([]);
    const [error, setError] = useState(''),
        [loading, setLoading] = useState(true),
        [retry, setRetry] = useState(0);
    useEffect(() => {
        const abort = new AbortController();
        const timer = setTimeout(() => {
            setLoading(true);
            setError('');
            const task =
                mode === 'items'
                    ? request<{ definitions: ItemDefinition[] }>(
                          `/campaigns/${campaignId}/items`,
                          'GET',
                          undefined,
                          abort.signal,
                      ).then((r) => {
                          setEntries(
                              r.definitions.filter((d) =>
                                  d.name.toLowerCase().includes(search.toLowerCase()),
                              ),
                          );
                          setPages(1);
                      })
                    : request<{ entries: { id: number; name: string }[]; pages: number }>(
                          `/campaigns/${campaignId}/compendium?type=spells&search=${encodeURIComponent(search)}&page=${page}`,
                          'GET',
                          undefined,
                          abort.signal,
                      ).then((r) => {
                          setEntries(r.entries.map((e) => ({ ...e, id: String(e.id) })));
                          setPages(r.pages);
                      });
            void task
                .catch((e) => {
                    if (!abort.signal.aborted) setError(e.message);
                })
                .finally(() => {
                    if (!abort.signal.aborted) setLoading(false);
                });
        }, 200);
        return () => {
            abort.abort();
            clearTimeout(timer);
        };
    }, [campaignId, mode, search, page, retry]);
    return (
        <section>
            <h2>{mode === 'items' ? 'Соберите рюкзак' : 'Выберите заклинания'}</h2>
            <p className="hint">
                Необязательно.{' '}
                {mode === 'items'
                    ? 'Предметы кампании попадут в рюкзак; экипировать их можно после создания.'
                    : 'Заклинания будут назначены при создании. Ячейки можно настроить в редакторе.'}
            </p>
            <label className="field">
                <span>Поиск</span>
                <input
                    maxLength={100}
                    value={search}
                    onChange={(e) => {
                        setSearch(e.target.value);
                        setPage(1);
                    }}
                />
            </label>
            {error && (
                <p role="alert">
                    {error}
                    <button onClick={() => setRetry((r) => r + 1)}>Повторить</button>
                </p>
            )}
            {loading ? (
                <p role="status">Загрузка…</p>
            ) : (
                <div className="builder-picker">
                    {entries.map((entry) => (
                        <button
                            key={entry.id}
                            aria-pressed={selected.some((s) => s.id === entry.id)}
                            onClick={() =>
                                onChange(
                                    selected.some((s) => s.id === entry.id)
                                        ? selected.filter((s) => s.id !== entry.id)
                                        : [...selected, { ...entry, quantity: 1 }],
                                )
                            }
                        >
                            {entry.name}
                            <small>
                                {selected.some((s) => s.id === entry.id)
                                    ? 'Выбрано ✓'
                                    : 'Добавить +'}
                            </small>
                        </button>
                    ))}
                    {!entries.length && (
                        <p className="hint">Ничего не найдено. Можно продолжить без выбора.</p>
                    )}
                </div>
            )}
            {pages > 1 && (
                <div className="button-row">
                    <button disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>
                        Назад
                    </button>
                    <span>
                        {page} / {pages}
                    </span>
                    <button
                        disabled={page >= pages || loading}
                        onClick={() => setPage((p) => p + 1)}
                    >
                        Далее
                    </button>
                </div>
            )}
            <h3>Выбрано · {selected.length}</h3>
            {selected.map((choice) => (
                <div className="builder-choice" key={choice.id}>
                    <span>{choice.name}</span>
                    {mode === 'items' && (
                        <input
                            aria-label={`Количество: ${choice.name}`}
                            type="number"
                            min={1}
                            max={99}
                            value={choice.quantity}
                            onChange={(e) =>
                                onChange(
                                    selected.map((s) =>
                                        s.id === choice.id
                                            ? { ...s, quantity: Number(e.target.value) }
                                            : s,
                                    ),
                                )
                            }
                        />
                    )}
                    <button onClick={() => onChange(selected.filter((s) => s.id !== choice.id))}>
                        Убрать
                    </button>
                </div>
            ))}
        </section>
    );
}
