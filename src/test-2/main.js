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
async function getActiveSequenceSafe() {
    try {
        const project = await getActiveProjectSafe();
        if (!project) return null;
        const sequence = await project.getActiveSequence();
        if (!sequence) {
            logError("No active sequence found");
            return null;
        }
        return sequence;
    } catch (error) {
        logError(`Error getting active sequence: ${error}`);
        return null;
    }
}

async function processFolder(folder, mediaFiles) {
    const folderItems = await folder.getItems();
    for (const item of folderItems) {
        if (item.type === 2) {
            const subFolder = ppro.FolderItem.cast(item);
            await processFolder(subFolder, mediaFiles);
        } else {
            const clipItem = ppro.ClipProjectItem.cast(item);
            if (clipItem) {
                const isSeq = await clipItem.isSequence();

                if (!isSeq) {
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
        }
    }
}

async function scanProjectMediaFiles() {
    try {
        clearLog();
        log("Scanning Premiere project for media files...");

        const project = await getActiveProjectSafe();
        if (!project) {
            return null;
        }

        const rootItem = await project.getRootItem();
        const mediaFiles = [];

        await processFolder(rootItem, mediaFiles);

        logSuccess(`Found ${mediaFiles.length} media files in project`);
        return mediaFiles;
    } catch (error) {
        logError(`Error scanning project: ${error.message}`);
        return null;
    }
}

async function saveMediaFilesToTxt(mediaFiles) {
    try {
        if (!mediaFiles || mediaFiles.length === 0) {
            logWarning("No media files to save");
            return;
        }

        const outputFolder = await fs.getFolder();
        if (!outputFolder) {
            logError("No output folder selected");
            return;
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
        const fileName = `project-media-${timestamp}.txt`;
        const outputFile = await outputFolder.createFile(fileName, { overwrite: true });

        const content = mediaFiles.map(item => `${item.name}\t${item.path}`).join('\n');
        await outputFile.write(content);

        logSuccess(`Saved ${mediaFiles.length} file paths to: ${outputFile.nativePath}`);
    } catch (error) {
        logError(`Error saving file: ${error.message}`);
    }
}

async function run() {
    const mediaFiles = await scanProjectMediaFiles();
    if (mediaFiles && mediaFiles.length > 0) {
        await saveMediaFilesToTxt(mediaFiles);
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
