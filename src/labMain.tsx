import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { LabScreen } from './screens/LabScreen';
import './styles.css';
import './lab.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LabScreen />
  </StrictMode>,
);
