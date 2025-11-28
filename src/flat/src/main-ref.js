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

async function collectMediaFiles(folder) {
  const mediaFiles = [];
  const items = await folder.getItems();

  for (const item of items) {
    if (item.type !== 2) {
      // It's a ClipProjectItem (type 1)
      const clipItem = ppro.ClipProjectItem.cast(item);
      if (clipItem) {
        const isSeq = await clipItem.isSequence();
        if (isSeq) {
          logInfo(`Skipping sequence: ${item.name}`);
        } else {
          const path = await clipItem.getMediaFilePath();
          if (path) {
            mediaFiles.push({
              name: item.name,
              path: path,
            });
            logInfo(`Found: ${item.name}`);
          }
        }
      }
    } else {
      // It's a bin (type 2), do recursion
      const subFolder = ppro.FolderItem.cast(item);
      if (subFolder) {
        logInfo(`Entering bin: ${item.name}`);
        const subFiles = await collectMediaFiles(subFolder);
        mediaFiles.push(...subFiles);
      }
    }
  }

  return mediaFiles;
}

async function collectOfflineFiles(folder) {
  const offlineFiles = [];
  const items = await folder.getItems();

  for (const item of items) {
    if (item.type !== 2) {
      // It's a ClipProjectItem (type 1)
      const clipItem = ppro.ClipProjectItem.cast(item);
      if (clipItem) {
        const isSeq = await clipItem.isSequence();
        if (isSeq) {
          logInfo(`Skipping sequence: ${item.name}`);
        } else {
          const offline = await clipItem.isOffline();
          if (offline) {
            const path = await clipItem.getMediaFilePath();
            offlineFiles.push({
              name: item.name,
              path: path,
            });
            logWarning(`OFFLINE: ${item.name}`);
          }
        }
      }
    } else {
      // It's a bin (type 2), do recursion
      const subFolder = ppro.FolderItem.cast(item);
      if (subFolder) {
        logInfo(`Entering bin: ${item.name}`);
        const subFiles = await collectOfflineFiles(subFolder);
        offlineFiles.push(...subFiles);
      }
    }
  }

  return offlineFiles;
}

async function findOfflineFiles() {
  try {
    clearLog();
    log("Scanning for offline clips...");

    const project = await getActiveProjectSafe();
    if (!project) return;

    const rootItem = await project.getRootItem();
    const offlineFiles = await collectOfflineFiles(rootItem);

    cachedOfflineFiles = offlineFiles;

    if (offlineFiles.length === 0) {
      logSuccess("No offline files found! All media is online.");
    } else {
      logError(`Found ${offlineFiles.length} offline files`);
    }

    // Print offline results
    for (const file of offlineFiles) {
      log(`${file.name}: ${file.path}`, "#ff0000");
    }
  } catch (error) {
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
    log("Starting scan...");

    const project = await getActiveProjectSafe();
    if (!project) return;

    const rootItem = await project.getRootItem();
    const mediaFiles = await collectMediaFiles(rootItem);

    cachedMediaFiles = mediaFiles;

    logSuccess(`Found ${mediaFiles.length} media files in project`);

    // Print results
    for (const file of mediaFiles) {
      log(`${file.name}: ${file.path}`);
    }
  } catch (error) {
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
