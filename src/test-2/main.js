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

async function run() {
    const project = await getActiveProjectSafe()
    const sequnce = await project.getActiveSequence()
    const projectItemsSelected = await ppro.ProjectUtils.getSelection(project)
    const items = await projectItemsSelected.getItems()
    if (projectItemsSelected && ppro.ClipProjectItem.cast(items[0])) {
        log(`You select: ${items[0].name}`)
    } else {
        log("wops")
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
