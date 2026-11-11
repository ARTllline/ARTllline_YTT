import { useState } from 'react';
import { BookmarkPlus } from 'lucide-react';
import { compositions } from '../../api/compositions';
import { ApiError } from '../../api/client';
import { usePanelGuard } from '../ui/PanelGuard';
import type { SceneStore } from '../../tabletop/state/SceneStore';
import { selectionMembers } from '../../tabletop/utils/selectionTransform';

export function SaveComposition({ store, disabled }: { store: SceneStore; disabled: boolean }) {
    const [draft, setDraft] = useState<null | {
        selection: ReturnType<SceneStore['selection']>;
        revision: number;
        names: string[];
    }>(null);
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [saved, setSaved] = useState('');
    const [uncertain, setUncertain] = useState(false);
    usePanelGuard(
        busy
            ? 'Дождитесь сохранения пресета.'
            : uncertain
              ? 'Подтвердите сохранение пресета повтором запроса.'
              : '',
    );
    return (
        <div className="composition-save">
            <button
                className="secondary-button"
                disabled={disabled || busy || uncertain}
                onClick={() => {
                    const state = store.getSnapshot();
                    const selection = store.selection();
                    setDraft({
                        selection,
                        revision: state.scene.revision ?? 0,
                        names: selectionMembers(state.scene, selection).map(
                            (m) => m.name || 'Объект',
                        ),
                    });
                    setError('');
                    setSaved('');
                }}
            >
                <BookmarkPlus size={15} />
                Сохранить как пресет
            </button>
            {draft && (
                <form
                    className="composition-form"
                    onSubmit={(e) => {
                        e.preventDefault();
                        setBusy(true);
                        setError('');
                        void compositions
                            .save(
                                store.getSnapshot().scene.id!,
                                draft.selection,
                                draft.revision,
                                name.trim(),
                                description.trim(),
                            )
                            .then((result) => {
                                setUncertain(false);
                                setDraft(null);
                                setSaved(`«${result.preset.name}» сохранён в Пресетах`);
                                setName('');
                                setDescription('');
                            })
                            .catch((e) => {
                                setError(e.message);
                                setUncertain(
                                    e instanceof ApiError && (e.status === 0 || e.status >= 500),
                                );
                            })
                            .finally(() => setBusy(false));
                    }}
                >
                    <strong>Новый пресет · {draft.names.length} элементов</strong>
                    <p className="hint">
                        Личный шаблон для всех ваших кампаний. NPC начнут с полными HP и ресурсами;
                        состояния и история игры не переносятся.
                    </p>
                    <label>
                        Название
                        <input
                            autoFocus
                            required
                            maxLength={160}
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            disabled={busy || uncertain}
                        />
                    </label>
                    <label>
                        Описание
                        <textarea
                            maxLength={2000}
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            disabled={busy || uncertain}
                        />
                    </label>
                    <div className="composition-members">
                        {draft.names.map((n, i) => (
                            <span key={i}>{n}</span>
                        ))}
                    </div>
                    {error && <p role="alert">{error}</p>}
                    <div className="composition-actions">
                        <button
                            className="primary-button"
                            disabled={busy || !name.trim() || disabled}
                        >
                            {busy ? 'Сохраняем…' : 'Сохранить пресет'}
                        </button>
                        <button
                            type="button"
                            className="text-button"
                            disabled={busy || uncertain}
                            onClick={() => setDraft(null)}
                        >
                            Отмена
                        </button>
                    </div>
                </form>
            )}
            {saved && <p role="status">{saved}</p>}
        </div>
    );
}
