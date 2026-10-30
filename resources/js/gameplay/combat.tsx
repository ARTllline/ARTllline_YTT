import '../../css/combat.css';
import type { Ability } from './model';
export interface TurnResources {
    ownTurn: boolean;
    action: boolean;
    bonus_action: boolean;
    reaction: boolean;
    movementSpent: number;
    movementRemaining: number;
    speed: number;
    unit: string;
    incapacitated?: boolean;
}
export function combatReason(a: Pick<Ability, 'activation'>, b?: TurnResources): string {
    if (!b) return '';
    if (b.incapacitated) return 'Персонаж не может действовать';
    const cost = a.activation ?? 'action';
    if (cost === 'free') return '';
    if (cost !== 'reaction' && !b.ownTurn) return 'Сейчас ход другого участника';
    return b[cost]
        ? ''
        : {
              action: 'Действие уже потрачено',
              bonus_action: 'Бонусное действие уже потрачено',
              reaction: 'Реакция недоступна',
          }[cost];
}
export function CombatBudgetView({
    budget,
    onStand,
}: {
    budget: TurnResources;
    onStand?: () => void;
}) {
    return (
        <div className="combat-budget" aria-label="Ресурсы хода">
            {(
                [
                    ['action', 'Действие'],
                    ['bonus_action', 'Бонус'],
                    ['reaction', 'Реакция'],
                ] as const
            ).map(([key, label]) => (
                <span
                    key={key}
                    className={budget[key] ? 'ready' : 'spent'}
                    title={`${label}: ${budget[key] ? 'доступно' : 'недоступно'}`}
                >
                    {label} <b>{budget[key] ? '●' : '○'}</b>
                </span>
            ))}
            <span className="movement-budget">
                Ходьба{' '}
                <b>
                    {Math.round(budget.movementRemaining * 100) / 100} / {budget.speed}{' '}
                    {budget.unit}
                </b>
            </span>
            {onStand && (
                <button
                    type="button"
                    onClick={onStand}
                    title="Встать: половина скорости, округление вниз"
                >
                    Встать
                </button>
            )}
        </div>
    );
}
