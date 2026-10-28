import { useEffect, useState } from 'react';
import { preparation } from '../../api/preparation';

export function HandoutAccess({
    campaignId,
    handoutId,
    refreshKey,
    onAccessChange,
}: {
    campaignId: string;
    handoutId: string;
    refreshKey: number;
    onAccessChange: () => void;
}) {
    const [players, setPlayers] = useState<{ id: string; name: string; hasAccess: boolean }[]>([]);
    const [selected, setSelected] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false),
        [error, setError] = useState(''),
        [notice, setNotice] = useState('');
    useEffect(() => {
        let alive = true;
        void preparation
            .handout(campaignId, handoutId)
            .then((h) => {
                if (alive) setPlayers(h.recipients ?? []);
            })
            .catch((e) => {
                if (alive) setError(e.message);
            })
            .finally(() => {
                if (alive) setLoading(false);
            });
        return () => {
            alive = false;
        };
    }, [campaignId, handoutId, refreshKey]);
    const run = async (revoke: boolean, all = false) => {
        setBusy(true);
        setError('');
        setNotice('');
        try {
            await (revoke ? preparation.revokeHandout : preparation.showHandout)(
                campaignId,
                handoutId,
                all ? undefined : selected,
            );
            setPlayers((await preparation.handout(campaignId, handoutId)).recipients ?? []);
            onAccessChange();
            setNotice(revoke ? 'Доступ отозван.' : 'Материал показан выбранным игрокам.');
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };
    return (
        <details className="handout-access">
            <summary>Получатели и доступ</summary>
            <div className="handout-recipients">
                {players.map((p) => (
                    <label key={p.id}>
                        <input
                            type="checkbox"
                            disabled={busy}
                            checked={selected.includes(p.id)}
                            onChange={() =>
                                setSelected((s) =>
                                    s.includes(p.id) ? s.filter((id) => id !== p.id) : [...s, p.id],
                                )
                            }
                        />
                        {p.name}
                        <small>{p.hasAccess ? 'Есть доступ' : 'Нет доступа'}</small>
                    </label>
                ))}
            </div>
            {loading && <p role="status">Загружаем получателей…</p>}
            {!loading && !error && !players.length && (
                <p className="hint">Пригласите игроков в кампанию.</p>
            )}
            <div className="handout-access-actions">
                <button disabled={busy || !selected.length} onClick={() => void run(false)}>
                    Показать выбранным игрокам
                </button>
                <button disabled={busy || !selected.length} onClick={() => void run(true)}>
                    Отозвать у выбранных
                </button>
                <button disabled={busy || loading} onClick={() => void run(true, true)}>
                    Отозвать у всех
                </button>
            </div>
            <p className="hint">
                Отзыв закрывает дальнейший доступ. Уже скачанные файлы могут остаться у игроков.
            </p>
            {busy && <p role="status">Сохраняем доступ…</p>}
            {notice && <p role="status">{notice}</p>}
            {error && (
                <p role="alert" className="form-error">
                    {error}
                </p>
            )}
        </details>
    );
}
