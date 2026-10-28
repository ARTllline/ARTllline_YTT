import { useEffect, useState } from 'react';
import { request } from '../api/client';
import type { User } from '../api/workspace';
export const authReturn = () => {
    const path = new URLSearchParams(location.search).get('returnTo') ?? '/';
    return /^\/join\/[a-f0-9]{64}$/.test(path) ? path : '/';
};
export function JoinScreen({ user }: { user: User | null }) {
    const token = location.pathname.split('/')[2];
    const [name, setName] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        const abort = new AbortController();
        void request<{ name: string }>(`/invites/${token}`, 'GET', undefined, abort.signal)
            .then((value) => setName(value.name))
            .catch((e) => {
                if (!abort.signal.aborted) setError(e.message);
            });
        return () => abort.abort();
    }, [token]);
    const join = async () => {
        setBusy(true);
        setError('');
        try {
            const result = await request<{ campaignId: string; role: string }>(
                `/invites/${token}/join`,
                'POST',
            );
            location.assign(
                `/campaigns/${result.campaignId}${result.role === 'gm' ? '' : '/play'}`,
            );
        } catch (e) {
            setError((e as Error).message);
            setBusy(false);
        }
    };
    return (
        <main className="join-screen">
            <div className="join-card">
                <span className="eyebrow">YTT / AN INVITATION TO ADVENTURE</span>
                <h1>
                    {name || (error ? 'This invitation is unavailable.' : 'Finding your table…')}
                </h1>
                <p>
                    A place at the table is waiting for you. Join as a player and follow your Game
                    Master into the story.
                </p>
                {error && (
                    <p role="alert" className="form-error">
                        {error}
                    </p>
                )}
                {name &&
                    (user ? (
                        <button
                            className="primary-button"
                            disabled={busy}
                            onClick={() => void join()}
                        >
                            {busy ? 'Joining…' : `Join as ${user.name}`}
                        </button>
                    ) : (
                        <a
                            className="primary-button"
                            href={`/login?returnTo=${encodeURIComponent(location.pathname)}`}
                        >
                            Sign in to join
                        </a>
                    ))}
                <a className="muted" href="/">
                    Your campaigns
                </a>
            </div>
        </main>
    );
}
