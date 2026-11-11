import { useEffect, useRef, useState } from 'react';
import { ArrowUp, ArrowDown, Plus, Trash2, MousePointer2 } from 'lucide-react';
import { commandId } from '../../api/workspace';
import { ApiError } from '../../api/client';
import { abilityLabels } from '../../rpg/rules';
import { CheckEditor, CheckHistoryList, defaultCheck } from './CheckEditor';
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
    const [base, setBase] = useState(actions);
    const [uncertain, setUncertain] = useState(false);
    const [resources, setResources] = useState<InteractionResources | null>(null);
    const [busy, setBusy] = useState(false),
        [error, setError] = useState(''),
        [saved, setSaved] = useState(false);
    const [opened, setOpened] = useState(false);
    const mutation = useRef<string | null>(null);
    const sceneId = store.getSnapshot().scene.id!;
    const remoteChanged = JSON.stringify(actions) !== JSON.stringify(base);
    if (remoteChanged && JSON.stringify(draft) === JSON.stringify(base) && !busy) {
        setBase(actions);
        setDraft(actions);
    }
    const scene = store.getSnapshot().scene;
    const stats = [
        ...new Map(
            [
                ...Object.entries(abilityLabels).map(([key, label]) => ({ key, label })),
                ...(scene.characters ?? []).flatMap((c) => c.derived?.checks ?? []),
                ...scene.tokens.flatMap((t) => t.checkStats ?? []),
            ].map((s) => [s.key, { key: s.key, label: s.label }]),
        ).values(),
    ];
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
    const save = () => {
        mutation.current ??= commandId();
        setBusy(true);
        setError('');
        setSaved(false);
        const uuid = mutation.current;
        const run = () => interactions.save(sceneId, kind, id, draft, uuid, base);
        void (store.history ? store.history.prepare(uuid, run) : run())
            .then((result) => {
                store.accept(result, true);
                if (result.preparationEdit)
                    store.history?.recordPreparation(result.preparationEdit);
                const canonical =
                    (kind === 'prop' ? result.props : result.tokens)?.find((o) => o.id === id)
                        ?.interactions ?? draft;
                setBase(canonical);
                setDraft(canonical);
                mutation.current = null;
                setUncertain(false);
                setSaved(true);
            })
            .catch((e) => {
                const terminal = e instanceof ApiError && e.status > 0 && e.status < 500;
                if (terminal) mutation.current = null;
                setUncertain(!terminal);
                setError(e.message);
            })
            .finally(() => setBusy(false));
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
                {remoteChanged && (
                    <div role="alert">
                        <p>Взаимодействия изменились в другой вкладке. Черновик сохранён здесь.</p>
                        <button
                            disabled={busy || uncertain}
                            onClick={() => {
                                setBase(actions);
                                change(actions);
                            }}
                        >
                            Загрузить актуальные действия
                        </button>
                    </div>
                )}
                <fieldset disabled={disabled || busy || uncertain}>
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
                                <label className="check-toggle">
                                    <input
                                        type="checkbox"
                                        checked={!!action.check?.enabled}
                                        onChange={(e) =>
                                            patch(index, {
                                                check: e.target.checked
                                                    ? {
                                                          ...defaultCheck(),
                                                          ...action.check,
                                                          enabled: true,
                                                      }
                                                    : {
                                                          ...action.check,
                                                          enabled: false,
                                                          label:
                                                              action.check?.label ??
                                                              'Внимательность',
                                                      },
                                            })
                                        }
                                    />
                                    Требуется проверка
                                </label>
                                {action.check?.enabled ? (
                                    <CheckEditor
                                        value={action.check}
                                        resources={resources}
                                        stats={stats}
                                        onChange={(check) => patch(index, { check })}
                                    />
                                ) : (
                                    <div className="interaction-result">
                                        <select
                                            aria-label={`Результат действия ${index + 1}`}
                                            value={action.result_type}
                                            onChange={(e) =>
                                                patch(index, {
                                                    result_type: e.target.value as
                                                        'cue' | 'handout' | 'nothing',
                                                    result_target: '',
                                                })
                                            }
                                        >
                                            <option value="handout">Открыть Handout</option>
                                            <option value="cue">Запустить Cue</option>
                                            <option value="nothing">Ничего</option>
                                        </select>
                                        {action.result_type !== 'nothing' && (
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
                                        )}
                                    </div>
                                )}
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
                        {(['Осмотреть', 'Взаимодействовать'] as const).map((label) => (
                            <button
                                key={label}
                                className="text-button"
                                disabled={draft.length >= 8}
                                onClick={() =>
                                    change([
                                        ...draft,
                                        {
                                            id: commandId(),
                                            label,
                                            icon: label === 'Осмотреть' ? 'eye' : 'hand',
                                            result_type: 'nothing',
                                            result_target: '',
                                            enabled: true,
                                        },
                                    ])
                                }
                            >
                                <Plus size={14} /> {label}
                            </button>
                        ))}
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
                                !resources ||
                                remoteChanged ||
                                draft.some(
                                    (a) =>
                                        !a.label.trim() ||
                                        (a.check?.enabled
                                            ? !a.check.label.trim() ||
                                              [a.check.success, a.check.failure].some(
                                                  (branch) =>
                                                      !branch ||
                                                      (branch.result_type !== 'nothing' &&
                                                          !branch.result_target),
                                              )
                                            : a.result_type !== 'nothing' && !a.result_target),
                                )
                            }
                            onClick={save}
                        >
                            {busy ? 'Сохраняем…' : 'Сохранить'}
                        </button>
                    </div>
                </fieldset>
                <CheckHistoryList sceneId={sceneId} kind={kind} id={id} />
                {saved && (
                    <p className="interaction-saved" role="status">
                        Действия сохранены
                    </p>
                )}
                {error && (
                    <p className="error" role="alert">
                        {error}
                        {uncertain && (
                            <button disabled={busy} onClick={save}>
                                Повторить сохранение
                            </button>
                        )}
                    </p>
                )}
            </section>
        </details>
    );
}
