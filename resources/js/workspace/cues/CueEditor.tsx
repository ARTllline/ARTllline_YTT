import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Copy, GripVertical, Plus, Trash2, X, Film } from 'lucide-react';
import type { Scene } from '../../tabletop/types/scene';
import { actionLabels, cues, newStep, reorder, type ActionType, type Cue } from './model';
import { CueActionFields } from './CueActionFields';
import { stepSubtitle } from './stepPresentation';

export function CueEditor({
    cue,
    scene,
    onClose,
    onSaved,
}: {
    cue: Cue;
    scene: Scene;
    onClose: () => void;
    onSaved: () => void;
}) {
    const [draft, setDraft] = useState(() => structuredClone(cue));
    const [selected, setSelected] = useState(0),
        [adding, setAdding] = useState<ActionType>('objects.reveal');
    const [busy, setBusy] = useState(false),
        [error, setError] = useState(''),
        [dirty, setDirty] = useState(false);
    const [draggingStep, setDraggingStep] = useState<number | null>(null);
    const [dropStep, setDropStep] = useState<number | null>(null);
    const dialog = useRef<HTMLDialogElement>(null),
        dragged = useRef<number | null>(null);
    useEffect(() => {
        dialog.current?.showModal();
    }, []);
    useEffect(() => {
        const warn = (e: BeforeUnloadEvent) => {
            if (dirty) {
                e.preventDefault();
                e.returnValue = '';
            }
        };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [dirty]);
    const change = (patch: Partial<Cue>) => {
        setDraft((d) => ({ ...d, ...patch }));
        setDirty(true);
    };
    const close = () => {
        if (!busy && (!dirty || window.confirm('Закрыть редактор без сохранения изменений?')))
            onClose();
    };
    const move = (from: number, to: number) => {
        change({ steps: reorder(draft.steps, from, to) });
        setSelected(to);
    };
    const step = draft.steps[selected];
    return (
        <dialog
            ref={dialog}
            className="cue-editor"
            onCancel={(e) => {
                e.preventDefault();
                close();
            }}
        >
            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    setBusy(true);
                    setError('');
                    void cues
                        .command(scene.id!, 'save', { ...draft, cueId: draft.id })
                        .then(() => {
                            setDirty(false);
                            onSaved();
                        })
                        .catch((e) => setError(e.message))
                        .finally(() => setBusy(false));
                }}
            >
                <header>
                    <div>
                        <span className="eyebrow">
                            <Film size={13} /> РЕЖИССЁРСКАЯ ПОСЛЕДОВАТЕЛЬНОСТЬ
                        </span>
                        <h2>{cue.id ? 'Редактор события' : 'Новое событие'}</h2>
                    </div>
                    <button
                        type="button"
                        className="icon-button"
                        aria-label="Закрыть редактор"
                        disabled={busy}
                        onClick={close}
                    >
                        <X size={18} />
                    </button>
                </header>
                <div className="cue-meta">
                    <label>
                        Название
                        <input
                            required
                            maxLength={160}
                            value={draft.name}
                            placeholder="Например, Засада у старого моста"
                            onChange={(e) => change({ name: e.target.value })}
                        />
                    </label>
                    <label>
                        Заметка для мастера
                        <textarea
                            rows={2}
                            maxLength={2000}
                            value={draft.description ?? ''}
                            placeholder="Что должно произойти в этот момент?"
                            onChange={(e) => change({ description: e.target.value })}
                        />
                    </label>
                </div>
                <div className="cue-composer">
                    <section className="cue-timeline" aria-label="Порядок действий">
                        <div className="cue-timeline-heading">
                            <span>ПОСЛЕДОВАТЕЛЬНОСТЬ</span>
                            <b>{draft.steps.length} / 50</b>
                        </div>
                        {draft.steps.map((item, index) => (
                            <div
                                key={index}
                                className={`cue-step ${selected === index ? 'selected' : ''} ${draggingStep === index ? 'is-dragging' : ''} ${dropStep === index ? 'is-drop-target' : ''}`}
                                data-action-family={item.type.split('.')[0]}
                                onDragOver={(e) => {
                                    e.preventDefault();
                                    if (dragged.current !== null) setDropStep(index);
                                }}
                                onDrop={(e) => {
                                    e.preventDefault();
                                    if (dragged.current !== null) move(dragged.current, index);
                                    dragged.current = null;
                                    setDraggingStep(null);
                                    setDropStep(null);
                                }}
                            >
                                <button
                                    type="button"
                                    className="cue-grip"
                                    draggable
                                    aria-label={`Перетащить шаг ${index + 1}`}
                                    onDragStart={(e) => {
                                        dragged.current = index;
                                        setDraggingStep(index);
                                        e.dataTransfer.setData('text/plain', String(index));
                                    }}
                                    onDragEnd={() => {
                                        dragged.current = null;
                                        setDraggingStep(null);
                                        setDropStep(null);
                                    }}
                                >
                                    <GripVertical size={15} />
                                </button>
                                <button
                                    type="button"
                                    className="cue-step-select"
                                    aria-pressed={selected === index}
                                    onClick={() => setSelected(index)}
                                >
                                    <span>{String(index + 1).padStart(2, '0')}</span>
                                    <strong>{actionLabels[item.type]}</strong>
                                    <em className="cue-step-subtitle">{stepSubtitle(item)}</em>
                                    {item.config.duration !== undefined && (
                                        <small>{item.config.duration / 1000} с</small>
                                    )}
                                </button>
                            </div>
                        ))}
                        {!draft.steps.length && (
                            <p className="hint">
                                Добавьте первое действие. Игроки увидят только то, что происходит
                                сейчас.
                            </p>
                        )}
                        <div className="cue-add">
                            <select
                                aria-label="Новое действие"
                                value={adding}
                                onChange={(e) => setAdding(e.target.value as ActionType)}
                            >
                                {Object.entries(actionLabels).map(([type, label]) => (
                                    <option key={type} value={type}>
                                        {label}
                                    </option>
                                ))}
                            </select>
                            <button
                                type="button"
                                className="secondary-button"
                                disabled={draft.steps.length >= 50}
                                onClick={() => {
                                    change({ steps: [...draft.steps, newStep(adding)] });
                                    setSelected(draft.steps.length);
                                }}
                            >
                                <Plus size={14} /> Добавить действие
                            </button>
                        </div>
                    </section>
                    <section className="cue-step-details" aria-label="Настройки действия">
                        {step ? (
                            <>
                                <div className="cue-step-heading">
                                    <h3>
                                        {selected + 1}. {actionLabels[step.type]}
                                    </h3>
                                    <div>
                                        <button
                                            type="button"
                                            className="icon-button"
                                            title="Выше"
                                            aria-label="Шаг выше"
                                            disabled={selected === 0}
                                            onClick={() => move(selected, selected - 1)}
                                        >
                                            <ArrowUp size={15} />
                                        </button>
                                        <button
                                            type="button"
                                            className="icon-button"
                                            title="Ниже"
                                            aria-label="Шаг ниже"
                                            disabled={selected === draft.steps.length - 1}
                                            onClick={() => move(selected, selected + 1)}
                                        >
                                            <ArrowDown size={15} />
                                        </button>
                                        <button
                                            type="button"
                                            className="icon-button"
                                            title="Дублировать"
                                            aria-label="Дублировать шаг"
                                            disabled={draft.steps.length >= 50}
                                            onClick={() => {
                                                const steps = [...draft.steps];
                                                steps.splice(
                                                    selected + 1,
                                                    0,
                                                    structuredClone(step),
                                                );
                                                change({ steps });
                                                setSelected(selected + 1);
                                            }}
                                        >
                                            <Copy size={15} />
                                        </button>
                                        <button
                                            type="button"
                                            className="icon-button"
                                            title="Удалить"
                                            aria-label="Удалить шаг"
                                            onClick={() => {
                                                change({
                                                    steps: draft.steps.filter(
                                                        (_, i) => i !== selected,
                                                    ),
                                                });
                                                setSelected(Math.max(0, selected - 1));
                                            }}
                                        >
                                            <Trash2 size={15} />
                                        </button>
                                    </div>
                                </div>
                                <CueActionFields
                                    key={selected + step.type}
                                    step={step}
                                    scene={scene}
                                    onChange={(config) =>
                                        change({
                                            steps: draft.steps.map((s, i) =>
                                                i === selected ? { ...s, config } : s,
                                            ),
                                        })
                                    }
                                />
                            </>
                        ) : (
                            <div className="cue-empty-detail">
                                <Film size={32} />
                                <p>Соберите момент, который запомнится игрокам.</p>
                            </div>
                        )}
                    </section>
                </div>
                <footer>
                    {error && (
                        <p role="alert" className="cue-error">
                            {error}
                        </p>
                    )}
                    <p className="hint">
                        Запущенное событие использует сохранённую копию. Его план не изменится во
                        время редактирования.
                    </p>
                    <button
                        type="submit"
                        className="primary-button"
                        disabled={busy || !draft.steps.length}
                    >
                        {busy ? 'Сохранение…' : 'Сохранить событие'}
                    </button>
                </footer>
            </form>
        </dialog>
    );
}
