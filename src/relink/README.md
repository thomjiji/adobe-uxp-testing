# Relink Media Plugin

This plugin provides a non-blocking, asynchronous way to relink media in your Premiere Pro project.

What it does:
It allows you to select a search folder on your computer. It quickly indexes all media files in that folder and matches them against clips in your project by filename. When a match is found, it automatically updates the clip's media path.

Main Features:
1. Non-blocking UI: Unlike Premiere's native relinking, this plugin stays responsive. You can continue working in Premiere while the relinking process runs in the background.
2. Fast Indexing: Builds a local index of your files for instant matching.
3. System Filter: Automatically ignores system folders (like .git, node_modules) and non-media files to avoid errors and speed up the process.
4. Smart Progress: Shows real-time progress for both file indexing and the relinking phase.

How it works:
1. Click "Select Search Folder" to pick the directory containing your media.
2. Once a folder is selected, click "Start Relink".
3. The plugin will first scan your hard drive to find all available media files.
4. It then iterates through your project bins and matches clips to the found files by name.
5. If a path change is needed, it updates the clip automatically.

Why use it:
It is perfect for large projects where Premiere's native relink dialog might freeze the application for a long time. It provides a smooth, "background" relinking experience.