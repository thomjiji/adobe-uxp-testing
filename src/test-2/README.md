# UXP API Testing Environment (TypeScript)

This is a TypeScript-based testing environment for experimenting with Adobe UXP Premiere Pro APIs. It provides a structured framework with helper functions to make API testing easy and efficient.

## Setup

1. **Install dependencies:**
   ```bash
   cd src/test-2
   npm install
   ```

2. **Compile TypeScript:**
   ```bash
   npm run build
   ```

   Or, to watch for changes and auto-compile:
   ```bash
   npm run watch
   # Or use the included watch script:
   ./watch.sh
   ```

## Load into Premiere Pro

1. Make sure Premiere Pro is running
2. Open UXP Developer Tools (UDT)
3. Add the plugin by selecting the `manifest.json` file: `src/test-2/manifest.json`
4. Click the ••• button and select "Load"
5. The "UXP API Testing Panel" will appear in Premiere Pro

## How to Use

### Writing Custom Tests

Open `main.ts` and locate the `customTest()` function (around line 225). This is your testing playground. Example:

```typescript
async function customTest() {
  logSection("Custom Test");

  try {
    const project = await getActiveProjectSafe();
    if (!project) return;

    const sequence = await project.getActiveSequence();
    if (!sequence) {
      logWarning("No active sequence to test with");
      return;
    }

    // Your test code here:
    const trackCount = await sequence.getVideoTrackCount();
    log(`Video tracks: ${trackCount}`);

    // Test more APIs...

    logSuccess("Custom test completed");
  } catch (error) {
    logError(`Error: ${error}`);
  }
}
```

### Available Helper Functions

**Logging:**
- `log(msg, color?)` - Log a message with optional color
- `logSection(title)` - Log a section header
- `logSuccess(msg)` - Log success message (green)
- `logError(msg)` - Log error message (red)
- `logWarning(msg)` - Log warning message (orange)
- `logInfo(msg)` - Log info message (gray)
- `clearLog()` - Clear the output panel

**API Helpers:**
- `getActiveProjectSafe()` - Get active project with error handling
- `getActiveSequenceSafe()` - Get active sequence with error handling
- `formatTickTime(tickTime)` - Format TickTime as readable string

**Globals:**
- `ppro` - Fully typed Premiere Pro API object
- `fs` - UXP file system access

### Built-in Test Functions

The environment includes several example tests:
- `testProjectInfo()` - Display project information
- `testSequenceInfo()` - Display sequence details
- `testVideoTrackItems()` - List video track clips
- `testApplicationInfo()` - Show app constants
- `testTickTime()` - Demonstrate TickTime operations

### Buttons in the Panel

- **Run All Tests** - Executes all built-in tests plus your custom test
- **Run Custom Test** - Executes only the `customTest()` function
- **Clear** - Clears the output panel

## Development Workflow

1. Edit `main.ts` and add your test code in the `customTest()` function
2. Save the file (if using watch mode, it will auto-compile)
3. In UDT, click ••• → "Reload" to reload the plugin in Premiere Pro
4. Click "Run Custom Test" in the plugin panel
5. View results in the output panel

## Type Definitions

Full TypeScript definitions for the Premiere Pro UXP API are available in `../types.d.ts`. Your IDE should provide autocomplete for all API methods.

## Example: Testing Markers

```typescript
async function customTest() {
  logSection("Testing Markers");

  const sequence = await getActiveSequenceSafe();
  if (!sequence) return;

  try {
    const markers = await sequence.getMarkers();
    const markerCount = await markers.getCount();
    log(`Marker count: ${markerCount}`);

    for (let i = 0; i < markerCount; i++) {
      const marker = await markers.getMarker(i);
      const name = await marker.getName();
      const time = await marker.getStartTime();
      log(`${i + 1}. ${name} at ${await formatTickTime(time)}`);
    }

    logSuccess("Markers listed successfully");
  } catch (error) {
    logError(`Error: ${error}`);
  }
}
```

## Tips

- Use `console.log()` for debugging (output appears in UDT console)
- Most API calls are async and return Promises - use `await`
- Actions must be executed within `project.executeTransaction()` for undo/redo support
- Check `../types.d.ts` for available API methods and their signatures
- The output panel shows color-coded results for easy reading
