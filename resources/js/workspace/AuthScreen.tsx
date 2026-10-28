import { useState, type FormEvent } from 'react';
import { Box, ArrowRight } from 'lucide-react';
import { api } from '../api/workspace';
export function AuthScreen() {
    const register = location.pathname === '/register';
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setBusy(true);
        setError('');
        const fields = Object.fromEntries(new FormData(event.currentTarget)) as Record<
            string,
            string
        >;
        try {
            await api.auth(register ? 'register' : 'login', fields);
            location.assign('/');
        } catch (error) {
            setError((error as Error).message);
            setBusy(false);
        }
    };
    return (
        <main className="entry-screen">
            <div className="entry-atmosphere" aria-hidden="true">
                <div className="orbit orbit-one" />
                <div className="orbit orbit-two" />
                <div className="entry-star" />
            </div>
            <a href="/" className="entry-brand brand">
                <Box size={28} />
                <strong>YTT /</strong>
                <span>YOUR TABLETOP</span>
            </a>
            <div className="entry-layout">
                <div className="entry-intro">
                    <span className="eyebrow">THE GAME MASTER’S WORKSPACE</span>
                    <h1>
                        Every great story
                        <br />
                        starts at your table.
                    </h1>
                    <p>
                        Build a world. Set the scene.
                        <br />
                        Keep your next adventure close.
                    </p>
                    <span className="entry-caption">
                        PREPARE WITH INTENTION. PLAY WITH POSSIBILITY.
                    </span>
                </div>
                <form className="entry-form" onSubmit={submit}>
                    <span className="eyebrow">{register ? 'A NEW CHAPTER' : 'WELCOME BACK'}</span>
                    <h2>{register ? 'Make yourself at home.' : 'Your table is waiting.'}</h2>
                    <p>
                        {register
                            ? 'Create your account to start preparing.'
                            : 'Sign in to continue your adventures.'}
                    </p>
                    {register && (
                        <label className="field">
                            <span>Your name</span>
                            <input name="name" autoComplete="name" required maxLength={80} />
                        </label>
                    )}
                    <label className="field">
                        <span>Email</span>
                        <input
                            name="email"
                            type="email"
                            autoComplete="email"
                            required
                            maxLength={255}
                        />
                    </label>
                    <label className="field">
                        <span>Password{register ? ' · at least 10 characters' : ''}</span>
                        <input
                            name="password"
                            type="password"
                            autoComplete={register ? 'new-password' : 'current-password'}
                            required
                            minLength={register ? 10 : undefined}
                            maxLength={128}
                        />
                    </label>
                    {register && (
                        <label className="field">
                            <span>Confirm password</span>
                            <input
                                name="password_confirmation"
                                type="password"
                                autoComplete="new-password"
                                required
                                maxLength={128}
                            />
                        </label>
                    )}
                    {error && (
                        <p className="form-error" role="alert">
                            {error}
                        </p>
                    )}
                    <button className="primary-button" disabled={busy}>
                        {busy ? 'Opening your workspace…' : register ? 'Create account' : 'Sign in'}
                        <ArrowRight size={17} />
                    </button>
                    <div className="entry-switch">
                        {register ? 'Already have an account?' : 'New to YTT?'}{' '}
                        <a href={register ? '/login' : '/register'}>
                            {register ? 'Sign in' : 'Create an account'}
                        </a>
                    </div>
                </form>
            </div>
            <footer className="entry-footer">YOUR WORLD. YOUR PACE. YOUR TABLE.</footer>
        </main>
    );
}
