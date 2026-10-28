import { t } from '../../i18n';
import { isAudio, durationLabel } from '../../media/model';
import { AudioPreview } from '../../media/AudioPreview';
import { audioEngine } from '../../media/AudioEngine';
import { useEffect, useState } from 'react';
import { Eye, Trash2 } from 'lucide-react';
import { preparation, type LibraryAsset, type Handout } from '../../api/preparation';
import { Dialog } from '../Dialog';
import { ConfirmDialog } from '../ConfirmDialog';
import { HandoutViewer } from '../handouts/HandoutViewer';
const labels = (value: string) => [
    ...new Set(
        value
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
    ),
];
export function AssetDetails({
    asset,
    campaignId,
    onClose,
    onChanged,
    onUse,
}: {
    asset: LibraryAsset;
    campaignId: string;
    onClose: () => void;
    onChanged: () => void;
    onUse?: (asset: LibraryAsset) => void;
}) {
    const [name, setName] = useState(asset.name),
        [tags, setTags] = useState(asset.tags.map((t) => t.name).join(', ')),
        [collections, setCollections] = useState(asset.collections.map((t) => t.name).join(', '));
    useEffect(() => () => audioEngine.stopPreview(), []);
    const [usage, setUsage] = useState<string[]>(),
        [error, setError] = useState(''),
        [busy, setBusy] = useState(false),
        [confirm, setConfirm] = useState(false);
    const [preview, setPreview] = useState<Handout | null>(null),
        [description, setDescription] = useState('');
    const [prepared, setPrepared] = useState(false);
    useEffect(() => {
        let alive = true;
        void preparation
            .detail(asset.id)
            .then((a) => {
                if (alive) {
                    setUsage(a.usage);
                    setDescription(a.handout?.description ?? '');
                    setPrepared(!!a.handout);
                }
            })
            .catch((e) => {
                if (alive) setError(e.message);
            });
        return () => {
            alive = false;
        };
    }, [asset.id]);
    const run = async (action: () => Promise<void>) => {
        setBusy(true);
        setError('');
        try {
            await action();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };
    const save = async () => {
        const saved = await preparation.update(asset.id, {
            name,
            tags: labels(tags),
            collections: labels(collections),
        });
        if (prepared)
            await preparation.saveHandout(campaignId, asset.id, name.slice(0, 160), description);
        onChanged();
        return saved;
    };
    return (
        <Dialog
            title={t('Asset details')}
            onClose={() => {
                if (!busy) onClose();
            }}
        >
            <div className="asset-detail">
                {isAudio(asset.kind) ? (
                    <AudioPreview asset={asset} />
                ) : (
                    <img
                        className="asset-detail-preview"
                        src={asset.thumbnailUrl}
                        alt={asset.name}
                    />
                )}
                <p className="hint">
                    {t(`kind.${asset.kind}`)} ·{' '}
                    {isAudio(asset.kind)
                        ? durationLabel(asset.duration ?? 0)
                        : `${asset.width} × ${asset.height}`}{' '}
                    · {(asset.fileSize / 1048576).toFixed(2)} MiB
                    <br />
                    {asset.originalName}
                    <br />
                    {new Date(asset.createdAt).toLocaleDateString()}
                </p>
                <label className="field">
                    {' '}
                    {t('Display name')}{' '}
                    <input value={name} maxLength={255} onChange={(e) => setName(e.target.value)} />
                </label>
                <label className="field">
                    {' '}
                    {t('Tags · comma separated')}{' '}
                    <input
                        value={tags}
                        placeholder={t('forest, ambush, night')}
                        onChange={(e) => setTags(e.target.value)}
                    />
                </label>
                <label className="field">
                    {' '}
                    {t('Collections · comma separated')}{' '}
                    <input
                        value={collections}
                        placeholder={t('Session 12, The old road')}
                        onChange={(e) => setCollections(e.target.value)}
                    />
                </label>
                <p className="hint">
                    {' '}
                    {t(
                        'Type a new tag or collection to create it. Remove a name to detach it.',
                    )}{' '}
                </p>
                {asset.kind === 'handout' && (
                    <label className="field">
                        {' '}
                        {t('Handout description')}{' '}
                        <textarea
                            disabled={usage === undefined || busy}
                            value={description}
                            maxLength={10000}
                            onChange={(e) => setDescription(e.target.value)}
                        />
                    </label>
                )}
                {error && (
                    <p role="alert" className="form-error">
                        {error}
                    </p>
                )}
                <div className="dialog-actions">
                    <button
                        className="primary-button"
                        disabled={busy || usage === undefined || !name.trim()}
                        onClick={() =>
                            void run(async () => {
                                await save();
                                onClose();
                            })
                        }
                    >
                        {' '}
                        {t('Save details')}{' '}
                    </button>
                    {asset.kind !== 'handout' && !isAudio(asset.kind) && onUse && (
                        <button
                            className="secondary-button"
                            disabled={busy}
                            onClick={() =>
                                void run(async () => {
                                    onUse(await save());
                                    onClose();
                                })
                            }
                        >
                            {' '}
                            {t('Use on scene')}{' '}
                        </button>
                    )}
                    {asset.kind === 'handout' && (
                        <button
                            className="secondary-button"
                            disabled={busy || usage === undefined || !name.trim()}
                            onClick={() =>
                                void run(async () => {
                                    await save();
                                    setPreview(
                                        await preparation.saveHandout(
                                            campaignId,
                                            asset.id,
                                            name.slice(0, 160),
                                            description,
                                        ),
                                    );
                                    setPrepared(true);
                                    setUsage(['Handout · ' + name]);
                                })
                            }
                        >
                            <Eye size={14} /> {t('Prepare / Preview')}{' '}
                        </button>
                    )}
                </div>
                <div className="asset-usage">
                    <strong> {t('Used in')} </strong>
                    {usage === undefined ? (
                        <p> {t('Checking references…')} </p>
                    ) : usage.length ? (
                        <ul>
                            {usage.map((u, i) => (
                                <li key={i}>{u}</li>
                            ))}
                        </ul>
                    ) : (
                        <p> {t('No scene or handout references. Safe to delete.')} </p>
                    )}
                    <button
                        className="danger-button"
                        disabled={busy || usage === undefined || usage.length > 0}
                        onClick={() => setConfirm(true)}
                    >
                        <Trash2 size={13} /> {t('Delete unused asset')}{' '}
                    </button>
                </div>
                {confirm && (
                    <ConfirmDialog
                        title={t('Delete unused asset?')}
                        description={t('deleteAsset', { name: asset.name })}
                        onClose={() => setConfirm(false)}
                        submit={async () => {
                            await preparation.remove(asset.id);
                            onChanged();
                            onClose();
                        }}
                    />
                )}
                {preview && (
                    <HandoutViewer
                        campaignId={campaignId}
                        handout={preview}
                        onClose={() => setPreview(null)}
                        onShow={() =>
                            preparation.showHandout(campaignId, preview.id).then(() => undefined)
                        }
                    />
                )}
            </div>
        </Dialog>
    );
}
