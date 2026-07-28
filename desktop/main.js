const { app, BrowserWindow, ipcMain, systemPreferences, shell } = require('electron');
const path = require('path');

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 460,
    height: 720,
    minWidth: 380,
    minHeight: 520,
    title: 'Gideon Listener',
    backgroundColor: '#0c0b09',
    show: false,
    alwaysOnTop: true,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());

  // Keep it a floating companion by default; user can toggle.
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
}

// Ask for mic permission up front on macOS so getUserMedia works.
async function ensureMic() {
  if (process.platform !== 'darwin') return true;
  const status = systemPreferences.getMediaAccessStatus('microphone');
  if (status === 'granted') return true;
  try {
    return await systemPreferences.askForMediaAccess('microphone');
  } catch {
    return false;
  }
}

app.whenReady().then(async () => {
  await ensureMic();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Renderer asks to toggle always-on-top.
ipcMain.handle('set-always-on-top', (_e, val) => {
  if (win) win.setAlwaysOnTop(!!val);
  return !!val;
});
ipcMain.handle('open-external', (_e, url) => shell.openExternal(url));
