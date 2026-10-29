import { actingToken, eligibleActors } from '../interactions/actingToken';
import {
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    useSyncExternalStore,
    type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { Plus, X } from 'lucide-react';
import { buildRadialActions, type RadialTarget } from './radialActions';
import type { SceneStore } from '../../tabletop/state/SceneStore';
import type { SaveQueue } from '../../tabletop/state/SaveQueue';
import type { TabletopRenderer } from '../../tabletop/renderer/TabletopRenderer';
import type { RightPanel } from '../workspaceState';
import { radialPosition, radialSlot, radialFocus } from './radialLayout';
import { interactions, interactionIcons } from '../interactions/model';
import { commandId } from '../../api/workspace';
import type { Handout } from '../../api/preparation';
import { HandoutViewer } from '../handouts/HandoutViewer';
import { CheckDialog, type CheckInvocation } from '../interactions/CheckDialog';
export function RadialMenu({
    store,
    queue,
    renderer,
    onPanel,
    onCreate,
    disabled = false,
}: {
    store: SceneStore;
    queue: SaveQueue;
    renderer: RefObject<TabletopRenderer | null>;
    onPanel?: (panel: RightPanel) => Promise<void>;
    onCreate?: () => void;
    disabled?: boolean;
}) {
    const mount = useRef<HTMLSpanElement>(null),
        menu = useRef<HTMLDivElement>(null);
    const [target, setTarget] = useState<RadialTarget | null>(null),
        [error, setError] = useState(''),
        [busy, setBusy] = useState(false);
    const [interactionMode, setInteractionMode] = useState(store.role === 'player');
    const [notice, setNotice] = useState('');
    const [preview, setPreview] = useState<Handout | null>(null);
    const [check, setCheck] = useState<CheckInvocation | null>(null);
    const mutation = useRef<{ key: string; id: string } | null>(null);
    useEffect(() => {
        if (!notice) return;
        const timer = setTimeout(() => setNotice(''), 1800);
        return () => clearTimeout(timer);
    }, [notice]);
    const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
    const actors = eligibleActors(snapshot.scene.tokens, store.role);
    const actor = actingToken(actors, snapshot.actingTokenId);
    const save = useSyncExternalStore(queue.subscribe, queue.getSnapshot);
    const create = useRef(onCreate);
    const holdClick = useRef(false);
    useLayoutEffect(() => {
        create.current = onCreate;
    }, [onCreate]);
    const close = () => {
        holdClick.current = false;
        setTarget(null);
        mount.current?.parentElement?.querySelector('canvas')?.focus({ preventScroll: true });
    };
    useEffect(() => {
        const host = mount.current?.parentElement;
        if (!host) return;
        let timer: ReturnType<typeof setTimeout> | undefined,
            origin: { x: number; y: number } | undefined;
        const clear = () => {
            clearTimeout(timer);
            origin = undefined;
        };
        const open = (x: number, y: number) => {
            const hit = renderer.current?.contextTarget(x, y);
            renderer.current?.cancelGesture();
            if (!hit) {
                setTarget(null);
                create.current?.();
                return;
            }
            setError('');
            setInteractionMode(store.role === 'player');
            mutation.current = null;
            setTarget({ ...hit, x, y });
        };
        const context = (e: MouseEvent) => {
            if (!(e.target instanceof HTMLCanvasElement)) return;
            e.preventDefault();
            e.stopPropagation();
            clear();
            open(e.clientX, e.clientY);
        };
        const down = (e: PointerEvent) => {
            clear();
            if (
                !e.isPrimary ||
                e.pointerType !== 'touch' ||
                !(e.target instanceof HTMLCanvasElement)
            )
                return;
            const before = store.getSnapshot();
            origin = { x: e.clientX, y: e.clientY };
            timer = setTimeout(() => {
                // A hold opens context without committing the tap selection. Restore it
                // before releasing pointer capture so the workspace does not resize.
                if (before.scene.id !== store.getSnapshot().scene.id) return;
                if (before.selectedNoteId) store.selectNote(before.selectedNoteId);
                else if (before.selectedRegionId) store.selectRegion(before.selectedRegionId);
                else
                    store.selectObjects({
                        tokenIds: [...before.selectedIds],
                        propIds: [...(before.selectedPropIds ?? [])],
                    });
                holdClick.current = true;
                open(e.clientX, e.clientY);
                origin = undefined;
            }, 520);
        };
        const move = (e: PointerEvent) => {
            if (origin && Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > 8) clear();
        };
        const key = (e: KeyboardEvent) => {
            if (
                !(e.target instanceof HTMLCanvasElement) ||
                !(e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))
            )
                return;
            const point = renderer.current?.selectedContextPoint();
            if (point) {
                e.preventDefault();
                e.stopPropagation();
                open(point.x, point.y);
            }
        };
        const dismiss = () => setTarget(null);
        host.addEventListener('contextmenu', context, true);
        host.addEventListener('pointerdown', down, true);
        host.addEventListener('keydown', key, true);
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', clear);
        window.addEventListener('pointercancel', clear);
        window.addEventListener('resize', dismiss);
        window.addEventListener('blur', dismiss);
        return () => {
            clear();
            host.removeEventListener('contextmenu', context, true);
            host.removeEventListener('pointerdown', down, true);
            host.removeEventListener('keydown', key, true);
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', clear);
            window.removeEventListener('pointercancel', clear);
            window.removeEventListener('resize', dismiss);
            window.removeEventListener('blur', dismiss);
        };
    }, [renderer, store]);
    useEffect(() => {
        if (target) menu.current?.querySelector<HTMLButtonElement>('[role=menuitem]')?.focus();
    }, [target]);
    const { entity, actions: gmActions } = buildRadialActions(
        target,
        store,
        queue,
        onPanel ?? (async () => {}),
    );
    const configured =
        entity && 'interactions' in entity && !entity.isHidden
            ? (entity.interactions ?? []).filter((a) => a.enabled !== false)
            : [];
    const actions =
        interactionMode && target && target.kind !== 'region'
            ? configured.map((action) => ({
                  label: action.label,
                  Icon: (interactionIcons[action.icon] ?? interactionIcons.hand).Icon,
                  tone: 'interaction',
                  run: async () => {
                      if (action.check?.enabled) {
                          const snapshot = store.getSnapshot();
                          setCheck({
                              action,
                              sceneId: snapshot.scene.id!,
                              kind: target.kind as 'token' | 'prop',
                              objectId: target.id,
                              epoch: snapshot.scene.liveRevision ?? 0,
                              userId: store.spatial.identity?.id ?? store.role,
                          });
                          return;
                      }
                      if (store.role === 'player' && !actor)
                          throw new Error('Выберите действующего персонажа.');
                      const key = `${actor?.id}:${target.kind}:${target.id}:${action.id}`;
                      if (mutation.current?.key !== key)
                          mutation.current = { key, id: commandId() };
                      const result = await interactions.run(
                          store.getSnapshot().scene.id!,
                          target.kind as 'token' | 'prop',
                          target.id,
                          action.id,
                          store.getSnapshot().scene.liveRevision ?? 0,
                          mutation.current.id,
                          actor?.id,
                      );
                      mutation.current = null;
                      renderer.current?.respondToObject(target.kind as 'token' | 'prop', target.id);
                      setNotice('Действие принято');
                      if (result.handout) setPreview(result.handout);
                  },
              }))
            : gmActions;
    const position = target
        ? radialPosition(target.x, target.y, window.innerWidth, window.innerHeight)
        : null;
    return (
        <>
            <span ref={mount} className="radial-mount" />
            {notice && (
                <div className="interaction-notice" role="status">
                    ✓ {notice}
                </div>
            )}
            {preview && <HandoutViewer handout={preview} onClose={() => setPreview(null)} />}
            {check && (
                <CheckDialog
                    invocation={check}
                    actorRequired={store.role === 'player'}
                    actors={actors}
                    actor={actor}
                    onActorChange={(id) => store.setActingToken(id)}
                    onClose={() => setCheck(null)}
                    onHandout={setPreview}
                />
            )}
            {target &&
                entity &&
                (store.role === 'gm' || configured.length > 0) &&
                position &&
                createPortal(
                    <div
                        className="radial-scrim"
                        onPointerDownCapture={() => {
                            holdClick.current = false;
                        }}
                        onClickCapture={(e) => {
                            // A held finger can lift over the new center action. Consume only
                            // that synthetic click; a fresh pointerdown enables normal actions.
                            if (holdClick.current) {
                                holdClick.current = false;
                                e.preventDefault();
                                e.stopPropagation();
                            }
                        }}
                        onPointerDown={(e) => {
                            if (e.target === e.currentTarget && !busy) close();
                        }}
                        onContextMenu={(e) => e.preventDefault()}
                    >
                        <div
                            ref={menu}
                            className="radial-menu"
                            role="menu"
                            aria-busy={busy}
                            aria-label={`Действия: ${entity.name || 'Объект'}`}
                            style={{
                                left: position.left,
                                top: position.top,
                                width: position.size,
                                height: position.size,
                            }}
                            onKeyDown={(e) => {
                                e.stopPropagation();
                                if (e.key === 'Escape' && !busy) {
                                    e.preventDefault();
                                    close();
                                }
                                const items = [
                                    ...e.currentTarget.querySelectorAll<HTMLButtonElement>(
                                        '[role=menuitem]:not(:disabled)',
                                    ),
                                ];
                                if (
                                    [
                                        'ArrowUp',
                                        'ArrowDown',
                                        'ArrowLeft',
                                        'ArrowRight',
                                        'Home',
                                        'End',
                                    ].includes(e.key) &&
                                    items.length
                                ) {
                                    e.preventDefault();
                                    items[
                                        radialFocus(
                                            items.indexOf(
                                                document.activeElement as HTMLButtonElement,
                                            ),
                                            e.key,
                                            items.length,
                                        )
                                    ]?.focus();
                                }
                                if (e.key === 'Tab' && !busy) {
                                    e.preventDefault();
                                    close();
                                }
                            }}
                        >
                            <div className="radial-center">
                                <span>
                                    {busy
                                        ? 'ПРИМЕНЯЕМ…'
                                        : target.kind === 'region'
                                          ? 'ОБЛАСТЬ'
                                          : target.kind === 'prop'
                                            ? 'ОБЪЕКТ'
                                            : 'ТОКЕН'}
                                </span>
                                <strong>{entity.name || 'Объект'}</strong>
                                {store.role === 'gm' && configured.length > 0 && (
                                    <button
                                        className="radial-mode"
                                        role="menuitem"
                                        disabled={busy}
                                        onClick={() => setInteractionMode(!interactionMode)}
                                    >
                                        {interactionMode
                                            ? '← Инструменты GM'
                                            : `Действия · ${configured.length} →`}
                                    </button>
                                )}
                                {store.role === 'gm' && onCreate && (
                                    <button
                                        className="radial-create"
                                        role="menuitem"
                                        disabled={busy}
                                        title="Добавить на сцену"
                                        onClick={() => {
                                            close();
                                            onCreate();
                                        }}
                                    >
                                        <Plus size={13} /> Добавить
                                    </button>
                                )}
                                <button
                                    title="Закрыть · Esc"
                                    aria-label="Закрыть меню действий"
                                    disabled={busy}
                                    onClick={close}
                                >
                                    <X size={14} />
                                </button>
                            </div>
                            {actions.map(({ label, Icon, run, tone }, index) => (
                                <button
                                    role="menuitem"
                                    key={`${index}:${label}`}
                                    className={`radial-action ${tone ?? ''}`}
                                    style={radialSlot(index, actions.length)}
                                    disabled={disabled || busy || save.status !== 'saved'}
                                    onClick={() => {
                                        setBusy(true);
                                        setError('');
                                        void Promise.resolve()
                                            .then(run)
                                            .then(() => queue.flush())
                                            .then(close)
                                            .catch((e) => setError((e as Error).message))
                                            .finally(() => setBusy(false));
                                    }}
                                >
                                    <Icon size={20} strokeWidth={1.6} />
                                    <span>{label}</span>
                                </button>
                            ))}
                            {error && (
                                <p className="radial-error" role="alert">
                                    {error}
                                </p>
                            )}
                        </div>
                    </div>,
                    document.body,
                )}
        </>
    );
}
