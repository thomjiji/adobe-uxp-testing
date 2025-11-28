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

async function run() {}

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
