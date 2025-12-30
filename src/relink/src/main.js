const ppro = require("premierepro");
const { localFileSystem } = require("uxp").storage;

let searchRootEntry = null;
let fileIndex = new Map(); // Map<fileName, fullPath>
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

// Buffer log messages
let logBuffer = [];
let logFlushTimer = null;

const log = (msg, color) => {
    const logEntry = color
        ? `<span style='color:${color}'>${msg}</span><br />`
        : `${msg}<br />`;

    logBuffer.push(logEntry);

    if (logFlushTimer) clearTimeout(logFlushTimer);
    logFlushTimer = setTimeout(() => {
        const body = document.getElementById("plugin-body");
        if (body && logBuffer.length > 0) {
            body.innerHTML += logBuffer.join("");
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

function yieldToUI() {
    return new Promise((resolve) => setTimeout(resolve, 0));
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
            const remaining = scanProgress.startTime
                ? Math.round(((Date.now() - scanProgress.startTime) / processed) * (total - processed) / 1000)
                : 0;

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
                if (isMediaFile(entry.name)) {
                    fileIndex.set(entry.name, entry.nativePath);
                    scanProgress.processed++;
                    updateProgress(scanProgress.processed, 0, `Indexing: ${entry.name}`, "Indexing Files");
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
    scanProgress.total = 0;
    scanProgress.startTime = Date.now();
    lastYieldTime = Date.now();

    logInfo(`Indexing files in: ${searchRootEntry.nativePath}...`);

    try {
        await indexFolder(searchRootEntry);
        logSuccess(`Indexed ${fileIndex.size} files.`);
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

async function collectProjectExtensions(folder) {
    const items = await folder.getItems();

    for (const item of items) {
        await checkYield();

        if (item.type === 2) {
            const subFolder = ppro.FolderItem.cast(item);
            if (subFolder) {
                await collectProjectExtensions(subFolder);
            }
        } else if (item.type === 1) {
            const clipItem = ppro.ClipProjectItem.cast(item);
            if (clipItem) {
                // Get extension from name
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

async function countProjectItems(folder) {
    let count = 0;
    const items = await folder.getItems();

    for (const item of items) {
        await checkYield();
        count++; // Count every item

        if (item.type === 2) {
            const subFolder = ppro.FolderItem.cast(item);
            if (subFolder) {
                count += await countProjectItems(subFolder);
            }
        }
    }
    return count;
}

async function processProjectItems(folder) {
    const items = await folder.getItems();

    for (const item of items) {
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
                    // ONLY RELINK IF OFFLINE
                    const isOffline = await clipItem.isOffline();
                    if (isOffline) {
                        await tryRelinkClip(clipItem, item.name);
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
        // Can happen if item is special or synthetic
    }

    if (newPath) {
        // Match found in index
        if (currentPath !== newPath) {
            logInfo(`Relinking: ${clipName}`);
            try {
                const result = await clipItem.changeMediaFilePath(newPath);
                if (result) {
                    logSuccess(`  Success: ${clipName}`);
                    relinkedItems.push({
                        name: clipName,
                        oldPath: currentPath,
                        newPath: newPath,
                        status: "Success"
                    });
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
            // Already matches
            relinkedItems.push({
                name: clipName,
                oldPath: currentPath,
                newPath: newPath,
                status: "Skipped (Already Linked)"
            });
        }
    } else {
        // No match found in index
        logWarning(`Not found in search folder: ${clipName}`);
        missingItems.push({
            name: clipName,
            currentPath: currentPath
        });
    }
}

// --------------------------------------------------------
// Export Functionality
// --------------------------------------------------------

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

        if (!file) {
            logInfo("Export cancelled");
            return;
        }

        let content = "Name,Status,Old Path,New Path\n";

        // Add Relinked Items
        content += relinkedItems.map(item =>
            `"${item.name}","${item.status}","${item.oldPath}","${item.newPath}"`
        ).join("\n");

        // Add Missing Items
        content += missingItems.map(item =>
            `"${item.name}","Missing in Search Folder","${item.currentPath}",""`
        ).join("\n");

        await file.write(content);
        logSuccess(`Log saved to: ${file.nativePath}`);

    } catch (e) {
        logError(`Error saving log: ${e.message}`);
    }
}

// --------------------------------------------------------
// Main Execution
// --------------------------------------------------------

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
    isCancelled = false;
    setButtonsState(true);

    try {
        const project = await getActiveProjectSafe();
        if (!project) throw new Error("No active project");
        if (!searchRootEntry) throw new Error("Please select a search folder first.");

        const rootItem = await project.getRootItem();

        // 0. Analyze project for extensions
        logInfo("Analyzing project for media extensions...");
        await collectProjectExtensions(rootItem);
        if (isCancelled) throw new Error("Operation Cancelled");

        // 1. Index Files
        const indexSuccess = await performFileIndexing();
        if (!indexSuccess || isCancelled) throw new Error("Operation Cancelled");

        // 2. Count Project Items
        logInfo("Counting project items...");
        scanProgress.total = await countProjectItems(rootItem);
        if (isCancelled) throw new Error("Operation Cancelled");

        scanProgress.processed = 0;
        scanProgress.startTime = Date.now();
        logInfo(`Found ${scanProgress.total} items in project.`);

        // 3. Process & Relink
        log("Starting relink process...");
        await processProjectItems(rootItem);
        if (isCancelled) throw new Error("Operation Cancelled");

        log("------------------------------------------------");
        logSuccess("Operation Complete!");

        // Summary Logic
        const relinkedCount = relinkedItems.filter(i => i.status === "Success").length;
        const skippedCount = relinkedItems.filter(i => i.status.startsWith("Skipped")).length;
        const missingCount = missingItems.length;

        logInfo(`Summary:`);
        logInfo(`  Relinked: ${relinkedCount}`);
        logInfo(`  Skipped (Online/Already OK): ${skippedCount}`);
p
        if (missingCount > 0) {
            logError(`  Missing / Not Found: ${missingCount}`);
            if (missingCount === (scanProgress.processed - skippedCount - relinkedCount)) {
                // Heuristic: If everything that wasn't skipped is missing
                logError("WARNING: Almost no clips were matched. You may have selected the wrong root folder.");
            }
            logWarning("Tip: Click 'Export Log' to see details of missing files.");
        } else {
            logSuccess("  All clips accounted for!");
        }

    } catch (e) {
        if (e.message === "Operation Cancelled") {
            logWarning("Operation stopped by user.");
        } else {
            logError(e.message);
        }
    } finally {
        setButtonsState(false);
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
