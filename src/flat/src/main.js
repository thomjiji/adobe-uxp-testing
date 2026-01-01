const ppro = require("premierepro");
const { localFileSystem } = require("uxp").storage;

// Configuration
const FLATTEN_DEPTH_THRESHOLD = 2; // Clips at this depth or deeper will be moved to the top level
const UNWANTED_EXTENSIONS = ['.jpg', '.jpeg', '.txt']; // Extensions to remove when using Flatten & Remove

// Progress tracking
let scanProgress = {
  total: 0,
  processed: 0,
  currentItem: '',
  startTime: null
};

// Responsiveness control
let lastYieldTime = 0;
let lastProgressUpdate = 0;
const YIELD_MS = 30; // Work for 30ms before yielding
const UPDATE_MS = 100; // Update UI max every 100ms

// Tracking unique items
let countedItemIds = new Set();
let processedItemIds = new Set();

// Buffer log messages
let logBuffer = [];
let logFlushTimer = null;
const MAX_LOG_LINES = 100; // Keep only the last 100 lines

const log = (msg, color) => {
  const logEntry = color
    ? `<div style='color:${color}'>${msg}</div>`
    : `<div>${msg}</div>`;

  logBuffer.push(logEntry);

  if (logFlushTimer) clearTimeout(logFlushTimer);
  logFlushTimer = setTimeout(() => {
    const body = document.getElementById("plugin-body");
    if (body && logBuffer.length > 0) {
      body.insertAdjacentHTML('beforeend', logBuffer.join(''));

      // Prune old messages
      while (body.childElementCount > MAX_LOG_LINES) {
        body.removeChild(body.firstElementChild);
      }

      logBuffer = [];
      body.scrollTop = body.scrollHeight;
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
function yieldToUI(ms = 0) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Check if we should yield to UI based on time
async function checkYield() {
    const now = Date.now();
    if (now - lastYieldTime > YIELD_MS) {
        await yieldToUI();
        lastYieldTime = Date.now();
    }
}

// Update progress text counter
function updateProgress(processed, total, currentItem) {
  const now = Date.now();
  if (now - lastProgressUpdate < UPDATE_MS && processed < total) return;
  lastProgressUpdate = now;

  const progressEl = document.getElementById('progress-text');
  if (progressEl && total > 0) {
    const percent = Math.round((processed / total) * 100);

    let remaining = 0;
    if (processed > 0 && scanProgress.startTime) {
        const elapsed = now - scanProgress.startTime;
        const rate = elapsed / processed;
        remaining = Math.max(0, Math.round((total - processed) * rate / 1000));
    }

    progressEl.innerHTML = `<span style="color: #00ff00;">
      Scanning: ${processed}/${total} (${percent}%)<br/>
      <div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;">${currentItem}</div>
      Est. time remaining: ${remaining}s
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

async function isDescendantOf(childBin, potentialParent) {
  try {
    let current = childBin.getParentBin();

    while (current) {
      const currentId = current.getId();
      const parentId = potentialParent.getId ? potentialParent.getId() : null;

      if (currentId === parentId) {
        return true;
      }

      current = current.getParentBin();
    }

    return false;
  } catch (error) {
    return false;
  }
}

// Count total items for accurate progress tracking
async function countItems(folder) {
  let count = 0;
  const items = await folder.getItems();

  for (const item of items) {
    await checkYield();

    const id = item.getId();
    if (!countedItemIds.has(id)) {
        countedItemIds.add(id);
        count++; // Count unique item

        if (item.type === 2) {
          const subFolder = ppro.FolderItem.cast(item);
          if (subFolder) {
            count += await countItems(subFolder);
          }
        }
    }
  }

  return count;
}

function isUnwantedItem(name) {
  const lowerName = name.toLowerCase();
  return UNWANTED_EXTENSIONS.some(ext => lowerName.endsWith(ext.toLowerCase()));
}

/**
 * Recursively scans a bin and plans actions for flattening, removing unwanted files,
 * and cleaning up empty bins.
 *
 * Returns: { actions: [], isEmpty: boolean }
 */
async function scanAndPlan(currentBin, targetBin, depth, options, batchSize = 10) {
  const allActions = [];
  let remainingItemCount = 0;

  const items = await currentBin.getItems();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    const id = item.getId();
    if (processedItemIds.has(id)) continue;
    processedItemIds.add(id);

    // Yield to UI periodically
    await checkYield();

    // Update global progress
    scanProgress.processed++;
    updateProgress(scanProgress.processed, scanProgress.total, item.name);

    if (item.type === 2) {
      // It's a Bin
      const subFolder = ppro.FolderItem.cast(item);
      if (subFolder) {
        // Recursively process the subfolder
        const result = await scanAndPlan(subFolder, targetBin, depth + 1, options, batchSize);
        allActions.push(...result.actions);

        // Check if the subfolder will be empty after actions are applied
        if (result.isEmpty) {
          logInfo(`  Marking empty bin for removal: ${item.name}`);
          const removeAction = currentBin.createRemoveItemAction(item);
          if (removeAction) {
            allActions.push(removeAction);
          } else {
             remainingItemCount++;
          }
        } else {
          remainingItemCount++;
        }
      }
    } else {
      // It's a Clip/Item
      let actionCreated = false;

      // Check 1: Unwanted File Removal
      if (options.removeUnwanted && isUnwantedItem(item.name)) {
        logInfo(`  Marking unwanted file for removal: ${item.name}`);
        const removeAction = currentBin.createRemoveItemAction(item);
        if (removeAction) {
          allActions.push(removeAction);
          actionCreated = true;
        }
      }

      // Check 2: Flattening (Move deep clips)
      if (!actionCreated && item.type === 1 && depth >= FLATTEN_DEPTH_THRESHOLD) {
        const clipItem = ppro.ClipProjectItem.cast(item);
        if (clipItem) {
          const isSeq = await clipItem.isSequence();
          if (!isSeq) {
             logInfo(`  Marking clip to move: ${item.name}`);
             const moveAction = currentBin.createMoveItemAction(item, targetBin);
             if (moveAction) {
               allActions.push(moveAction);
               actionCreated = true;
             }
          }
        }
      }

      if (!actionCreated) {
        remainingItemCount++;
      }
    }
  }

  return {
    actions: allActions,
    isEmpty: remainingItemCount === 0
  };
}

async function run(options = { removeUnwanted: false }) {
  try {
    clearLog();
    clearProgress();
    countedItemIds.clear();
    processedItemIds.clear();

    log(`Starting folder flatten operation${options.removeUnwanted ? ' with cleanup' : ''}...`);

    const project = await getActiveProjectSafe();
    if (!project) return;

    const selection = await ppro.ProjectUtils.getSelection(project);
    const selectedItems = await selection.getItems();

    if (selectedItems.length === 0) {
      logError("No bins selected. Please select one or more bins in the Project Panel.");
      return;
    }

    const selectedBins = [];
    for (const item of selectedItems) {
      if (item.type === 2) {
        const bin = ppro.FolderItem.cast(item);
        if (bin) {
          selectedBins.push({ item: item, bin: bin });
        }
      } else {
        logWarning(`Skipping non-bin item: ${item.name}`);
      }
    }

    if (selectedBins.length === 0) {
      logError("No bins found in selection. Please select at least one bin.");
      return;
    }

    // Filter nested selections
    const finalBins = [];
    for (let i = 0; i < selectedBins.length; i++) {
      let isChild = false;
      for (let j = 0; j < selectedBins.length; j++) {
        if (i !== j) {
          const potentialParent = selectedBins[j].bin;
          if (await isDescendantOf(selectedBins[i].bin, potentialParent)) {
            isChild = true;
            logInfo(`Skipping "${selectedBins[i].item.name}" - parent bin "${selectedBins[j].item.name}" is also selected`);
            break;
          }
        }
      }
      if (!isChild) {
        finalBins.push(selectedBins[i]);
      }
    }

    if (finalBins.length === 0) {
      logError("All selected bins were filtered out as children of other selected bins.");
      return;
    }

    logSuccess(`Processing ${finalBins.length} bin(s)...`);
    log("───────────────────────────────────");

    // 1. Count items for progress tracking
    log("Counting items...");
    scanProgress.total = 0;
    scanProgress.processed = 0;
    scanProgress.startTime = Date.now();
    lastYieldTime = Date.now();

    for (const binData of finalBins) {
        // Count bin itself
        const id = binData.item.getId();
        if (!countedItemIds.has(id)) {
            countedItemIds.add(id);
            scanProgress.total++;
            scanProgress.total += await countItems(binData.bin);
        }
    }
    log(`Found ${scanProgress.total} items to scan`);

    // 2. Scan and Plan Actions (One Pass)
    log("\nScanning and planning actions...");
    const allPlannedActions = [];

    for (const binData of finalBins) {
      log(`Scanning bin: ${binData.item.name}`);

      const id = binData.item.getId();
      if (!processedItemIds.has(id)) {
          processedItemIds.add(id);
          scanProgress.processed++;
          updateProgress(scanProgress.processed, scanProgress.total, binData.item.name);

          const result = await scanAndPlan(binData.bin, binData.bin, 0, options);
          allPlannedActions.push(...result.actions);
      }
    }

    log("\n───────────────────────────────────");

    if (allPlannedActions.length === 0) {
      logSuccess("No actions needed. Project structure is already clean.");
      return;
    }

    log(`Total actions planned: ${allPlannedActions.length}`);
    log("Executing transaction...");

    // 3. Execute Transaction
    let executedCount = 0;
    project.executeTransaction((compoundAction) => {
      for (const action of allPlannedActions) {
        compoundAction.addAction(action);
        executedCount++;
      }
    }, options.removeUnwanted ? "Flatten & Remove Unwanted" : "Flatten Folders");

    logSuccess(`\nSuccessfully executed ${executedCount} operations.`);
    logSuccess(`Operation complete!`);

  } catch (error) {
    clearProgress();
    logError(`Error: ${error.message}`);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const scanBtn = document.querySelector("#scan-btn");
  const flattenRemoveBtn = document.querySelector("#flatten-remove-btn");
  const clearBtn = document.querySelector("#clear-btn");

  if (scanBtn) {
    scanBtn.addEventListener("click", () => run({ removeUnwanted: false }));
  }
  if (flattenRemoveBtn) {
    flattenRemoveBtn.addEventListener("click", () => run({ removeUnwanted: true }));
  }
  if (clearBtn) {
    clearBtn.addEventListener("click", clearLog);
  }
  log("\n");
});
