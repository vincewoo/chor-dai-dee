import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useRegisterSW } from 'virtual:pwa-register/react';

function PWAUpdatePrompt() {
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  // In-game the bottom of the screen is the hand and Pass/Play — nothing may
  // sit over it. Install/offline toasts wait until the player leaves the
  // game; an available update collapses to a compact pill in the HUD's empty
  // middle instead of a card over the controls.
  const inGame = useLocation().pathname.startsWith('/game/');

  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r) {
      console.log('SW Registered:', r);
    },
    onRegisterError(error) {
      console.log('SW registration error', error);
    },
  });

  // Handle install prompt
  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowInstallPrompt(true);
    };

    window.addEventListener('beforeinstallprompt', handler);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
    };
  }, []);

  // "Ready to work offline" is purely informational — dismiss it on its own
  // so it never sits over the UI waiting for a tap.
  useEffect(() => {
    if (!offlineReady) return;
    const t = setTimeout(() => setOfflineReady(false), 4000);
    return () => clearTimeout(t);
  }, [offlineReady, setOfflineReady]);

  const handleInstall = async () => {
    if (!deferredPrompt) {
      return;
    }

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;

    if (outcome === 'accepted') {
      setShowInstallPrompt(false);
      setDeferredPrompt(null);
    }
  };

  const handleUpdate = () => {
    updateServiceWorker(true);
  };

  const close = () => {
    setOfflineReady(false);
    setNeedRefresh(false);
    setShowInstallPrompt(false);
  };

  if (!offlineReady && !needRefresh && !showInstallPrompt) {
    return null;
  }

  if (inGame) {
    // Only an available update is worth showing mid-game (a Fly deploy
    // restarts the server and in-memory rooms with it, so the player will
    // shortly need this). Rendered as a small top-center pill in the HUD's
    // empty middle — never over the hand or Pass/Play.
    if (!needRefresh) return null;
    return (
      <div
        className="fixed z-40 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full bg-slate-800 border border-slate-600 text-white shadow-lg px-3 py-1.5"
        style={{ top: 'calc(env(safe-area-inset-top) + 14px)', fontSize: 12 }}
      >
        <span className="font-semibold whitespace-nowrap">⟳ Update ready</span>
        <button
          onClick={handleUpdate}
          className="px-2 py-0.5 bg-blue-600 hover:bg-blue-700 rounded-full font-medium"
        >
          Reload
        </button>
        <button onClick={close} className="text-slate-400 hover:text-white" aria-label="Close">
          ✕
        </button>
      </div>
    );
  }

  // Mobile: bottom-centered, floated above the home screen's bottom nav so it
  // never covers the primary CTAs at the top of the screen (it used to sit at
  // top-3, directly over "Create a room" / the top seats, and intercepted
  // taps). Desktop (sm+): original bottom-right card. pointer-events-none on
  // the wrapper so only the visible cards — not the full-width container —
  // catch taps.
  return (
    <div className="fixed z-[60] pointer-events-none [&>div]:pointer-events-auto bottom-safe-20 left-1/2 -translate-x-1/2 w-[calc(100%-1.5rem)] max-w-sm sm:left-auto sm:translate-x-0 sm:right-4 sm:bottom-4 sm:w-auto sm:max-w-md">
      {/* Update Available Notification */}
      {needRefresh && (
        <div className="bg-slate-800 text-white p-4 rounded-lg shadow-lg border border-slate-700 mb-2">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h3 className="font-semibold mb-1">New version available!</h3>
              <p className="text-sm text-slate-300 mb-3">
                Click reload to update the app.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={handleUpdate}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded font-medium text-sm transition-colors"
                >
                  Reload
                </button>
                <button
                  onClick={close}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded font-medium text-sm transition-colors"
                >
                  Later
                </button>
              </div>
            </div>
            <button
              onClick={close}
              className="ml-2 text-slate-400 hover:text-white"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Offline Ready Notification */}
      {offlineReady && (
        <div className="bg-green-800 text-white p-4 rounded-lg shadow-lg border border-green-700 mb-2">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h3 className="font-semibold mb-1">App ready to work offline</h3>
              <p className="text-sm text-green-100">
                The app is now available offline!
              </p>
            </div>
            <button
              onClick={close}
              className="ml-2 text-green-200 hover:text-white"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Install App Prompt */}
      {showInstallPrompt && (
        <div className="bg-slate-800 text-white p-4 rounded-lg shadow-lg border border-slate-700">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h3 className="font-semibold mb-1">Install Chor Dai Dee</h3>
              <p className="text-sm text-slate-300 mb-3">
                Install the app for a better experience and quick access.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={handleInstall}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded font-medium text-sm transition-colors"
                >
                  Install
                </button>
                <button
                  onClick={close}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded font-medium text-sm transition-colors"
                >
                  Not Now
                </button>
              </div>
            </div>
            <button
              onClick={close}
              className="ml-2 text-slate-400 hover:text-white"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default PWAUpdatePrompt;
