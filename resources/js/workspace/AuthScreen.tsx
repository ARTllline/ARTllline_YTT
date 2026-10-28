import { t } from '../i18n';
import { useState, type FormEvent } from 'react';
import { Box, ArrowRight } from 'lucide-react';
import { api } from '../api/workspace';
import { authReturn } from './JoinScreen';
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
            location.assign(authReturn());
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
                <span> {t('YOUR TABLETOP')} </span>
            </a>
            <div className="entry-layout">
                <div className="entry-intro">
                    <span className="eyebrow"> {t('THE GAME MASTER’S WORKSPACE')} </span>
                    <h1>
                        {' '}
                        {t('Every great story')} <br /> {t('starts at your table.')}{' '}
                    </h1>
                    <p>
                        {' '}
                        {t('Build a world. Set the scene.')} <br />{' '}
                        {t('Keep your next adventure close.')}{' '}
                    </p>
                    <span className="entry-caption">
                        {' '}
                        {t('PREPARE WITH INTENTION. PLAY WITH POSSIBILITY.')}{' '}
                    </span>
                </div>
                <form className="entry-form" onSubmit={submit}>
                    <span className="eyebrow">
                        {register ? t('A NEW CHAPTER') : t('WELCOME BACK')}
                    </span>
                    <h2>{register ? t('Make yourself at home.') : t('Your table is waiting.')}</h2>
                    <p>
                        {register
                            ? t('Create your account to start preparing.')
                            : t('Sign in to continue your adventures.')}
                    </p>
                    {register && (
                        <label className="field">
                            <span> {t('Your name')} </span>
                            <input name="name" autoComplete="name" required maxLength={80} />
                        </label>
                    )}
                    <label className="field">
                        <span> {t('Email')} </span>
                        <input
                            name="email"
                            type="email"
                            autoComplete="email"
                            required
                            maxLength={255}
                        />
                    </label>
                    <label className="field">
                        <span>
                            {' '}
                            {t('Password')} {register ? t(' · at least 10 characters') : ''}
                        </span>
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
                            <span> {t('Confirm password')} </span>
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
                        {busy
                            ? t('Opening your workspace…')
                            : register
                              ? t('Create account')
                              : t('Sign in')}
                        <ArrowRight size={17} />
                    </button>
                    <div className="entry-switch">
                        {register ? t('Already have an account?') : t('New to YTT?')}{' '}
                        <a
                            href={`${register ? '/login' : '/register'}?returnTo=${encodeURIComponent(authReturn())}`}
                        >
                            {register ? t('Sign in') : t('Create an account')}
                        </a>
                    </div>
                </form>
            </div>
            <footer className="entry-footer"> {t('YOUR WORLD. YOUR PACE. YOUR TABLE.')} </footer>
        </main>
    );
}
