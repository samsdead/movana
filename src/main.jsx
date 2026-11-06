import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { track,campaignSource } from './analytics.js';
import './styles.css';

// Development-only camera fixtures exercise the real model without capturing a person.
if (import.meta.env.DEV && new URLSearchParams(location.search).has('qa-camera')) {
  await import('./qa-camera.js');
}
createRoot(document.getElementById('root')).render(<App />);
track('visit',{source:campaignSource()});
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
