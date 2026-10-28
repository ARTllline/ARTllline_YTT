import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { Scene } from '../tabletop/types/scene';
import { eventLabels, type Trigger } from './model';

export function TriggerEditor({
    initial,
    scene,
    cues,
    onSave,
    onClose,
}: {
    initial: Trigger;
    scene: Scene;
    cues: { id: string; name: string }[];
    onSave: (t: Trigger) => Promise<void>;
    onClose: () => void;
}) {
    const [draft, setDraft] = useState(initial),
        [busy, setBusy] = useState(false),
        [error, setError] = useState('');
    const dialog = useRef<HTMLDialogElement>(null);
    const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
    const close = () => {
        if (!busy && (!dirty || confirm('Закрыть без сохранения триггера?'))) onClose();
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
    const change = (p: Partial<Trigger>) => setDraft({ ...draft, ...p });
    const region = draft.eventType.startsWith('region.');
    const objects = draft.objectType === 'token' ? scene.tokens : (scene.props ?? []);
    return (
        <dialog
            ref={dialog}
            className="trigger-editor"
            onCancel={(e) => {
                e.preventDefault();
                close();
            }}
        >
            <header className="panel-heading">
                <div>
                    <span className="eyebrow">КОГДА → ЗАПУСТИТЬ СОБЫТИЕ</span>
                    <h2>{initial.id ? 'Настроить триггер' : 'Новый триггер'}</h2>
                </div>
                <button
                    className="icon-button"
                    aria-label="Закрыть редактор триггера"
                    onClick={close}
                >
                    <X size={18} />
                </button>
            </header>
            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    setBusy(true);
                    setError('');
                    void onSave(draft)
                        .then(onClose)
                        .catch((e) => setError(e.message))
                        .finally(() => setBusy(false));
                }}
            >
                <label>
                    Название
                    <input
                        required
                        maxLength={160}
                        value={draft.name}
                        onChange={(e) => change({ name: e.target.value })}
                    />
                </label>
                <label>
                    Когда
                    <select
                        value={draft.eventType}
                        onChange={(e) =>
                            change({ eventType: e.target.value as Trigger['eventType'] })
                        }
                    >
                        {Object.entries(eventLabels).map(([id, label]) => (
                            <option key={id} value={id}>
                                {label}
                            </option>
                        ))}
                    </select>
                </label>
                {region && (
                    <>
                        <label>
                            Область
                            <select
                                required
                                value={draft.regionId ?? ''}
                                onChange={(e) => change({ regionId: e.target.value })}
                            >
                                <option value="">Выберите область…</option>
                                {scene.regions?.map((r) => (
                                    <option key={r.id} value={r.id}>
                                        {r.name}
                                        {r.enabled ? '' : ' · выключена'}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label>
                            Какие токены
                            <select
                                value={draft.actorFilter}
                                onChange={(e) =>
                                    change({
                                        actorFilter: e.target.value as Trigger['actorFilter'],
                                    })
                                }
                            >
                                <option value="player">Любой токен игрока</option>
                                <option value="token">Конкретный токен</option>
                                <option value="any">Любой токен</option>
                            </select>
                        </label>
                        {draft.actorFilter === 'token' && (
                            <label>
                                Токен
                                <select
                                    required
                                    value={draft.actorTokenId ?? ''}
                                    onChange={(e) => change({ actorTokenId: e.target.value })}
                                >
                                    <option value="">Выберите токен…</option>
                                    {scene.tokens.map((t) => (
                                        <option key={t.id} value={t.id}>
                                            {t.name}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        )}
                        <p className="hint">
                            Срабатывает при пересечении краем токена границы после сохранённого
                            перемещения. Касание считается входом.
                        </p>
                    </>
                )}
                {draft.eventType === 'object.interact' && (
                    <>
                        <label>
                            Тип объекта
                            <select
                                value={draft.objectType}
                                onChange={(e) =>
                                    change({
                                        objectType: e.target.value as Trigger['objectType'],
                                        objectId: null,
                                    })
                                }
                            >
                                <option value="token">Токен</option>
                                <option value="prop">Объект</option>
                            </select>
                        </label>
                        <label>
                            Объект
                            <select
                                required
                                value={draft.objectId ?? ''}
                                onChange={(e) => change({ objectId: e.target.value })}
                            >
                                <option value="">Выберите объект…</option>
                                {objects.map((o) => (
                                    <option key={o.id} value={o.id}>
                                        {o.name || 'Без названия'}
                                        {o.isHidden ? ' · скрыт' : ''}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <p className="hint">
                            Игрок нажимает «Взаимодействовать» у видимого объекта. Обычное выделение
                            ничего не запускает.
                        </p>
                    </>
                )}
                {draft.eventType === 'combat.round' && (
                    <label>
                        Начиная с раунда
                        <input
                            type="number"
                            min={1}
                            max={9999}
                            required
                            value={draft.minimumRound}
                            onChange={(e) => change({ minimumRound: Number(e.target.value) })}
                        />
                    </label>
                )}
                <label>
                    Запустить событие
                    <select
                        required
                        value={draft.cueId ?? ''}
                        onChange={(e) => change({ cueId: e.target.value })}
                    >
                        <option value="">Выберите подготовленное событие…</option>
                        {cues.map((c) => (
                            <option key={c.id} value={c.id}>
                                {c.name}
                            </option>
                        ))}
                    </select>
                </label>
                {!cues.length && (
                    <p className="form-error">
                        Сначала подготовьте событие для этой сцены в разделе «События».
                    </p>
                )}
                <div className="trigger-options">
                    <label className="check-row">
                        <input
                            type="checkbox"
                            checked={draft.enabled}
                            onChange={(e) => change({ enabled: e.target.checked })}
                        />
                        Включён
                    </label>
                    <label className="check-row">
                        <input
                            type="checkbox"
                            checked={draft.once}
                            onChange={(e) => change({ once: e.target.checked })}
                        />
                        Только один раз
                    </label>
                </div>
                <label>
                    Пауза между запусками
                    <select
                        value={draft.cooldownMs}
                        onChange={(e) => change({ cooldownMs: Number(e.target.value) })}
                    >
                        {[
                            [0, 'Нет'],
                            [5000, '5 секунд'],
                            [30000, '30 секунд'],
                            [60000, '1 минута'],
                            [300000, '5 минут'],
                        ].map(([v, label]) => (
                            <option key={v} value={v}>
                                {label}
                            </option>
                        ))}
                    </select>
                </label>
                {!!initial.fireCount && (
                    <p className="hint">
                        Уже срабатывал: {initial.fireCount}. Изменение настроек не сбрасывает
                        историю. При необходимости используйте «Разрешить снова» в списке.
                    </p>
                )}
                {error && (
                    <p className="form-error" role="alert">
                        {error}
                    </p>
                )}
                <footer>
                    <button
                        type="button"
                        className="secondary-button"
                        disabled={busy}
                        onClick={close}
                    >
                        Отмена
                    </button>
                    <button className="primary-button" disabled={busy}>
                        {busy ? 'Сохранение…' : 'Сохранить триггер'}
                    </button>
                </footer>
            </form>
        </dialog>
    );
}
