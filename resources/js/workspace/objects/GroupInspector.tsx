import { EncounterSelection } from '../encounters/EncounterPanel';
import { SaveComposition } from './SaveComposition';
import '../creation/compositions.css';
import { useSyncExternalStore } from 'react';
import { Box, CircleUserRound, MousePointer2, Copy, Trash2, Eye, EyeOff } from 'lucide-react';
import type { SaveQueue } from '../../tabletop/state/SaveQueue';
import { Panel } from '../ui/Controls';
import type { SceneStore } from '../../tabletop/state/SceneStore';
import {
    selectionBounds,
    selectionMembers,
    translationIssue,
    duplicateIssue,
} from '../../tabletop/utils/selectionTransform';

export function GroupInspector({
    store,
    queue,
    onClose,
    onEncounters,
}: {
    store: SceneStore;
    queue: SaveQueue;
    onClose: () => void;
    onEncounters?: () => void;
}) {
    const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
    const save = useSyncExternalStore(queue.subscribe, queue.getSnapshot);
    const members = selectionMembers(state.scene, store.selection());
    const bounds = selectionBounds(members);
    const issue = translationIssue(members);
    const tokens = members.filter((o) => 'size' in o);
    const props = members.filter((o) => 'image' in o && !('size' in o));
    const hidden = members.filter((o) => o.isHidden).length;
    const duplicateError = duplicateIssue(members);
    const busy = save.status !== 'saved' || !!state.duplicatePlacement;
    const containers = members.filter((o) => o.loot).length;
    const interactions = members.filter((o) => o.interactions?.length).length;
    return (
        <Panel title="Выбранная группа" subtitle="ПОДГОТОВКА СЦЕНЫ" onClose={onClose}>
            <div className="preparation-group-inspector" aria-label="Свойства группы">
                <div className="group-selection-heading">
                    <MousePointer2 size={25} />
                    <div>
                        <strong>Выбрано: {members.length}</strong>
                        <small>Общее расположение</small>
                    </div>
                </div>
                <div className="group-selection-counts">
                    <span>
                        <CircleUserRound size={14} />
                        NPC: {tokens.filter((o) => o.kind === 'npc').length} · Персонажи:{' '}
                        {tokens.filter((o) => o.kind === 'player_character').length}
                    </span>
                    <span>
                        <Box size={14} />
                        Объекты: {props.length}
                    </span>
                    {containers > 0 && <span>Контейнеры: {containers}</span>}
                    {interactions > 0 && <span>С действиями: {interactions}</span>}
                </div>
                <p className="group-visibility-state">
                    {hidden === 0
                        ? 'Нет ручного скрытия'
                        : hidden === members.length
                          ? 'Все скрыты вручную'
                          : `Смешанная видимость · скрыто ${hidden} из ${members.length}`}
                </p>
                {onEncounters && <EncounterSelection store={store} onOpen={onEncounters} disabled={busy} />}
                <SaveComposition store={store} disabled={busy} />
                <div className="group-operation-grid">
                    <button
                        className="secondary-button"
                        disabled={busy || !!duplicateError}
                        title={duplicateError || 'Разместить независимые копии · Ctrl+D'}
                        onClick={() => store.onSelectionAction?.('duplicate')}
                    >
                        <Copy size={15} />
                        Дублировать
                    </button>
                    <button
                        className="secondary-button"
                        disabled={busy || !!issue}
                        title={issue || 'Удалить экземпляры из сцены'}
                        onClick={() => store.onSelectionAction?.('delete')}
                    >
                        <Trash2 size={15} />
                        Удалить
                    </button>
                    <button
                        className="secondary-button"
                        disabled={busy || !!issue || hidden === members.length}
                        title={issue || 'Скрыть вручную от игроков'}
                        onClick={() =>
                            store.objectCommand({
                                endpoint: 'selection',
                                data: { action: 'hide', ...store.selection() },
                            })
                        }
                    >
                        <EyeOff size={15} />
                        Скрыть
                    </button>
                    <button
                        className="secondary-button"
                        disabled={busy || !!issue || hidden === 0}
                        title={issue || 'Снять ручное скрытие; обзор и туман сохраняются'}
                        onClick={() =>
                            store.objectCommand({
                                endpoint: 'selection',
                                data: { action: 'show', ...store.selection() },
                            })
                        }
                    >
                        <Eye size={15} />
                        Показать
                    </button>
                </div>
                <p className="hint">
                    «Показать» снимает ручное скрытие. Обзор игроков и туман продолжают действовать.
                </p>
                {duplicateError && duplicateError !== issue && (
                    <p className="group-selection-issue">{duplicateError}</p>
                )}
                {state.duplicatePlacement && (
                    <p role="status">
                        Кликните на карте для размещения группы. Esc — отмена.
                        <button
                            className="secondary-button"
                            onClick={() => store.cancelDuplicate()}
                        >
                            Отменить размещение
                        </button>
                    </p>
                )}
                {state.editorNotice && (
                    <p role="alert" className="group-selection-issue">
                        {state.editorNotice}
                    </p>
                )}
                <p>
                    Потяните за любой выбранный объект. Взаимное расположение всей группы
                    сохранится.
                </p>
                <dl className="group-selection-bounds">
                    <div>
                        <dt>Ширина</dt>
                        <dd>{Math.round(bounds.width)} px</dd>
                    </div>
                    <div>
                        <dt>Высота</dt>
                        <dd>{Math.round(bounds.height)} px</dd>
                    </div>
                </dl>
                <div className="group-selection-members">
                    {members.slice(0, 8).map((o) => (
                        <div key={`${'size' in o ? 'token' : 'prop'}:${o.id}`}>
                            {'size' in o ? <CircleUserRound size={16} /> : <Box size={16} />}
                            <span>{o.name || 'Объект'}</span>
                            {o.isLocked && <small>Заблокирован</small>}
                        </div>
                    ))}
                    {members.length > 8 && <small>И ещё {members.length - 8}</small>}
                </div>
                {issue && (
                    <p className="group-selection-issue" role="status">
                        {issue}
                    </p>
                )}
                <p className="hint">
                    <kbd>Shift</kbd> + клик — изменить состав
                    <br />
                    <kbd>Shift</kbd> + рамка — добавить
                    <br />
                    <kbd>Esc</kbd> — снять выделение
                </p>
                <button className="secondary-button" onClick={() => store.select(null)}>
                    Снять выделение
                </button>
            </div>
        </Panel>
    );
}
