# Premiere Pro UXP Casting Cheat Sheet

## Core Hierarchy
- ProjectItem (Base)
  - FolderItem (`type === 2`): Bins/Folders.
  - ClipProjectItem (`type === 1`): Clips and Sequences.
    - If `isSequence()`, use `getSequence()` to get the Sequence object.

## Essential Flow

Simplified version:
```mermaid
project.getRootItem() → FolderItem
  └─ getItems() → ProjectItem[]
      ├─ type 2: FolderItem.cast(item) → getItems() (Recurse)
      └─ type 1: ClipProjectItem.cast(item)
          ├─ isSequence() → Sequence object (Timeline, Tracks)
          └─ isClip → getMediaFilePath(), changeMediaFilePath()
```

Complete version:
``` mermaid
PROJECT
  │
  ├─> getRootItem() → FolderItem
  │                      │
  │                      └─> getItems() → ProjectItem[]
  │                                          │
  │                                          ├─> Check item.type
  │                                          │
  │                                          ├─> if type === 2 (TYPE_BIN)
  │                                          │   └─> FolderItem.cast(item)
  │                                          │       └─> getItems() (recurse)
  │                                          │
  │                                          └─> if type !== 2 (TYPE_CLIP, etc)
  │                                              └─> ClipProjectItem.cast(item)
  │                                                  │
  │                                                  ├─> isSequence()
  │                                                  │   └─> true: getSequence() → Sequence
  │                                                  │                              │
  │                                                  │                              ├─> getVideoTrack() → VideoTrack
  │                                                  │                              │   └─> getTrackItems() → VideoClipTrackItem[]
  │                                                  │                              │
  │                                                  │                              └─> getAudioTrack() → AudioTrack
  │                                                  │                                  └─> getTrackItems() → AudioClipTrackItem[]
  │                                                  │
  │                                                  └─> false: it's a clip
  │                                                      ├─> getMediaFilePath()
  │                                                      ├─> changeMediaFilePath()
  │                                                      ├─> isOffline()
  │                                                      └─> etc.
  │
  └─> For any object: UniqueSerializeable.cast(item) → getUniqueID() → Guid
```

## Key Casts
| From          | To                    | Method                                | Purpose                           |
|:--------------|:----------------------|:--------------------------------------|:----------------------------------|
| `ProjectItem` | `FolderItem`          | `ppro.FolderItem.cast(item)`          | Access bin children (`getItems`)  |
| `ProjectItem` | `ClipProjectItem`     | `ppro.ClipProjectItem.cast(item)`     | Access media paths / sequences    |
| `Any`         | `UniqueSerializeable` | `ppro.UniqueSerializeable.cast(item)` | Get unique ID via `getUniqueID()` |
| `Specific`    | `ProjectItem`         | `ppro.ProjectItem.cast(item)`         | Reverse cast to base type         |

## Practical Pattern
```js
const items = await (await project.getRootItem()).getItems();

for (const item of items) {
  if (item.type === 2) {
    const folder = ppro.FolderItem.cast(item);
    // it's a bin
  } else {
    const clip = ppro.ClipProjectItem.cast(item);
    if (await clip.isSequence()) {
      const seq = await clip.getSequence();
      // it's a sequence
    } else {
      const path = await clip.getMediaFilePath();
      // it's a clip
    }
  }
}
```

## Shortcuts
- Type 1: Clip / Sequence
- Type 2: Bin / Folder
- Type 3: Root Item

- Close Premiere Project: `Ctrl+Shift+W` (C-S-W)
