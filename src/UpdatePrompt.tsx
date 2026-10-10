import { useEffect, useState } from 'react';
import { Workbox } from 'workbox-window';
import type { WorkboxLifecycleEvent } from 'workbox-window';

/** Registers the generated service worker and surfaces offline/update state. */
function UpdatePrompt() {
  const [offlineReady, setOfflineReady] = useState(false);
  const [needRefresh, setNeedRefresh] = useState(false);
  const [updateServiceWorker, setUpdateServiceWorker] = useState<(() => void) | null>(null);

  useEffect(() => {
    if (import.meta.env.DEV || !('serviceWorker' in navigator)) return;

    const workbox = new Workbox(`${import.meta.env.BASE_URL}sw.js`, {
      scope: import.meta.env.BASE_URL,
    });
    let reloadAfterUpdate = false;

    const onInstalled = (event: WorkboxLifecycleEvent) => {
      if (!event.isUpdate) setOfflineReady(true);
    };
    const onWaiting = () => setNeedRefresh(true);
    const onControlling = () => {
      if (reloadAfterUpdate) window.location.reload();
    };

    workbox.addEventListener('installed', onInstalled);
    workbox.addEventListener('waiting', onWaiting);
    workbox.addEventListener('controlling', onControlling);
    setUpdateServiceWorker(() => () => {
      reloadAfterUpdate = true;
      void workbox.messageSkipWaiting();
    });

    void workbox.register().catch((registrationError: unknown) => {
      console.error('Service worker registration failed:', registrationError);
    });

    return () => {
      workbox.removeEventListener('installed', onInstalled);
      workbox.removeEventListener('waiting', onWaiting);
      workbox.removeEventListener('controlling', onControlling);
    };
  }, []);

  if (!offlineReady && !needRefresh) return null;

  const dismiss = () => {
    setOfflineReady(false);
    setNeedRefresh(false);
  };

  const applyUpdate = () => {
    if (updateServiceWorker) updateServiceWorker();
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-5 left-1/2 z-[100] flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-center gap-4 rounded-2xl border border-primary/30 bg-surface/95 p-4 text-white shadow-neon-cyan backdrop-blur"
    >
      <span className="material-symbols-outlined shrink-0 text-primary">
        {needRefresh ? 'system_update' : 'offline_bolt'}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-bold">{needRefresh ? 'Update available' : 'Ready for offline use'}</p>
        <p className="mt-1 text-xs text-gray-300">
          {needRefresh ? 'Reload to use the latest LuringTalk build.' : 'The app is cached for this device.'}
        </p>
      </div>
      {needRefresh ? (
        <button
          type="button"
          onClick={applyUpdate}
          disabled={!updateServiceWorker}
          className="rounded-lg bg-primary px-3 py-2 text-sm font-bold text-black disabled:opacity-50"
        >
          Reload
        </button>
      ) : null}
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss offline status"
        className="rounded-lg bg-white/10 px-3 py-2 text-sm font-bold text-white"
      >
        {needRefresh ? 'Later' : 'Dismiss'}
      </button>
    </div>
  );
}

export default UpdatePrompt;
