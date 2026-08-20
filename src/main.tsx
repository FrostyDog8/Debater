import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { FitViewport } from './components/FitViewport';
import { initAnalytics } from './lib/analytics';
import './styles.css';

initAnalytics();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FitViewport>
      <App />
    </FitViewport>
  </StrictMode>,
);
