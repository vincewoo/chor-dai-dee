import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

function PWAUpdatePrompt() {
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState(null);

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

  // Mobile: top-centered banner (clears the v2 screens' bottom footer/CTAs).
  // Desktop (sm+): original bottom-right card.
  return (
    <div className="fixed z-[60] top-3 left-1/2 -translate-x-1/2 w-[calc(100%-1.5rem)] max-w-sm sm:top-auto sm:left-auto sm:translate-x-0 sm:right-4 sm:bottom-4 sm:w-auto sm:max-w-md">
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
