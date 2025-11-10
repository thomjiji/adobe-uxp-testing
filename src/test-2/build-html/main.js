"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
// @ts-ignore - UXP uses require for module loading
const ppro = require("premierepro");
// @ts-ignore - UXP uses require for module loading
const fs = require("uxp").storage.localFileSystem;
// ============================================================================
// HELPER FUNCTIONS - Logging and Display
// ============================================================================
const log = (msg, color) => {
    const body = document.getElementById("plugin-body");
    if (body) {
        body.innerHTML += color ? `<span style='color:${color}'>${msg}</span><br />` : `${msg}<br />`;
    }
};
const clearLog = () => {
    const body = document.getElementById("plugin-body");
    if (body) {
        body.innerHTML = "";
    }
};
const logSection = (title) => {
    log(`<br/><strong>=== ${title} ===</strong>`, "#00a8ff");
};
const logSuccess = (msg) => log(`- ${msg}`, "#00ff00");
const logError = (msg) => log(`- ${msg}`, "#ff0000");
const logWarning = (msg) => log(`- ${msg}`, "#ffaa00");
const logInfo = (msg) => log(`- ${msg}`, "#aaaaaa");
// ============================================================================
// HELPER FUNCTIONS - Common UXP API Operations
// ============================================================================
/**
 * Get the active project, with error handling
 */
async function getActiveProjectSafe() {
    try {
        const project = await ppro.Project.getActiveProject();
        if (!project) {
            logError("No active project found");
            return null;
        }
        return project;
    }
    catch (error) {
        logError(`Error getting active project: ${error}`);
        return null;
    }
}
/**
 * Get the active sequence, with error handling
 */
async function getActiveSequenceSafe() {
    try {
        const project = await getActiveProjectSafe();
        if (!project)
            return null;
        const sequence = await project.getActiveSequence();
        if (!sequence) {
            logError("No active sequence found");
            return null;
        }
        return sequence;
    }
    catch (error) {
        logError(`Error getting active sequence: ${error}`);
        return null;
    }
}
/**
 * Format TickTime as a readable string
 */
async function formatTickTime(tickTime) {
    try {
        const seconds = tickTime.seconds;
        const ticks = tickTime.ticks;
        return `${seconds.toFixed(2)}s (${ticks} ticks)`;
    }
    catch (error) {
        return `[Error formatting time: ${error}]`;
    }
}
// ============================================================================
// TEST FUNCTIONS - Add your API tests here
// ============================================================================
/**
 * Test: Get Project Information
 */
async function testProjectInfo() {
    logSection("Project Information");
    const project = await getActiveProjectSafe();
    if (!project)
        return;
    try {
        log(`Project Name: ${project.name}`);
        // Get root item
        const rootItem = await project.getRootItem();
        log(`Root Item Type: ${typeof rootItem}`);
        logSuccess("Project info retrieved successfully");
    }
    catch (error) {
        logError(`Error in testProjectInfo: ${error}`);
    }
}
/**
 * Test: Get Sequence Information
 */
async function testSequenceInfo() {
    logSection("Sequence Information");
    const sequence = await getActiveSequenceSafe();
    if (!sequence)
        return;
    try {
        log(`Sequence Name: ${sequence.name}`);
        // Get track counts
        const videoTrackCount = await sequence.getVideoTrackCount();
        const audioTrackCount = await sequence.getAudioTrackCount();
        log(`Video Tracks: ${videoTrackCount}`);
        log(`Audio Tracks: ${audioTrackCount}`);
        // Get timecode info
        const inPoint = await sequence.getInPoint();
        const outPoint = await sequence.getOutPoint();
        log(`In Point: ${await formatTickTime(inPoint)}`);
        log(`Out Point: ${await formatTickTime(outPoint)}`);
        logSuccess("Sequence info retrieved successfully");
    }
    catch (error) {
        logError(`Error in testSequenceInfo: ${error}`);
    }
}
/**
 * Test: List Video Track Items
 */
async function testVideoTrackItems() {
    logSection("Video Track Items");
    const sequence = await getActiveSequenceSafe();
    if (!sequence)
        return;
    try {
        const trackCount = await sequence.getVideoTrackCount();
        for (let i = 0; i < trackCount; i++) {
            const track = await sequence.getVideoTrack(i);
            const trackName = track.name;
            log(`<br/>Track ${i}: ${trackName}`);
            const trackItems = track.getTrackItems(ppro.VideoClipTrackItem.TRACKITEMTYPE_CLIP, false);
            log(`  Clips: ${trackItems.length}`);
            for (let j = 0; j < Math.min(trackItems.length, 5); j++) {
                const item = trackItems[j];
                const name = await item.getName();
                const start = await item.getStartTime();
                const end = await item.getEndTime();
                log(`  ${j + 1}. ${name} [${await formatTickTime(start)} - ${await formatTickTime(end)}]`);
            }
            if (trackItems.length > 5) {
                log(`  ... and ${trackItems.length - 5} more clips`);
            }
        }
        logSuccess("Video track items listed successfully");
    }
    catch (error) {
        logError(`Error in testVideoTrackItems: ${error}`);
    }
}
/**
 * Test: TickTime Operations
 */
async function testTickTime() {
    logSection("TickTime Operations");
    try {
        // Create TickTime from seconds
        const time1 = ppro.TickTime.createWithSeconds(5.5);
        log(`Time from 5.5 seconds: ${await formatTickTime(time1)}`);
        // Create TickTime from frame number
        const frameRate = ppro.FrameRate.createWithValue(24);
        const time2 = ppro.TickTime.createWithFrameAndFrameRate(120, frameRate);
        log(`Time from frame 120 @ 24fps: ${await formatTickTime(time2)}`);
        logSuccess("TickTime operations completed");
    }
    catch (error) {
        logError(`Error in testTickTime: ${error}`);
    }
}
// ============================================================================
// YOUR CUSTOM TEST CODE - Write your experiments here!
// ============================================================================
/**
 * Custom Test Function
 *
 * This is where you can write your own test code to experiment with the UXP API.
 * Feel free to modify this function or create new ones.
 *
 * Available globals:
 * - ppro: The Premiere Pro API object (fully typed)
 * - fs: File system access (from uxp.storage.localFileSystem)
 *
 * Helper functions available:
 * - log(msg, color?): Log a message
 * - logSection(title): Log a section header
 * - logSuccess/logError/logWarning/logInfo(msg): Log with colors
 * - clearLog(): Clear the output
 * - getActiveProjectSafe(): Get project with error handling
 * - getActiveSequenceSafe(): Get sequence with error handling
 * - formatTickTime(tickTime): Format TickTime as readable string
 *
 * Example usage:
 * ```typescript
 * const project = await getActiveProjectSafe();
 * if (!project) return;
 *
 * const sequence = await project.getActiveSequence();
 * log(`Working with sequence: ${sequence.name}`);
 * ```
 */
async function customTestSequenceInfo() {
    logSection("Custom Test");
    try {
        // Example: Get project and sequence
        const project = await getActiveProjectSafe();
        if (!project)
            return;
        const sequence = await project.getActiveSequence();
        if (!sequence) {
            logWarning("No active sequence to test with");
            return;
        }
        log(`Active project: ${project.name}`);
        log(`Active sequence: ${sequence.name}`);
        // Add your experiments below:
        // ===============================
        const settings = await sequence.getSettings();
        const res = await settings.getVideoFrameRect();
        log(`Sequence resolution: ${res.width}x${res.height}`);
        const playerPos = await sequence.getPlayerPosition();
        log(`Current player position ticks: ${playerPos.ticks}`);
        log(`Current player position ticks number: ${playerPos.ticks}`);
        log(`Current player position seconds: ${playerPos.seconds}`);
        logSuccess("Custom test completed");
    }
    catch (error) {
        logError(`Error in customTest: ${error}`);
        console.error(error);
    }
}
async function customTest() {
    log("=== Custom Test ===");
    const project = await getActiveProjectSafe();
    if (!project)
        return;
    try {
        // Get root item (which is a FolderItem)
        const rootItem = await project.getRootItem();
        log(`Root Item Name: ${rootItem.name}`);
        // Get all items in the root bin
        const items = await rootItem.getItems();
        log(`Total items in root: ${items.length}`);
        log("");
        let clipCount = 0;
        // Iterate through each item
        for (const item of items) {
            // Check if this is a bin/folder (type === 2)
            if (item.type === 2) {
                log(`[BIN] ${item.name}`);
            }
            else {
                // It's a clip or sequence - cast to ClipProjectItem to access methods
                const clipItem = ppro.ClipProjectItem.cast(item);
                // Check if it's a sequence
                const isSeq = await clipItem.isSequence();
                if (isSeq) {
                    continue;
                }
                else {
                    // It's a regular clip
                    clipCount++;
                    // const changedSuccess = await clipItem.changeMediaFilePath("/Users/geekshootjack/Downloads/250712_zbcjl_20117.MP4")
                    const changedSuccess = await clipItem.changeMediaFilePath("/Users/geekshootjack/git/adobe-uxp-testing/media/footage/250712_zbcjl_20117.MP4");
                    log(`Changed filepath of ${clipItem.name} to ${changedSuccess}`);
                }
            }
            log("");
        }
        log(`Found ${clipCount} clip(s) in root bin`);
    }
    catch (error) {
        log(`ERROR in customTest: ${error}`);
    }
}
/**
 * Normalize path separators - convert Windows backslashes to forward slashes
 * @param path - Path to normalize
 * @returns path with forward slashes
 */
function normalizePath(path) {
    return path.replace(/\\/g, "/");
}
/**
 * Relink media files in the "source" bin by replacing the base path
 * Handles both Windows (D:\path\) and Unix (/Volumes/path/) paths
 * @param oldBasePath - The old base path to replace (e.g., "D:\\Project\\Source\\" or "/Volumes/OldDrive/Project/Source")
 * @param newBasePath - The new base path to use (e.g., "/Volumes/NewDrive/Project/Source")
 * @returns Object with success count and error messages
 */
async function relinkSourceBinMedia(oldBasePath, newBasePath) {
    const project = await getActiveProjectSafe();
    if (!project)
        return { success: 0, failed: 0, errors: [] };
    const results = {
        success: 0,
        failed: 0,
        errors: [],
    };
    try {
        // Normalize both paths to use forward slashes for comparison
        const normalizedOldBase = normalizePath(oldBasePath);
        const normalizedNewBase = normalizePath(newBasePath);
        log(`Old base path (normalized): ${normalizedOldBase}`);
        log(`New base path (normalized): ${normalizedNewBase}`);
        log("");
        // Get root item
        const rootItem = await project.getRootItem();
        const items = await rootItem.getItems();
        // Find the "source" bin (case-insensitive)
        let sourceBin = null;
        log(`Total items in root: ${items.length}`);
        for (const item of items) {
            log(`  Item: "${item.name}", Type: ${item.type}`);
            // TYPE_BIN constant is undefined, but bins have type === 2
            if (item.type === 2 && item.name.toLowerCase() === "source") {
                sourceBin = ppro.FolderItem.cast(item);
                log(`  -> Found source bin!`);
                break;
            }
        }
        log("");
        if (!sourceBin) {
            log('ERROR: Could not find "source" bin in project root');
            return results;
        }
        log(`Found source bin: ${sourceBin.name}`);
        log("");
        // Recursive function to process all items in a folder
        async function processFolder(folder) {
            const folderItems = await folder.getItems();
            for (const item of folderItems) {
                if (item.type === 2) {
                    // TYPE_BIN constant is undefined, bins have type === 2
                    // Recursively process sub-bins
                    const subFolder = ppro.FolderItem.cast(item);
                    await processFolder(subFolder);
                }
                else {
                    // It's a clip or sequence
                    const clipItem = ppro.ClipProjectItem.cast(item);
                    const isSeq = await clipItem.isSequence();
                    if (!isSeq) {
                        // It's a regular clip - relink it
                        try {
                            const oldPath = await clipItem.getMediaFilePath();
                            const normalizedOldPath = normalizePath(oldPath);
                            // Replace the old base path with new base path
                            if (normalizedOldPath.startsWith(normalizedOldBase)) {
                                const relativePath = normalizedOldPath.substring(normalizedOldBase.length);
                                const newPath = normalizedNewBase + relativePath;
                                log(`Relinking: ${item.name}`);
                                log(`  Old: ${oldPath}`);
                                log(`  New: ${newPath}`);
                                const success = await clipItem.changeMediaFilePath(newPath, false);
                                if (success) {
                                    results.success++;
                                    log(`  Result: SUCCESS`);
                                }
                                else {
                                    results.failed++;
                                    results.errors.push(`${item.name}: changeMediaFilePath returned false`);
                                    log(`  Result: FAILED`);
                                }
                            }
                            else {
                                log(`Skipping ${item.name}: path does not start with old base path`);
                                log(`  Current path: ${oldPath}`);
                                log(`  Normalized: ${normalizedOldPath}`);
                                log(`  Expected to start with: ${normalizedOldBase}`);
                            }
                            log("");
                        }
                        catch (error) {
                            results.failed++;
                            results.errors.push(`${item.name}: ${error}`);
                            log(`ERROR processing ${item.name}: ${error}`);
                        }
                    }
                }
            }
        }
        // Start processing from the source bin
        await processFolder(sourceBin);
        log(`Relink completed: ${results.success} success, ${results.failed} failed`);
    }
    catch (error) {
        log(`ERROR in relinkSourceBinMedia: ${error}`);
        results.errors.push(`Fatal error: ${error}`);
    }
    return results;
}
// ============================================================================
// MAIN TEST RUNNER
// ============================================================================
/**
 * Run all tests
 */
async function runAllTests() {
    clearLog();
    log("<strong>UXP API Test Runner</strong>", "#00a8ff");
    log("Running all tests...<br/>");
    try {
        await testTickTime();
        await testProjectInfo();
        await testSequenceInfo();
        await testVideoTrackItems();
        await customTest();
        logSection("All Tests Complete");
        logSuccess("Test suite finished!");
    }
    catch (error) {
        logError(`Fatal error in test runner: ${error}`);
        console.error(error);
    }
}
/**
 * Run only the custom test
 */
async function runCustomTest() {
    clearLog();
    log("<strong>Running Custom Test</strong>", "#00a8ff");
    await relinkSourceBinMedia("D:\\25076-木马乐队×白敬亭「Feifei Run」LIVE版MV\\素材\\", "/Volumes/GSJ#554/25076-木马乐队×白敬亭「Feifei Run」LIVE版MV/素材/");
}
// ============================================================================
// EVENT LISTENERS - UI Button Handlers
// ============================================================================
document.addEventListener("DOMContentLoaded", () => {
    const runAllBtn = document.querySelector("#run-all-btn");
    const runCustomBtn = document.querySelector("#run-custom-btn");
    const clearBtn = document.querySelector("#clear-btn");
    if (runAllBtn) {
        runAllBtn.addEventListener("click", runAllTests);
    }
    if (runCustomBtn) {
        runCustomBtn.addEventListener("click", runCustomTest);
    }
    if (clearBtn) {
        clearBtn.addEventListener("click", clearLog);
    }
    log("\n");
    log("Test environment ready. Click 'Run All Tests' to begin.", "#00ff00");
});
