import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Auth0Provider } from '@auth0/auth0-react';
import '@fontsource/anek-latin/600.css';
import '@fontsource/anek-latin/700.css';
import '@fontsource/source-sans-3/400.css';
import '@fontsource/source-sans-3/600.css';
import '@fontsource/jetbrains-mono/400.css';
import 'leaflet/dist/leaflet.css';
import './index.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Auth0Provider
      domain={import.meta.env.VITE_AUTH0_DOMAIN ?? 'dev-geomark.jp.auth0.com'}
      clientId={import.meta.env.VITE_AUTH0_CLIENT_ID ?? 'XBdoMKG3kteo2Z0ld3xxEpnjcF5Ndlnn'}
      authorizationParams={{
        redirect_uri: window.location.origin,
        audience: 'https://attendance-api',
        scope: 'openid profile email offline_access',
      }}
      // Browsers block the third-party cookies silent login needs, so keep rotating refresh tokens.
      // ponytail: localStorage is readable by any script on this origin; fine for an internal HR tool with
      // no third-party scripts. Move to a backend-for-frontend (httpOnly cookie) if the panel grows.
      useRefreshTokens
      cacheLocation="localstorage"
    >
      <App />
    </Auth0Provider>
  </StrictMode>,
);
