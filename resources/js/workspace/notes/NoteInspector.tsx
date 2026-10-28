import { t } from '../../i18n';
import { useState, useSyncExternalStore } from 'react';
import { EyeOff, Trash2, X } from 'lucide-react';
import type { SceneStore } from '../../tabletop/state/SceneStore';
import type { SceneNote } from '../../tabletop/types/scene';
import { ConfirmDialog } from '../ConfirmDialog';
export function NoteInspector({ store }: { store: SceneStore }) {
    const { scene, selectedNoteId } = useSyncExternalStore(store.subscribe, store.getSnapshot);
    const [confirm, setConfirm] = useState(false);
    const note = scene.notes?.find((n) => n.id === selectedNoteId);
    if (!note) return null;
    return (
        <aside className="note-inspector panel" aria-label={t('GM note editor')}>
            <div className="panel-heading">
                <span>
                    <EyeOff size={14} /> {t('GM only')}{' '}
                </span>
                <button
                    className="icon-button"
                    aria-label={t('Close note')}
                    onClick={() => store.selectNote()}
                >
                    <X size={16} />
                </button>
            </div>
            <div className="note-fields">
                <label className="field">
                    {' '}
                    {t('Title')}{' '}
                    <input
                        key={note.id + note.title}
                        defaultValue={note.title}
                        maxLength={160}
                        onBlur={(e) => {
                            const title = e.target.value.trim();
                            if (title && title !== note.title) store.updateNote(note.id, { title });
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') e.currentTarget.blur();
                        }}
                    />
                </label>
                <label className="field">
                    {' '}
                    {t('Marker')}{' '}
                    <select
                        value={note.icon}
                        onChange={(e) =>
                            store.updateNote(note.id, { icon: e.target.value as SceneNote['icon'] })
                        }
                    >
                        {['note', 'warning', 'secret', 'encounter', 'clue'].map((icon) => (
                            <option key={icon} value={icon}>
                                {t(`marker.${icon}` as import('../../i18n').TranslationKey)}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="field">
                    {' '}
                    {t('Private notes')}{' '}
                    <textarea
                        value={note.body}
                        maxLength={20000}
                        placeholder={t('A reminder, a secret, a clue…')}
                        onChange={(e) => store.updateNote(note.id, { body: e.target.value }, true)}
                        onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                                e.stopPropagation();
                                store.selectNote();
                            }
                        }}
                    />
                </label>
                <p className="hint">
                    {' '}
                    {t(
                        'Plain text. Saves as you write. Drag the marker to move it; players never receive it.',
                    )}{' '}
                </p>
                <button className="danger-button" onClick={() => setConfirm(true)}>
                    <Trash2 size={13} /> {t('Delete note')}{' '}
                </button>
                {confirm && (
                    <ConfirmDialog
                        title={t('Delete GM note?')}
                        description={t('deleteNote', { name: note.title })}
                        onClose={() => setConfirm(false)}
                        submit={async () => {
                            store.noteCommand({ action: 'delete', id: note.id });
                            store.selectNote();
                        }}
                    />
                )}
            </div>
        </aside>
    );
}
