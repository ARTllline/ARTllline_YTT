import { useRef, useState } from 'react';
import { automation } from './model';
import { commandId } from '../api/workspace';
export function InteractButton({
    sceneId,
    epoch,
    kind,
    id,
    disabled,
}: {
    sceneId: string;
    epoch: number;
    kind: 'token' | 'prop';
    id: string;
    disabled: boolean;
}) {
    const [busy, setBusy] = useState(false),
        [error, setError] = useState(''),
        [sent, setSent] = useState(false);
    const mutation = useRef<string | null>(null);
    return (
        <div className="object-interaction">
            <button
                className="secondary-button"
                disabled={busy || disabled}
                onClick={() => {
                    mutation.current ??= commandId();
                    setBusy(true);
                    setError('');
                    setSent(false);
                    void automation
                        .interact(sceneId, kind, id, epoch, mutation.current)
                        .then(() => {
                            mutation.current = null;
                            setSent(true);
                        })
                        .catch((e) => setError(e.message))
                        .finally(() => setBusy(false));
                }}
            >
                {busy ? 'Отправка…' : error ? 'Повторить взаимодействие' : 'Взаимодействовать'}
            </button>
            {sent && <small role="status">Действие передано</small>}
            {error && <small role="alert">{error}</small>}
        </div>
    );
}
