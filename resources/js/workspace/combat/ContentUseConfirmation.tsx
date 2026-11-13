import { useState } from 'react';
import type { Scene } from '../../tabletop/types/scene';
import type { ResolutionTask } from './sessionModel';
import { RpgIcon } from '../../gameplay/RpgIcon';
import '../../../css/content-use.css';

export function ContentUseConfirmation({
    task,
    scene,
    disabled,
    onConfirm,
}: {
    task: ResolutionTask;
    scene: Scene;
    disabled: boolean;
    onConfirm: (body: Record<string, unknown>) => void;
}) {
    const source = task.result.gmContext!.contentUse!;
    const [targetId, setTarget] = useState(
        task.result.target?.kind === 'token' ? task.result.target.id : '',
    );
    const [effect, setEffect] = useState('log'),
        [amount, setAmount] = useState('');
    const [spendItem, setItem] = useState(false),
        [spendSlot, setSlot] = useState(false),
        [spendCosts, setCosts] = useState(false),
        [spendAction, setAction] = useState(false);
    const [review, setReview] = useState(false);
    const [activation, setActivation] = useState('action');
    const target = scene.tokens.find((t) => t.id === targetId);
    const automatic = source.automatic;
    if (automatic) {
        const rolls = automatic.rolls;
        return (
            <fieldset className="content-use-confirm" disabled={disabled}>
                <strong>Проверенный рецепт · подтверждение броска</strong>
                <p>
                    Цель: {target?.name ?? 'Удалена'} · HP {target?.hp} / {target?.maxHp}
                </p>
                {rolls.roll && (
                    <p>
                        d20: {rolls.roll.natural} · итог {rolls.roll.total} ·{' '}
                        {rolls.success
                            ? rolls.critical
                                ? 'Критическое попадание'
                                : 'Попадание'
                            : 'Промах'}
                    </p>
                )}
                {rolls.damageRolls.map((d, i) => (
                    <p key={i}>
                        Урон до сопротивлений: {d.roll.expression} [{d.roll.rawDice?.join(', ')}] +
                        ({d.roll.modifier ?? 0}) = {d.roll.total}
                    </p>
                ))}
                {rolls.healingRoll && (
                    <p>
                        Лечение: {rolls.healingRoll.expression} [
                        {rolls.healingRoll.rawDice.join(', ')}] → {rolls.healingRoll.total}
                    </p>
                )}
                <p>Расход: {automatic.costSummary}. Sap и дополнительные эффекты — вручную.</p>
                <button className="primary-button" onClick={() => onConfirm({ confirmed: true })}>
                    Подтвердить бросок и применить
                </button>
            </fieldset>
        );
    }
    return (
        <fieldset className="content-use-confirm" disabled={disabled}>
            <RpgIcon icon={source.icon} size={36} />
            <label>
                Эффект GM
                <select
                    aria-label="Эффект GM"
                    value={effect}
                    onChange={(e) => {
                        setEffect(e.target.value);
                        setReview(false);
                    }}
                >
                    <option value="log">Только журнал</option>
                    <option value="damage">Урон</option>
                    <option value="heal">Лечение</option>
                </select>
            </label>
            {effect !== 'log' && (
                <>
                    <label>
                        Цель
                        <select
                            aria-label="Цель решения GM"
                            value={targetId}
                            onChange={(e) => {
                                setTarget(e.target.value);
                                setReview(false);
                            }}
                        >
                            <option value="">Выберите цель</option>
                            {scene.tokens.map((t) => (
                                <option key={t.id} value={t.id}>
                                    {t.name}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label>
                        Подтверждённая величина
                        <input
                            aria-label="Подтверждённая величина"
                            type="number"
                            min={1}
                            max={9999}
                            value={amount}
                            onChange={(e) => {
                                setAmount(e.target.value);
                                setReview(false);
                            }}
                        />
                    </label>
                    {target && (
                        <small>
                            {target.name}: HP {target.hp} / {target.maxHp}
                        </small>
                    )}
                </>
            )}
            {source.inventoryItemId && (
                <label>
                    <input
                        type="checkbox"
                        checked={spendItem}
                        onChange={(e) => {
                            setItem(e.target.checked);
                            setReview(false);
                        }}
                    />
                    Израсходовать 1 предмет
                </label>
            )}
            {!!source.castLevel && !source.inventoryItemId && (
                <label>
                    <input
                        type="checkbox"
                        checked={spendSlot}
                        onChange={(e) => {
                            setSlot(e.target.checked);
                            setReview(false);
                        }}
                    />
                    Потратить ячейку {source.castLevel} круга
                </label>
            )}
            {!!source.costs.length && (
                <label>
                    <input
                        type="checkbox"
                        checked={spendCosts}
                        onChange={(e) => {
                            setCosts(e.target.checked);
                            setReview(false);
                        }}
                    />
                    Списать ресурсы: {source.costs.map((c) => `${c.key} −${c.amount}`).join(', ')}
                </label>
            )}
            {scene.combat?.status === 'active' && (
                <label>
                    <input
                        type="checkbox"
                        checked={spendAction}
                        onChange={(e) => {
                            setAction(e.target.checked);
                            setReview(false);
                        }}
                    />
                    Потратить действие персонажа
                </label>
            )}
            {spendAction && (
                <label>
                    Тип действия
                    <select
                        aria-label="Тип расходуемого действия"
                        value={activation}
                        onChange={(e) => {
                            setActivation(e.target.value);
                            setReview(false);
                        }}
                    >
                        <option value="action">Действие</option>
                        <option value="bonus_action">Бонусное действие</option>
                        <option value="reaction">Реакция</option>
                        <option value="free">Свободное действие</option>
                    </select>
                </label>
            )}
            <label>
                <input
                    type="checkbox"
                    checked={review}
                    onChange={(e) => setReview(e.target.checked)}
                />
                Подтверждаю цель, эффект и отмеченный расход
            </label>
            <button
                className="primary-button"
                disabled={
                    !review ||
                    (effect !== 'log' &&
                        (!target ||
                            !Number.isInteger(Number(amount)) ||
                            Number(amount) < 1 ||
                            Number(amount) > 9999))
                }
                onClick={() =>
                    onConfirm({
                        confirmed: true,
                        effect,
                        targetId: targetId || null,
                        ...(effect !== 'log' ? { amount: Number(amount) } : {}),
                        spendItem,
                        spendSlot,
                        spendCosts,
                        spendAction,
                        activation,
                    })
                }
            >
                Подтвердить и применить
            </button>
        </fieldset>
    );
}
