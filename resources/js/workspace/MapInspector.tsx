import { ImagePlus, ImageOff } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import type { SceneStore } from '../tabletop/state/SceneStore';
import { NumberField } from './NumberField';
export function MapInspector({
    store,
    upload,
    busy,
}: {
    store: SceneStore;
    upload: (file: File) => void;
    busy: boolean;
}) {
    const { scene } = useSyncExternalStore(store.subscribe, store.getSnapshot);
    const map = scene.map;
    return (
        <div className="inspector-body">
            <div className="identity">
                <span className="eyebrow">SCENE SETUP</span>
                <h2>{scene.name ?? 'Your next scene'}</h2>
                <span className="muted">
                    {scene.width} × {scene.height} world pixels
                </span>
            </div>
            <section>
                <h3>Battle map</h3>
                {map ? (
                    <img className="map-preview" src={map.asset.url} alt="Current battle map" />
                ) : (
                    <div className="map-placeholder">
                        <ImagePlus size={24} />
                        <p>Give this scene a place.</p>
                    </div>
                )}
                <label className="upload-button">
                    <ImagePlus size={14} />
                    {busy ? 'Uploading…' : map ? 'Replace map' : 'Upload map'}
                    <input
                        type="file"
                        aria-label="Upload battle map"
                        accept="image/png,image/jpeg,image/webp"
                        disabled={busy || !scene.id}
                        onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) upload(file);
                            e.target.value = '';
                        }}
                    />
                </label>
                <p className="hint">PNG, JPEG or WebP · up to 16 MB</p>
                {map && (
                    <button className="text-button" onClick={() => store.setMap(null)}>
                        <ImageOff size={13} /> Remove from scene
                    </button>
                )}
            </section>
            {map && (
                <section>
                    <h3>Map placement</h3>
                    <div className="field-row">
                        <NumberField
                            label="Map X"
                            value={map.x}
                            onChange={(x) => store.setMap({ ...map, x })}
                        />
                        <NumberField
                            label="Map Y"
                            value={map.y}
                            onChange={(y) => store.setMap({ ...map, y })}
                        />
                    </div>
                    <div className="field-row">
                        <NumberField
                            label="Map width"
                            value={map.width}
                            min={1}
                            max={20000}
                            onChange={(width) => store.setMap({ ...map, width })}
                        />
                        <NumberField
                            label="Map height"
                            value={map.height}
                            min={1}
                            max={20000}
                            onChange={(height) => store.setMap({ ...map, height })}
                        />
                    </div>
                </section>
            )}
            <section>
                <h3>On the tabletop</h3>
                <p className="hint">
                    Select a token to edit it. Use Add token to place one at the center of your
                    view. Grid settings are in the tabletop toolbar.
                </p>
            </section>
        </div>
    );
}
