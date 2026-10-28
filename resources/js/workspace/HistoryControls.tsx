import { useSyncExternalStore } from 'react';
import { Undo2, Redo2 } from 'lucide-react';
import type { SceneStore } from '../tabletop/state/SceneStore';
export function HistoryControls({ store }: { store: SceneStore }) {
    const history = store.history!;
    const state = useSyncExternalStore(history.subscribe, history.getSnapshot);
    return (
        <>
            <button
                aria-label="Отменить правку"
                title={
                    state.undo
                        ? `Отменить: ${state.undo} · Ctrl/Cmd+Z`
                        : 'Нет правок для отмены · история этой сцены, до 50 действий'
                }
                disabled={!state.undo || state.busy || state.saving}
                onClick={() => history.run()}
            >
                <Undo2 size={17} />
            </button>
            <button
                aria-label="Повторить правку"
                title={
                    state.redo
                        ? `Повторить: ${state.redo} · Ctrl/Cmd+Shift+Z`
                        : 'Нет отменённых правок'
                }
                disabled={!state.redo || state.busy || state.saving}
                onClick={() => history.run(true)}
            >
                <Redo2 size={17} />
            </button>
            {state.notice && (
                <span className="history-notice" role="status">
                    {state.notice}
                </span>
            )}
        </>
    );
}
