import { t } from '../i18n';
import { PropInspector } from './objects/PropInspector';
import { useSyncExternalStore } from 'react';
import { Crosshair, SlidersHorizontal, X, Trash2, ImagePlus } from 'lucide-react';
import { tokenAppearance } from '../tabletop/objects/tokenAppearance';
import type { SceneStore } from '../tabletop/state/SceneStore';
import { NumberField } from './NumberField';
import { MapInspector } from './MapInspector';
import type { Campaign } from '../api/workspace';
import { TokenCombatControls } from './combat/TokenCombatControls';
export function Inspector({
    store,
    onClose,
    campaign,
    uploadMap,
    uploadToken,
    busy,
    deleteToken,
    combatBusy,
    chooseImage,
}: {
    store: SceneStore;
    onClose: () => void;
    campaign: Campaign;
    uploadMap: (file: File) => void;
    uploadToken: (id: string, file: File) => void;
    busy: boolean;
    deleteToken: () => void;
    combatBusy: boolean;
    chooseImage: (kind: 'map' | 'token', tokenId?: string) => void;
}) {
    const { scene, selectedIds, preview } = useSyncExternalStore(
        store.subscribe,
        store.getSnapshot,
    );
    const selectedPropIds = store.getSnapshot().selectedPropIds ?? [];
    const prop = scene.props?.find((p) => p.id === selectedPropIds[0]);
    if (prop)
        return <PropInspector prop={prop} store={store} onClose={onClose} busy={combatBusy} />;
    const token = scene.tokens.find((item) => item.id === selectedIds[0]);
    const position = preview?.id === token?.id ? preview?.position : token;
    return (
        <aside className="inspector panel" aria-label={t('Inspector')}>
            <div className="panel-heading">
                <span>
                    <SlidersHorizontal size={14} /> {t('Inspector')}{' '}
                </span>
                <button
                    className="icon-button"
                    onClick={onClose}
                    aria-label={t('Close inspector')}
                    title={t('Close inspector')}
                >
                    <X size={15} />
                </button>
            </div>
            {token && position ? (
                <div className="inspector-body" key={token.id}>
                    <div className="identity">
                        <div className={`portrait disposition-${token.disposition ?? 'neutral'}`}>
                            {token.image ? (
                                <img src={token.image.url} alt="" />
                            ) : (
                                tokenAppearance(token).initials
                            )}
                        </div>
                        <span className="eyebrow">
                            {' '}
                            {t('TOKEN ·')}{' '}
                            {token.kind === 'player_character' ? t('ADVENTURER') : t('CREATURE')}
                        </span>
                        <h2>{token.name}</h2>
                        <span className="muted">
                            {token.isHidden
                                ? t('GM only · hidden from players')
                                : t('Visible in the scene')}
                        </span>
                    </div>
                    <details className="inspector-section" open>
                        <summary>Личность</summary>
                        <section>
                            <h3> {t('Identity')} </h3>
                            <label className="field">
                                <span>Тип токена</span>
                                <select
                                    aria-label="Тип токена"
                                    value={token.kind}
                                    onChange={(e) =>
                                        store.updateToken(token.id, {
                                            kind: e.target.value as typeof token.kind,
                                        })
                                    }
                                >
                                    <option value="player_character">Персонаж игрока</option>
                                    <option value="npc">NPC</option>
                                </select>
                            </label>
                            <label className="field">
                                <span>Отношение</span>
                                <select
                                    aria-label="Отношение токена"
                                    value={token.disposition ?? 'neutral'}
                                    onChange={(e) =>
                                        store.updateToken(token.id, {
                                            disposition: e.target.value as NonNullable<
                                                typeof token.disposition
                                            >,
                                        })
                                    }
                                >
                                    <option value="friendly">Дружественный</option>
                                    <option value="neutral">Нейтральный</option>
                                    <option value="hostile">Враждебный</option>
                                </select>
                            </label>
                            {token.image && (
                                <img
                                    className="token-image-preview"
                                    src={token.image.url}
                                    alt={t('Current token image')}
                                />
                            )}
                            <button
                                className="secondary-button"
                                onClick={() => chooseImage('token', token.id)}
                            >
                                {' '}
                                {t('Choose image from library')}{' '}
                            </button>
                            <label className="field">
                                <span> {t('Name')} </span>
                                <input
                                    aria-label={t('Token name')}
                                    key={token.name}
                                    defaultValue={token.name}
                                    maxLength={80}
                                    onBlur={(event) => {
                                        if (event.target.value !== token.name)
                                            store.updateToken(token.id, {
                                                name: event.target.value,
                                            });
                                        event.target.value = store
                                            .getSnapshot()
                                            .scene.tokens.find((t) => t.id === token.id)!.name;
                                    }}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter') event.currentTarget.blur();
                                    }}
                                />
                            </label>
                        </section>
                    </details>
                    <details className="inspector-section" open>
                        <summary>Здоровье и состояние</summary>
                        <section>
                            <h3> {t('Vitals')} </h3>
                            <div className="token-combat-context">
                                {scene.combat ? (
                                    (() => {
                                        const combat = scene.combat;
                                        const entry = combat.combatants.find(
                                            (c) => c.tokenId === token.id,
                                        );
                                        return (
                                            <button
                                                className="text-button"
                                                disabled={combatBusy}
                                                onClick={() =>
                                                    store.combatCommand(
                                                        entry
                                                            ? {
                                                                  action: 'remove',
                                                                  combatId: combat.id,
                                                                  combatantId: entry.id,
                                                              }
                                                            : {
                                                                  action: 'add',
                                                                  combatId: combat.id,
                                                                  tokenIds: [token.id],
                                                              },
                                                    )
                                                }
                                            >
                                                {entry
                                                    ? t('Remove from Combat')
                                                    : t('Add to Combat')}
                                            </button>
                                        );
                                    })()
                                ) : (
                                    <button
                                        className="text-button"
                                        disabled={combatBusy}
                                        onClick={() => store.combatCommand({ action: 'prepare' })}
                                    >
                                        {' '}
                                        {t('Prepare Combat')}{' '}
                                    </button>
                                )}
                            </div>
                            <div className="field-row">
                                <NumberField
                                    label="HP"
                                    value={token.hp ?? 0}
                                    min={0}
                                    max={token.maxHp}
                                    onChange={(hp) => store.updateToken(token.id, { hp })}
                                />
                                <NumberField
                                    label={t('Max HP')}
                                    value={token.maxHp ?? 1}
                                    min={1}
                                    max={9999}
                                    onChange={(maxHp) => store.updateToken(token.id, { maxHp })}
                                />
                            </div>
                            <div className="health-track">
                                <i
                                    style={{
                                        width: `${((token.hp ?? 0) / (token.maxHp ?? 1)) * 100}%`,
                                    }}
                                />
                            </div>
                            <TokenCombatControls
                                token={token}
                                store={store}
                                disabled={combatBusy}
                            />
                            <div className="field-row">
                                <NumberField
                                    label="AC"
                                    value={token.ac ?? 0}
                                    min={0}
                                    max={99}
                                    onChange={(ac) => store.updateToken(token.id, { ac })}
                                />
                                <NumberField
                                    label={t('Speed')}
                                    value={token.speed ?? 0}
                                    min={0}
                                    max={999}
                                    onChange={(speed) => store.updateToken(token.id, { speed })}
                                />
                            </div>
                        </section>
                    </details>
                    <details className="inspector-section">
                        <summary>Доступ и видимость</summary>
                        <section>
                            <h3> {t('Access & visibility')} </h3>
                            <label className="toggle-row">
                                {' '}
                                {t('Hidden from players')}{' '}
                                <input
                                    type="checkbox"
                                    checked={token.isHidden ?? false}
                                    onChange={(event) =>
                                        store.updateToken(token.id, {
                                            isHidden: event.target.checked,
                                        })
                                    }
                                />
                            </label>
                            <label className="toggle-row">
                                {' '}
                                {t('Lock position')}{' '}
                                <input
                                    type="checkbox"
                                    checked={token.isLocked ?? false}
                                    onChange={(event) =>
                                        store.updateToken(token.id, {
                                            isLocked: event.target.checked,
                                        })
                                    }
                                />
                            </label>
                            <label className="field">
                                <span> {t('Controlled by')} </span>
                                <select
                                    value={token.ownerUserId ?? ''}
                                    onChange={(event) =>
                                        store.updateToken(token.id, {
                                            ownerUserId: event.target.value || null,
                                        })
                                    }
                                >
                                    <option value=""> {t('Unassigned')} </option>
                                    {campaign.members?.map((member) => (
                                        <option key={member.id} value={member.id}>
                                            {member.name} ·{' '}
                                            {member.role === 'gm' ? t('Game Master') : t('Player')}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        </section>
                    </details>
                    <details className="inspector-section">
                        <summary>Положение</summary>
                        <section>
                            <h3>
                                {' '}
                                {t('Position')} <span> {t('WORLD')} </span>
                            </h3>
                            <div className="field-row">
                                <NumberField
                                    label="X"
                                    value={position.x}
                                    disabled={!!preview}
                                    onChange={(x) => store.updateToken(token.id, { x })}
                                />
                                <NumberField
                                    label="Y"
                                    value={position.y}
                                    disabled={!!preview}
                                    onChange={(y) => store.updateToken(token.id, { y })}
                                />
                            </div>
                        </section>
                    </details>
                    <details className="inspector-section">
                        <summary>Поворот и масштаб</summary>
                        <section>
                            <h3> {t('Transform')} </h3>
                            <div className="field-row">
                                <NumberField
                                    label={t('Rotation °')}
                                    value={token.rotation}
                                    onChange={(rotation) =>
                                        store.updateToken(token.id, { rotation })
                                    }
                                />
                                <NumberField
                                    label={t('Scale')}
                                    value={token.scale}
                                    min={0.4}
                                    max={3}
                                    step={0.1}
                                    onChange={(scale) => store.updateToken(token.id, { scale })}
                                />
                            </div>
                        </section>
                    </details>
                    <details className="inspector-section">
                        <summary>Изображение и размер</summary>
                        <section>
                            <NumberField
                                label={t('Base size')}
                                value={token.size}
                                min={20}
                                max={300}
                                onChange={(size) => store.updateToken(token.id, { size })}
                            />
                            <h3> {t('Token image')} </h3>
                            <label className="upload-button">
                                <ImagePlus size={14} />
                                {busy
                                    ? t('Uploading…')
                                    : token.image
                                      ? t('Replace image')
                                      : t('Upload image')}
                                <input
                                    type="file"
                                    aria-label={t('Upload token image')}
                                    accept="image/png,image/jpeg,image/webp"
                                    disabled={busy}
                                    onChange={(event) => {
                                        const file = event.target.files?.[0];
                                        if (file) uploadToken(token.id, file);
                                        event.target.value = '';
                                    }}
                                />
                            </label>
                            {token.image && (
                                <button
                                    className="text-button"
                                    onClick={() => store.updateToken(token.id, { image: null })}
                                >
                                    {' '}
                                    {t('Use placeholder')}{' '}
                                </button>
                            )}
                        </section>
                    </details>
                    <details className="inspector-section">
                        <summary>Привязка</summary>
                        <section>
                            <h3> {t('Placement')} </h3>
                            <label className="toggle-row">
                                <span>
                                    {' '}
                                    {t('Snap to grid')}{' '}
                                    <small> {t('Scene-wide · cell centers')} </small>
                                </span>
                                <input
                                    type="checkbox"
                                    checked={scene.grid.snap}
                                    onChange={(event) =>
                                        store.updateGrid({ snap: event.target.checked })
                                    }
                                />
                            </label>
                            <p className="hint">
                                {' '}
                                {t('Snaps when dropped. Inspector coordinates stay exact.')}{' '}
                            </p>
                        </section>
                    </details>{' '}
                    <div className="inspector-foot">
                        <Crosshair size={13} /> {t('World coordinates · px')}{' '}
                    </div>
                    <section className="inspector-danger">
                        <button className="danger-button" onClick={deleteToken}>
                            <Trash2 size={14} /> {t('Delete token')}{' '}
                        </button>
                    </section>
                </div>
            ) : (
                <div className="map-library-choice">
                    <button className="secondary-button" onClick={() => chooseImage('map')}>
                        {' '}
                        {t('Choose map from library')}{' '}
                    </button>
                    <MapInspector store={store} upload={uploadMap} busy={busy} />
                </div>
            )}
        </aside>
    );
}
