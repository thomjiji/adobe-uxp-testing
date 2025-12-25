# Flatten Folder Structure Plugin

This plugin helps organize your Premiere Pro project by flattening deep folder structures. 

What it does:
It looks into the bins you have selected. It searches for clips that are buried more than two levels deep inside those bins. It then moves all those clips directly into the main bin you selected.

How it works:
1. Select one or more bins in your Project Panel.
2. Click the Flatten button in the plugin.
3. The plugin counts all items to show you progress.
4. It scans every subfolder recursively.
5. Clips found deep in the structure are moved up to the selected bin.
6. After moving the clips, the plugin searches for and removes any folders that are now empty.

Why use it:
It is useful when you have many nested folders and want to bring all your media to the top level for easier access without manually dragging every clip.

# TODO

1. [x] Keep the progress persistent. Currently once the scaning progress is done, the green progress disappeared.
2. [ ] Add a new button: Flatten and Remove. This button also removes unwanted files like jpeg, jpg, txt.
