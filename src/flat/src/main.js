const ppro = require("premierepro");
const { localFileSystem } = require("uxp").storage;

// Progress tracking
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

function isUnwantedItem(name) {
  const lowerName = name.toLowerCase();
  return lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg') || lowerName.endsWith('.txt');
}

async function collectUnwantedItems(folder, unwantedItems, parent, batchSize = 10) {
  const items = await folder.getItems();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    // Yield to UI every N items
    if (i > 0 && i % batchSize === 0) {
      await yieldToUI();
    }

    // We don't update global progress here as strictly because this is an extra pass
    // but we could if we wanted to be precise. For now just yielding is fine.

    if (item.type === 2) {
      const subFolder = ppro.FolderItem.cast(item);
      if (subFolder) {
        await collectUnwantedItems(subFolder, unwantedItems, subFolder, batchSize);
      }
    } else {
      // Check if it's an unwanted file
      if (isUnwantedItem(item.name)) {
        unwantedItems.push({
            item: item,
            parent: parent || folder 
        });
        logInfo(`Found unwanted file: ${item.name}`);
      }
    }
  }
}

async function collectDeepClips(folder, targetBin, currentDepth, clipsToMove, batchSize = 10) {
  const items = await folder.getItems();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    // Yield to UI every N items
    if (i > 0 && i % batchSize === 0) {
      await yieldToUI();
    }

    scanProgress.processed++;
    updateProgress(scanProgress.processed, scanProgress.total, item.name);

    if (item.type === 2) {
      const subFolder = ppro.FolderItem.cast(item);
      if (subFolder) {
        if (currentDepth >= 2) {
          logInfo(`Searching deep bin (level ${currentDepth + 1}): ${item.name}`);
        }
        await collectDeepClips(subFolder, targetBin, currentDepth + 1, clipsToMove, batchSize);
      }
    } else if (item.type === 1 && currentDepth >= 2) {
      const clipItem = ppro.ClipProjectItem.cast(item);
      if (clipItem) {
        const isSeq = await clipItem.isSequence();
        if (!isSeq) {
          clipsToMove.push({
            item: item,
            fromFolder: folder,
            targetBin: targetBin,
          });
          logInfo(`Found clip to move: ${item.name}`);
        }
      }
    }
  }
}

async function collectEmptyBins(folder, emptyBins, depth = 0, batchSize = 10) {
  const items = await folder.getItems();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    
    // Yield to UI every N items
    if (i > 0 && i % batchSize === 0) {
      await yieldToUI();
    }

    if (item.type === 2) {
      const subFolder = ppro.FolderItem.cast(item);
      if (subFolder) {
        await collectEmptyBins(subFolder, emptyBins, depth + 1, batchSize);

        const subItems = await subFolder.getItems();
        if (subItems.length === 0) {
          emptyBins.push({
            bin: subFolder,
            item: item,
            parent: folder,
            depth: depth,
          });
          logInfo(`  Found empty bin at depth ${depth + 1}: ${item.name}`);
        }
      }
    }
  }
}

async function removeEmptyBins(selectedBins, project) {
  log("\n───────────────────────────────────");
  log("Checking for empty bins to remove...");

  let totalRemovedCount = 0;
  let passCount = 0;
  let foundEmpty = true;

  while (foundEmpty) {
    passCount++;
    const allEmptyBins = [];
    const seenBinIds = new Set();

    for (const binData of selectedBins) {
      const emptyBins = [];
      logInfo(`Scanning for empty bins in: ${binData.item.name}`);
      await collectEmptyBins(binData.bin, emptyBins);

      logInfo(`  Found ${emptyBins.length} empty bin(s) in "${binData.item.name}"`);

      for (const emptyBin of emptyBins) {
        const binId = emptyBin.item.getId();
        if (!seenBinIds.has(binId)) {
          seenBinIds.add(binId);
          allEmptyBins.push(emptyBin);
        } else {
          logInfo(`  Skipping duplicate: ${emptyBin.item.name}`);
        }
      }
    }

    if (allEmptyBins.length === 0) {
      foundEmpty = false;
      if (passCount === 1) {
        logInfo("No empty bins found.");
      }
      break;
    }

    if (passCount === 1) {
      logWarning(`Found ${allEmptyBins.length} empty bin(s) to remove...`);
    } else {
      logInfo(`Pass ${passCount}: Found ${allEmptyBins.length} additional empty bin(s)...`);
    }

    let removedCount = 0;
    project.executeTransaction((compoundAction) => {
      for (const binData of allEmptyBins) {
        const removeAction = binData.parent.createRemoveItemAction(binData.item);
        if (removeAction) {
          compoundAction.addAction(removeAction);
          removedCount++;
          logInfo(`  Removed: ${binData.item.name}`);
        }
      }
    }, `Remove Empty Bins (Pass ${passCount})`);

    totalRemovedCount += removedCount;
  }

  return totalRemovedCount;
}

async function run(options = { removeUnwanted: false }) {
  try {
    clearLog();
    clearProgress();
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

    const finalBins = [];
    for (let i = 0; i < selectedBins.length; i++) {
      let isChild = false;
      const binId = selectedBins[i].item.getId();

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

    logSuccess(`Processing ${finalBins.length} bin(s) (${selectedBins.length - finalBins.length} skipped as children)...`);
    log("───────────────────────────────────");
    
    // Count items for progress tracking
    log("Counting items...");
    scanProgress.total = 0;
    scanProgress.processed = 0;
    scanProgress.startTime = Date.now();
    
    for (const binData of finalBins) {
        scanProgress.total += await countItems(binData.bin);
    }
    log(`Found ${scanProgress.total} items to scan`);

    // --- Optional Unwanted Files Removal ---
    if (options.removeUnwanted) {
        log("\nScanning for unwanted files (jpeg, jpg, txt)...");
        const allUnwantedItems = [];
        for (const binData of finalBins) {
            await collectUnwantedItems(binData.bin, allUnwantedItems, binData.bin);
        }

        if (allUnwantedItems.length > 0) {
            logWarning(`Found ${allUnwantedItems.length} unwanted file(s) to remove.`);
            let removedUnwantedCount = 0;
            
            project.executeTransaction((compoundAction) => {
                for (const itemData of allUnwantedItems) {
                    const removeAction = itemData.parent.createRemoveItemAction(itemData.item);
                    if (removeAction) {
                        compoundAction.addAction(removeAction);
                        removedUnwantedCount++;
                    }
                }
            }, "Remove Unwanted Files");
            
            logSuccess(`Removed ${removedUnwantedCount} unwanted file(s).`);
             // We need to recount because we just removed items!
             // But actually, updateProgress uses `scanProgress.total` which we set earlier.
             // If we remove items, `processed` count in `collectDeepClips` might be off or we might process fewer items than `total`.
             // It's okay, the progress bar will just be approximate or finish early.
             // Alternatively, we could re-count. Let's just subtract from total.
             scanProgress.total -= removedUnwantedCount;

        } else {
            logInfo("No unwanted files found.");
        }
        log("───────────────────────────────────");
    }

    const allClipsToMove = [];
    let totalClipsFound = 0;

    for (const binData of finalBins) {
      log(`\nProcessing bin: ${binData.item.name}`);
      log("Scanning for clips in folders deeper than 2 levels...");

      const clipsToMove = [];
      await collectDeepClips(binData.bin, binData.bin, 0, clipsToMove);

      if (clipsToMove.length === 0) {
        logInfo(`  No deep clips found in "${binData.item.name}"`);
      } else {
        logWarning(`  Found ${clipsToMove.length} clip(s) to flatten from "${binData.item.name}"`);
        totalClipsFound += clipsToMove.length;
        allClipsToMove.push(...clipsToMove);
      }
    }
    
    // clearProgress(); // Keep progress persistent

    log("\n───────────────────────────────────");

    if (allClipsToMove.length === 0) {
      if (!options.removeUnwanted) {
           logSuccess("No clips found in folders deeper than 2 levels. All structures are already flat enough.");
           return;
      } else {
           logSuccess("Flattening check complete (nothing moved).");
      }
    } else {
        log(`Total clips to move: ${totalClipsFound}`);
        log("Moving clips to their respective bins...");

        let movedCount = 0;
        project.executeTransaction((compoundAction) => {
        for (const clipData of allClipsToMove) {
            const moveAction = clipData.fromFolder.createMoveItemAction(
            clipData.item,
            clipData.targetBin,
            );
            if (moveAction) {
            compoundAction.addAction(moveAction);
            movedCount++;
            }
        }
        }, "Flatten Multiple Bins");

        logSuccess(`\nSuccessfully flattened ${movedCount} clip(s) across ${finalBins.length} bin(s)`);
    }

    // Reset progress for cleanup phase (simulated or just simple spinner would be better, but we'll leave it simple)
    const removedCount = await removeEmptyBins(finalBins, project);

    if (removedCount > 0) {
      logSuccess(`\nCleanup complete: Removed ${removedCount} empty bin(s)`);
    }

    log("\n───────────────────────────────────");
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
