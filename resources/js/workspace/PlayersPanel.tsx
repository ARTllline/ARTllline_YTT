import { t } from '../i18n';
import { useCallback, useEffect, useState } from 'react';
import { Users, Copy, Link, X } from 'lucide-react';
import { request } from '../api/client';
import type { Campaign } from '../api/workspace';
import type { Member, ConnectionState } from '../realtime/useCampaignLive';
import { Dialog } from './Dialog';
interface Invite {
    id: string;
    expiresAt: string | null;
    revokedAt: string | null;
    usesCount: number;
    maxUses: number | null;
}
export function ConnectionBadge({ state }: { state: ConnectionState }) {
    return (
        <span className={`connection-badge ${state}`} role="status">
            <i />
            {state === 'connected'
                ? t('Live')
                : state === 'offline'
                  ? t('Offline · retrying')
                  : state === 'reconnecting'
                    ? t('Reconnecting…')
                    : t('Connecting…')}
        </span>
    );
}
export function PlayersPanel({
    campaign,
    members,
    connection,
}: {
    campaign: Campaign;
    members: Member[];
    connection: ConnectionState;
}) {
    const [open, setOpen] = useState(false);
    const [invites, setInvites] = useState<Invite[]>([]);
    const [url, setUrl] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [copied, setCopied] = useState(false);
    const reload = useCallback(
        () =>
            request<{ invites: Invite[] }>(`/campaigns/${campaign.id}/invites`).then((r) =>
                setInvites(r.invites),
            ),
        [campaign.id],
    );
    useEffect(() => {
        if (open) void reload().catch((e) => setError(e.message));
    }, [open, reload]);
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
    return (
        <>
            <ConnectionBadge state={connection} />
            <button className="secondary-button players-trigger" onClick={() => setOpen(true)}>
                <Users size={15} /> {t('Players')} <span>{members.length}</span>
            </button>
            {open && (
                <Dialog title={t('Around the table')} onClose={() => setOpen(false)}>
                    <div className="players-panel">
                        <p> {t('Invite your party. Players see only the scene you activate.')} </p>
                        <div className="member-list">
                            {campaign.members?.map((member) => (
                                <div className="member-row" key={member.id}>
                                    <span className="member-avatar">
                                        {member.name.slice(0, 2).toUpperCase()}
                                    </span>
                                    <div>
                                        <strong>{member.name}</strong>
                                        <small>
                                            {member.role === 'gm' ? t('Game Master') : t('Player')}
                                        </small>
                                    </div>
                                    <span
                                        className={
                                            members.some((m) => m.id === member.id)
                                                ? 'online-label'
                                                : 'muted'
                                        }
                                    >
                                        {members.some((m) => m.id === member.id)
                                            ? t('Online')
                                            : t('Offline')}
                                    </span>
                                </div>
                            ))}
                        </div>
                        <form
                            onSubmit={(event) => {
                                event.preventDefault();
                                const fields = new FormData(event.currentTarget);
                                void run(async () => {
                                    const value = await request<Invite & { url: string }>(
                                        `/campaigns/${campaign.id}/invites`,
                                        'POST',
                                        {
                                            expiresInDays: Number(fields.get('days')),
                                            maxUses: fields.get('uses')
                                                ? Number(fields.get('uses'))
                                                : null,
                                        },
                                    );
                                    setUrl(value.url);
                                    setCopied(false);
                                    await reload();
                                });
                            }}
                        >
                            <div className="invite-options">
                                <label className="field">
                                    <span> {t('Expires in')} </span>
                                    <select name="days" defaultValue="7">
                                        <option value="1"> {t('1 day')} </option>
                                        <option value="7"> {t('7 days')} </option>
                                        <option value="30"> {t('30 days')} </option>
                                    </select>
                                </label>
                                <label className="field">
                                    <span> {t('New players limit')} </span>
                                    <input
                                        type="number"
                                        name="uses"
                                        min="1"
                                        max="100"
                                        placeholder={t('Unlimited')}
                                    />
                                </label>
                            </div>
                            <button className="primary-button" disabled={busy}>
                                <Link size={14} /> {t('Create invitation')}{' '}
                            </button>
                        </form>
                        {url && (
                            <div className="invite-link">
                                <input
                                    aria-label={t('Invitation link')}
                                    readOnly
                                    value={url}
                                    onFocus={(e) => e.target.select()}
                                />
                                <button
                                    className="icon-button"
                                    aria-label={t('Copy invitation')}
                                    onClick={() =>
                                        void run(async () => {
                                            await navigator.clipboard.writeText(url);
                                            setCopied(true);
                                        })
                                    }
                                >
                                    <Copy size={16} />
                                </button>
                                <small>
                                    {copied
                                        ? t('Copied')
                                        : t('Copy this link now; only its secure hash is stored.')}
                                </small>
                            </div>
                        )}
                        {error && (
                            <p className="form-error" role="alert">
                                {error}
                            </p>
                        )}
                        <div className="invite-list">
                            {invites.map((invite) => (
                                <div className="invite-row" key={invite.id}>
                                    <div>
                                        <strong>
                                            {' '}
                                            {t('Invitation #')} {invite.id}
                                        </strong>
                                        <small>
                                            {invite.revokedAt
                                                ? t('Revoked')
                                                : t('expiresOn', {
                                                      date: new Date(
                                                          invite.expiresAt!,
                                                      ).toLocaleDateString('ru-RU'),
                                                  })}{' '}
                                            · {invite.usesCount}
                                            {invite.maxUses ? ` / ${invite.maxUses}` : ''}{' '}
                                            {t('joined')}{' '}
                                        </small>
                                    </div>
                                    {!invite.revokedAt && (
                                        <button
                                            className="icon-button"
                                            title={t('Revoke invitation')}
                                            aria-label={t('revokeInvite', { id: invite.id })}
                                            disabled={busy}
                                            onClick={() =>
                                                void run(async () => {
                                                    await request(
                                                        `/invites/${invite.id}`,
                                                        'DELETE',
                                                    );
                                                    setUrl('');
                                                    await reload();
                                                })
                                            }
                                        >
                                            <X size={15} />
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                </Dialog>
            )}
        </>
    );
}
