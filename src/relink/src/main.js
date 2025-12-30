const ppro = require("premierepro");
const { localFileSystem } = require("uxp").storage;

let searchRootEntry = null;
let fileIndex = new Map(); // Map<fileName, fullPath>

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
    ".arw", ".cr2", ".nef", ".dng", ".exr", ".svg", ".bmp", ".gif",
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
            const elapsed = scanProgress.startTime ? Date.now() - scanProgress.startTime : 0;
            const rate = processed > 0 ? elapsed / processed : 0;
            const remaining = rate > 0 ? Math.round(((total - processed) * rate) / 1000) : 0;

            progressEl.innerHTML = `<span style="color: #00ff00;">
                ${statusPrefix}: ${processed}/${total} (${percent}%)
                <div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;">${currentItem}</div>
                Est. time remaining: ${remaining}s
                </span>`;
        } else {
            progressEl.innerHTML = `<span style="color: #00ff00;">
                ${statusPrefix}: ${processed}
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
        logError(`Error indexing folder: ${e.message}`);
        return false;
    }
}

// --------------------------------------------------------
// Project Scanning & Relinking
// --------------------------------------------------------

async function countProjectItems(folder) {
    let count = 0;
    const items = await folder.getItems();

    for (const item of items) {
        await checkYield();

        if (item.type === 2) {
            const subFolder = ppro.FolderItem.cast(item);
            if (subFolder) {
                count += await countProjectItems(subFolder);
            }
        } else {
            count++;
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
                    await tryRelinkClip(clipItem, item.name);
                }
            }
        }
    }
}

async function tryRelinkClip(clipItem, clipName) {
    const newPath = fileIndex.get(clipName);

    if (newPath) {
        try {
            const currentPath = await clipItem.getMediaFilePath();
            if (currentPath !== newPath) {
                logInfo(`Relinking: ${clipName}`);
                const result = await clipItem.changeMediaFilePath(newPath);
                if (result) {
                    logSuccess(`  Success: ${clipName}`);
                } else {
                    logError(`  Failed to change path for: ${clipName}`);
                }
            }
        } catch (e) {
            logError(`Error processing ${clipName}: ${e.message}`);
        }
    }
}

// --------------------------------------------------------
// Main Execution
// --------------------------------------------------------

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
    const project = await getActiveProjectSafe();
    if (!project) return;
    if (!searchRootEntry) {
        logError("Please select a search folder first.");
        return;
    }

    const indexSuccess = await performFileIndexing();
    if (!indexSuccess) return;

    logInfo("Counting project items...");
    const rootItem = await project.getRootItem();
    scanProgress.total = await countProjectItems(rootItem);
    scanProgress.processed = 0;
    scanProgress.startTime = Date.now();
    logInfo(`Found ${scanProgress.total} items in project.`);

    log("Starting relink process...");
    await processProjectItems(rootItem);
    logSuccess("Operation Complete!");
}

document.addEventListener("DOMContentLoaded", () => {
    const runBtn = document.querySelector("#run-btn");
    const clearBtn = document.querySelector("#clear-btn");
    const selectFolderBtn = document.querySelector("#select-folder-btn");

    if (selectFolderBtn) selectFolderBtn.addEventListener("click", selectFolder);
    if (runBtn) runBtn.addEventListener("click", run);
    if (clearBtn) clearBtn.addEventListener("click", clearLog);

    log("Please select a folder to search for media.\n");
});