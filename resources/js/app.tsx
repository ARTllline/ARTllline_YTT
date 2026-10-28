import { createRoot } from 'react-dom/client';
import { StrictMode } from 'react';
import { Workspace } from './workspace/Workspace';
import { ErrorBoundary } from './workspace/ErrorBoundary';
import '../css/app.css';

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <ErrorBoundary>
            <Workspace />
        </ErrorBoundary>
    </StrictMode>,
);
