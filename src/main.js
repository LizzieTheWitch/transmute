const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { PDFDocument } = require('pdf-lib');
const sharp = require('sharp');
const extractZip = require('extract-zip');

function createWindow() {
  const win = new BrowserWindow({
    width: 820,
    height: 680,
    minWidth: 620,
    minHeight: 520,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#1a1a2e',
      symbolColor: '#e0e0e0',
      height: 36,
    },
    backgroundColor: '#1a1a2e',
    show: false,
    icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ─── IPC: pick folder ─────────────────────────────────────────────────────────
ipcMain.handle('pick-folder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

// ─── IPC: pick ZIP file ───────────────────────────────────────────────────────
ipcMain.handle('pick-zip', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'ZIP Files', extensions: ['zip'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

// ─── IPC: pick save path ──────────────────────────────────────────────────────
ipcMain.handle('pick-save', async (_, defaultName) => {
  const result = await dialog.showSaveDialog({
    defaultPath: defaultName || 'output.pdf',
    filters: [{ name: 'PDF File', extensions: ['pdf'] }],
  });
  if (result.canceled) return null;
  return result.filePath;
});

// ─── IPC: scan folder for images ─────────────────────────────────────────────
ipcMain.handle('scan-folder', async (_, folderPath) => {
  const SUPPORTED = /\.(webp|jpg|jpeg|png|gif|bmp)$/i;
  let targetFolder = folderPath;
  let tempZipDir = null;

  // If a ZIP file was dropped, extract it
  try {
    const stat = fs.statSync(folderPath);
    if (stat.isFile() && /\.zip$/i.test(folderPath)) {
      tempZipDir = path.join(os.tmpdir(), 'transmute-' + Date.now());
      fs.mkdirSync(tempZipDir, { recursive: true });
      await extractZip(folderPath, { dir: tempZipDir });
      targetFolder = tempZipDir;
    } else if (stat.isFile()) {
      targetFolder = path.dirname(folderPath);
    }
  } catch (e) {
    if (tempZipDir && fs.existsSync(tempZipDir)) {
      fs.rmSync(tempZipDir, { recursive: true, force: true });
    }
    return { error: 'Cannot read that file or folder: ' + e.message };
  }

  let files;
  try {
    files = fs.readdirSync(targetFolder);
  } catch {
    if (tempZipDir && fs.existsSync(tempZipDir)) {
      fs.rmSync(tempZipDir, { recursive: true, force: true });
    }
    return { error: 'Cannot read that folder.' };
  }
  const images = files
    .filter((f) => SUPPORTED.test(f))
    .sort(naturalSort)
    .map((f) => ({ name: f, fullPath: path.join(targetFolder, f) }));

  return { images, folderPath: targetFolder, tempZipDir };
});

// ─── IPC: build PDF ───────────────────────────────────────────────────────────
ipcMain.handle('build-pdf', async (event, { files, outputPath, title, tempZipDir }) => {
  const send = (msg) => event.sender.send('progress', msg);

  try {
    const pdfDoc = await PDFDocument.create();
    if (title) pdfDoc.setTitle(title);
    pdfDoc.setCreationDate(new Date());

    for (let i = 0; i < files.length; i++) {
      const filePath = files[i];
      send({ step: i + 1, total: files.length, file: path.basename(filePath) });

      let jpegBuffer;
      try {
        jpegBuffer = await sharp(filePath).jpeg({ quality: 92 }).toBuffer();
      } catch (e) {
        send({ warning: `Skipped ${path.basename(filePath)}: ${e.message}` });
        continue;
      }

      const image = await pdfDoc.embedJpg(jpegBuffer);
      const page = pdfDoc.addPage([image.width, image.height]);
      page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
    }

    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(outputPath, pdfBytes);
    send({ done: true, outputPath });
    return { success: true, outputPath };
  } catch (err) {
    send({ error: err.message });
    return { success: false, error: err.message };
  } finally {
    // Clean up temporary ZIP extraction directory
    if (tempZipDir && fs.existsSync(tempZipDir)) {
      fs.rmSync(tempZipDir, { recursive: true, force: true });
    }
  }
});

// ─── IPC: open folder in Explorer ─────────────────────────────────────────────
ipcMain.handle('open-folder', async (_, folderPath) => {
  const { shell } = require('electron');
  await shell.openPath(folderPath);
});

// ─── Natural sort helper ──────────────────────────────────────────────────────
function naturalSort(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}
