const { app, BrowserWindow, ipcMain, systemPreferences, globalShortcut, desktopCapturer, session, screen } = require('electron');
const { execFile } = require('child_process');
const path = require('path');

let win = null;
let clickThrough = false;

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
        win.webContents.send('meeting-detected', name);
      }
    } else if (!isMeeting && meetingActive) {
      meetingActive = false;
      dismissedFor = null;
      win.webContents.send('meeting-cleared');
    }
  });
}

function createWindow() {
  const { width: sw } = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: 440,
    height: 640,
    x: sw - 470,
    y: 40,
    minWidth: 360,
    minHeight: 420,
    title: 'Gideon',
    frame: false,
    transparent: true,
    hasShadow: true,
    resizable: true,
    vibrancy: 'under-window',
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    show: false,
    alwaysOnTop: true,
    skipTaskbar: false,
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
  wireDisplayMedia();
  await ensureMic();
  createWindow();

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
ipcMain.handle('dismiss-meeting', (_e, name) => { dismissedFor = name; });
