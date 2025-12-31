# Scratch Plugin

This is a template/scratchpad plugin for Adobe Premiere Pro UXP development.

What it does:
It serves as a minimal, clean starting point for developing new plugins or testing code snippets. It comes pre-configured with the basic structure, styling, and API connections needed to run code in Premiere Pro.

Main Features:
1. Basic UI: A simple interface with a main content area and a footer with "Run" and "Clear" buttons.
2. Logging System: Built-in `log`, `logSuccess`, `logError` functions that output directly to the plugin window.
3. Event Listeners: Pre-wired buttons for executing your test code (`run` function) and clearing the log.
4. Error Handling: Basic try/catch blocks and safe project acquisition logic are already in place.

How it works:
1. Edit `src/main.js`: Write your experimental code inside the `run()` function.
2. Click "Run": The plugin executes your code and displays the output.
3. Use this as a base: Copy this folder to start a new project (just like `relink` or `flat`) without setting up the boilerplate from scratch.

Why use it:
To quickly test API calls, verify logic, or prototype a new feature without affecting your production plugins.
