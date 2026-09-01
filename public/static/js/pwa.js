// ===========================================================================
// Install and alerts.
//
// Registers the service worker, keeps the install prompt available behind a
// button rather than firing it unasked, and raises a notification when the
// signal engine commits to a call.
//
// One limit worth being plain about: these notifications are raised by the page
// while it is running, including when the window is in the background. They are
// not server push — nothing arrives once the app is fully closed. Real push
// would need a backend holding subscriptions and a key pair, and this app has
// no server-side state at all.
// ===========================================================================

const PWA = (() => {
  let deferredPrompt = null;
  let registration = null;
  let notifyOn = false;

  try { notifyOn = localStorage.getItem('bt_notify') === 'on'; } catch (_e) {}

  const installed = () =>
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  async function register() {
    if (!('serviceWorker' in navigator)) return null;
    try {
      registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      return registration;
    } catch (e) {
      console.warn('[pwa] service worker refused', e);
      return null;
    }
  }

  // Chrome fires this instead of showing its own prompt; holding it lets the
  // install button work at a moment the user chose.
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    render();
  });
  window.addEventListener('appinstalled', () => { deferredPrompt = null; render(); });

  async function install() {
    if (!deferredPrompt) return 'unavailable';
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    render();
    return outcome;
  }

  // ---- notifications ----------------------------------------------------
  function permission() {
    return ('Notification' in window) ? Notification.permission : 'unsupported';
  }

  async function enableNotifications() {
    if (!('Notification' in window)) return 'unsupported';
    let p = Notification.permission;
    if (p === 'default') p = await Notification.requestPermission();
    notifyOn = p === 'granted';
    try { localStorage.setItem('bt_notify', notifyOn ? 'on' : 'off'); } catch (_e) {}
    render();
    return p;
  }

  function disableNotifications() {
    notifyOn = false;
    try { localStorage.setItem('bt_notify', 'off'); } catch (_e) {}
    render();
  }

  /** Raised through the worker so it still shows with the window in the background. */
  function notify(title, body, opts = {}) {
    if (!notifyOn || permission() !== 'granted') return false;
    const payload = { type: 'signal-notify', title, body, ...opts };
    if (registration && registration.active) {
      registration.active.postMessage(payload);
      return true;
    }
    try { new Notification(title, { body, icon: '/static/icons/icon-192.png' }); return true; }
    catch (_e) { return false; }
  }

  // ---- the control in the UI --------------------------------------------
  let host = null;

  function render() {
    if (!host) return;
    const canInstall = !!deferredPrompt && !installed();
    const perm = permission();

    const installBtn = installed()
      ? `<span class="pwa-pill on"><i class="fa-solid fa-check"></i> Installed</span>`
      : canInstall
        ? `<button class="pwa-btn" data-pwa="install"><i class="fa-solid fa-download"></i> Install app</button>`
        : `<span class="pwa-pill" data-tip-wide data-tip="Your browser offers this from its own menu — in Chrome, the install icon in the address bar; on iOS, Share then Add to Home Screen.">Install from the browser menu</span>`;

    const notifBtn = perm === 'unsupported'
      ? `<span class="pwa-pill">Notifications unsupported here</span>`
      : perm === 'denied'
        ? `<span class="pwa-pill off" data-tip-wide data-tip="Blocked for this site. Re-enable it in the browser's site settings.">Notifications blocked</span>`
        : notifyOn
          ? `<button class="pwa-btn on" data-pwa="notify-off"><i class="fa-solid fa-bell"></i> Alerts on</button>`
          : `<button class="pwa-btn" data-pwa="notify-on"><i class="fa-regular fa-bell"></i> Alert me on signals</button>`;

    host.innerHTML = installBtn + notifBtn;
  }

  function mount(sel) {
    host = document.querySelector(sel);
    if (!host) return;
    host.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-pwa]');
      if (!b) return;
      if (b.dataset.pwa === 'install') await install();
      else if (b.dataset.pwa === 'notify-on') await enableNotifications();
      else if (b.dataset.pwa === 'notify-off') disableNotifications();
    });
    render();
  }

  function init(sel) {
    register().then(render);
    if (sel) mount(sel);

    // One notification per committed call — the engine only fires this when it
    // has actually decided, so there is nothing to debounce here.
    if (window.Signals && Signals.onSignal) {
      Signals.onSignal((sig, symbol) => {
        const d = (window.findSymbol && findSymbol(symbol)?.digits) ?? 2;
        const px = (v) => Number(v).toLocaleString(undefined,
          { minimumFractionDigits: d, maximumFractionDigits: d });
        notify(
          `${sig.side} ${symbol} · grade ${sig.grade}`,
          `Entry ${px(sig.entry)} · stop ${px(sig.sl)} · target ${px(sig.tp2)} (${sig.rr.toFixed(2)}R)`,
          { tag: 'signal-' + symbol, sticky: true, url: '/#live' }
        );
      });
    }
  }

  return { init, mount, install, enableNotifications, disableNotifications, notify,
    permission, render,
    get installed() { return installed(); },
    get notifyOn() { return notifyOn; },
    get canInstall() { return !!deferredPrompt; } };
})();

window.PWA = PWA;
