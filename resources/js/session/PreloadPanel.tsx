import { useEffect, useState } from 'react';
import { request } from '../api/client';
import { commandId, type Campaign } from '../api/workspace';
import type { Member } from '../realtime/useCampaignLive';
export interface PreloadStatus {
    id: string;
    sceneId: string;
    valid: boolean;
    includeAudio: boolean;
    total: number;
    bytes: number;
    players: { id: string; name: string; status: string; loaded: number }[];
}
const labels: Record<string, string> = {
    waiting: 'Не готов',
    loading: 'Загрузка',
    ready: 'Готово',
    failed: 'Ошибка',
};
export function PreloadPanel({
    campaign,
    members,
    target,
    automatic,
    onActivate,
}: {
    campaign: Campaign;
    members: Member[];
    target?: string | null;
    automatic: boolean;
    onActivate: (id: string) => Promise<void>;
}) {
    const [sceneId, setSceneId] = useState(target ?? ''),
        [audio, setAudio] = useState(false);
    const [status, setStatus] = useState<PreloadStatus | null>(null),
        [error, setError] = useState(''),
        [busy, setBusy] = useState(false),
        [retry, setRetry] = useState(0);
    const selected = target || sceneId;
    const base = `/campaigns/${campaign.id}/preload`;
    useEffect(() => {
        const abort = new AbortController();
        let pending = false;
        const refresh = async () => {
            if (pending) return;
            pending = true;
            try {
                const d = await request<{ preload: PreloadStatus | null }>(
                    base,
                    'GET',
                    undefined,
                    abort.signal,
                );
                if (!abort.signal.aborted) setStatus(d.preload);
            } catch (e) {
                if (!abort.signal.aborted) setError((e as Error).message);
            } finally {
                pending = false;
            }
        };
        void refresh();
        const timer = setInterval(() => void refresh(), 3000);
        return () => {
            abort.abort();
            clearInterval(timer);
        };
    }, [base, retry]);
    useEffect(() => {
        if (!automatic || !target) return;
        let alive = true;
        void request<{ preload: PreloadStatus }>(base, 'POST', {
            sceneId: target,
            includeAudio: false,
            clientMutationId: commandId(),
        })
            .then((d) => {
                if (alive) {
                    setStatus(d.preload);
                    setError('');
                }
            })
            .catch((e) => {
                if (alive) setError(e.message);
            });
        return () => {
            alive = false;
        };
    }, [automatic, target, base]);
    const prepare = async () => {
        setBusy(true);
        setError('');
        try {
            const d = await request<{ preload: PreloadStatus }>(base, 'POST', {
                sceneId: selected,
                includeAudio: audio,
                clientMutationId: commandId(),
            });
            setStatus(d.preload);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };
    return (
        <details className="session-preload">
            <summary>Подготовка сцены</summary>
            <select
                aria-label="Сцена для предзагрузки"
                value={selected}
                onChange={(e) => setSceneId(e.target.value)}
                disabled={!!target}
            >
                <option value="">Выберите сцену…</option>
                {campaign.scenes.map((s) => (
                    <option key={s.id} value={s.id}>
                        {s.name}
                    </option>
                ))}
            </select>
            <label className="check-row">
                <input
                    type="checkbox"
                    checked={audio}
                    onChange={(e) => setAudio(e.target.checked)}
                />
                Также аудио её событий
            </label>
            <p className="hint">
                Игроки получат файлы заранее и смогут их открыть. Названия скрыты; скрытые объекты и
                материалы не загружаются.
            </p>
            <button
                className="secondary-button"
                disabled={!selected || busy}
                onClick={() => void prepare()}
            >
                {busy ? 'Подготовка…' : 'Предзагрузить игрокам'}
            </button>
            {status && (
                <div className="preload-readiness">
                    <strong>
                        {campaign.scenes.find((s) => s.id === status.sceneId)?.name ?? 'Сцена'}
                    </strong>
                    <small>
                        {status.total} файлов · {(status.bytes / 1048576).toFixed(1)} МиБ
                    </small>
                    {!status.valid && (
                        <p className="form-error">Сцена изменена. Повторите подготовку.</p>
                    )}
                    {status.players.map((p) => (
                        <div key={p.id}>
                            <span>{p.name}</span>
                            <span className={`readiness-${p.status}`}>
                                {!members.some((m) => m.id === p.id)
                                    ? 'Не в сети'
                                    : `${labels[p.status]}${p.status === 'loading' ? ` · ${p.loaded}/${status.total}` : ''}`}
                            </span>
                        </div>
                    ))}
                    {!status.players.length && (
                        <p className="hint">Игроки пока не присоединились.</p>
                    )}
                    <button
                        className="primary-button"
                        disabled={busy}
                        onClick={() => {
                            setBusy(true);
                            void onActivate(status.sceneId)
                                .catch((e) => setError(e.message))
                                .finally(() => setBusy(false));
                        }}
                    >
                        Активировать сцену
                    </button>
                    <small>Активация доступна независимо от готовности.</small>
                </div>
            )}
            {error && (
                <p role="alert" className="form-error">
                    {error}
                    <button
                        onClick={() => {
                            setError('');
                            setRetry((n) => n + 1);
                        }}
                    >
                        Обновить
                    </button>
                </p>
            )}
        </details>
    );
}
