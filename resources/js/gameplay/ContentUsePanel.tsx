import { useRef, useState } from 'react';
import { ApiError, request } from '../api/client';
import { api, commandId } from '../api/workspace';
import { ContentReference } from '../compendium/ContentReference';
import type { InventoryItem } from '../rpg/model';
import { ItemFacts } from '../rpg/itemGameplay';
import type { SceneStore } from '../tabletop/state/SceneStore';
import type { Character } from '../tabletop/types/scene';
import { Dialog } from '../workspace/Dialog';
import { gameplayApi, type Ability } from './model';
import { RpgIcon } from './RpgIcon';
import { SpellDetails } from './spellcasting';
import '../../css/content-use.css';

export type ContentSelection =
    { item: InventoryItem; ability?: never } | { ability: Ability; item?: never };
export const manualContent = (ability: Ability) =>
    ability.spell?.content?.gates.execute === false || !!ability.spell?.content?.execution_profile;
export const manualItem = (item: InventoryItem) =>
    item.definition.content?.gates.execute === false ||
    !!item.definition.content?.execution_profile;

/** One explicit confirmation surface. Reference prose is never converted to commands. */
export function ContentUsePanel({
    selection,
    character,
    store,
    onClose,
}: {
    selection: ContentSelection;
    character: Character;
    store: SceneStore;
    onClose: () => void;
}) {
    const { scene, selectedIds } = store.getSnapshot();
    const item = selection.item;
    const ability = selection.ability ?? item?.action?.ability;
    const content = item?.definition.content ?? ability?.spell?.content;
    const automatic = content?.gates.execute === true && !!content.execution_profile;
    const manual = content?.gates.execute === false || automatic;
    const [rollMode, setRollMode] = useState('normal');
    const name = item?.definition.name ?? ability!.name;
    const icon = item?.definition.icon ?? ability!.icon;
    const [targetId, setTarget] = useState(selectedIds[0] ?? '');
    const [level, setLevel] = useState(ability?.spell?.level ?? 0);
    const [busy, setBusy] = useState(false),
        [error, setError] = useState(''),
        [accepted, setAccepted] = useState(false);
    const [preview, setPreview] = useState<{
        attack?: { rawDice: number[]; total: number } | null;
        healing?: { expression: string; total: number } | null;
        damage?: { expression: string; rawDice?: number[]; modifier?: number; total: number }[];
    } | null>(null);
    const retry = useRef<Record<string, unknown> | null>(null);
    const [uncertain, setUncertain] = useState(false);
    const needsTarget = manual || ability?.target === 'token';
    const mapTarget = !manual && (ability?.target === 'point' || ability?.target === 'prop');
    const target = scene.tokens.find((t) => t.id === targetId);
    const send = async () => {
        if (busy) return;
        const body = retry.current ?? {
            characterId: character.id,
            epoch: scene.liveRevision ?? 0,
            clientMutationId: commandId(),
            ...(item ? { inventoryItemId: item.id } : { abilityId: ability!.id }),
            ...(manual
                ? { targetId: targetId || null, castLevel: level, rollMode }
                : {
                      abilityId: ability!.id,
                      target: ability?.target === 'token' ? { kind: 'token', id: targetId } : null,
                      rollMode: 'normal',
                      ...(ability?.spell ? { castLevel: level } : {}),
                  }),
        };
        retry.current = body;
        setBusy(true);
        setError('');
        try {
            if (manual) {
                const response = await request<{ execution: { preview?: typeof preview } }>(
                    `/scenes/${scene.id}/content-use`,
                    'POST',
                    body,
                );
                setPreview(response.execution.preview ?? null);
            } else
                await gameplayApi.execute(
                    scene.id!,
                    body as unknown as Parameters<typeof gameplayApi.execute>[1],
                );
            retry.current = null;
            setUncertain(false);
            setAccepted(true);
            store.reconcile(await api.snapshot(scene.id!));
        } catch (e) {
            setError((e as Error).message);
            if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
                retry.current = null;
                setUncertain(false);
            } else setUncertain(true);
        } finally {
            setBusy(false);
        }
    };
    return (
        <Dialog
            title={`Использовать · ${name}`}
            onClose={() => {
                if (!busy) onClose();
            }}
        >
            <div className="content-use-panel">
                <header>
                    <RpgIcon icon={icon} size={56} />
                    <div>
                        <h3>{name}</h3>
                        <small>
                            {character.name} · HP {character.hp} / {character.maxHp}
                            {item ? ` · ${item.quantity} шт.` : ''}
                        </small>
                    </div>
                </header>
                {accepted ? (
                    <>
                        <p role="status">
                            {manual
                                ? 'Запрос отправлен GM. HP и ресурсы не изменены; итог и расход подтверждает GM.'
                                : 'Действие применено.'}
                        </p>
                        {preview && (
                            <div role="status">
                                {preview.attack && (
                                    <p>
                                        d20 [{preview.attack.rawDice.join(', ')}] →{' '}
                                        {preview.attack.total}
                                    </p>
                                )}
                                {preview.damage?.map((d, i) => (
                                    <p key={i}>
                                        Урон до сопротивлений: [{d.rawDice?.join(', ')}] + (
                                        {d.modifier ?? 0}) = {d.total}
                                    </p>
                                ))}
                                {preview.healing && (
                                    <p>
                                        Лечение: {preview.healing.expression} →{' '}
                                        {preview.healing.total}
                                    </p>
                                )}
                                <small>Бросок сохранён. Ожидает подтверждения GM.</small>
                            </div>
                        )}
                        <button onClick={onClose}>Готово</button>
                    </>
                ) : (
                    <>
                        {manual && (
                            <p className="hint">
                                {automatic
                                    ? 'Проверенный рецепт · бросок сохраняется, HP и расход применит GM после подтверждения. Sap и дополнительные эффекты разрешаются вручную.'
                                    : 'Ручное решение GM · эффект и расход требуют отдельного подтверждения.'}
                            </p>
                        )}
                        {item ? (
                            <ItemFacts definition={item.definition} item={item} />
                        ) : (
                            <SpellDetails ability={ability!} />
                        )}
                        {content?.facts?.length ? (
                            <div className="content-use-facts">
                                {content.facts.slice(0, 3).map((fact) => (
                                    <small key={fact}>{fact}</small>
                                ))}
                            </div>
                        ) : null}
                        {content && (
                            <details>
                                <summary>Описание, характеристики и источник</summary>
                                <ContentReference content={content} />
                            </details>
                        )}
                        <fieldset disabled={busy || uncertain}>
                            {automatic && ability?.category === 'attack' && (
                                <label>
                                    Режим броска
                                    <select
                                        aria-label="Режим броска"
                                        value={rollMode}
                                        onChange={(e) => setRollMode(e.target.value)}
                                    >
                                        <option value="normal">Обычный</option>
                                        <option value="advantage">Преимущество</option>
                                        <option value="disadvantage">Помеха</option>
                                    </select>
                                </label>
                            )}
                            {needsTarget && (
                                <label>
                                    Цель
                                    <select
                                        aria-label="Цель использования"
                                        value={targetId}
                                        onChange={(e) => setTarget(e.target.value)}
                                    >
                                        <option value="">
                                            {manual
                                                ? 'Без цели · только описание'
                                                : 'Выберите цель'}
                                        </option>
                                        {scene.tokens.map((t) => (
                                            <option key={t.id} value={t.id}>
                                                {t.name}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            )}
                            {target && (
                                <p>
                                    Цель: {target.name}
                                    {target.hp != null
                                        ? ` · HP ${target.hp} / ${target.maxHp}`
                                        : ''}
                                </p>
                            )}
                            {!!ability?.spell?.level && (
                                <label>
                                    Круг
                                    <select
                                        aria-label="Круг использования"
                                        value={level}
                                        onChange={(e) => setLevel(Number(e.target.value))}
                                    >
                                        {Array.from(
                                            { length: 10 - ability.spell.level },
                                            (_, i) => i + ability.spell!.level,
                                        ).map((n) => (
                                            <option key={n} value={n}>
                                                {n} · ячеек{' '}
                                                {character.spellcasting?.slots[n]?.current ?? 0}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            )}
                            {!!ability?.costs.length && (
                                <p>
                                    Ресурсы:{' '}
                                    {ability.costs
                                        .map(
                                            (c) =>
                                                `${c.key} −${c.amount} (есть ${character.resources?.find((r) => r.key === c.key)?.current ?? 0})`,
                                        )
                                        .join(' · ')}
                                </p>
                            )}
                        </fieldset>
                        {error && <p role="alert">{error}</p>}
                        {mapTarget && (
                            <p role="note">
                                Для этой способности выберите область или объект через её действие
                                на карте.
                            </p>
                        )}
                        <button
                            className="primary-button"
                            disabled={
                                busy ||
                                (automatic && !targetId) ||
                                mapTarget ||
                                (!manual && (!ability || (ability.target === 'token' && !targetId)))
                            }
                            onClick={() => void send()}
                        >
                            {busy
                                ? 'Отправка…'
                                : uncertain
                                  ? 'Повторить с тем же ID'
                                  : manual
                                    ? automatic
                                        ? 'Бросить и передать GM'
                                        : 'Запросить решение GM'
                                    : 'Подтвердить действие'}
                        </button>
                    </>
                )}
            </div>
        </Dialog>
    );
}
