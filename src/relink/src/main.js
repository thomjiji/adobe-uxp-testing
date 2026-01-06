const ppro = require("premierepro");
const { localFileSystem } = require("uxp").storage;

let searchRootEntry = null;
let fileIndex = new Map(); // Map<fileName, fullPath>
let targetFileNames = new Set(); // Set<fileName> of offline clips
let missingItems = []; // Array<{name, currentPath}>
let relinkedItems = []; // Array<{name, oldPath, newPath, status}>
let isCancelled = false; // Flag for cancellation

// Configuration
const IGNORED_FOLDERS = [
    ".git",
    "node_modules",
    ".DS_Store",
    "System Volume Information",
    "$RECYCLE.BIN",
    "_gsdata_",
];
const MEDIA_EXTENSIONS = new Set([
    ".mov", ".mp4", ".m4v", ".mxf", ".avi", ".wav", ".mp3", ".aif", ".aiff", ".aac",
    ".png", ".jpg", ".jpeg", ".tiff", ".tif", ".psd", ".mts", ".crm", ".r3d", ".braw",
    ".arw", ".cr2", ".nef", ".dng", ".exr", ".svg", ".bmp", ".gif", ".mpg"
]);

// Progress tracking
let scanProgress = {
    total: 0,
    processed: 0,
    currentItem: "",
    startTime: null,
};

// Responsiveness control
let lastYieldTime = 0;
let lastProgressUpdate = 0;
const YIELD_MS = 30; // Work for 30ms before yielding
const UPDATE_MS = 100; // Update UI max every 100ms
let successCount = 0; // Track successful relinks for throttling

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

            while (body.childElementCount > MAX_LOG_LINES) {
                body.removeChild(body.firstElementChild);
            }

            logBuffer = [];
            body.scrollTop = body.scrollHeight; // Auto-scroll
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

function yieldToUI(ms = 0) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Check if we should yield to UI based on time
async function checkYield() {
    if (isCancelled) throw new Error("Operation Cancelled");
    const now = Date.now();
    if (now - lastYieldTime > YIELD_MS) {
        await yieldToUI();
        lastYieldTime = Date.now();
    }
}

function updateProgress(processed, total, currentItem, statusPrefix = "Processing") {
    const now = Date.now();
    if (now - lastProgressUpdate < UPDATE_MS && processed < total) return;
    lastProgressUpdate = now;

    const progressEl = document.getElementById("progress-text");
    if (progressEl) {
        if (total > 0) {
            const percent = Math.round((processed / total) * 100);

            let remaining = 0;
            if (processed > 0 && scanProgress.startTime) {
                const elapsed = now - scanProgress.startTime;
                const rate = elapsed / processed;
                remaining = Math.max(0, Math.round((total - processed) * rate / 1000));
            }

            progressEl.innerHTML = `<span style="color: #00ff00;">
                ${statusPrefix}: ${processed}/${total} (${percent}%)<br/>
                <div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;">${currentItem}</div>
                Est. time remaining: ${remaining}s
                </span>`;
        } else {
            progressEl.innerHTML = `<span style="color: #00ff00;">
                ${statusPrefix}: ${processed}<br/>
                <div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;">${currentItem}</div>
                </span>`;
        }
    }
}

function clearProgress() {
    const progressEl = document.getElementById("progress-text");
    if (progressEl) {
        progressEl.innerHTML = "";
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

// --------------------------------------------------------
// File System Indexing
// --------------------------------------------------------

function isMediaFile(name) {
    const lastDotIndex = name.lastIndexOf(".");
    if (lastDotIndex === -1) return false;
    const ext = name.substring(lastDotIndex).toLowerCase();
    return MEDIA_EXTENSIONS.has(ext);
}

async function indexFolder(folderEntry) {
    try {
        const entries = await folderEntry.getEntries();

        for (const entry of entries) {
            await checkYield();

            if (entry.name.startsWith(".") || IGNORED_FOLDERS.includes(entry.name)) {
                continue;
            }

            if (entry.isFolder) {
                await indexFolder(entry).catch((err) => {
                    if (err.message === "Operation Cancelled") throw err;
                    logInfo(`Skipping folder ${entry.name}: ${err.message}`);
                });
            } else if (entry.isFile) {
                if (targetFileNames.has(entry.name)) {
                    if (!fileIndex.has(entry.name)) {
                        scanProgress.processed++;
                    }
                    fileIndex.set(entry.name, entry.nativePath);
                    updateProgress(scanProgress.processed, targetFileNames.size, `Match found: ${entry.name}`, "Indexing");
                }
            }
        }
    } catch (err) {
        throw err;
    }
}

async function performFileIndexing() {
    if (!searchRootEntry) return false;

    fileIndex.clear();
    scanProgress.processed = 0;
    scanProgress.total = targetFileNames.size;
    scanProgress.startTime = Date.now();
    lastYieldTime = Date.now();

    logInfo(`Searching for ${targetFileNames.size} missing files in: ${searchRootEntry.nativePath}...`);

    try {
        await indexFolder(searchRootEntry);
        logSuccess(`Found ${fileIndex.size} matches on disk.`);
        return true;
    } catch (e) {
        if (e.message === "Operation Cancelled") {
            logError("Indexing cancelled by user.");
            return false;
        }
        logError(`Error indexing folder: ${e.message}`);
        return false;
    }
}

// --------------------------------------------------------
// Project Scanning & Relinking
// --------------------------------------------------------

async function analyzeProject(folder) {
    const items = await folder.getItems();

    for (const item of items) {
        await checkYield();

        const id = item.getId();
        if (!countedItemIds.has(id)) {
            countedItemIds.add(id);
            scanProgress.total++; // For Phase 3

            if (item.type === 2) {
                const subFolder = ppro.FolderItem.cast(item);
                if (subFolder) {
                    await analyzeProject(subFolder);
                }
            } else if (item.type === 1) {
                const clipItem = ppro.ClipProjectItem.cast(item);
                if (clipItem) {
                    const isSeq = await clipItem.isSequence();
                    if (!isSeq) {
                        const isOffline = await clipItem.isOffline();
                        if (isOffline) {
                            targetFileNames.add(item.name);
                            const name = item.name;
                            const lastDot = name.lastIndexOf('.');
                            if (lastDot !== -1) {
                                const ext = name.substring(lastDot).toLowerCase();
                                if (ext.length > 1 && ext.length < 10 && !MEDIA_EXTENSIONS.has(ext)) {
                                    MEDIA_EXTENSIONS.add(ext);
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

async function processProjectItems(folder) {
    const items = await folder.getItems();

    for (const item of items) {
        const id = item.getId();
        if (processedItemIds.has(id)) continue;
        processedItemIds.add(id);

        scanProgress.processed++;
        updateProgress(scanProgress.processed, scanProgress.total, item.name, "Relinking");
        await checkYield();

        if (item.type === 2) {
            const subFolder = ppro.FolderItem.cast(item);
            if (subFolder) {
                await processProjectItems(subFolder);
            }
        } else if (item.type === 1) {
            const clipItem = ppro.ClipProjectItem.cast(item);
            if (clipItem) {
                const isSeq = await clipItem.isSequence();
                if (!isSeq) {
                    const isOffline = await clipItem.isOffline();
                    if (isOffline) {
                        await tryRelinkClip(clipItem, item.name);
                        if (successCount > 0 && successCount % 10 === 0) {
                             await yieldToUI(50);
                        }
                    } else {
                        relinkedItems.push({
                            name: item.name,
                            oldPath: "",
                            newPath: "",
                            status: "Skipped (Online)"
                        });
                    }
                }
            }
        }
    }
}

async function tryRelinkClip(clipItem, clipName) {
    const newPath = fileIndex.get(clipName);
    let currentPath = "";

    try {
        currentPath = await clipItem.getMediaFilePath();
    } catch (e) {
    }

    if (newPath) {
        if (currentPath !== newPath) {
            logInfo(`Relinking: ${clipName}`);
            try {
                const result = await clipItem.changeMediaFilePath(newPath);
                if (result) {
                    logSuccess(`  Success: ${clipName}`);
                    successCount++;
                    relinkedItems.push({
                        name: clipName,
                        oldPath: currentPath,
                        newPath: newPath,
                        status: "Success"
                    });
                    await yieldToUI();
                } else {
                    logError(`  Failed to change path: ${clipName}`);
                    relinkedItems.push({
                        name: clipName,
                        oldPath: currentPath,
                        newPath: newPath,
                        status: "Failed (API Error)"
                    });
                }
            } catch (e) {
                logError(`  Error: ${e.message}`);
                relinkedItems.push({
                    name: clipName,
                    oldPath: currentPath,
                    newPath: newPath,
                    status: `Error: ${e.message}`
                });
            }
        } else {
            relinkedItems.push({
                name: clipName,
                oldPath: currentPath,
                newPath: newPath,
                status: "Skipped (Already Linked)"
            });
        }
    } else {
        logWarning(`Not found in search folder: ${clipName}`);
        missingItems.push({
            name: clipName,
            currentPath: currentPath
        });
    }
}

function getFormattedTimestamp() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    return `${year}${month}${day}${hours}${minutes}`;
}

async function exportResults() {
    if (relinkedItems.length === 0 && missingItems.length === 0) {
        logWarning("No results to export. Run a scan first.");
        return;
    }

    try {
        const timestamp = getFormattedTimestamp();
        const defaultFilename = `relink_log_${timestamp}.csv`;

        const file = await localFileSystem.getFileForSaving(defaultFilename, {
            types: ["csv", "txt"],
        });

        if (!file) return;

        let content = "Name,Status,Old Path,New Path\n";
        content += relinkedItems.map(item =>
            `"${item.name}","${item.status}","${item.oldPath}","${item.newPath}"`
        ).join("\n");
        content += "\n" + missingItems.map(item =>
            `"${item.name}","Missing in Search Folder","${item.currentPath}",""`
        ).join("\n");

        await file.write(content);
        logSuccess(`Log saved to: ${file.nativePath}`);
    } catch (e) {
        logError(`Error saving log: ${e.message}`);
    }
}

function setButtonsState(isRunning) {
    const runBtn = document.getElementById("run-btn");
    const stopBtn = document.getElementById("stop-btn");
    const selectFolderBtn = document.getElementById("select-folder-btn");

    if (runBtn) runBtn.disabled = isRunning;
    if (stopBtn) stopBtn.disabled = !isRunning;
    if (selectFolderBtn) selectFolderBtn.disabled = isRunning;
}

function stopOperation() {
    if (!isCancelled) {
        isCancelled = true;
        logWarning("Stopping operation... please wait.");
    }
}

async function selectFolder() {
    try {
        const folders = await localFileSystem.getFolder();
        if (folders) {
            searchRootEntry = folders;
            const pathDisplay = document.getElementById("selected-path-display");
            if (pathDisplay) pathDisplay.textContent = searchRootEntry.nativePath;
            const runBtn = document.getElementById("run-btn");
            if (runBtn) runBtn.removeAttribute("disabled");
            logInfo(`Selected search folder: ${searchRootEntry.nativePath}`);
        }
    } catch (e) {
        logError(`Folder selection failed: ${e}`);
    }
}

async function run() {
    clearLog();
    missingItems = [];
    relinkedItems = [];
    targetFileNames.clear();
    countedItemIds.clear();
    processedItemIds.clear();
    isCancelled = false;
    successCount = 0;
    setButtonsState(true);

    try {
        const project = await getActiveProjectSafe();
        if (!project) throw new Error("No active project");
        if (!searchRootEntry) throw new Error("Please select a search folder first.");

        const rootItem = await project.getRootItem();

        logInfo("Analyzing project for offline clips...");
        scanProgress.total = 0;
        await analyzeProject(rootItem);
        const projectItemCount = scanProgress.total;

        if (isCancelled) throw new Error("Operation Cancelled");

        if (targetFileNames.size === 0) {
            logSuccess("No offline clips found in project. Nothing to relink!");
            return;
        }

        const indexSuccess = await performFileIndexing();
        if (!indexSuccess || isCancelled) throw new Error("Operation Cancelled");

        scanProgress.processed = 0;
        scanProgress.total = projectItemCount;
        scanProgress.startTime = Date.now();
        logInfo(`Processing ${scanProgress.total} items...`);
        

        log("Starting relink process...");
        await processProjectItems(rootItem);
        if (isCancelled) throw new Error("Operation Cancelled");

        log("------------------------------------------------");
        logSuccess("Operation Complete!");

        const relinkedCount = relinkedItems.filter(i => i.status === "Success").length;
        const skippedCount = relinkedItems.filter(i => i.status.startsWith("Skipped")).length;
        const missingCount = missingItems.length;

        logInfo(`Summary:`);
        logInfo(`  Relinked: ${relinkedCount}`);
        logInfo(`  Skipped (Online/Already OK): ${skippedCount}`);

        if (missingCount > 0) {
            logError(`  Missing / Not Found: ${missingCount}`);
            if (missingCount === targetFileNames.size) {
                logError("WARNING: Zero matches found. You may have selected the wrong root folder.");
            }
            logWarning("Tip: Click 'Export Log' to see details of missing files.");
        } else {
            logSuccess("  All offline clips relinked successfully!");
        }

    } catch (e) {
        if (e.message === "Operation Cancelled") {
            logWarning("Operation stopped by user.");
        } else {
            logError(e.message);
        }
    } finally {
        setButtonsState(false);
        targetFileNames.clear();
        fileIndex.clear();
        countedItemIds.clear();
        processedItemIds.clear();
    }
}

document.addEventListener("DOMContentLoaded", () => {
    const runBtn = document.querySelector("#run-btn");
    const stopBtn = document.querySelector("#stop-btn");
    const exportBtn = document.querySelector("#export-btn");
    const clearBtn = document.querySelector("#clear-btn");
    const selectFolderBtn = document.querySelector("#select-folder-btn");

    if (selectFolderBtn) selectFolderBtn.addEventListener("click", selectFolder);
    if (runBtn) runBtn.addEventListener("click", run);
    if (stopBtn) stopBtn.addEventListener("click", stopOperation);
    if (exportBtn) exportBtn.addEventListener("click", exportResults);
    if (clearBtn) clearBtn.addEventListener("click", clearLog);

    log("Please select a folder to search for media.\n");
});
