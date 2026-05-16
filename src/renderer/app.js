/* global state */
let currentFolder = null;
let imageFiles = [];   // array of { name, fullPath }
let savePath = null;

const $ = (id) => document.getElementById(id);

// ─── Elements ────────────────────────────────────────────────────────────────
const dropZone       = $('drop-zone');
const btnBrowse      = $('btn-browse');
const folderPill     = $('folder-pill');
const folderLabel    = $('folder-path-label');
const btnClearFolder = $('btn-clear-folder');
const imageListEl    = $('image-list');
const imageCountEl   = $('image-count');
const fileListUl     = $('file-list-ul');
const btnReorder     = $('btn-reorder');

const stepOptions    = $('step-options');
const inputTitle     = $('input-title');
const inputSavePath  = $('input-save-path');
const btnPickSave    = $('btn-pick-save');

const stepConvert    = $('step-convert');
const btnConvert     = $('btn-convert');
const progressArea   = $('progress-area');
const progressFill   = $('progress-fill');
const progressLabel  = $('progress-label');
const warningList    = $('warning-list');
const doneBanner     = $('done-banner');
const donePath       = $('done-path');
const btnOpenFolder  = $('btn-open-folder');

// ─── Drag & drop folder onto drop zone ───────────────────────────────────────
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', async (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const items = [...e.dataTransfer.items];
  for (const item of items) {
    if (item.kind === 'file') {
      const entry = item.webkitGetAsEntry?.();
      if (entry && entry.isDirectory) {
        // On Electron, dataTransfer.files gives us the path
        const f = item.getAsFile();
        if (f && f.path) { await loadFolder(f.path); return; }
      }
      // Fallback: try file.path directly
      const f = item.getAsFile();
      if (f && f.path) {
        // might be a file — grab its directory
        const parts = f.path.replace(/\\/g, '/').split('/');
        parts.pop();
        await loadFolder(parts.join('/') || f.path);
        return;
      }
    }
  }
});

// Also allow dropping a folder on the whole window
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  if (e.dataTransfer.files.length > 0) {
    const f = e.dataTransfer.files[0];
    if (f.path) await loadFolder(f.path);
  }
});

// ─── Browse button ────────────────────────────────────────────────────────────
btnBrowse.addEventListener('click', async () => {
  const folder = await window.api.pickFolder();
  if (folder) await loadFolder(folder);
});

// ─── Clear folder ─────────────────────────────────────────────────────────────
btnClearFolder.addEventListener('click', clearFolder);

// ─── Re-sort button ───────────────────────────────────────────────────────────
btnReorder.addEventListener('click', () => {
  imageFiles = naturalSort(imageFiles);
  renderFileList();
});

// ─── Pick save path ───────────────────────────────────────────────────────────
btnPickSave.addEventListener('click', async () => {
  const title = inputTitle.value.trim() || 'output';
  const picked = await window.api.pickSave(title + '.pdf');
  if (picked) {
    savePath = picked;
    inputSavePath.value = picked;
    updateConvertBtn();
  }
});

// ─── Convert button ───────────────────────────────────────────────────────────
btnConvert.addEventListener('click', async () => {
  if (!savePath || imageFiles.length === 0) return;

  resetProgress();
  progressArea.classList.remove('hidden');
  doneBanner.classList.add('hidden');
  btnConvert.disabled = true;

  window.api.removeProgressListener();
  window.api.onProgress((data) => {
    if (data.warning) {
      const li = document.createElement('li');
      li.textContent = '⚠ ' + data.warning;
      warningList.appendChild(li);
    } else if (data.done) {
      progressFill.style.width = '100%';
      progressLabel.textContent = 'Complete!';
      donePath.textContent = data.outputPath;
      doneBanner.classList.remove('hidden');
      btnConvert.disabled = false;
    } else if (data.error) {
      progressLabel.textContent = 'Error: ' + data.error;
      btnConvert.disabled = false;
    } else if (data.total) {
      const pct = Math.round((data.step / data.total) * 100);
      progressFill.style.width = pct + '%';
      progressLabel.textContent = `Processing ${data.step} / ${data.total}  —  ${data.file}`;
    }
  });

  await window.api.buildPdf({
    files: imageFiles.map((f) => f.fullPath),
    outputPath: savePath,
    title: inputTitle.value.trim() || undefined,
  });
});

// ─── Open output folder ───────────────────────────────────────────────────────
btnOpenFolder.addEventListener('click', () => {
  if (!savePath) return;
  const folder = savePath.replace(/[/\\][^/\\]+$/, '');
  window.api.openFolder(folder);
});

// ─── Core: load folder ────────────────────────────────────────────────────────
async function loadFolder(folderPath) {
  const result = await window.api.scanFolder(folderPath);
  if (result.error) {
    alert('Error: ' + result.error);
    return;
  }
  if (result.images.length === 0) {
    alert('No supported images found in that folder.\n\nSupported types: WEBP, JPG, PNG, GIF, BMP');
    return;
  }

  const actualFolderPath = result.folderPath || folderPath;
  currentFolder = actualFolderPath;
  imageFiles = result.images;

  folderLabel.textContent = actualFolderPath;
  folderPill.classList.remove('hidden');
  dropZone.classList.add('hidden');
  renderFileList();
  imageListEl.classList.remove('hidden');

  // Suggest a title from the folder name
  const folderName = actualFolderPath.replace(/\\/g, '/').split('/').pop();
  if (!inputTitle.value) inputTitle.value = folderName;

  // Suggest a save path
  if (!savePath) {
    const suggested = actualFolderPath.replace(/\\/g, '/').replace(/\/$/, '') + '/' + folderName + '.pdf';
    savePath = suggested.replace(/\//g, '\\');
    inputSavePath.value = savePath;
  }

  stepOptions.classList.remove('hidden');
  stepConvert.classList.remove('hidden');
  updateConvertBtn();
}

function clearFolder() {
  currentFolder = null;
  imageFiles = [];
  savePath = null;

  folderPill.classList.add('hidden');
  dropZone.classList.remove('hidden');
  imageListEl.classList.add('hidden');
  fileListUl.innerHTML = '';
  stepOptions.classList.add('hidden');
  stepConvert.classList.add('hidden');
  inputTitle.value = '';
  inputSavePath.value = '';
  resetProgress();
  progressArea.classList.add('hidden');
  doneBanner.classList.add('hidden');
}

function renderFileList() {
  fileListUl.innerHTML = '';
  imageCountEl.textContent = `${imageFiles.length} image${imageFiles.length !== 1 ? 's' : ''} found`;
  imageFiles.forEach((f, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="file-num">${i + 1}</span><span class="file-name">${f.name}</span>`;
    fileListUl.appendChild(li);
  });
}

function updateConvertBtn() {
  btnConvert.disabled = !(imageFiles.length > 0 && savePath);
}

function resetProgress() {
  progressFill.style.width = '0%';
  progressLabel.textContent = 'Starting…';
  warningList.innerHTML = '';
}

// ─── Natural sort helper (client-side, for re-sort button) ────────────────────
function naturalSort(arr) {
  return [...arr].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  );
}
