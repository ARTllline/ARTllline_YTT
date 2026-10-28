import { useSyncExternalStore } from 'react';
import { Crosshair, SlidersHorizontal, Shield, X, MousePointer2 } from 'lucide-react';
import type { SceneStore } from '../tabletop/state/SceneStore';
import { NumberField } from './NumberField';
export function Inspector({ store, onClose }: { store: SceneStore; onClose: () => void }) {
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
                        <span className="muted">Local demo object</span>
                    </div>
                    <section>
                        <h3>Identity</h3>
                        <label className="field">
                            <span>Name</span>
                            <input
                                aria-label="Token name"
                                defaultValue={token.name}
                                maxLength={80}
                                onBlur={(event) => {
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
                        <h3>
                            Vitals <span>DEMO</span>
                        </h3>
                        <div className="field-row">
                            <NumberField
                                label="HP"
                                value={token.hp}
                                min={0}
                                max={token.maxHp}
                                onChange={(hp) => store.updateToken(token.id, { hp })}
                            />
                            <NumberField
                                label="Max HP"
                                value={token.maxHp}
                                min={1}
                                max={9999}
                                onChange={(maxHp) => store.updateToken(token.id, { maxHp })}
                            />
                        </div>
                        <div className="health-track">
                            <i style={{ width: `${(token.hp / token.maxHp) * 100}%` }} />
                        </div>
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
                </div>
            ) : (
                <div className="empty-inspector">
                    <div className="empty-symbol">
                        <MousePointer2 size={25} />
                    </div>
                    <h2>A closer look</h2>
                    <p>
                        Select a token on the tabletop to adjust its position, appearance and
                        vitals.
                    </p>
                    <div className="scene-facts">
                        <span>SCENE</span>
                        <strong>The Sunken Observatory</strong>
                        <dl>
                            <dt>Dimensions</dt>
                            <dd>1440 × 1080</dd>
                            <dt>Grid</dt>
                            <dd>{scene.grid.size} px · square</dd>
                            <dt>Objects</dt>
                            <dd>{scene.tokens.length} tokens</dd>
                        </dl>
                    </div>
                    <p className="hint">You can also select a token from the scene outline.</p>
                </div>
            )}
        </aside>
    );
}
