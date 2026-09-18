// OpenHowl desktop: avvia l'agente in-process (nessun terminale), apre la finestra principale,
// gestisce la mascotte sempre in primo piano, l'icona nell'area di notifica e le scorciatoie.
const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, screen, nativeImage, shell, Notification } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

const ROOT = path.join(__dirname, '..');
const ICON = path.join(ROOT, 'build', 'icon.png');
const TRAY_ICON = path.join(ROOT, 'build', 'tray.png');
const PRELOAD = path.join(__dirname, 'preload.cjs');
const SHORTCUT_OPEN = 'CommandOrControl+Shift+O';
const SHORTCUT_MASCOT = 'CommandOrControl+Shift+M';

process.env.OPENHOWL_HOME ||= path.join(app.getPath('home'), '.openhowl');
app.setAppUserModelId('com.openhowl.app');

let server = null;
let mainWin = null;
let mascotWin = null;
let tray = null;
let quitting = false;
let busy = false;

/* ── preferenze desktop ── */
const PREFS_FILE = path.join(process.env.OPENHOWL_HOME, 'desktop.json');
let prefs = { mascot: true, mascotPos: null, autoUpdate: true };
try { prefs = { ...prefs, ...JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8')) }; } catch {}
const savePrefs = () => { try { fs.mkdirSync(path.dirname(PREFS_FILE), { recursive: true }); fs.writeFileSync(PREFS_FILE, JSON.stringify(prefs, null, 2)); } catch {} };

/* ── sicurezza: solo le nostre pagine possono usare il ponte IPC ── */
const trusted = (e) => !!server && (e.senderFrame?.url || '').startsWith(server.url);
function lockDown(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(server.url)) e.preventDefault(); });
}

/* ── finestra principale ── */
function createMain() {
  mainWin = new BrowserWindow({
    width: 1240, height: 820, minWidth: 760, minHeight: 540,
    show: false, title: 'OpenHowl', icon: ICON, backgroundColor: '#f5f7f9',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#475569', height: 48 },
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true },
  });
  lockDown(mainWin);
  mainWin.loadURL(server.url + '/?desktop=1');
  mainWin.once('ready-to-show', () => mainWin.show());
  mainWin.on('close', (e) => {
    if (quitting) return;
    e.preventDefault(); // chiudere la finestra non spegne l'agente: resta nell'area di notifica
    mainWin.hide();
  });
}

function openMain() {
  if (!mainWin) createMain();
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show();
  mainWin.focus();
}

/* ── mascotte sul desktop ── */
const MASCOT_W = 240;
const MASCOT_H = 320;

function mascotPosition() {
  const p = prefs.mascotPos;
  if (p) {
    const d = screen.getDisplayMatching({ x: p.x, y: p.y, width: MASCOT_W, height: MASCOT_H }).workArea;
    return { x: Math.min(Math.max(p.x, d.x), d.x + d.width - MASCOT_W), y: Math.min(Math.max(p.y, d.y), d.y + d.height - MASCOT_H) };
  }
  const wa = screen.getPrimaryDisplay().workArea;
  return { x: wa.x + wa.width - MASCOT_W - 16, y: wa.y + wa.height - MASCOT_H };
}

function createMascot() {
  if (mascotWin) return;
  const pos = mascotPosition();
  mascotWin = new BrowserWindow({
    width: MASCOT_W, height: MASCOT_H, ...pos,
    frame: false, transparent: true, resizable: false, maximizable: false, fullscreenable: false,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false, show: false, backgroundColor: '#00000000',
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  mascotWin.setAlwaysOnTop(true, 'floating');
  mascotWin.setVisibleOnAllWorkspaces(true);
  lockDown(mascotWin);
  mascotWin.loadURL(server.url + '/mascot.html');
  mascotWin.once('ready-to-show', () => mascotWin.showInactive());
  mascotWin.on('closed', () => { mascotWin = null; });
}

function setMascot(on) {
  prefs.mascot = !!on;
  savePrefs();
  if (on) createMascot();
  else mascotWin?.close();
  mainWin?.webContents.send('mascot:state', prefs.mascot);
  refreshTray();
}

/* ── aggiornamenti automatici (dalle release su GitHub) ── */
// Si scaricano da soli in background; quando sono pronti l'interfaccia mostra "Aggiorna ora".
const CHECK_EVERY = 6 * 3600 * 1000;
// status: idle | checking | downloading | ready | latest | error | dev
const upd = { current: app.getVersion(), status: app.isPackaged ? 'idle' : 'dev', version: null, percent: 0, error: null };
let manualCheck = false;

let trayKey = '';
function setUpd(patch) {
  Object.assign(upd, patch);
  mainWin?.webContents.send('update:state', { ...upd });
  // il menu dell'area di notifica si ricostruisce solo a scatti del 10%, non a ogni pacchetto scaricato
  const key = `${upd.status}:${Math.floor(upd.percent / 10)}`;
  if (key !== trayKey) { trayKey = key; refreshTray(); }
}

function setupUpdates() {
  if (!app.isPackaged) return; // in sviluppo non c'è nulla da aggiornare
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-available', (info) => setUpd({ status: 'downloading', version: info.version, percent: 0, error: null }));
  autoUpdater.on('download-progress', (p) => setUpd({ status: 'downloading', percent: Math.round(p.percent || 0) }));
  autoUpdater.on('update-downloaded', (info) => {
    setUpd({ status: 'ready', version: info.version, percent: 100 });
    if (Notification.isSupported() && !mainWin?.isFocused()) {
      const n = new Notification({ title: `OpenHowl ${info.version} è pronto`, body: 'Apri OpenHowl e premi "Aggiorna ora": ci vogliono pochi secondi.', icon: ICON });
      n.on('click', openMain);
      n.show();
    }
  });
  autoUpdater.on('update-not-available', () => setUpd({ status: manualCheck ? 'latest' : 'idle' }));
  autoUpdater.on('error', (e) => {
    console.error('Aggiornamento non riuscito:', e?.message || e);
    setUpd({ status: manualCheck ? 'error' : 'idle', error: String(e?.message || e).slice(0, 200) });
  });

  checkUpdates = (manual = false) => {
    if (upd.status === 'downloading' || upd.status === 'ready' || upd.status === 'checking') return;
    if (!prefs.autoUpdate && !manual) return;
    manualCheck = manual;
    setUpd({ status: 'checking', error: null });
    autoUpdater.checkForUpdates().catch(() => {});
  };
  installUpdate = () => {
    if (upd.status !== 'ready') return;
    quitting = true;
    autoUpdater.quitAndInstall(true, true); // installa in silenzio e riapre l'app
  };

  setTimeout(() => checkUpdates(), 10000);
  setInterval(() => checkUpdates(), CHECK_EVERY);
}
let checkUpdates = () => {};
let installUpdate = () => {};

ipcMain.handle('update:get', (e) => (trusted(e) ? { ...upd } : null));
ipcMain.on('update:check', (e) => { if (trusted(e)) checkUpdates(true); });
ipcMain.on('update:install', (e) => { if (trusted(e)) installUpdate(); });

/* ── area di notifica ── */
function refreshTray() {
  if (!tray) return;
  tray.setToolTip(busy ? 'OpenHowl — sta lavorando…' : 'OpenHowl');
  const updateItems = !app.isPackaged ? [] : upd.status === 'ready'
    ? [{ label: `Aggiorna ora alla ${upd.version}`, click: installUpdate }]
    : [
      { label: upd.status === 'checking' ? 'Controllo aggiornamenti…' : upd.status === 'downloading' ? `Scarico la ${upd.version}… ${upd.percent}%` : 'Cerca aggiornamenti', enabled: upd.status !== 'checking' && upd.status !== 'downloading', click: () => checkUpdates(true) },
      { label: 'Aggiorna automaticamente', type: 'checkbox', checked: prefs.autoUpdate, click: (i) => { prefs.autoUpdate = i.checked; savePrefs(); refreshTray(); } },
    ];
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Apri OpenHowl', accelerator: SHORTCUT_OPEN, click: openMain },
    { label: 'Mascotte sul desktop', type: 'checkbox', checked: prefs.mascot, accelerator: SHORTCUT_MASCOT, click: (i) => setMascot(i.checked) },
    { label: 'Interrompi', enabled: busy, click: () => server.harness.stop() },
    { type: 'separator' },
    { label: 'Avvia con Windows', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked, args: ['--hidden'] }) },
    { label: 'Apri cartella dati', click: () => shell.openPath(process.env.OPENHOWL_HOME) },
    ...(updateItems.length ? [{ type: 'separator' }, ...updateItems] : []),
    { type: 'separator' },
    { label: 'Esci', click: () => { quitting = true; app.quit(); } },
  ]));
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(TRAY_ICON).resize({ width: 16, height: 16 }));
  tray.on('click', openMain);
  refreshTray();
}

/* ── IPC dalle pagine ── */
ipcMain.on('app:open', (e) => { if (trusted(e)) openMain(); });
ipcMain.on('mascot:set', (e, on) => { if (trusted(e)) setMascot(on); });
ipcMain.handle('mascot:get', (e) => (trusted(e) ? prefs.mascot : false));
ipcMain.on('mascot:move', (e, x, y) => {
  if (!trusted(e) || !mascotWin) return;
  mascotWin.setPosition(Math.round(x), Math.round(y));
});
ipcMain.on('mascot:moved', (e) => {
  if (!trusted(e) || !mascotWin) return;
  const [x, y] = mascotWin.getPosition();
  prefs.mascotPos = { x, y };
  savePrefs();
});
ipcMain.on('mascot:menu', (e) => {
  if (!trusted(e) || !mascotWin) return;
  Menu.buildFromTemplate([
    { label: 'Apri OpenHowl', click: openMain },
    { label: 'Interrompi', enabled: busy, click: () => server.harness.stop() },
    { type: 'separator' },
    { label: 'Nascondi mascotte', click: () => setMascot(false) },
  ]).popup({ window: mascotWin });
});

/* ── avvio ── */
app.on('second-instance', openMain);

app.whenReady().then(async () => {
  const { startServer } = await import(pathToFileURL(path.join(ROOT, 'src', 'server.js')).href);
  server = await startServer({ port: 47823 });

  server.harness.on((ev) => {
    if (ev.type === 'busy') { busy = ev.busy; refreshTray(); }
    // notifica di sistema se serve un permesso e la finestra non è in primo piano
    if (ev.type === 'approval_request' && !mainWin?.isFocused() && Notification.isSupported()) {
      const n = new Notification({ title: 'OpenHowl chiede il permesso', body: `Vuole usare: ${ev.name}`, icon: ICON });
      n.on('click', openMain);
      n.show();
    }
    // automazioni: l'utente di solito non è davanti allo schermo, quindi il riassunto arriva come notifica
    if (ev.type === 'task_started') { tray?.setToolTip(`OpenHowl — automazione "${ev.name}"…`); }
    if (ev.type === 'task_done') {
      refreshTray();
      if (ev.notify && Notification.isSupported()) {
        const body = String(ev.report || '').replace(/[#*`>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 220);
        const n = new Notification({ title: `🐺 ${ev.name} — ${ev.ok ? 'fatto' : 'non riuscita'}`, body: body || 'Nessun riassunto.', icon: ICON });
        n.on('click', openMain);
        n.show();
      }
    }
    if (ev.type === 'user_action_request' && Notification.isSupported()) {
      const n = new Notification({ title: `OpenHowl — ${ev.title}`, body: ev.message, icon: ICON });
      n.on('click', openMain);
      n.show();
    }
  });

  createTray();
  setupUpdates();
  if (!process.argv.includes('--hidden')) createMain();
  if (prefs.mascot) createMascot();

  globalShortcut.register(SHORTCUT_OPEN, () => (mainWin?.isVisible() && mainWin.isFocused() ? mainWin.hide() : openMain()));
  globalShortcut.register(SHORTCUT_MASCOT, () => setMascot(!prefs.mascot));
});

app.on('window-all-closed', () => { /* resta attivo nell'area di notifica */ });
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  server?.close();
});
