# Flatten Folder Structure Plugin

This plugin helps organize your Premiere Pro project by flattening deep folder structures and cleaning up unwanted files.

What it does:
It looks into the bins you have selected and searches for clips buried deep within the folder structure (configurable depth, default is more than 2 levels). It moves these clips directly to the top level of the bin you selected. It also automatically removes any folders that become empty during the process.

Main Features:
1. Flatten Selected Bins: Moves deep clips and removes empty folders.
2. Flatten & Remove: Moves deep clips, removes empty folders, and also deletes unwanted files (configurable extensions, default: .jpg, .jpeg, .txt).

How it works:
1. Select one or more bins in your Project Panel.
2. Click one of the action buttons.
3. The plugin counts all items to show real-time progress.
4. It scans subfolders recursively and plans all actions.
5. All changes (moving clips and removing files/folders) are performed in a single step.

Why use it:
It is useful for quickly organizing projects with many nested folders. Since all actions are grouped together, you can undo the entire operation with a single Undo command in Premiere Pro.

The plugin interface is responsive and provides estimated time remaining during large scans.