import { useSyncExternalStore } from 'react';
import { Crosshair, SlidersHorizontal, Shield, X, Trash2, ImagePlus } from 'lucide-react';
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
    const token = scene.tokens.find((item) => item.id === selectedIds[0]);
    const position = preview?.id === token?.id ? preview?.position : token;
    return (
        <aside className="inspector panel" aria-label="Inspector">
            <div className="panel-heading">
                <span>
                    <SlidersHorizontal size={14} /> Inspector
                </span>
                <button
                    className="icon-button"
                    onClick={onClose}
                    aria-label="Close inspector"
                    title="Close inspector"
                >
                    <X size={15} />
                </button>
            </div>
            {token && position ? (
                <div className="inspector-body" key={token.id}>
                    <div className="identity">
                        <div className={`portrait ${token.kind === 'hero' ? 'hero' : 'enemy'}`}>
                            <Shield size={30} />
                        </div>
                        <span className="eyebrow">
                            TOKEN · {token.kind === 'hero' ? 'ADVENTURER' : 'CREATURE'}
                        </span>
                        <h2>{token.name}</h2>
                        <span className="muted">
                            {token.isHidden
                                ? 'GM only · hidden from players'
                                : 'Visible in the scene'}
                        </span>
                    </div>
                    <section>
                        <h3>Identity</h3>
                        {token.image && (
                            <img
                                className="token-image-preview"
                                src={token.image.url}
                                alt="Current token image"
                            />
                        )}
                        <button
                            className="secondary-button"
                            onClick={() => chooseImage('token', token.id)}
                        >
                            Choose image from library
                        </button>
                        <label className="field">
                            <span>Name</span>
                            <input
                                aria-label="Token name"
                                key={token.name}
                                defaultValue={token.name}
                                maxLength={80}
                                onBlur={(event) => {
                                    if (event.target.value !== token.name)
                                        store.updateToken(token.id, { name: event.target.value });
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
                    <section>
                        <h3>
                            Position <span>WORLD</span>
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
                    <section>
                        <h3>Transform</h3>
                        <div className="field-row">
                            <NumberField
                                label="Rotation °"
                                value={token.rotation}
                                onChange={(rotation) => store.updateToken(token.id, { rotation })}
                            />
                            <NumberField
                                label="Scale"
                                value={token.scale}
                                min={0.4}
                                max={3}
                                step={0.1}
                                onChange={(scale) => store.updateToken(token.id, { scale })}
                            />
                        </div>
                    </section>
                    <section>
                        <NumberField
                            label="Base size"
                            value={token.size}
                            min={20}
                            max={300}
                            onChange={(size) => store.updateToken(token.id, { size })}
                        />
                        <h3>Token image</h3>
                        <label className="upload-button">
                            <ImagePlus size={14} />
                            {busy ? 'Uploading…' : token.image ? 'Replace image' : 'Upload image'}
                            <input
                                type="file"
                                aria-label="Upload token image"
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
                                Use placeholder
                            </button>
                        )}
                    </section>
                    <section>
                        <h3>Vitals</h3>
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
                                            {entry ? 'Remove from Combat' : 'Add to Combat'}
                                        </button>
                                    );
                                })()
                            ) : (
                                <button
                                    className="text-button"
                                    disabled={combatBusy}
                                    onClick={() => store.combatCommand({ action: 'prepare' })}
                                >
                                    Prepare Combat
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
                                label="Max HP"
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
                        <TokenCombatControls token={token} store={store} disabled={combatBusy} />
                        <div className="field-row">
                            <NumberField
                                label="AC"
                                value={token.ac ?? 0}
                                min={0}
                                max={99}
                                onChange={(ac) => store.updateToken(token.id, { ac })}
                            />
                            <NumberField
                                label="Speed"
                                value={token.speed ?? 0}
                                min={0}
                                max={999}
                                onChange={(speed) => store.updateToken(token.id, { speed })}
                            />
                        </div>
                    </section>
                    <section>
                        <h3>Access & visibility</h3>
                        <label className="toggle-row">
                            Hidden from players
                            <input
                                type="checkbox"
                                checked={token.isHidden ?? false}
                                onChange={(event) =>
                                    store.updateToken(token.id, { isHidden: event.target.checked })
                                }
                            />
                        </label>
                        <label className="toggle-row">
                            Lock position
                            <input
                                type="checkbox"
                                checked={token.isLocked ?? false}
                                onChange={(event) =>
                                    store.updateToken(token.id, { isLocked: event.target.checked })
                                }
                            />
                        </label>
                        <label className="field">
                            <span>Controlled by</span>
                            <select
                                value={token.ownerUserId ?? ''}
                                onChange={(event) =>
                                    store.updateToken(token.id, {
                                        ownerUserId: event.target.value || null,
                                    })
                                }
                            >
                                <option value="">Unassigned</option>
                                {campaign.members?.map((member) => (
                                    <option key={member.id} value={member.id}>
                                        {member.name} · {member.role.toUpperCase()}
                                    </option>
                                ))}
                            </select>
                        </label>
                    </section>
                    <section>
                        <h3>Placement</h3>
                        <label className="toggle-row">
                            <span>
                                Snap to grid<small>Scene-wide · cell centers</small>
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
                            Snaps when dropped. Inspector coordinates stay exact.
                        </p>
                    </section>
                    <div className="inspector-foot">
                        <Crosshair size={13} /> World coordinates · px
                    </div>
                    <section>
                        <button className="danger-button" onClick={deleteToken}>
                            <Trash2 size={14} /> Delete token
                        </button>
                    </section>
                </div>
            ) : (
                <div className="map-library-choice">
                    <button className="secondary-button" onClick={() => chooseImage('map')}>
                        Choose map from library
                    </button>
                    <MapInspector store={store} upload={uploadMap} busy={busy} />
                </div>
            )}
        </aside>
    );
}
