import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Self-hosted Outfit font (used by the v2 mobile game table).
// Bundled locally so it works offline in the PWA and doesn't depend on Google's CDN.
import '@fontsource/outfit/400.css'
import '@fontsource/outfit/600.css'
import '@fontsource/outfit/700.css'
import '@fontsource/outfit/800.css'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
