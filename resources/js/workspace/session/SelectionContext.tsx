import type { RefObject } from 'react';
import { EyeOff, Shield, X } from 'lucide-react';
import type { SceneStore } from '../../tabletop/state/SceneStore';
import type { Token } from '../../tabletop/types/scene';
import type { TabletopRenderer } from '../../tabletop/renderer/TabletopRenderer';
import { RuntimeQuickActions } from './RuntimeQuickActions';
import { CombatActorControls } from '../combat/CombatActorControls';
import { tokenAppearance } from '../../tabletop/objects/tokenAppearance';
import { SessionTokenDetails } from './SessionTokenDetails';
import { SessionCharacterContent } from './SessionCharacterContent';

/** Runtime projection only. Commands use the same authoritative queue as Combat Console. */
export function SelectionContext({
    token,
    store,
    disabled,
    onExpand,
    onClose,
    renderer,
    expanded = false,
}: {
    token: Token;
    store: SceneStore;
    disabled: boolean;
    onExpand: () => void;
    onClose: () => void;
    renderer?: RefObject<TabletopRenderer | null>;
    expanded?: boolean;
}) {
    const state = store.getSnapshot();
    return (
        <section className="selection-context" aria-label={`Контекст · ${token.name}`}>
            <header className="selection-context-heading">
                <div className={`context-portrait disposition-${token.disposition ?? 'neutral'}`}>
                    {token.image ? (
                        <img src={token.image.url} alt="" />
                    ) : (
                        tokenAppearance(token).initials
                    )}
                </div>
                <div>
                    <span className="eyebrow">
                        {token.kind === 'player_character' ? 'Персонаж' : 'NPC'}
                        {state.selectedIds.length > 1
                            ? ` · +${state.selectedIds.length - 1} выбрано`
                            : ''}
                    </span>
                    <h2>{token.name}</h2>
                </div>
                <button
                    className="icon-button"
                    onClick={onClose}
                    title="Скрыть контекст"
                    aria-label="Скрыть контекст"
                >
                    <X size={15} />
                </button>
            </header>
            <div className="context-vitals">
                <strong>
                    <span>HP</span> {token.hp ?? '—'} <small>/ {token.maxHp ?? '—'}</small>
                </strong>
                <span>
                    <Shield size={14} /> AC {token.ac ?? '—'}
                </span>
                {token.isHidden && (
                    <span title="Скрыт от игроков">
                        <EyeOff size={14} />
                    </span>
                )}
            </div>
            {state.combatNotice && (
                <p className="form-error" role="alert">
                    {state.combatNotice}
                </p>
            )}
            <div
                className="runtime-health-bar"
                role="meter"
                aria-label="Здоровье"
                aria-valuemin={0}
                aria-valuemax={token.maxHp ?? 1}
                aria-valuenow={token.hp ?? 0}
            >
                <i
                    style={{
                        width: `${Math.max(0, Math.min(100, ((token.hp ?? 0) / Math.max(1, token.maxHp ?? 1)) * 100))}%`,
                    }}
                />
            </div>
            <RuntimeQuickActions token={token} store={store} disabled={disabled} />
            {store.role === 'gm' &&
                token.characterId &&
                state.scene.characters?.find((c) => c.id === token.characterId) && (
                    <SessionCharacterContent
                        key={token.characterId}
                        character={state.scene.characters.find((c) => c.id === token.characterId)!}
                        store={store}
                        disabled={disabled}
                    />
                )}
            <div className="runtime-primary-actions">
                <span className="eyebrow">Действия</span>
                <CombatActorControls
                    token={token}
                    store={store}
                    renderer={renderer}
                    disabled={disabled}
                    compact
                    actionLimit={expanded ? undefined : 3}
                />
            </div>
            {expanded && <SessionTokenDetails token={token} store={store} disabled={disabled} />}
            <button className="context-expand" onClick={onExpand}>
                More · Подробнее <span>↗</span>
            </button>
        </section>
    );
}
