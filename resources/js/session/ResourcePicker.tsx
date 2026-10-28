import { useEffect, useState } from 'react';
import { sessions, type ReferenceType, type Resource } from './model';
export function ResourcePicker({
    campaignId,
    type,
    onChoose,
}: {
    campaignId: string;
    type: ReferenceType;
    onChoose: (resource: Resource) => void;
}) {
    const [search, setSearch] = useState(''),
        [page, setPage] = useState(1);
    const [result, setResult] = useState<{ items: Resource[]; pages: number }>({
        items: [],
        pages: 1,
    });
    const [error, setError] = useState(''),
        [loading, setLoading] = useState(true),
        [retry, setRetry] = useState(0);
    useEffect(() => {
        const abort = new AbortController();
        const timer = setTimeout(() => {
            setLoading(true);
            void sessions
                .resources(campaignId, type, search, page, abort.signal)
                .then((d) => {
                    if (!abort.signal.aborted) {
                        setResult(d);
                        setError('');
                    }
                })
                .catch((e) => {
                    if (!abort.signal.aborted) setError(e.message);
                })
                .finally(() => {
                    if (!abort.signal.aborted) setLoading(false);
                });
        }, 180);
        return () => {
            clearTimeout(timer);
            abort.abort();
        };
    }, [campaignId, type, search, page, retry]);
    return (
        <div className="session-resources">
            <input
                aria-label="Поиск в материалах плана"
                placeholder="Найти подготовленный материал…"
                value={search}
                onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                }}
            />
            {error && (
                <p role="alert">
                    {error} <button onClick={() => setRetry((n) => n + 1)}>Повторить</button>
                </p>
            )}
            {loading ? (
                <p className="hint">Загрузка…</p>
            ) : (
                <div className="session-resource-list">
                    {result.items.map((item) => (
                        <button key={item.id} onClick={() => onChoose(item)}>
                            {item.name}
                        </button>
                    ))}
                    {!result.items.length && (
                        <p className="hint">Здесь пока нет подготовленных материалов.</p>
                    )}
                </div>
            )}
            {result.pages > 1 && (
                <div className="session-pager">
                    <button disabled={page === 1} onClick={() => setPage(page - 1)}>
                        Назад
                    </button>
                    <span>
                        {page} / {result.pages}
                    </span>
                    <button disabled={page === result.pages} onClick={() => setPage(page + 1)}>
                        Далее
                    </button>
                </div>
            )}
        </div>
    );
}
