const ppro = require("premierepro");
const fs = require("uxp").storage.localFileSystem;

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

const logSuccess = (msg) => log(`- ${msg}`, "#00ff00");
const logError = (msg) => log(`- ${msg}`, "#ff0000");
const logWarning = (msg) => log(`- ${msg}`, "#ffaa00");
const logInfo = (msg) => log(`- ${msg}`, "#aaaaaa");

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
                            path: path
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

async function run() {
    try {
        clearLog();
        log("Starting test...");

        const project = await getActiveProjectSafe();
        if (!project) return;

        const rootItem = await project.getRootItem();
        const mediaFiles = await collectMediaFiles(rootItem);

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
    const runBtn = document.querySelector("#run-btn");
    const clearBtn = document.querySelector("#clear-btn");
    if (runBtn) {
        runBtn.addEventListener("click", run);
    }
    if (clearBtn) {
        clearBtn.addEventListener("click", clearLog);
    }
    log("\n");
});
