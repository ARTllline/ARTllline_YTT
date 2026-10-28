import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Copy, GripVertical, Plus, Trash2, X } from 'lucide-react';
import {
    itemLabels,
    itemTitle,
    moveItem,
    sessions,
    type GameSession,
    type ItemType,
    type ReferenceType,
    type SessionItem,
} from './model';
import { ResourcePicker } from './ResourcePicker';

export function SessionPlanner({
    campaignId,
    initial,
    onSaved,
    onClose,
}: {
    campaignId: string;
    initial: GameSession;
    onSaved: (session: GameSession) => void;
    onClose: () => void;
}) {
    const [name, setName] = useState(initial.name),
        [items, setItems] = useState(initial.items);
    const [selected, setSelected] = useState(initial.items[0]?.id ?? ''),
        [adding, setAdding] = useState<ReferenceType | null>(null);
    const [error, setError] = useState(''),
        [busy, setBusy] = useState(false);
    const dialog = useRef<HTMLDialogElement>(null);
    const dirty = name !== initial.name || JSON.stringify(items) !== JSON.stringify(initial.items);
    const close = () => {
        if (!busy && (!dirty || confirm('Закрыть редактор и не сохранять изменения плана?')))
            onClose();
    };
    useEffect(() => {
        dialog.current?.showModal();
    }, []);
    useEffect(() => {
        const guard = (e: BeforeUnloadEvent) => {
            if (dirty) {
                e.preventDefault();
                e.returnValue = '';
            }
        };
        window.addEventListener('beforeunload', guard);
        return () => window.removeEventListener('beforeunload', guard);
    }, [dirty]);
    const add = (
        type: ItemType,
        referenceId: string | null = null,
        title = '',
        sceneId: string | null = null,
    ) => {
        const item: SessionItem = {
            id: crypto.randomUUID(),
            type,
            referenceId,
            title: '',
            name: title,
            notes: '',
            sceneId,
            missing: false,
        };
        setItems([...items, item]);
        setSelected(item.id);
        setAdding(null);
    };
    const current = items.find((i) => i.id === selected);
    const change = (patch: Partial<SessionItem>) =>
        setItems(items.map((i) => (i.id === selected ? { ...i, ...patch } : i)));
    return (
        <dialog
            ref={dialog}
            className="session-planner"
            onCancel={(e) => {
                e.preventDefault();
                close();
            }}
        >
            <header>
                <div>
                    <span className="eyebrow">ПОДГОТОВКА · ТОЛЬКО МАСТЕР</span>
                    <h2>План сессии</h2>
                </div>
                <button className="icon-button" aria-label="Закрыть план" onClick={close}>
                    <X size={18} />
                </button>
            </header>
            <label className="session-name">
                Название
                <input maxLength={160} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <nav className="session-add" aria-label="Добавить пункт">
                {(Object.keys(itemLabels) as ItemType[]).map((type) => (
                    <button
                        disabled={items.length >= 200 || busy}
                        key={type}
                        onClick={() =>
                            type === 'note' || type === 'chapter' ? add(type) : setAdding(type)
                        }
                    >
                        <Plus size={12} />
                        {itemLabels[type]}
                    </button>
                ))}
            </nav>
            <div className="session-planner-body">
                <ol className="session-plan-list">
                    {items.map((item, index) => (
                        <li
                            key={item.id}
                            className={`${item.type === 'chapter' ? 'chapter' : ''} ${selected === item.id ? 'selected' : ''}`}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                                e.preventDefault();
                                setItems(
                                    moveItem(
                                        items,
                                        e.dataTransfer.getData('application/x-ytt-session-item'),
                                        index,
                                    ),
                                );
                            }}
                        >
                            <button
                                className="session-grip"
                                draggable
                                aria-label={`Переместить ${itemTitle(item)}`}
                                onDragStart={(e) =>
                                    e.dataTransfer.setData(
                                        'application/x-ytt-session-item',
                                        item.id,
                                    )
                                }
                            >
                                <GripVertical size={15} />
                            </button>
                            <button
                                className="session-item-title"
                                onClick={() => {
                                    setSelected(item.id);
                                    setAdding(null);
                                }}
                            >
                                <small>
                                    {String(index + 1).padStart(2, '0')} · {itemLabels[item.type]}
                                </small>
                                <strong>{itemTitle(item)}</strong>
                                {item.missing && (
                                    <span className="form-error">Ссылка недоступна</span>
                                )}
                            </button>
                        </li>
                    ))}
                    {!items.length && (
                        <li className="session-empty">
                            Начните со сцены. Затем добавьте событие, материал или короткую заметку.
                        </li>
                    )}
                </ol>
                <section className="session-item-editor">
                    {adding ? (
                        <>
                            <h3>Добавить: {itemLabels[adding]}</h3>
                            <ResourcePicker
                                key={adding}
                                campaignId={campaignId}
                                type={adding}
                                onChoose={(r) => add(adding, r.id, r.name, r.sceneId)}
                            />
                        </>
                    ) : current ? (
                        <>
                            <span className="eyebrow">{itemLabels[current.type]}</span>
                            <h3>{current.name || itemLabels[current.type]}</h3>
                            <label>
                                Заголовок в плане
                                <input
                                    maxLength={160}
                                    value={current.title}
                                    placeholder={current.name || 'Например: Пролог'}
                                    onChange={(e) => change({ title: e.target.value })}
                                />
                            </label>
                            <label>
                                Заметка мастера
                                <textarea
                                    rows={7}
                                    maxLength={4000}
                                    value={current.notes}
                                    placeholder="Напоминание, варианты развития, важная деталь…"
                                    onChange={(e) => change({ notes: e.target.value })}
                                />
                            </label>
                            <div className="session-item-tools">
                                <button
                                    title="Выше"
                                    aria-label="Пункт выше"
                                    onClick={() =>
                                        setItems(
                                            moveItem(items, current.id, items.indexOf(current) - 1),
                                        )
                                    }
                                >
                                    <ArrowUp size={15} />
                                </button>
                                <button
                                    title="Ниже"
                                    aria-label="Пункт ниже"
                                    onClick={() =>
                                        setItems(
                                            moveItem(items, current.id, items.indexOf(current) + 1),
                                        )
                                    }
                                >
                                    <ArrowDown size={15} />
                                </button>
                                <button
                                    disabled={items.length >= 200}
                                    onClick={() => {
                                        const copy = { ...current, id: crypto.randomUUID() };
                                        const next = [...items];
                                        next.splice(items.indexOf(current) + 1, 0, copy);
                                        setItems(next);
                                        setSelected(copy.id);
                                    }}
                                >
                                    <Copy size={14} />
                                    Копия
                                </button>
                                <button
                                    onClick={() => {
                                        setItems(items.filter((i) => i.id !== current.id));
                                        setSelected('');
                                    }}
                                >
                                    <Trash2 size={14} />
                                    Удалить
                                </button>
                            </div>
                        </>
                    ) : (
                        <p className="hint">Выберите пункт слева или добавьте новый.</p>
                    )}
                </section>
            </div>
            <footer>
                {error && (
                    <p role="alert" className="form-error">
                        {error}
                    </p>
                )}
                <span className="hint">
                    {items.length} / 200 · Переход по плану не запускает действия.
                </span>
                <button className="secondary-button" disabled={busy} onClick={close}>
                    Отмена
                </button>
                <button
                    className="primary-button"
                    disabled={busy || !name.trim()}
                    onClick={() => {
                        setBusy(true);
                        setError('');
                        void sessions
                            .command(campaignId, 'save', {
                                sessionId: initial.id,
                                name,
                                planRevision: initial.planRevision,
                                items: items.map(({ id, type, referenceId, title, notes }) => ({
                                    id,
                                    type,
                                    referenceId,
                                    title,
                                    notes,
                                })),
                            })
                            .then(({ session }) => {
                                onSaved(session);
                                onClose();
                            })
                            .catch((e) => setError(e.message))
                            .finally(() => setBusy(false));
                    }}
                >
                    {busy ? 'Сохранение…' : 'Сохранить план'}
                </button>
            </footer>
        </dialog>
    );
}
