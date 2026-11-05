import React from 'react';
import ReactDOM from 'react-dom/client';
import BlockedApp from './BlockedApp';
import '../styles/globals.css';

const rootEl = document.getElementById('root');
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <BlockedApp />
    </React.StrictMode>
  );
}

