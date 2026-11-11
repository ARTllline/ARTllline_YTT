import { useState, useSyncExternalStore } from 'react';
import { ArrowLeft, Eye, EyeOff, Swords, Users } from 'lucide-react';
import type { SceneStore } from '../../tabletop/state/SceneStore';
import type { SaveQueue } from '../../tabletop/state/SaveQueue';
import { Panel } from '../ui/Controls';
import type { EncounterCombatCommand } from './model';
import '../../../css/encounters.css';

export function SessionEncounters({
    store,
    queue,
    onClose,
    onCombat,
}: {
    store: SceneStore;
    queue: SaveQueue;
    onClose: () => void;
    onCombat: () => void;
}) {
    const { scene, editorNotice } = useSyncExternalStore(
        store.subscribe,
        store.getSnapshot,
        store.getSnapshot,
    );
    const save = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
    const [selected, setSelected] = useState<string | null>(null);
    const [launch, setLaunch] = useState<EncounterCombatCommand | null>(null);
    if (store.role !== 'gm') return null;
    const busy = save.status !== 'saved';
    const encounter = scene.encounters?.find((e) => e.id === selected);
    const run = scene.encounterRuns?.find((r) => r.encounterId === selected);
    const current = new Set(scene.combat?.combatants.map((c) => c.tokenId));
    const tokens = new Map(scene.tokens.map((t) => [t.id, t]));
    const participating = scene.combat && run?.combatId === scene.combat.id;
    const label = (id: string) => {
        if (run?.status === 'ended')
            return run.activatedTokenIds.includes(id) ? 'Завершено' : 'Не участвовал';
        if (current.has(id)) return 'Участвует';
        if (run?.activatedTokenIds.includes(id)) return 'Выведен';
        return encounter?.groups[0].tokenIds.includes(id) ? 'Подготовлено' : 'Резерв';
    };
    const activate = (tokenIds: string[]) => {
        if (!encounter || !scene.combat || busy) return;
        store.encounterCombatCommand({
            id: encounter.id,
            action: 'reinforce',
            expected: encounter,
            expectedCombatId: scene.combat.id,
            tokenIds,
        });
    };
    return (
        <Panel title="Столкновения" subtitle="СЕССИЯ · СОСТАВ И РЕЗЕРВ" onClose={onClose}>
            <div className="encounter-panel session-encounters">
                {editorNotice && (
                    <p className="encounter-warning" role="alert">
                        {editorNotice}
                    </p>
                )}
                {save.status === 'failed' && (
                    <p role="alert">
                        Ответ не получен. Нажмите «Повторить» в статусе сохранения — команда
                        сохранит свой номер.
                    </p>
                )}
                {!encounter ? (
                    <>
                        <p className="hint">
                            Подготовленные составы этой сцены. Запуск и подкрепления используют
                            текущий бой.
                        </p>
                        {!scene.encounters?.length && (
                            <div className="encounter-empty">
                                <Swords size={26} />
                                <strong>Нет подготовленных столкновений</strong>
                                <p>Соберите основную группу и резерв в режиме подготовки.</p>
                            </div>
                        )}
                        <div className="encounter-cards">
                            {scene.encounters?.map((e) => {
                                const r = scene.encounterRuns?.find((r) => r.encounterId === e.id);
                                const ids = e.groups.flatMap((g) => g.tokenIds);
                                const count = ids.filter((id) => current.has(id)).length;
                                return (
                                    <button
                                        key={e.id}
                                        className="encounter-card"
                                        onClick={() => {
                                            setSelected(e.id);
                                            setLaunch(null);
                                        }}
                                    >
                                        <span className="encounter-card-heading">
                                            <strong>{e.name}</strong>
                                            <small data-ready={e.status === 'ready' || !!count}>
                                                {r?.status === 'ended'
                                                    ? 'Завершено'
                                                    : count
                                                      ? 'Участвует'
                                                      : r
                                                        ? 'Выведено из боя'
                                                        : e.status === 'ready'
                                                          ? 'Подготовлено'
                                                          : 'Черновик'}
                                            </small>
                                        </span>
                                        <span>
                                            Основная группа · {e.groups[0].tokenIds.length} · резерв{' '}
                                            {ids.length - e.groups[0].tokenIds.length}
                                        </span>
                                        <small>
                                            {ids
                                                .slice(0, 4)
                                                .map(
                                                    (id) =>
                                                        tokens.get(id)?.name ?? 'Участник удалён',
                                                )
                                                .join(', ') || 'Пустой состав'}
                                        </small>
                                    </button>
                                );
                            })}
                        </div>
                    </>
                ) : (
                    <>
                        <button
                            className="encounter-back"
                            onClick={() => {
                                setSelected(null);
                                setLaunch(null);
                            }}
                        >
                            <ArrowLeft size={14} /> Все столкновения
                        </button>
                        <div className="encounter-card-heading">
                            <strong>{encounter.name}</strong>
                            <small>
                                {run?.status === 'ended'
                                    ? 'Завершено'
                                    : participating
                                      ? scene.combat?.status === 'preparing'
                                          ? 'Подготовка боя'
                                          : 'В бою'
                                      : encounter.status === 'ready'
                                        ? 'Подготовлено'
                                        : 'Черновик'}
                            </small>
                        </div>
                        {!run && !launch && (
                            <button
                                className="primary-button"
                                disabled={busy || !encounter.groups[0].tokenIds.length}
                                onClick={() =>
                                    setLaunch({
                                        id: encounter.id,
                                        action: 'start',
                                        expected: encounter,
                                        expectedCombatId: scene.combat?.id ?? null,
                                        playerTokenIds: [],
                                    })
                                }
                            >
                                <Swords size={15} />{' '}
                                {scene.combat ? 'Добавить в текущий бой…' : 'Начать бой…'}
                            </button>
                        )}
                        {launch && !run && (
                            <section className="encounter-launch">
                                <strong>
                                    {launch.expectedCombatId
                                        ? 'Добавить основную группу в существующий бой?'
                                        : 'Начать бой с основной группой?'}
                                </strong>
                                <p className="hint">
                                    Выберите игровые персонажи. Уже участвующие останутся без
                                    изменений.
                                </p>
                                {scene.tokens
                                    .filter((t) => t.kind === 'player_character')
                                    .map((t) => (
                                        <label key={t.id} className="encounter-player">
                                            <input
                                                type="checkbox"
                                                disabled={busy || current.has(t.id)}
                                                checked={
                                                    current.has(t.id) ||
                                                    launch.playerTokenIds?.includes(t.id) ||
                                                    false
                                                }
                                                onChange={(e) =>
                                                    setLaunch({
                                                        ...launch,
                                                        playerTokenIds: e.target.checked
                                                            ? [
                                                                  ...(launch.playerTokenIds ?? []),
                                                                  t.id,
                                                              ]
                                                            : launch.playerTokenIds?.filter(
                                                                  (id) => id !== t.id,
                                                              ),
                                                    })
                                                }
                                            />
                                            {t.name}
                                            {current.has(t.id) && <small>Участвует</small>}
                                        </label>
                                    ))}
                                <p className="hint">
                                    Инициатива новых участников — «—». Они добавляются в конец
                                    очереди; значения и порядок задаются в Combat Workspace. Текущий
                                    ход, раунд, HP и состояния сохраняются.
                                </p>
                                <button
                                    className="primary-button"
                                    disabled={busy}
                                    onClick={() => store.encounterCombatCommand(launch)}
                                >
                                    {launch.expectedCombatId
                                        ? 'Подтвердить добавление'
                                        : 'Начать бой'}
                                </button>
                                <button
                                    className="secondary-button"
                                    disabled={busy}
                                    onClick={() => setLaunch(null)}
                                >
                                    Отмена
                                </button>
                            </section>
                        )}
                        {run && run.status !== 'ended' && (
                            <button className="secondary-button" onClick={onCombat}>
                                <Swords size={14} />{' '}
                                {scene.combat?.status === 'preparing'
                                    ? 'Инициатива · начать бой'
                                    : 'Открыть Combat Workspace'}
                            </button>
                        )}
                        {encounter.groups.map((g, index) => {
                            const pending = g.tokenIds.filter(
                                (id) => !run?.activatedTokenIds.includes(id) && !current.has(id),
                            );
                            return (
                                <section className="encounter-runtime-group" key={g.id}>
                                    <header>
                                        <strong>
                                            <Users size={14} /> {g.name}
                                        </strong>
                                        <small>{g.tokenIds.length}</small>
                                    </header>
                                    {index > 0 &&
                                        participating &&
                                        run?.status !== 'ended' &&
                                        pending.length > 0 && (
                                            <button
                                                className="secondary-button"
                                                disabled={busy}
                                                onClick={() => activate(pending)}
                                            >
                                                Ввести подкрепление · {pending.length}
                                            </button>
                                        )}
                                    {!g.tokenIds.length && <p className="hint">Группа пуста</p>}
                                    {g.tokenIds.map((id) => {
                                        const token = tokens.get(id);
                                        return (
                                            <div key={id} className="encounter-runtime-member">
                                                <button
                                                    className="encounter-member-identity"
                                                    disabled={!token}
                                                    onClick={() =>
                                                        store.selectObjects({
                                                            tokenIds: [id],
                                                            propIds: [],
                                                        })
                                                    }
                                                >
                                                    <strong>
                                                        {token?.name ?? 'Участник удалён'}
                                                    </strong>
                                                    <small>
                                                        {label(id)}
                                                        {token?.isHidden ? ' · скрыт GM' : ''}
                                                    </small>
                                                </button>
                                                {index > 0 &&
                                                    participating &&
                                                    pending.includes(id) && (
                                                        <button
                                                            className="secondary-button"
                                                            disabled={busy}
                                                            onClick={() => activate([id])}
                                                        >
                                                            Ввести
                                                        </button>
                                                    )}
                                                {token && (
                                                    <button
                                                        className="icon-button"
                                                        disabled={busy}
                                                        aria-label={`${token.isHidden ? 'Показать игрокам' : 'Скрыть от игроков'}: ${token.name}`}
                                                        title={
                                                            token.isHidden
                                                                ? 'Снять GM-hidden; LOS и Fog продолжают действовать'
                                                                : 'Скрыть от игроков'
                                                        }
                                                        onClick={() =>
                                                            store.updateToken(id, {
                                                                isHidden: !token.isHidden,
                                                            })
                                                        }
                                                    >
                                                        {token.isHidden ? (
                                                            <EyeOff size={15} />
                                                        ) : (
                                                            <Eye size={15} />
                                                        )}
                                                    </button>
                                                )}
                                            </div>
                                        );
                                    })}
                                </section>
                            );
                        })}
                        <p className="hint">
                            Подкрепления получают обычные ресурсы хода и инициативу «—» в конце
                            очереди. Появление для игроков меняется отдельно значком глаза; LOS, Fog
                            и освещение продолжают действовать.
                        </p>
                        {run?.status === 'ended' && (
                            <p className="hint">
                                Бой завершён. Повторные команды не запускают его заново.
                            </p>
                        )}
                    </>
                )}
            </div>
        </Panel>
    );
}
