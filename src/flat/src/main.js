const ppro = require("premierepro");
const { localFileSystem } = require("uxp").storage;

let cachedMediaFiles = [];
let cachedOfflineFiles = [];

const log = (msg, color) => {
  const body = document.getElementById("plugin-body");
  if (body) {
    body.innerHTML += color
      ? `<span style='color:${color}'>${msg}</span><br />`
      : `${msg}<br />`;
  }
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

async function collectDeepClips(folder, targetBin, currentDepth, clipsToMove) {
  const items = await folder.getItems();

  for (const item of items) {
    if (item.type === 2) {
      const subFolder = ppro.FolderItem.cast(item);
      if (subFolder) {
        if (currentDepth >= 2) {
          logInfo(`Searching deep bin (level ${currentDepth + 1}): ${item.name}`);
        }
        await collectDeepClips(subFolder, targetBin, currentDepth + 1, clipsToMove);
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

async function run() {
  try {
    clearLog();
    log("Starting folder flatten operation...");

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

    logSuccess(`Processing ${selectedBins.length} selected bin(s)...`);
    log("───────────────────────────────────");

    const allClipsToMove = [];
    let totalClipsFound = 0;

    for (const binData of selectedBins) {
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

    log("\n───────────────────────────────────");

    if (allClipsToMove.length === 0) {
      logSuccess("No clips found in folders deeper than 2 levels. All structures are already flat enough.");
      return;
    }

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

    logSuccess(`\nSuccessfully flattened ${movedCount} clip(s) across ${selectedBins.length} bin(s)`);
  } catch (error) {
    logError(`Error: ${error.message}`);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const scanBtn = document.querySelector("#scan-btn");
  const clearBtn = document.querySelector("#clear-btn");

  if (scanBtn) {
    scanBtn.addEventListener("click", run);
  }
  if (clearBtn) {
    clearBtn.addEventListener("click", clearLog);
  }
  log("\n");
});
