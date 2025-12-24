const ppro = require("premierepro");
const { localFileSystem } = require("uxp").storage;

let cachedMediaFiles = [];
let cachedOfflineFiles = [];
let lastScanType = null; // Track which scan was run last: 'media' or 'offline'

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

  // Also clear cached scan results
  cachedMediaFiles = [];
  cachedOfflineFiles = [];
  lastScanType = null;
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

    progressEl.innerHTML = `<span style="color: #00ff00;">
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

// Get selected items from project panel, or return root if nothing selected
async function getSelectedItemsOrRoot() {
  try {
    const project = await getActiveProjectSafe();
    if (!project) return null;

    // Get current selection from project panel
    const selection = await ppro.ProjectUtils.getSelection(project);
    const selectedItems = await selection.getItems();

    if (selectedItems.length === 0) {
      // Nothing selected - return root as single-item array for consistency
      log("No selection detected, scanning entire project");
      const rootItem = await project.getRootItem();
      return [rootItem];
    }

    // Return selected items
    log(`Found ${selectedItems.length} selected item(s)`);
    return selectedItems;
  } catch (error) {
    logError(`Error getting selection: ${error.message}`);
    return null;
  }
}

// Scan multiple items (bins and/or clips) for media files
async function collectMediaFilesFromItems(items, batchSize = 10) {
  const allMediaFiles = [];

  for (const item of items) {
    if (item.type === 2 || item.type === 3) {
      // It's a BIN/FOLDER or ROOT - scan recursively
      const folder = ppro.FolderItem.cast(item);
      if (folder) {
        log(`Scanning bin: ${item.name}`);
        const mediaFiles = await collectMediaFiles(folder, batchSize);
        allMediaFiles.push(...mediaFiles);
      }
    } else {
      // It's a CLIP or other item - process directly
      const clipItem = ppro.ClipProjectItem.cast(item);
      if (clipItem) {
        const isSeq = await clipItem.isSequence();
        if (!isSeq) {
          const path = await clipItem.getMediaFilePath();
          if (path) {
            allMediaFiles.push({
              name: item.name,
              path: path,
            });
          }
        }

        scanProgress.processed++;
        updateProgress(scanProgress.processed, scanProgress.total, item.name);
      }

      // Yield periodically
      if (scanProgress.processed % batchSize === 0) {
        await yieldToUI();
      }
    }
  }

  return allMediaFiles;
}

// Scan multiple items (bins and/or clips) for offline files
async function collectOfflineFilesFromItems(items, batchSize = 10) {
  const allOfflineFiles = [];

  for (const item of items) {
    if (item.type === 2 || item.type === 3) {
      // It's a BIN/FOLDER or ROOT - scan recursively
      const folder = ppro.FolderItem.cast(item);
      if (folder) {
        log(`Scanning bin: ${item.name}`);
        const offlineFiles = await collectOfflineFiles(folder, batchSize);
        allOfflineFiles.push(...offlineFiles);
      }
    } else {
      // It's a CLIP or other item - check if offline
      const clipItem = ppro.ClipProjectItem.cast(item);
      if (clipItem) {
        const isSeq = await clipItem.isSequence();
        if (!isSeq) {
          const offline = await clipItem.isOffline();
          if (offline) {
            const path = await clipItem.getMediaFilePath();
            allOfflineFiles.push({
              name: item.name,
              path: path,
            });
          }
        }

        scanProgress.processed++;
        updateProgress(scanProgress.processed, scanProgress.total, item.name);
      }

      // Yield periodically
      if (scanProgress.processed % batchSize === 0) {
        await yieldToUI();
      }
    }
  }

  return allOfflineFiles;
}

// Count total items in selected items (for progress tracking)
async function countItemsInSelection(items) {
  let totalCount = 0;

  for (const item of items) {
    if (item.type === 2 || item.type === 3) {
      // It's a BIN or ROOT - count all items inside recursively
      const folder = ppro.FolderItem.cast(item);
      if (folder) {
        totalCount += await countItems(folder);
      }
    } else {
      // It's a single CLIP - count as 1
      totalCount++;
    }
  }

  return totalCount;
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

/**
 * Returns a formatted timestamp string (YYYYMMDDHHmm)
 */
function getFormattedTimestamp() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  return `${year}${month}${day}${hours}${minutes}`;
}

// Export scan results (exports the most recent scan)
async function exportResults() {
  try {
    // Determine which scan results to export based on last scan type
    let dataToExport = null;
    let defaultFilename = null;
    let scanType = null;
    const timestamp = getFormattedTimestamp();

    if (lastScanType === 'offline' && cachedOfflineFiles && cachedOfflineFiles.length > 0) {
      dataToExport = cachedOfflineFiles;
      defaultFilename = `offline-media-${timestamp}`;
      scanType = "offline";
    } else if (lastScanType === 'media' && cachedMediaFiles && cachedMediaFiles.length > 0) {
      dataToExport = cachedMediaFiles;
      defaultFilename = `media-files-${timestamp}`;
      scanType = "media";
    } else if (cachedOfflineFiles && cachedOfflineFiles.length > 0) {
      // Fallback to offline if no recent scan tracked
      dataToExport = cachedOfflineFiles;
      defaultFilename = `offline-media-${timestamp}`;
      scanType = "offline";
    } else if (cachedMediaFiles && cachedMediaFiles.length > 0) {
      // Fallback to media if no recent scan tracked
      dataToExport = cachedMediaFiles;
      defaultFilename = `media-files-${timestamp}`;
      scanType = "media";
    } else {
      logWarning("No files to export. Run a scan first.");
      return;
    }

    const file = await localFileSystem.getFileForSaving(defaultFilename, {
      types: ["csv", "txt"],
    });

    if (!file) {
      logInfo("Export cancelled");
      return;
    }

    let content = "";
    const isCsv = file.name.toLowerCase().endsWith(".csv");

    if (isCsv) {
      // CSV format: "Name","Path"
      content = "Name,Path\n" + dataToExport
        .map((item) => `"${item.name.replace(/"/g, '""')}","${item.path.replace(/"/g, '""')}"`)
        .join("\n");
    } else {
      // TXT format: Name\tPath
      content = dataToExport
        .map((item) => `${item.name}\t${item.path}`)
        .join("\n");
    }

    await file.write(content);

    logSuccess(
      `Saved ${dataToExport.length} ${scanType} file paths to: ${file.nativePath}`,
    );
  } catch (error) {
    logError(`Error saving file: ${error.message}`);
  }
}

// Scan media in selected items (or all if nothing selected)
async function scanMedia() {
  try {
    clearLog();
    clearProgress();

    log("Getting selection...");

    // Get selected items or root if nothing selected
    const items = await getSelectedItemsOrRoot();
    if (!items) return;

    // Count total items for progress tracking
    log("Counting items...");
    scanProgress.total = await countItemsInSelection(items);
    scanProgress.processed = 0;
    scanProgress.startTime = Date.now();

    log(`Found ${scanProgress.total} items to scan`);

    // Scan the selected items (or root)
    const mediaFiles = await collectMediaFilesFromItems(items, 10);

    clearProgress();
    cachedMediaFiles = mediaFiles;
    lastScanType = 'media'; // Mark that media scan was run last

    const elapsed = Math.round((Date.now() - scanProgress.startTime) / 1000);
    logSuccess(`Found ${mediaFiles.length} media files in selection (${elapsed}s)`);

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

// Scan offline files in selected items (or all if nothing selected)
async function scanOffline() {
  try {
    clearLog();
    clearProgress();

    log("Getting selection...");

    // Get selected items or root if nothing selected
    const items = await getSelectedItemsOrRoot();
    if (!items) return;

    // Count total items for progress tracking
    log("Counting items...");
    scanProgress.total = await countItemsInSelection(items);
    scanProgress.processed = 0;
    scanProgress.startTime = Date.now();

    log(`Found ${scanProgress.total} items to scan`);

    // Scan for offline files in selected items (or root)
    const offlineFiles = await collectOfflineFilesFromItems(items, 10);

    clearProgress();
    cachedOfflineFiles = offlineFiles;
    lastScanType = 'offline'; // Mark that offline scan was run last

    const elapsed = Math.round((Date.now() - scanProgress.startTime) / 1000);

    if (offlineFiles.length === 0) {
      logSuccess(`No offline files found in selection! (${elapsed}s)`);
    } else {
      logError(`Found ${offlineFiles.length} offline files in selection (${elapsed}s)`);
    }

    // Print offline results (limit to first 100 to avoid DOM overload)
    const displayLimit = Math.min(offlineFiles.length, 100);
    for (let i = 0; i < displayLimit; i++) {
      const file = offlineFiles[i];
      log(`${file.name}: ${file.path}`, "#ff0000");
    }
    if (offlineFiles.length > displayLimit) {
      log(`... and ${offlineFiles.length - displayLimit} more offline files (use Export to see all)`, "#ff0000");
    }
  } catch (error) {
    clearProgress();
    logError(`Error: ${error.message}`);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const scanMediaBtn = document.querySelector("#scan-media-btn");
  const scanOfflineBtn = document.querySelector("#scan-offline-btn");
  const exportBtn = document.querySelector("#export-btn");
  const clearBtn = document.querySelector("#clear-btn");

  if (scanMediaBtn) {
    scanMediaBtn.addEventListener("click", scanMedia);
  }
  if (scanOfflineBtn) {
    scanOfflineBtn.addEventListener("click", scanOffline);
  }
  if (exportBtn) {
    exportBtn.addEventListener("click", exportResults);
  }
  if (clearBtn) {
    clearBtn.addEventListener("click", clearLog);
  }
  log("\n");
});
