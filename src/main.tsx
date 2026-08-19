import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { FitViewport } from './components/FitViewport';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FitViewport>
      <App />
    </FitViewport>
  </StrictMode>,
);
