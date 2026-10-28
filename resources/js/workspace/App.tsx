import { useEffect, useState } from 'react';
import { api, type User, type Campaign } from '../api/workspace';
import { AuthScreen } from './AuthScreen';
import { CampaignPicker } from './CampaignPicker';
import { Workspace } from './Workspace';
import type { Scene } from '../tabletop/types/scene';
type Loaded = { user: User; campaign?: Campaign; scene?: Scene };
export function App() {
    const [loaded, setLoaded] = useState<Loaded | null>(null);
    const [error, setError] = useState('');
    const auth = location.pathname === '/login' || location.pathname === '/register';
    useEffect(() => {
        let active = true;
        const abort = new AbortController();
        void (async () => {
            const user = await api.session();
            if (!active) return;
            if (!user) {
                if (!auth) location.replace('/login');
                return;
            }
            if (auth) {
                location.replace('/');
                return;
            }
            const path = location.pathname.match(/^\/campaigns\/(\d+)(?:\/scenes\/(\d+))?$/);
            if (!path) {
                setLoaded({ user });
                return;
            }
            const campaign = await api.campaign(path[1], abort.signal);
            if (campaign.role !== 'gm')
                throw new Error('The player tabletop is not available yet.');
            let scene: Scene | undefined;
            if (path[2]) {
                scene = await api.snapshot(path[2], abort.signal);
                if (scene.campaignId !== campaign.id)
                    throw new Error('This scene does not belong to the campaign.');
            } else if (campaign.scenes.length) {
                location.replace(`/campaigns/${campaign.id}/scenes/${campaign.scenes[0].id}`);
                return;
            }
            if (active) setLoaded({ user, campaign, scene });
        })().catch((error) => {
            if (active && error.name !== 'AbortError') setError(error.message);
        });
        return () => {
            active = false;
            abort.abort();
        };
    }, [auth]);
    if (auth) return <AuthScreen />;
    if (error)
        return (
            <div className="boot">
                <h1>The workspace could not open.</h1>
                <p className="muted">{error}</p>
                <a href="/">Return to campaigns</a>
            </div>
        );
    if (!loaded)
        return (
            <div className="boot">
                <strong>YTT / YOUR TABLETOP</strong>
                <small>Opening your workspace…</small>
            </div>
        );
    return loaded.campaign ? (
        <Workspace user={loaded.user} campaign={loaded.campaign} initialScene={loaded.scene} />
    ) : (
        <CampaignPicker user={loaded.user} />
    );
}
