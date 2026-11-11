import { useEffect, useRef, useState } from 'react';
import {
    BookOpen,
    Layers,
    Users,
    Volume2,
    Film,
    X,
    ArrowLeft,
    SlidersHorizontal,
    Swords,
} from 'lucide-react';
import { type Campaign } from '../../api/workspace';
import { ResourcePicker } from '../../session/ResourcePicker';
import type { RightPanel } from '../workspaceState';

/** Existing live actions only. Scene activation uses the normal save/navigation guard. */
export function SessionRuntimeControls({
    campaign,
    sceneId,
    open,
    onOpen,
    onPanel,
    onActivate,
}: {
    campaign: Campaign;
    sceneId?: string;
    open: boolean;
    onOpen: (value: boolean) => void;
    onPanel: (panel: RightPanel) => void;
    onActivate: (id: string) => Promise<void>;
}) {
    const [scenes, setScenes] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const root = useRef<HTMLDivElement>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (!open) return;
        const dismiss = (event: PointerEvent) => {
            if (!root.current?.contains(event.target as Node)) onOpen(false);
        };
        document.addEventListener('pointerdown', dismiss);
        return () => document.removeEventListener('pointerdown', dismiss);
    }, [open, onOpen]);
    const close = () => {
        onOpen(false);
        trigger.current?.focus();
    };
    return (
        <div
            className="session-runtime-controls"
            ref={root}
            onKeyDown={(event) => {
                if (event.key === 'Escape') {
                    event.stopPropagation();
                    close();
                }
            }}
        >
            <button
                ref={trigger}
                className="scene-switch"
                aria-expanded={open}
                aria-controls="session-runtime-actions"
                onClick={() => {
                    setScenes(false);
                    onOpen(!open);
                }}
            >
                <SlidersHorizontal size={16} />
                <span>Сессия</span>
            </button>
            {open && (
                <section
                    id="session-runtime-actions"
                    className="session-runtime-actions"
                    aria-label="Инструменты сессии"
                >
                    <header>
                        {scenes ? (
                            <button
                                className="icon-button"
                                aria-label="Назад к действиям"
                                onClick={() => setScenes(false)}
                            >
                                <ArrowLeft size={15} />
                            </button>
                        ) : (
                            <SlidersHorizontal size={16} />
                        )}
                        <strong>{scenes ? 'Переключить сцену' : 'Сейчас за столом'}</strong>
                        <button
                            className="icon-button"
                            aria-label="Закрыть инструменты сессии"
                            onClick={close}
                        >
                            <X size={16} />
                        </button>
                    </header>
                    <div className="runtime-scene-state">
                        <strong>
                            {campaign.scenes.find((s) => s.id === sceneId)?.name ?? 'Сцена'}
                        </strong>
                        <small>
                            {campaign.activeSceneId === sceneId
                                ? 'В эфире · игроки на этой сцене'
                                : `Игроки: ${campaign.scenes.find((s) => s.id === campaign.activeSceneId)?.name ?? 'нет активной сцены'}`}
                        </small>
                    </div>
                    {scenes ? (
                        <fieldset disabled={busy}>
                            <p className="hint">
                                Выбор активирует подготовленную сцену для игроков.
                            </p>
                            <ResourcePicker
                                campaignId={campaign.id}
                                type="scene"
                                onChoose={(resource) => {
                                    if (busy) return;
                                    setBusy(true);
                                    setError('');
                                    void onActivate(resource.id)
                                        .catch((e) => setError((e as Error).message))
                                        .finally(() => setBusy(false));
                                }}
                            />
                        </fieldset>
                    ) : (
                        <nav aria-label="Быстрые действия сессии">
                            <button onClick={() => setScenes(true)}>
                                <Layers size={16} />
                                Переключить сцену
                            </button>
                            {(
                                [
                                    ['encounters', 'Столкновения', Swords],
                                    ['handouts', 'Показать Handout', BookOpen],
                                    ['players', 'Игроки и подключение', Users],
                                    ['audio', 'Звук и атмосфера', Volume2],
                                    ['cues', 'События сцены', Film],
                                ] as const
                            ).map(([id, label, Icon]) => (
                                <button
                                    key={id}
                                    onClick={() => {
                                        close();
                                        onPanel(id);
                                    }}
                                >
                                    <Icon size={16} />
                                    {label}
                                </button>
                            ))}
                        </nav>
                    )}
                    {error && (
                        <p role="alert" className="form-error">
                            {error}
                        </p>
                    )}
                </section>
            )}
        </div>
    );
}
