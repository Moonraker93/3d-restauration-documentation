import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/global.css';

// No React StrictMode: the WebGPU renderer owns imperative GPU resources
// and must not be initialized twice by StrictMode's double-effect in dev.
createRoot(document.getElementById('root')!).render(<App />);
