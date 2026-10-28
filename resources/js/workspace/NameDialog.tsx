import { t } from '../i18n';
import { useState, type FormEvent } from 'react';
import { Dialog } from './Dialog';
export function NameDialog({
    title,
    label,
    initial = '',
    description,
    submit,
    onClose,
}: {
    title: string;
    label: string;
    initial?: string;
    description?: string;
    submit: (name: string) => Promise<void>;
    onClose: () => void;
}) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const save = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setBusy(true);
        setError('');
        try {
            await submit(String(new FormData(event.currentTarget).get('name')));
            onClose();
        } catch (error) {
            setError((error as Error).message);
            setBusy(false);
        }
    };
    return (
        <Dialog title={title} onClose={() => !busy && onClose()}>
            <form onSubmit={save}>
                {description && <p className="hint">{description}</p>}
                <label className="field">
                    <span>{label}</span>
                    <input autoFocus name="name" required maxLength={120} defaultValue={initial} />
                </label>
                {error && (
                    <p className="form-error" role="alert">
                        {error}
                    </p>
                )}
                <div className="dialog-actions">
                    <button
                        className="secondary-button"
                        type="button"
                        disabled={busy}
                        onClick={onClose}
                    >
                        {' '}
                        {t('Cancel')}{' '}
                    </button>
                    <button className="primary-button" disabled={busy}>
                        {busy ? t('Saving…') : t('Save')}
                    </button>
                </div>
            </form>
        </Dialog>
    );
}
