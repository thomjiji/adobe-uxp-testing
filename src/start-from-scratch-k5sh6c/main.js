/*************************************************************************
 * ADOBE CONFIDENTIAL
 * ___________________
 *
 * Copyright 2024 Adobe
 * All Rights Reserved.
 *
 * NOTICE: Adobe permits you to use, modify, and distribute this file in
 * accordance with the terms of the Adobe license agreement accompanying
 * it. If you have received this file from a source other than Adobe,
 * then your use, modification, or distribution of it requires the prior
 * written permission of Adobe.
 **************************************************************************/

//global objects.
const ppro = require("premierepro");

const log = (msg, color) =>
(document.getElementById("plugin-body").innerHTML += color
  ? `<span style='color:${color}'>${msg}</span><br />`
  : `${msg}<br />`);

const clearLog = (msg, color) =>
  (document.getElementById("plugin-body").innerHTML = "");

async function main() {
  clearLog();

  try {
    const project = await ppro.Project.getActiveProject();
    const rootItem = await project.getRootItem();

    if (!rootItem) {
      log("No root item returned.", "red");
      return;
    }

    const items = await rootItem.getItems(); // ✅ 这是正确的获取方式

    if (!items || items.length === 0) {
      log("Root item has no items.", "orange");
      return;
    }

    log(`Root item contains ${items.length} item(s):`, "green");

    for (const item of items) {
      const name = await item.name;
      const type = await item.type; // 如果有 .type，或用 typeof 检查
      const mediaPath = item.getMediaPath ? await item.getMediaPath() : null;

      log(`• ${name} ${mediaPath ? `— ${mediaPath}` : ""}`, "blue");
    }

  } catch (err) {
    log(`Error: ${err.message || err}`, "red");
  }
}


document
  .querySelector("#btnPopulate")
  .addEventListener("click", main);

document.querySelector("#clear-btn").addEventListener("click", clearLog);
