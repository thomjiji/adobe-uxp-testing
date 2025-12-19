const ppro = require("premierepro");
const { localFileSystem } = require("uxp").storage;

let cachedMediaFiles = [];
let cachedOfflineFiles = [];

// Progress tracking for batched processing
let scanProgress = {
  total: 0,
  processed: 0,
  currentItem: '',
  startTime: null
};

// Buffer log messages to reduce DOM manipulation
let logBuffer = [];
let logFlushTimer = null;

const log = (msg, color) => {
  const logEntry = color
    ? `<span style='color:${color}'>${msg}</span><br />`
    : `${msg}<br />`;

  logBuffer.push(logEntry);

  // Debounce DOM updates to every 100ms
  if (logFlushTimer) clearTimeout(logFlushTimer);
  logFlushTimer = setTimeout(() => {
    const body = document.getElementById("plugin-body");
    if (body && logBuffer.length > 0) {
      body.innerHTML += logBuffer.join('');
      logBuffer = [];
    }
  }, 100);
};

const clearLog = () => {
  const body = document.getElementById("plugin-body");
  if (body) {
    body.innerHTML = "";
  }
};

const logSuccess = (msg) => log(`> ${msg}`, "#00ff00");
const logError = (msg) => log(`> ${msg}`, "#ff0000");
const logWarning = (msg) => log(`> ${msg}`, "#ffaa00");
const logInfo = (msg) => log(`> ${msg}`, "#aaaaaa");

// Yield control to UI thread to prevent freezing
function yieldToUI() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

// Update progress text counter
function updateProgress(processed, total, currentItem) {
  const progressEl = document.getElementById('progress-text');
  if (progressEl && total > 0) {
    const percent = Math.round((processed / total) * 100);
    const elapsed = Date.now() - scanProgress.startTime;
    const rate = processed > 0 ? elapsed / processed : 0;
    const remaining = rate > 0 ? Math.round((total - processed) * rate / 1000) : 0;

    progressEl.innerHTML = `<span style="color: #00ff00; font-weight: bold;">
      Scanning: ${processed}/${total} (${percent}%) - ${currentItem}<br/>
      Estimated time remaining: ${remaining}s
    </span>`;
  }
}

function clearProgress() {
  const progressEl = document.getElementById('progress-text');
  if (progressEl) {
    progressEl.innerHTML = '';
  }
}

async function getActiveProjectSafe() {
  try {
    const project = await ppro.Project.getActiveProject();
    if (!project) {
      logError("No active project found");
      return null;
    }
    return project;
  } catch (error) {
    logError(`Error getting active project: ${error}`);
    return null;
  }
}

// Count total items for accurate progress tracking
async function countItems(folder) {
  let count = 0;
  const items = await folder.getItems();

  for (const item of items) {
    if (item.type === 2) {
      // Recursively count items in bins
      const subFolder = ppro.FolderItem.cast(item);
      if (subFolder) {
        count += await countItems(subFolder);
      }
    } else {
      count++; // Count clips
    }
  }

  return count;
}

async function collectMediaFiles(folder, batchSize = 10) {
  const mediaFiles = [];
  const items = await folder.getItems();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    if (i > 0 && i % batchSize === 0) {
      await yieldToUI();
    }

    if (item.type !== 2) {
      const clipItem = ppro.ClipProjectItem.cast(item);
      if (clipItem) {
        const isSeq = await clipItem.isSequence();
        if (!isSeq) {
          const path = await clipItem.getMediaFilePath();
          if (path) {
            mediaFiles.push({
              name: item.name,
              path: path,
            });
          }
        }

        scanProgress.processed++;
        updateProgress(scanProgress.processed, scanProgress.total, item.name);
      }
    } else {
      const subFolder = ppro.FolderItem.cast(item);
      if (subFolder) {
        const subFiles = await collectMediaFiles(subFolder, batchSize);
        mediaFiles.push(...subFiles);
      }
    }
  }

  return mediaFiles;
}

// Batched offline file collection with progress tracking
async function collectOfflineFiles(folder, batchSize = 10) {
  const offlineFiles = [];
  const items = await folder.getItems();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    // Yield to UI every N items
    if (i > 0 && i % batchSize === 0) {
      await yieldToUI();
    }

    if (item.type !== 2) {
      const clipItem = ppro.ClipProjectItem.cast(item);
      if (clipItem) {
        const isSeq = await clipItem.isSequence();
        if (!isSeq) {
          const offline = await clipItem.isOffline();
          if (offline) {
            const path = await clipItem.getMediaFilePath();
            offlineFiles.push({
              name: item.name,
              path: path,
            });
          }
        }

        // Update progress after each clip
        scanProgress.processed++;
        updateProgress(scanProgress.processed, scanProgress.total, item.name);
      }
    } else {
      // Process bins recursively
      const subFolder = ppro.FolderItem.cast(item);
      if (subFolder) {
        scanProgress.currentItem = `Entering bin: ${item.name}`;
        updateProgress(scanProgress.processed, scanProgress.total, scanProgress.currentItem);

        const subFiles = await collectOfflineFiles(subFolder, batchSize);
        offlineFiles.push(...subFiles);
      }
    }
  }

  return offlineFiles;
}

async function findOfflineFiles() {
  try {
    clearLog();
    clearProgress();

    log("Counting items...");
    const project = await getActiveProjectSafe();
    if (!project) return;

    const rootItem = await project.getRootItem();

    // Count total items for progress tracking
    scanProgress.total = await countItems(rootItem);
    scanProgress.processed = 0;
    scanProgress.startTime = Date.now();

    log(`Found ${scanProgress.total} items to scan`);

    // Perform batched scan with progress feedback
    const offlineFiles = await collectOfflineFiles(rootItem, 10);

    clearProgress();
    cachedOfflineFiles = offlineFiles;

    const elapsed = Math.round((Date.now() - scanProgress.startTime) / 1000);

    if (offlineFiles.length === 0) {
      logSuccess(`No offline files found! All media is online. (${elapsed}s)`);
    } else {
      logError(`Found ${offlineFiles.length} offline files in ${elapsed}s`);
    }

    // Print offline results
    for (const file of offlineFiles) {
      log(`${file.name}: ${file.path}`, "#ff0000");
    }
  } catch (error) {
    clearProgress();
    logError(`Error: ${error.message}`);
  }
}

async function saveMediaFilesToTxt() {
  try {
    if (!cachedMediaFiles || cachedMediaFiles.length === 0) {
      logWarning("No media files to export. Run scan first.");
      return;
    }

    const file = await localFileSystem.getFileForSaving("project-media", {
      types: ["txt"],
    });

    if (!file) {
      logInfo("Export cancelled");
      return;
    }

    const content = cachedMediaFiles
      .map((item) => `${item.name}\t${item.path}`)
      .join("\n");
    await file.write(content);

    logSuccess(
      `Saved ${cachedMediaFiles.length} file paths to: ${file.nativePath}`,
    );
  } catch (error) {
    logError(`Error saving file: ${error.message}`);
  }
}

async function saveOfflineFilesToTxt() {
  try {
    if (!cachedOfflineFiles || cachedOfflineFiles.length === 0) {
      logWarning("No offline files to export. Run offline scan first.");
      return;
    }

    const file = await localFileSystem.getFileForSaving("offline-media", {
      types: ["txt"],
    });

    if (!file) {
      logInfo("Export cancelled");
      return;
    }

    const content = cachedOfflineFiles
      .map((item) => `${item.name}\t${item.path}`)
      .join("\n");
    await file.write(content);

    logSuccess(
      `Saved ${cachedOfflineFiles.length} offline file paths to: ${file.nativePath}`,
    );
  } catch (error) {
    logError(`Error saving file: ${error.message}`);
  }
}

async function run() {
  try {
    clearLog();
    clearProgress();

    log("Counting items...");
    const project = await getActiveProjectSafe();
    if (!project) return;

    const rootItem = await project.getRootItem();

    scanProgress.total = await countItems(rootItem);
    scanProgress.processed = 0;
    scanProgress.startTime = Date.now();

    log(`Found ${scanProgress.total} items to scan`);

    const mediaFiles = await collectMediaFiles(rootItem, 10);

    clearProgress();
    cachedMediaFiles = mediaFiles;

    const elapsed = Math.round((Date.now() - scanProgress.startTime) / 1000);
    logSuccess(`Found ${mediaFiles.length} media files in project (${elapsed}s)`);

    // Print results (limit to first 100 to avoid DOM overload)
    const displayLimit = Math.min(mediaFiles.length, 100);
    for (let i = 0; i < displayLimit; i++) {
      const file = mediaFiles[i];
      log(`${file.name}: ${file.path}`);
    }
    if (mediaFiles.length > displayLimit) {
      log(`... and ${mediaFiles.length - displayLimit} more files (use Export to see all)`);
    }
  } catch (error) {
    clearProgress();
    logError(`Error: ${error.message}`);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const scanBtn = document.querySelector("#scan-btn");
  const exportBtn = document.querySelector("#export-btn");
  const scanOfflineBtn = document.querySelector("#scan-offline-btn");
  const exportOfflineBtn = document.querySelector("#export-offline-btn");
  const clearBtn = document.querySelector("#clear-btn");

  if (scanBtn) {
    scanBtn.addEventListener("click", run);
  }
  if (exportBtn) {
    exportBtn.addEventListener("click", saveMediaFilesToTxt);
  }
  if (scanOfflineBtn) {
    scanOfflineBtn.addEventListener("click", findOfflineFiles);
  }
  if (exportOfflineBtn) {
    exportOfflineBtn.addEventListener("click", saveOfflineFilesToTxt);
  }
  if (clearBtn) {
    clearBtn.addEventListener("click", clearLog);
  }
  log("\n");
});
