const { app, BrowserWindow, clipboard, ipcMain, shell } = require('electron');
const path = require('node:path');

app.setPath('userData', path.join(app.getPath('appData'), 'milanote-local'));

ipcMain.handle('clipboard:read-image', () => {
  const image = clipboard.readImage();
  if (image.isEmpty()) return null;
  return { data: image.toPNG(), type: 'image/png' };
});

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#111214',
    title: 'DudinhaNote',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  window.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
