import '@fontsource/space-grotesk/300.css';
import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './styles/base.css';
import './styles/screens.css';
import './styles/missions.css';
import './styles/cod.css';
import { App } from './app/App';

const app = new App();
void app.boot();

// Handy for debugging in the browser console during development.
(window as unknown as { orion: App }).orion = app;
