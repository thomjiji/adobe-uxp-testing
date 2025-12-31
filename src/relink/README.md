# Relink Media Plugin

This plugin provides a non-blocking, asynchronous way to relink media in your Premiere Pro project.

What it does:
It allows you to select a search folder on your computer and automatically matches it against offline clips in your project by filename. Unlike Premiere's native relinking, this plugin stays responsive, allowing you to continue working while it runs in the background.

Main Features:
1. **Non-blocking UI:** The plugin stays responsive. You can move the window, scroll the logs, or even keep editing in Premiere while the relinking process runs.
2. **Smart Project Analysis:** Before scanning your drive, the plugin analyzes your project to learn exactly what file extensions you are using, ensuring it only indexes relevant media files.
3. **Offline-Only Logic:** To save time and prevent accidental changes, the plugin only attempts to relink clips that are currently offline.
4. **Fast Indexing with Filters:** Builds a local index of your files for instant matching while automatically ignoring system folders (like .git, node_modules) and hidden files.
5. **Real-Time Progress:** Shows live updates for both the indexing and relinking phases, including an estimated time remaining.
6. **Stop Functionality:** You can stop the process at any time if you realize you've selected the wrong folder or need to pause.
7. **Detailed Reporting & Export:** After the process, you get a summary of what was relinked, skipped, or not found. You can export a detailed CSV log for further investigation.

How it works:
1. Click **"Select Search Folder"** to pick the directory containing your media.
2. Click **"Start Relink"**.
3. **Step 0:** The plugin analyzes your project to find all media file extensions.
4. **Step 1:** It scans your selected folder and builds a memory index of all matching media files.
5. **Step 2:** It iterates through your project and matches offline clips to the found files by name.
6. **Summary:** Once complete, it reports the results and allows you to export a log if any files are still missing.

Why use it:
It is perfect for large projects where Premiere's native relink dialog might freeze the application. It provides a smooth, background experience for getting your project back online.
