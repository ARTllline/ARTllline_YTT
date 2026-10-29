import { useEffect, useRef, useState } from 'react';
import { ArrowUp, ArrowDown, Plus, Trash2, MousePointer2 } from 'lucide-react';
import { commandId } from '../../api/workspace';
import type { SceneStore } from '../../tabletop/state/SceneStore';
import {
    interactions,
    interactionIcons,
    type ObjectInteraction,
    type InteractionResources,
} from './model';

export function InteractionEditor({
    store,
    kind,
    id,
    actions = [],
    disabled,
}: {
    store: SceneStore;
    kind: 'token' | 'prop';
    id: string;
    actions?: ObjectInteraction[];
    disabled: boolean;
}) {
    const [draft, setDraft] = useState(actions);
    const [resources, setResources] = useState<InteractionResources | null>(null);
    const [busy, setBusy] = useState(false),
        [error, setError] = useState(''),
        [saved, setSaved] = useState(false);
    const [opened, setOpened] = useState(false);
    const mutation = useRef<string | null>(null);
    const sceneId = store.getSnapshot().scene.id!;
    useEffect(() => {
        if (!opened) return;
        const controller = new AbortController();
        void interactions
            .resources(sceneId, controller.signal)
            .then(setResources)
            .catch((e) => {
                if (!controller.signal.aborted) setError(e.message);
            });
        return () => controller.abort();
    }, [opened, sceneId]);
    const change = (next: ObjectInteraction[]) => {
        mutation.current = null;
        setDraft(next);
        setSaved(false);
        setError('');
    };
    const patch = (index: number, value: Partial<ObjectInteraction>) =>
        change(draft.map((a, i) => (i === index ? { ...a, ...value } : a)));
    const move = (index: number, delta: number) => {
        const next = [...draft];
        [next[index], next[index + delta]] = [next[index + delta], next[index]];
        change(next);
    };
    return (
        <details
            className="inspector-section interaction-editor"
            onToggle={(e) => setOpened(e.currentTarget.open)}
        >
            <summary>
                <MousePointer2 size={14} /> Взаимодействия <small>{draft.length || ''}</small>
            </summary>
            <section>
                <p className="hint">
                    Игрок: ПКМ или долгое нажатие. Материал откроется только ему; событие действует
                    на сцену.
                </p>
                <fieldset disabled={disabled || busy}>
                    {draft.map((action, index) => {
                        const options =
                            action.result_type === 'cue' ? resources?.cues : resources?.handouts;
                        const Icon = interactionIcons[action.icon].Icon;
                        return (
                            <div
                                className={`interaction-card ${!action.enabled ? 'is-disabled' : ''}`}
                                key={action.id}
                            >
                                <div className="interaction-card-head">
                                    <Icon size={16} />
                                    <input
                                        aria-label={`Название действия ${index + 1}`}
                                        value={action.label}
                                        maxLength={48}
                                        placeholder="Прочитать"
                                        onChange={(e) => patch(index, { label: e.target.value })}
                                    />
                                    <label title="Доступно игрокам">
                                        <input
                                            aria-label={`Включить действие ${index + 1}`}
                                            type="checkbox"
                                            checked={!!action.enabled}
                                            onChange={(e) =>
                                                patch(index, { enabled: e.target.checked })
                                            }
                                        />
                                    </label>
                                </div>
                                <div className="interaction-result">
                                    <select
                                        aria-label={`Результат действия ${index + 1}`}
                                        value={action.result_type}
                                        onChange={(e) =>
                                            patch(index, {
                                                result_type: e.target.value as 'cue' | 'handout',
                                                result_target: '',
                                            })
                                        }
                                    >
                                        <option value="handout">Открыть Handout</option>
                                        <option value="cue">Запустить Cue</option>
                                    </select>
                                    <select
                                        aria-label={`Цель действия ${index + 1}`}
                                        value={action.result_target}
                                        onChange={(e) =>
                                            patch(index, { result_target: e.target.value })
                                        }
                                    >
                                        <option value="">
                                            {resources ? 'Выберите…' : 'Загрузка…'}
                                        </option>
                                        {action.result_target &&
                                            !options?.some(
                                                (o) => o.id === action.result_target,
                                            ) && (
                                                <option value={action.result_target}>
                                                    Цель недоступна
                                                </option>
                                            )}
                                        {options?.map((o) => (
                                            <option key={o.id} value={o.id}>
                                                {o.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="interaction-card-tools">
                                    <select
                                        aria-label={`Иконка действия ${index + 1}`}
                                        value={action.icon}
                                        onChange={(e) =>
                                            patch(index, {
                                                icon: e.target.value as ObjectInteraction['icon'],
                                            })
                                        }
                                    >
                                        {Object.entries(interactionIcons).map(([key, value]) => (
                                            <option key={key} value={key}>
                                                {value.label}
                                            </option>
                                        ))}
                                    </select>
                                    <button
                                        className="icon-button"
                                        aria-label={`Выше: ${action.label}`}
                                        disabled={index === 0}
                                        onClick={() => move(index, -1)}
                                    >
                                        <ArrowUp size={14} />
                                    </button>
                                    <button
                                        className="icon-button"
                                        aria-label={`Ниже: ${action.label}`}
                                        disabled={index === draft.length - 1}
                                        onClick={() => move(index, 1)}
                                    >
                                        <ArrowDown size={14} />
                                    </button>
                                    <button
                                        className="icon-button"
                                        aria-label={`Удалить: ${action.label}`}
                                        onClick={() => change(draft.filter((_, i) => i !== index))}
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                    <div className="interaction-editor-footer">
                        <button
                            className="text-button"
                            disabled={draft.length >= 8}
                            onClick={() =>
                                change([
                                    ...draft,
                                    {
                                        id: commandId(),
                                        label: 'Прочитать',
                                        icon: 'book',
                                        result_type: 'handout',
                                        result_target: '',
                                        enabled: true,
                                    },
                                ])
                            }
                        >
                            <Plus size={14} /> Действие
                        </button>
                        <button
                            className="secondary-button"
                            disabled={
                                !resources || draft.some((a) => !a.label.trim() || !a.result_target)
                            }
                            onClick={() => {
                                mutation.current ??= commandId();
                                setBusy(true);
                                setError('');
                                setSaved(false);
                                void interactions
                                    .save(sceneId, kind, id, draft, mutation.current)
                                    .then((result) => {
                                        store.accept(result, true);
                                        mutation.current = null;
                                        setSaved(true);
                                    })
                                    .catch((e) => setError(e.message))
                                    .finally(() => setBusy(false));
                            }}
                        >
                            {busy ? 'Сохраняем…' : 'Сохранить'}
                        </button>
                    </div>
                </fieldset>
                {saved && (
                    <p className="interaction-saved" role="status">
                        Действия сохранены
                    </p>
                )}
                {error && (
                    <p className="error" role="alert">
                        {error}
                    </p>
                )}
            </section>
        </details>
    );
}
