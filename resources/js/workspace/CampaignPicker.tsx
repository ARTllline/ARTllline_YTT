import { t } from '../i18n';
import { useEffect, useState, type FormEvent } from 'react';
import { Box, Plus, ArrowUpRight, LogOut } from 'lucide-react';
import { api, type CampaignSummary, type User } from '../api/workspace';
import { Dialog } from './Dialog';
export function CampaignPicker({ user }: { user: User }) {
    const [campaigns, setCampaigns] = useState<CampaignSummary[] | null>(null);
    const [create, setCreate] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    useEffect(() => {
        let active = true;
        void api
            .campaigns()
            .then((result) => {
                if (active) setCampaigns(result.campaigns);
            })
            .catch((error) => {
                if (active) setError(error.message);
            });
        return () => {
            active = false;
        };
    }, []);
    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setBusy(true);
        setError('');
        try {
            const campaign = await api.createCampaign(
                String(new FormData(event.currentTarget).get('name')),
            );
            location.assign(`/campaigns/${campaign.id}`);
        } catch (error) {
            setError((error as Error).message);
            setBusy(false);
        }
    };
    return (
        <div className="project-screen">
            <header className="topbar">
                <a className="brand" href="/">
                    <Box size={25} />
                    <strong>YTT /</strong>
                </a>
                <span className="muted"> {t('Your workspaces')} </span>
                <div className="topbar-actions">
                    <span className="muted">{user.name}</span>
                    <button
                        className="icon-button"
                        aria-label={t('Sign out')}
                        title={t('Sign out')}
                        onClick={() =>
                            void api
                                .logout()
                                .then(() => location.assign('/login'))
                                .catch((error) => setError(error.message))
                        }
                    >
                        <LogOut size={17} />
                    </button>
                </div>
            </header>
            <main className="project-main">
                <span className="eyebrow"> {t('MAKE ROOM FOR ADVENTURE')} </span>
                <div className="project-title">
                    <h1> {t('Your campaigns')} </h1>
                    <button className="primary-button" onClick={() => setCreate(true)}>
                        <Plus size={16} /> {t('New campaign')}{' '}
                    </button>
                </div>
                <p className="muted">
                    {' '}
                    {t('A home for the places, characters and stories you’re preparing.')}{' '}
                </p>
                {error && !create && (
                    <p role="alert" className="form-error">
                        {error}
                    </p>
                )}
                {campaigns === null ? (
                    <div className="project-empty"> {t('Loading your campaigns…')} </div>
                ) : campaigns.length === 0 ? (
                    <div className="project-empty">
                        <div className="empty-symbol">
                            <Box size={28} />
                        </div>
                        <h2> {t('Create your first campaign')} </h2>
                        <p> {t('Start with a name. Your world can grow from there.')} </p>
                        <button className="primary-button" onClick={() => setCreate(true)}>
                            <Plus size={16} /> {t('Create campaign')}{' '}
                        </button>
                    </div>
                ) : (
                    <div className="project-grid">
                        {campaigns.map((c) => (
                            <a
                                className="project-card"
                                href={
                                    c.role === 'gm'
                                        ? `/campaigns/${c.id}`
                                        : `/campaigns/${c.id}/play`
                                }
                                key={c.id}
                            >
                                <div className="project-card-art">
                                    <Box size={38} />
                                    <ArrowUpRight size={17} />
                                </div>
                                <span className="eyebrow">
                                    {c.role === 'gm' ? t('GAME MASTER') : t('PLAYER')}
                                </span>
                                <h2>{c.name}</h2>
                                <small>
                                    {c.role === 'gm' ? t('Open workspace') : t('Join the table')}
                                </small>
                            </a>
                        ))}
                    </div>
                )}
            </main>
            {create && (
                <Dialog title={t('A new campaign')} onClose={() => !busy && setCreate(false)}>
                    <form onSubmit={submit}>
                        <p> {t('Give your next adventure a home.')} </p>
                        <label className="field">
                            <span> {t('Campaign name')} </span>
                            <input
                                name="name"
                                required
                                maxLength={120}
                                autoFocus
                                placeholder={t('The Hollow Marches')}
                            />
                        </label>
                        {error && (
                            <p role="alert" className="form-error">
                                {error}
                            </p>
                        )}
                        <button className="primary-button" disabled={busy}>
                            {busy ? t('Creating…') : t('Create campaign')}
                        </button>
                    </form>
                </Dialog>
            )}
        </div>
    );
}
