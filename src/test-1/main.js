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
const fs = require("uxp").storage.localFileSystem;

// Store the collected paths globally so we can save them later
let collectedPaths = [];

const log = (msg, color) =>
(document.getElementById("plugin-body").innerHTML += color
  ? `<span style='color:${color}'>${msg}</span><br />`
  : `${msg}<br />`);

const clearLog = (msg, color) =>
  (document.getElementById("plugin-body").innerHTML = "");

// Helper function to recursively collect all movie file paths from project items
async function collectMovieFilePaths(projectItem, filePaths = []) {
  try {
    // Try to cast as ClipProjectItem to check if it's a media item
    const clipItem = ppro.ClipProjectItem.cast(projectItem);

    if (clipItem) {
      // Check if it's not a sequence and not offline
      const isSequence = await clipItem.isSequence();
      const isOffline = await clipItem.isOffline();

      if (!isSequence) {
        // Get the media file path
        const mediaPath = await clipItem.getMediaFilePath();
        if (mediaPath && mediaPath.trim() !== "") {
          filePaths.push(mediaPath);
        }
      }
    }

    // Try to cast as FolderItem to check if it's a bin/folder
    const folderItem = ppro.FolderItem.cast(projectItem);

    if (folderItem) {
      // Recursively process items in this folder
      const items = await folderItem.getItems();
      for (const item of items) {
        await collectMovieFilePaths(item, filePaths);
      }
    }
  } catch (error) {
    // Silently skip items that can't be processed
    log(`Error processing item: ${error.message}`);
  }

  return filePaths;
}

async function main() {
  const project = await ppro.Project.getActiveProject();
  if (!project) {
    log("There is no active project found", "red");
    return;
  }

  log(`Active project: ${project.name}`, "red");
  log("Scanning for movie files...");

  try {
    // Get the root folder item
    const rootItem = await project.getRootItem();

    // Collect all movie file paths
    const moviePaths = await collectMovieFilePaths(rootItem);

    // Debug: log the array to console
    console.log("Collected paths:", moviePaths);
    console.log("Array length:", moviePaths.length);
    moviePaths.forEach((p, i) => console.log(`[${i}]:`, typeof p, p));

    collectedPaths = moviePaths; // Store for later saving

    if (moviePaths.length === 0) {
      log("No movie files found in project", "orange");
    } else {
      log(`Found ${moviePaths.length} movie file(s):`, "green");
      moviePaths.forEach((path, index) => {
        log(`${index + 1}. ${path}`);
      });
      log("Click 'Save to File' to export the list", "blue");
    }
  } catch (error) {
    log(`Error: ${error.message}`, "red");
    log(error);
  }
}

async function saveToFile() {
  if (collectedPaths.length === 0) {
    log("No file paths to save. Run the scan first.", "orange");
    return;
  }

  try {
    log("Opening save dialog...", "blue");

    // Show save dialog
    const file = await fs.getFileForSaving("movie-paths.txt", {
      types: ["txt"]
    });

    if (!file) {
      log("Save cancelled", "orange");
      return;
    }

    log("Writing file...", "blue");

    // Create the content
    const content = collectedPaths.join("\n");

    // Write to file
    await file.write(content);

    log(`Saved ${collectedPaths.length} file paths to: ${file.nativePath}`, "green");
  } catch (error) {
    log(`Error saving file: ${error.message}`, "red");
    console.error(error);
  }
}

document.querySelector("#run").addEventListener("click", main);
document.querySelector("#clear-btn").addEventListener("click", clearLog);
document.querySelector("#save-btn").addEventListener("click", saveToFile);
