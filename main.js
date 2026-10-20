const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, nativeImage, nativeTheme, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { Coordinates, CalculationMethod, PrayerTimes, Madhab } = require('adhan');

if (!app.requestSingleInstanceLock()) app.quit();
app.on('window-all-closed', () => {}); // keep running in tray

// ---------- settings ----------
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const defaults = {
  lat: null, lng: null,
  method: 'MuslimWorldLeague', madhab: 'Shafi',
  adhanPath: null, warnMinutes: 15, muteNext: false, autoStart: true,
};
let S = { ...defaults };
try { S = { ...defaults, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; } catch {}
const save = () => fs.writeFileSync(settingsFile(), JSON.stringify(S, null, 2));

// ---------- prayer times ----------
const NAMES = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

function dayTimes(date) {
  const params = CalculationMethod[S.method]();
  params.madhab = Madhab[S.madhab];
  return new PrayerTimes(new Coordinates(S.lat, S.lng), date, params);
}

function schedule() {
  if (S.lat == null || S.lng == null) return null;
  const now = new Date();
  const list = [];
  for (const d of [0, 1]) {
    const date = new Date(now); date.setDate(date.getDate() + d);
    const t = dayTimes(date);
    NAMES.forEach((n) => list.push({ name: n, time: t[n] }));
  }
  return { today: list.slice(0, 5), next: list.find((p) => p.time > now) };
}

// ---------- windows ----------
let tray, engine, pop, lastHide = 0, dialogOpen = false;
let playing = false, current = null, lastIconKey = '', lastState = null;

function createEngine() {
  engine = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      autoplayPolicy: 'no-user-gesture-required',
      backgroundThrottling: false,
    },
  });
  engine.loadFile('engine.html');
}

function createPopup() {
  pop = new BrowserWindow({
    width: 340, height: 660, show: false, frame: false, resizable: false,
    skipTaskbar: true, alwaysOnTop: true, roundedCorners: true,
    backgroundMaterial: 'acrylic', // Windows 11 blur; falls back to solid on Win10
    backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  pop.loadFile('index.html');
  pop.on('blur', () => { if (!dialogOpen) { pop.hide(); lastHide = Date.now(); } });
}

function togglePopup() {
  if (pop.isVisible()) return pop.hide();
  if (Date.now() - lastHide < 250) return; // click that caused the blur-hide
  const b = tray.getBounds();
  const wa = screen.getDisplayNearestPoint({ x: b.x, y: b.y }).workArea;
  const width = 340, height = Math.min(660, wa.height - 24);
  pop.setSize(width, height);
  const x = Math.min(Math.round(b.x + b.width / 2 - width / 2), wa.x + wa.width - width - 8);
  pop.setPosition(x, wa.y + wa.height - height - 12);
  pop.show(); pop.focus();
  pushState();
}

// ---------- audio ----------
function playAdhan() {
  if (!S.adhanPath || !fs.existsSync(S.adhanPath)) return shell.beep();
  playing = true;
  engine.webContents.executeJavaScript(`playAdhan(${JSON.stringify(pathToFileURL(S.adhanPath).href)})`)
    .catch(() => { playing = false; });
}

function stopAdhan() {
  engine.webContents.executeJavaScript('stopAdhan()');
  playing = false;
}

// ---------- tray icon ----------
async function setIcon(text, status) {
  const dark = nativeTheme.shouldUseDarkColors;
  // draw at the exact pixel size Windows uses for tray icons (16 px at 100%, 24 px at 150%, ...)
  const size = Math.round(16 * screen.getPrimaryDisplay().scaleFactor);
  const key = `${text}|${status}|${dark}|${size}`;
  if (key === lastIconKey) return;
  lastIconKey = key;
  const url = await engine.webContents.executeJavaScript(
    `renderIcon(${JSON.stringify(text)}, ${JSON.stringify(status)}, ${dark}, ${size})`);
  tray.setImage(nativeImage.createFromDataURL(url));
}

const cap = (s) => s[0].toUpperCase() + s.slice(1);
const COMPACT = false; // false = "2:01" style (exact time, smaller text); true = big 2-character text
function fmtShort(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  if (COMPACT) return h > 0 ? `${h}h` : String(m).padStart(2, '0'); // "2h" over an hour, "45" (minutes) under it
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}`;
  return m > 0 ? `${m}m` : '<1';
}
function fmtLong(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ---------- main loop ----------
function tick() {
  const sc = schedule();
  if (!sc) { setIcon('?', 'normal'); tray.setToolTip('Adhan Bar: set your location'); return pushState(null); }

  // Prayer time just passed -> fire it (skip if we were asleep for a while)
  if (current && sc.next.time.getTime() !== current.time.getTime()) {
    if (Date.now() - current.time.getTime() < 120000) {
      if (S.muteNext) { S.muteNext = false; save(); } else playAdhan();
    }
  }
  current = sc.next;

  const remaining = Math.max(0, Math.round((sc.next.time - Date.now()) / 1000));
  const status = playing ? 'playing' : remaining <= S.warnMinutes * 60 ? 'soon' : 'normal';
  setIcon(fmtShort(remaining), status);
  tray.setToolTip(playing
    ? 'Adhan playing'
    : `${cap(sc.next.name)} in ${fmtLong(remaining)}${S.muteNext ? ' (muted)' : ''}`);
  pushState({ sc, remaining, status });
}

function pushState(extra) {
  if (extra !== undefined) lastState = extra;
  if (!pop || !pop.isVisible()) return;
  pop.webContents.send('state', buildState());
}

function buildState() {
  const s = lastState;
  return {
    settings: S, playing,
    next: s ? { name: s.sc.next.name, time: s.sc.next.time.getTime() } : null,
    remaining: s ? s.remaining : null,
    status: s ? s.status : 'normal',
    today: s ? s.sc.today.map((p) => ({ name: p.name, time: p.time.getTime() })) : [],
  };
}

// ---------- IPC ----------
ipcMain.handle('state', () => buildState());
ipcMain.handle('set', (_, patch) => {
  S = { ...S, ...patch }; save();
  app.setLoginItemSettings({ openAtLogin: !!S.autoStart });
  tick();
});
ipcMain.handle('pick', async () => {
  dialogOpen = true;
  const r = await dialog.showOpenDialog(pop, { filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'm4a'] }], properties: ['openFile'] });
  dialogOpen = false; pop.focus();
  if (!r.canceled) { S.adhanPath = r.filePaths[0]; save(); }
  return S.adhanPath;
});
ipcMain.handle('test', playAdhan);
ipcMain.handle('stop', stopAdhan);
ipcMain.on('ended', () => { playing = false; });

// ---------- boot ----------
app.whenReady().then(() => {
  app.setLoginItemSettings({ openAtLogin: !!S.autoStart });
  createEngine();
  createPopup();
  tray = new Tray(nativeImage.createEmpty());
  tray.on('click', togglePopup);
  tray.on('right-click', () => tray.popUpContextMenu(Menu.buildFromTemplate([
    { label: 'Quit Adhan Bar', click: () => app.exit(0) },
  ])));
  engine.webContents.once('did-finish-load', () => {
    tick();
    setInterval(tick, 1000);
    if (S.lat == null) togglePopup(); // first run: ask for location
  });
});
