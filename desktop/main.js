const { app, BrowserWindow, ipcMain, systemPreferences, globalShortcut, desktopCapturer, session, screen, Tray, Menu, nativeImage } = require('electron');
const { execFile } = require('child_process');
const path = require('path');

let win = null;
let tray = null;
let clickThrough = false;

function positionUnderTray() {
  if (!win) return;
  const b = win.getBounds();
  let x, y;
  if (tray) {
    const t = tray.getBounds();
    x = Math.round(t.x + t.width / 2 - b.width / 2);
    y = Math.round(t.y + t.height + 6);
  } else {
    const wa = screen.getPrimaryDisplay().workArea;
    x = wa.x + wa.width - b.width - 24; y = wa.y + 8;
  }
  const wa = screen.getPrimaryDisplay().workArea;
  x = Math.max(wa.x + 6, Math.min(x, wa.x + wa.width - b.width - 6));
  win.setPosition(x, y, false);
}
function showWin() { if (!win) return; positionUnderTray(); win.show(); win.focus(); }
function toggleWin() { if (!win) return; if (win.isVisible()) win.hide(); else showWin(); }

function createTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'renderer', 'trayTemplate.png'));
  img.setTemplateImage(true);
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
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
function checkMeeting() {
  if (process.platform !== 'darwin' || !win) return;
  const args = [];
  OSA.forEach((l) => { args.push('-e', l); });
  execFile('osascript', args, { timeout: 4000 }, (err, stdout) => {
    if (err) return; // no Accessibility permission — skip silently
    const hay = String(stdout || '').trim().toLowerCase().replace('|||', ' ');
    const isMeeting =
      /zoom\.us|zoom meeting|meet\.google|google meet|hangouts call|microsoft teams|teams meeting|webex|whereby|gather\.town|around\.co|huddle|riverside\.fm/.test(hay) ||
      /\bmeet\b\s*[\-–—·]/.test(hay) || /[\-–—·]\s*meet\b/.test(hay);
    const name = /zoom/.test(hay) ? 'Zoom' : /teams/.test(hay) ? 'Microsoft Teams'
      : /webex/.test(hay) ? 'Webex' : /meet/.test(hay) ? 'Google Meet' : 'a meeting';
    if (isMeeting && !meetingActive) {
      meetingActive = true;
      if (dismissedFor !== name) {
        if (!win.isVisible()) win.showInactive();
        expandWin();
        win.webContents.send('meeting-detected', name);
      }
    } else if (!isMeeting && meetingActive) {
      meetingActive = false;
      dismissedFor = null;
      win.webContents.send('meeting-cleared');
    }
  });
}

const PILL = { width: 74, height: 138 };
const PANEL = { width: 440, height: 640 };
let expanded = false;

function anchorRight(size) {
  // Keep the window's top-right corner fixed while it grows/shrinks.
  const b = win.getBounds();
  const rightEdge = b.x + b.width, top = b.y;
  const wa = screen.getPrimaryDisplay().workArea;
  let x = Math.round(rightEdge - size.width);
  x = Math.max(wa.x + 6, Math.min(x, wa.x + wa.width - size.width - 6));
  const y = Math.max(wa.y + 4, Math.min(top, wa.y + wa.height - size.height - 6));
  return { x, y, width: size.width, height: size.height };
}
function expandWin() {
  if (!win || expanded) return;
  expanded = true;
  win.setResizable(false);
  win.setBounds(anchorRight(PANEL), true);
  win.webContents.send('view', 'panel');
  win.focus();
}
function collapseWin() {
  if (!win || !expanded) return;
  expanded = false;
  win.setBounds(anchorRight(PILL), true);
  win.webContents.send('view', 'pill');
}

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
    hasShadow: true,
    resizable: false,
    vibrancy: 'under-window',
    visualEffectState: 'active',
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
  win.once('ready-to-show', () => win.show());

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
  wireDisplayMedia();
  await ensureMic();
  createWindow();
  createTray();

  // Global hotkeys
  globalShortcut.register('CommandOrControl+\\', () => {
    if (!win) return;
    if (win.isVisible()) win.hide(); else { win.show(); win.focus(); }
  });
  globalShortcut.register('CommandOrControl+Shift+L', () => win && win.webContents.send('hotkey-listen'));
  globalShortcut.register('CommandOrControl+Shift+A', () => { if (win) { win.show(); win.focus(); win.webContents.send('hotkey-ask'); } });

  setInterval(checkMeeting, 5000);
  setTimeout(checkMeeting, 1500);

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('will-quit', () => globalShortcut.unregisterAll());
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
