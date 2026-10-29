import { createRoot } from 'react-dom/client';
import { StrictMode } from 'react';
import { App } from './workspace/App';
import { ErrorBoundary } from './workspace/ErrorBoundary';
import '../css/app.css';
import '../css/persistence.css';
import '../css/multiplayer.css';
import '../css/preparation.css';
import '../css/workspace.css';
import '../css/identity.css';
import '../css/creation.css';
import '../css/interactions.css';
import '../css/checks.css';
import '../css/gameplay.css';

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <ErrorBoundary>
            <App />
        </ErrorBoundary>
    </StrictMode>,
);
