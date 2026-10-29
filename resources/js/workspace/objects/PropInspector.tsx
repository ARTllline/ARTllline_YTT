import { t } from '../../i18n';
import { X, Layers } from 'lucide-react';
import type { SceneStore } from '../../tabletop/state/SceneStore';
import type { SceneProp } from '../../tabletop/types/scene';
import { NumberField } from '../NumberField';
import { InteractionEditor } from '../interactions/InteractionEditor';
export function PropInspector({
    prop,
    store,
    onClose,
    busy,
}: {
    prop: SceneProp;
    store: SceneStore;
    onClose: () => void;
    busy: boolean;
}) {
    const patch = (value: Record<string, string | number | boolean>) =>
        store.objectCommand({
            endpoint: 'props',
            data: { action: 'update', id: prop.id, patch: value },
        });
    return (
        <aside className="inspector panel" aria-label={t('Object inspector')}>
            <div className="panel-heading">
                <Layers size={14} />
                <span> {t('Object')} </span>
                <button className="icon-button" aria-label={t('Close inspector')} onClick={onClose}>
                    <X size={16} />
                </button>
            </div>
            <div className="inspector-scroll">
                <fieldset disabled={busy} className="object-fields">
                    <img
                        className="prop-image-preview"
                        src={prop.image.url}
                        alt={t('Object image')}
                    />
                    <label className="field">
                        {' '}
                        {t('Name')}{' '}
                        <input
                            key={prop.name}
                            defaultValue={prop.name ?? ''}
                            maxLength={160}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') e.currentTarget.blur();
                            }}
                            onBlur={(e) => {
                                if (e.target.value !== prop.name) patch({ name: e.target.value });
                            }}
                        />
                    </label>
                    <InteractionEditor
                        key={prop.id}
                        store={store}
                        kind="prop"
                        id={prop.id}
                        actions={prop.interactions}
                        disabled={busy}
                    />
                    <div className="field-grid">
                        <NumberField label="X" value={prop.x} onChange={(x) => patch({ x })} />
                        <NumberField label="Y" value={prop.y} onChange={(y) => patch({ y })} />
                    </div>
                    <div className="field-grid">
                        <NumberField
                            label={t('Width')}
                            min={1}
                            value={prop.image.width * prop.scaleX}
                            onChange={(v) => patch({ scale_x: v / prop.image.width })}
                        />
                        <NumberField
                            label={t('Height')}
                            min={1}
                            value={prop.image.height * prop.scaleY}
                            onChange={(v) => patch({ scale_y: v / prop.image.height })}
                        />
                    </div>
                    <NumberField
                        label={t('Rotation')}
                        value={prop.rotation}
                        min={-360}
                        max={360}
                        onChange={(rotation) => patch({ rotation })}
                    />
                    <label className="check-field">
                        <input
                            type="checkbox"
                            checked={!!prop.isHidden}
                            onChange={(e) => patch({ is_hidden: e.target.checked })}
                        />{' '}
                        {t('Hidden from players')}{' '}
                    </label>
                    <label className="check-field">
                        <input
                            type="checkbox"
                            checked={!!prop.isLocked}
                            onChange={(e) => patch({ is_locked: e.target.checked })}
                        />{' '}
                        {t('Locked')}{' '}
                    </label>
                    <h3> {t('Display order')} </h3>
                    <div className="object-order">
                        {(
                            [
                                ['front', t('Bring to front')],
                                ['forward', t('Forward')],
                                ['backward', t('Backward')],
                                ['back', t('Send to back')],
                            ] as const
                        ).map(([order, label]) => (
                            <button
                                className="secondary-button"
                                key={order}
                                onClick={() =>
                                    store.objectCommand({
                                        endpoint: 'props',
                                        data: { action: 'update', id: prop.id, order },
                                    })
                                }
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                    <p className="hint">
                        {' '}
                        {t(
                            'Drag the corner handle to resize. Shift + click selects several objects.',
                        )}{' '}
                    </p>
                </fieldset>
            </div>
        </aside>
    );
}
