import type { SceneStore } from '../../tabletop/state/SceneStore';
import type { Token } from '../../tabletop/types/scene';
import { GMQuickCheck } from '../combat/GMQuickCheck';
import { GMLifecycleControls } from '../combat/AdventuringControls';

/** Detailed runtime work stays separate from character and NPC authoring. */
export function SessionTokenDetails(props: { token: Token; store: SceneStore; disabled: boolean }) {
    return (
        <div className="session-token-details">
            <div className="runtime-details-section">
                <GMQuickCheck
                    tokenId={props.token.id}
                    store={props.store}
                    disabled={props.disabled}
                />
            </div>
            <details className="runtime-details-section">
                <summary>Жизненный цикл · коррекции ГМ</summary>
                <GMLifecycleControls
                    token={props.token}
                    store={props.store}
                    disabled={props.disabled}
                />
            </details>
            <details className="runtime-details-section">
                <summary>Размещение и видимость</summary>
                <div className="runtime-placement">
                    <span>
                        Позиция {Math.round(props.token.x)} / {Math.round(props.token.y)}
                    </span>
                    <button
                        disabled={props.disabled}
                        onClick={() =>
                            props.store.updateToken(props.token.id, {
                                isHidden: !props.token.isHidden,
                            })
                        }
                    >
                        {props.token.isHidden ? 'Показать игрокам' : 'Скрыть от игроков'}
                    </button>
                    <button
                        disabled={props.disabled}
                        onClick={() =>
                            props.store.updateToken(props.token.id, {
                                isLocked: !props.token.isLocked,
                            })
                        }
                    >
                        {props.token.isLocked
                            ? 'Разблокировать движение'
                            : 'Заблокировать движение'}
                    </button>
                </div>
            </details>
        </div>
    );
}
