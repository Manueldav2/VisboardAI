const { app, BrowserWindow, ipcMain, systemPreferences, globalShortcut, desktopCapturer, session, screen, Tray, Menu, nativeImage } = require('electron');
const { execFile, spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const db = require('./db');

// Debug log (helps diagnose tray/detection without a screen).
const DBG = path.join(os.tmpdir(), 'gideon-debug.log');
function dbg(...a) { try { fs.appendFileSync(DBG, `[${new Date().toISOString()}] ${a.join(' ')}\n`); } catch {} }

// ── On-device transcription (yap → Apple SpeechAnalyzer, macOS 26+) ──
// Free, private, ~0.6s/utterance. We call yap in file-transcribe mode, so yap
// itself needs no mic/screen permission — Electron already captures the audio.
function resolveYap() {
  const candidates = [
    path.join(process.resourcesPath || '', 'bin', 'yap'),
    path.join(__dirname, 'bin', 'yap'),
    '/opt/homebrew/bin/yap',
    '/usr/local/bin/yap',
  ];
  for (const c of candidates) { try { if (c && fs.existsSync(c)) return c; } catch {} }
  return 'yap';
}
const YAP = resolveYap();
let yapOk = false;
function checkYap() {
  execFile(YAP, ['--help'], { timeout: 5000 }, (err) => { yapOk = !err; });
}

let win = null;
let tray = null;
let clickThrough = false;

// Gideon is hidden by default (menu-bar only). It surfaces on its own when a
// meeting is detected (toast), or when you open it from the tray/hotkey.
function showWin() { openPanel(); }
function toggleWin() { if (!win) return; if (win.isVisible() && viewState === 'panel') hideWin(); else openPanel(); }

function createTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'renderer', 'trayTemplate.png'));
  img.setTemplateImage(true);
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
  dbg('tray created; imgEmpty=', img.isEmpty(), 'bounds=', JSON.stringify(tray.getBounds()));
  tray.setToolTip('Gideon — click to show, ⌘\\ to toggle');
  const menu = Menu.buildFromTemplate([
    { label: 'Show / Hide', accelerator: 'CommandOrControl+\\', click: toggleWin },
    { label: 'Start / Stop Listening', accelerator: 'CommandOrControl+Shift+L', click: () => win && win.webContents.send('hotkey-listen') },
    { label: 'Ask Gideon…', accelerator: 'CommandOrControl+Shift+A', click: () => { showWin(); win.webContents.send('hotkey-ask'); } },
    { type: 'separator' },
    { label: 'Quit Gideon', accelerator: 'CommandOrControl+Q', click: () => app.quit() },
  ]);
  tray.on('click', toggleWin);
  tray.on('right-click', () => tray.popUpContextMenu(menu));
}

// ── Meeting detection (Granola-style) ──
let meetingActive = false;
let dismissedFor = null;
let appListening = false;
const OSA = [
  'tell application "System Events"',
  'set fa to name of first application process whose frontmost is true',
  'try',
  'set wt to name of front window of (first application process whose frontmost is true)',
  'on error',
  'set wt to ""',
  'end try',
  'end tell',
  'return fa & "|||" & wt',
];
function resolveBin(name) {
  const candidates = [
    path.join(process.resourcesPath || '', 'bin', name),
    path.join(__dirname, 'bin', name),
  ];
  for (const c of candidates) { try { if (c && fs.existsSync(c)) return c; } catch {} }
  return null;
}
const CAMSTATE = resolveBin('camstate');
const CALLSTATE = resolveBin('callstate');
function cameraInUse() {
  return new Promise((resolve) => {
    if (!CAMSTATE) return resolve(false);
    execFile(CAMSTATE, [], { timeout: 3000 }, (err, out) => resolve(!err && String(out).trim() === '1'));
  });
}
// A single process doing mic + speaker at once = a live call (audio or video).
// Ignores music (speaker only) and always-on dictation apps (mic only).
function callInProgress() {
  return new Promise((resolve) => {
    if (!CALLSTATE) return resolve(false);
    execFile(CALLSTATE, [], { timeout: 3000 }, (err, out) => resolve(!err && String(out).trim() === '1'));
  });
}
function frontWindowTitle() {
  return new Promise((resolve) => {
    const args = []; OSA.forEach((l) => { args.push('-e', l); });
    execFile('osascript', args, { timeout: 4000 }, (err, stdout) => resolve(err ? '' : String(stdout || '').trim().toLowerCase().replace('|||', ' ')));
  });
}
async function checkMeeting() {
  if (process.platform !== 'darwin' || !win) return;
  if (appListening) return; // already capturing — don't nudge
  const [cam, call, hay] = await Promise.all([cameraInUse(), callInProgress(), frontWindowTitle()]);
  const titleMeeting =
    /zoom\.us|zoom meeting|meet\.google|google meet|hangouts call|microsoft teams|teams meeting|webex|whereby|gather\.town|around\.co|huddle|riverside\.fm/.test(hay) ||
    /\bmeet\b\s*[\-–—·]/.test(hay) || /[\-–—·]\s*meet\b/.test(hay);
  const isMeeting = cam || call || titleMeeting;
  dbg('detect cam=', cam, 'call=', call, 'title=', titleMeeting, 'front=', hay.slice(0, 60));
  const name = /zoom/.test(hay) ? 'Zoom' : /teams/.test(hay) ? 'Microsoft Teams'
    : /webex/.test(hay) ? 'Webex' : /meet/.test(hay) ? 'Google Meet' : cam ? 'a video call' : 'a call';
  if (isMeeting && !meetingActive) {
    meetingActive = true;
    if (dismissedFor !== name) {
      dbg('MEETING DETECTED:', name, '→ toast');
      if (!win.isVisible()) win.showInactive();
      win.webContents.send('meeting-detected', name);
      showToast();
    }
  } else if (!isMeeting && meetingActive) {
    meetingActive = false;
    dismissedFor = null;
    win.webContents.send('meeting-cleared');
    hideToast();
  }
}

const PILL = { width: 42, height: 104 };
const PANEL = { width: 440, height: 640 };
const TOAST = { width: 344, height: 74 };
let viewState = 'hidden'; // 'hidden' | 'toast' | 'panel'

function anchorTopRight(size) {
  // Park the window in the top-right corner under the menu bar (Granola-style).
  const wa = screen.getPrimaryDisplay().workArea;
  const x = wa.x + wa.width - size.width - 12;
  const y = wa.y + 8;
  return { x, y, width: size.width, height: size.height };
}
function openPanel() {
  if (!win) return;
  dbg('openPanel called');
  viewState = 'panel';
  win.setResizable(false);
  win.setBounds(anchorTopRight(PANEL), false);
  win.webContents.send('view', 'panel');
  win.show(); win.focus();
}
function hideWin() {
  if (!win) return;
  viewState = 'hidden';
  win.webContents.send('view', 'pill');
  win.hide();
}
function showToast() {
  if (!win || viewState === 'panel') return; // don't cover an open panel
  viewState = 'toast';
  win.setBounds(anchorTopRight(TOAST), false);
  win.webContents.send('view', 'toast');
  win.showInactive(); // appear without stealing focus
}
// Back-compat names used by IPC + meeting detection.
function expandWin() { openPanel(); }
function collapseWin() { hideWin(); }
function hideToast() { if (viewState === 'toast') hideWin(); }

function createWindow() {
  const wa = screen.getPrimaryDisplay().workArea;
  win = new BrowserWindow({
    width: PILL.width,
    height: PILL.height,
    x: wa.x + wa.width - PILL.width - 22,
    y: wa.y + 8,
    title: 'Gideon',
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    roundedCorners: false,
    backgroundColor: '#00000000',
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // Open once on launch so Gideon is discoverable (menu-bar icons can hide
  // behind the notch). After you collapse it, it lives in the menu bar and
  // pops up on its own when a meeting is detected.
  win.once('ready-to-show', () => openPanel());

  // Float above everything, follow across spaces + fullscreen apps.
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Stealth: hide the window from screen recording / share by default.
  win.setContentProtection(true);
}

// System audio loopback (macOS 13+/Win) — lets the app hear the whole meeting.
function wireDisplayMedia() {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      callback({ video: sources[0], audio: 'loopback' });
    }).catch(() => callback({}));
  }, { useSystemPicker: false });
}

async function ensureMic() {
  if (process.platform !== 'darwin') return true;
  if (systemPreferences.getMediaAccessStatus('microphone') === 'granted') return true;
  try { return await systemPreferences.askForMediaAccess('microphone'); } catch { return false; }
}

app.whenReady().then(async () => {
  if (process.platform === 'darwin' && app.dock) app.dock.hide(); // live in the menu bar
  try { await db.initDb(); } catch (e) { dbg('db init failed:', String(e).slice(0, 200)); }
  wireDisplayMedia();
  checkYap();
  await ensureMic();
  createWindow();
  createTray();

  // Global hotkeys
  globalShortcut.register('CommandOrControl+\\', () => toggleWin());
  globalShortcut.register('CommandOrControl+Shift+L', () => { openPanel(); if (win) win.webContents.send('hotkey-listen'); });
  globalShortcut.register('CommandOrControl+Shift+A', () => { openPanel(); if (win) win.webContents.send('hotkey-ask'); });

  setInterval(checkMeeting, 5000);
  setTimeout(checkMeeting, 1500);

  // Clicking the app (Spotlight/Finder/Dock) when it's already running as a
  // hidden menu-bar agent → open the panel, so it always responds.
  app.on('activate', () => { if (!win) createWindow(); openPanel(); });
});

// If a second launch happens, focus/open the existing instance instead of a no-op.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) openPanel(); });
}

app.on('will-quit', () => { globalShortcut.unregisterAll(); stopStream(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

ipcMain.handle('set-always-on-top', (_e, v) => { if (win) win.setAlwaysOnTop(!!v, 'screen-saver'); return !!v; });
ipcMain.handle('set-stealth', (_e, v) => { if (win) win.setContentProtection(!!v); return !!v; });
ipcMain.handle('set-click-through', (_e, v) => {
  clickThrough = !!v;
  if (win) win.setIgnoreMouseEvents(clickThrough, { forward: true });
  return clickThrough;
});
ipcMain.handle('close-app', () => app.quit());
ipcMain.handle('minimize-app', () => win && win.hide());
ipcMain.handle('expand', () => expandWin());
ipcMain.handle('collapse', () => collapseWin());
ipcMain.handle('dismiss-meeting', (_e, name) => { dismissedFor = name; });

// ── Manual pill drag (smooth, and lets us tell a drag from a click) ──
let dragOrigin = null;
ipcMain.handle('drag-start', () => { if (win) { const b = win.getBounds(); dragOrigin = { x: b.x, y: b.y }; } });
ipcMain.handle('drag-move', (_e, dx, dy) => {
  if (!win || !dragOrigin) return;
  const wa = screen.getDisplayNearestPoint({ x: dragOrigin.x + dx, y: dragOrigin.y + dy }).workArea;
  const b = win.getBounds();
  let x = dragOrigin.x + dx, y = dragOrigin.y + dy;
  x = Math.max(wa.x, Math.min(x, wa.x + wa.width - b.width));
  y = Math.max(wa.y, Math.min(y, wa.y + wa.height - b.height));
  win.setPosition(Math.round(x), Math.round(y), false);
});
ipcMain.handle('drag-end', () => { dragOrigin = null; });

// ── On-device STT: live streaming via yap (Apple SpeechAnalyzer) ──
let sttProc = null;
function stopStream() {
  if (sttProc) { try { sttProc.kill('SIGINT'); } catch {} try { sttProc.kill('SIGKILL'); } catch {} sttProc = null; }
}
function startStream(opts) {
  stopStream();
  if (!yapOk) return false;
  const mic = opts.mic !== false, sys = opts.system !== false;
  let args, fallbackSpeaker;
  if (mic && sys) { args = ['listen-and-dictate', '--srt', '--max-length', '220', '--mic-label', 'You', '--system-label', 'Them']; fallbackSpeaker = 'You'; }
  else if (sys) { args = ['listen', '--srt', '--max-length', '220']; fallbackSpeaker = 'Them'; }
  else { args = ['dictate', '--srt', '--max-length', '220']; fallbackSpeaker = 'You'; }
  try { sttProc = spawn(YAP, args, { stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch { sttProc = null; return false; }

  let buf = '';
  const proc = sttProc;
  const emit = (block) => {
    const lines = block.split('\n').map((s) => s.trim()).filter(Boolean);
    if (!lines.length) return;
    const textLine = lines[lines.length - 1]; // "Speaker: text" (or bare text)
    const m = textLine.match(/^(You|Them|Mic|System)\s*:\s*(.*)$/);
    let speaker = fallbackSpeaker, text = textLine;
    if (m) { speaker = (m[1] === 'Them' || m[1] === 'System') ? 'Them' : 'You'; text = m[2]; }
    text = text.trim();
    if (text && win && !win.isDestroyed()) win.webContents.send('stt-segment', { speaker, text });
  };
  proc.stdout.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) { const block = buf.slice(0, i); buf = buf.slice(i + 2); emit(block); }
  });
  proc.stderr.on('data', (d) => { const s = String(d); if (/permission|denied|not available/i.test(s) && win) win.webContents.send('stt-error', s.trim().slice(0, 200)); });
  proc.on('close', () => { if (sttProc === proc) sttProc = null; });
  return true;
}
ipcMain.handle('stt-available', () => yapOk);
ipcMain.handle('stt-start', (_e, opts) => { appListening = true; return startStream(opts || {}); });
ipcMain.handle('stt-stop', () => { appListening = false; stopStream(); });

// ── Meeting storage (SQLite) ──
ipcMain.handle('db-list', () => { try { return db.listMeta(); } catch { return []; } });
ipcMain.handle('db-search', (_e, q) => { try { return db.search(q); } catch { return []; } });
ipcMain.handle('db-get', (_e, id) => { try { return db.get(id); } catch { return null; } });
ipcMain.handle('db-upsert', (_e, note) => { try { db.upsert(note); } catch {} });
ipcMain.handle('db-remove', (_e, id) => { try { db.remove(id); } catch {} });
ipcMain.handle('db-import', (_e, notes) => { try { db.importAll(notes); return db.count(); } catch { return 0; } });
ipcMain.handle('db-count', () => { try { return db.count(); } catch { return 0; } });
