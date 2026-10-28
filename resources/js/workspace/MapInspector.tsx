import { t } from '../i18n';
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
                <span className="eyebrow"> {t('SCENE SETUP')} </span>
                <h2>{scene.name ?? t('Your next scene')}</h2>
                <span className="muted">
                    {scene.width} × {scene.height} {t('world pixels')}{' '}
                </span>
            </div>
            <section>
                <h3> {t('Battle map')} </h3>
                {map ? (
                    <img
                        className="map-preview"
                        src={map.asset.url}
                        alt={t('Current battle map')}
                    />
                ) : (
                    <div className="map-placeholder">
                        <ImagePlus size={24} />
                        <p> {t('Give this scene a place.')} </p>
                    </div>
                )}
                <label className="upload-button">
                    <ImagePlus size={14} />
                    {busy ? t('Uploading…') : map ? t('Replace map') : t('Upload map')}
                    <input
                        type="file"
                        aria-label={t('Upload battle map')}
                        accept="image/png,image/jpeg,image/webp"
                        disabled={busy || !scene.id}
                        onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) upload(file);
                            e.target.value = '';
                        }}
                    />
                </label>
                <p className="hint"> {t('PNG, JPEG or WebP · up to 16 MB')} </p>
                {map && (
                    <button className="text-button" onClick={() => store.setMap(null)}>
                        <ImageOff size={13} /> {t('Remove from scene')}{' '}
                    </button>
                )}
            </section>
            {map && (
                <section>
                    <h3> {t('Map placement')} </h3>
                    <div className="field-row">
                        <NumberField
                            label={t('Map X')}
                            value={map.x}
                            onChange={(x) => store.setMap({ ...map, x })}
                        />
                        <NumberField
                            label={t('Map Y')}
                            value={map.y}
                            onChange={(y) => store.setMap({ ...map, y })}
                        />
                    </div>
                    <div className="field-row">
                        <NumberField
                            label={t('Map width')}
                            value={map.width}
                            min={1}
                            max={20000}
                            onChange={(width) => store.setMap({ ...map, width })}
                        />
                        <NumberField
                            label={t('Map height')}
                            value={map.height}
                            min={1}
                            max={20000}
                            onChange={(height) => store.setMap({ ...map, height })}
                        />
                    </div>
                </section>
            )}
            <section>
                <h3> {t('On the tabletop')} </h3>
                <p className="hint">
                    {' '}
                    {t(
                        'Select a token to edit it. Use Add token to place one at the center of your view. Grid settings are in the tabletop toolbar.',
                    )}{' '}
                </p>
            </section>
        </div>
    );
}
