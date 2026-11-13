// Only served by the isolated frontend QA runner. No application entrypoint or DB.
import { createRoot } from 'react-dom/client';
import '../../../resources/css/app.css';
import '../../../resources/css/persistence.css';
import '../../../resources/css/multiplayer.css';
import '../../../resources/css/preparation.css';
import '../../../resources/css/workspace.css';
import '../../../resources/css/identity.css';
import '../../../resources/css/creation.css';
import '../../../resources/css/interactions.css';
import '../../../resources/css/checks.css';
import '../../../resources/css/gameplay.css';
import '../../../resources/css/player-rpg.css';
import '../../../resources/css/player-cinematic.css';
import '../../../resources/css/player-dice.css';
import '../../../resources/css/rpg-windows.css';
import '../../../resources/css/rpg-folio.css';
import '../../../resources/css/player-hud.css';
import { ControlCenter } from '../../../resources/js/control/ControlCenter';

const kind = new URLSearchParams(location.search).get('kind') === 'spells' ? 'spells' : 'items';
history.replaceState(null, '', `/control/${kind}`);
createRoot(document.getElementById('root')!).render(
    <>
        <ControlCenter />
        <div
            style={{
                position: 'fixed',
                bottom: 5,
                right: 8,
                color: '#8a9990',
                fontSize: 10,
                pointerEvents: 'none',
            }}
        >
            QA · изолированные SQLite-фикстуры · без live DB
        </div>
    </>,
);
