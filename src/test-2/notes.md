```js
// Firstly we get the rootItem
const rootItem: FolderItem = await project.getRootItem()
// Then we get a array
const items: ProjectItem[] = await rootItem.getItems()

for (const item of items) {}

// ProjectItem (base type) => can be casted to
// 1. ClipProjectItem: ClipProjectItemStatic.cast(projectItem: ProjectItem)
//   1. clips/sequences
// 2. FolderItem: FolderItemStatic.cast(ProjectItem: ProjectItem)
//   1. bins/folders
// ClipProjectItem and FolderItem can also be reverse casted back to ProjectItem
```

```
project.getRootItem()
  → FolderItem (the root bin)
    → getItems()
      → ProjectItem[] (mixed: bins and clips)
        → Check item.type
          → If type === 2: it's a bin (FolderItem)
          → If type !== 2: cast to ClipProjectItem
            → Access clip methods like changeMediaFilePath()
```

ProjectItem (base class)
├── FolderItem (bins/folders)
│   └── getItems(), createBinAction(), etc.
└── ClipProjectItem (clips AND sequences)
    ├── isSequence() → boolean
    ├── getSequence() → Sequence (if it's a sequence)
    ├── changeMediaFilePath() (for clips)
    ├── getMediaFilePath() (for clips)
    └── etc.
    If isSequence() == true:
      └── Sequence (separate object)
          ├── getVideoTrack()
          ├── getPlayerPosition()
          ├── etc.


Complete Adobe UXP Casting Hierarchy

Overview

Adobe's Premiere Pro UXP API uses a casting pattern to navigate between generic and specific object types. Here's the complete hierarchy:

1. ProjectItem Hierarchy

Base Type: ProjectItem

- Properties: name, type, basic methods
- Location: types.d.ts:575-584

Specific Types (Cast From ProjectItem):

A. ClipProjectItem

ppro.ClipProjectItem.cast(projectItem: ProjectItem) → ClipProjectItem
- Purpose: Represents media clips AND sequences in the project bin
- Location: types.d.ts:174
- Key Methods:
  - isSequence() - Check if it's a sequence
  - getSequence() - Get the Sequence object (if it's a sequence)
  - changeMediaFilePath() - Change media file path (for clips)
  - getMediaFilePath() - Get current media path
  - isOffline() - Check if media is offline
  - hasProxy(), attachProxy() - Proxy management
  - getInPoint(), getOutPoint() - In/out points
  - getFootageInterpretation() - Footage settings
- Used in your code: lines 338, 433

B. FolderItem

ppro.FolderItem.cast(projectItem: ProjectItem) → FolderItem
- Purpose: Represents bins/folders in the project panel
- Location: types.d.ts:305
- Key Methods:
  - getItems() - Get child items (returns ProjectItem[])
  - createBinAction() - Create a new bin
  - createSmartBinAction() - Create smart bin
  - createRenameBinAction() - Rename bin
  - createRemoveItemAction() - Remove item from bin
  - createMoveItemAction() - Move item to another bin
- Used in your code: lines 407, 429

C. Reverse Cast: ProjectItem

ppro.ProjectItem.cast(item: FolderItem | ClipProjectItem) → ProjectItem
- Purpose: Cast back to base ProjectItem type
- Location: types.d.ts:566
- Use case: When you need to treat clips and folders uniformly

---
2. UniqueSerializeable Hierarchy

ppro.UniqueSerializeable.cast(
  item: ProjectItem | ClipProjectItem | FolderItem | Sequence
) → UniqueSerializeable
- Purpose: Get unique ID from any serializable object
- Location: types.d.ts:848
- Key Methods:
  - getUniqueID() - Returns a Guid for the object
- Use case: When you need to get/compare unique IDs across different object types

---
3. Related Objects (Not Cast, But Related)

Sequence Object

- Not a cast, but obtained from ClipProjectItem:
const clipItem = ppro.ClipProjectItem.cast(item);
if (await clipItem.isSequence()) {
  const sequence = await clipItem.getSequence();  // Get Sequence object
}
- Key Methods:
  - getVideoTrack(), getAudioTrack() - Get tracks
  - getPlayerPosition(), setPlayerPosition() - Playhead control
  - getInPoint(), getOutPoint() - Sequence in/out
  - getSettings() - Sequence settings
  - getSelection() - Get selected track items

TrackItem Types (No casting needed)

- VideoClipTrackItem - Video clips on timeline
- AudioClipTrackItem - Audio clips on timeline
- Returned directly from track.getTrackItems()

---

Complete Type Flow Diagram

```mermaid
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

---

Practical Casting Pattern

Pattern 1: Iterate Through Project Items

const rootItem = await project.getRootItem();  // FolderItem
const items = await rootItem.getItems();       // ProjectItem[]

for (const item of items) {
  if (item.type === 2) {
    // It's a bin
    const folder = ppro.FolderItem.cast(item);
    const subItems = await folder.getItems();  // Recurse
  } else {
    // It's a clip or sequence
    const clip = ppro.ClipProjectItem.cast(item);
    if (await clip.isSequence()) {
      // Handle sequence
      const seq = await clip.getSequence();
    } else {
      // Handle clip
      const path = await clip.getMediaFilePath();
    }
  }
}

Pattern 2: Get Unique IDs

const item = /* any ProjectItem, Sequence, etc */;
const uniqueObj = ppro.UniqueSerializeable.cast(item);
const guid = uniqueObj.getUniqueID();  // Guid

---

Summary

ClipProjectItem.cast()

- From: ProjectItem
- To: ClipProjectItem
- Purpose: Access clip/sequence methods
- Location: types.d.ts:174

FolderItem.cast()

- From: ProjectItem
- To: FolderItem
- Purpose: Access bin/folder methods
- Location: types.d.ts:305

ProjectItem.cast()

- From: FolderItem | ClipProjectItem
- To: ProjectItem
- Purpose: Cast back to base type
- Location: types.d.ts:566

UniqueSerializeable.cast()

- From: ProjectItem | ClipProjectItem | FolderItem | Sequence
- To: UniqueSerializeable
- Purpose: Get unique ID
- Location: types.d.ts:848

Key Pattern:
1. Get items as generic ProjectItem[]
2. Check item.type to determine what it is
3. Cast to specific type to access specialized methods
4. For clips, use isSequence() to distinguish clips from sequences

```json
scripts: {
        // "deploy": "rsync -aviPh --info=progress --out-format='%i %n%L %C' --delete /home/geekshootjack/git/adobe-uxp-testing/src/test-2/ gsj-data-1@100.98.57.101:/cygdrive/c/Users/GSJ-DATA-1/git/adobe-uxp-testing/src/test-2/",
        // "deploy": "rsync -aviPh --info=progress --out-format='%i %n%L %C' --delete /home/geekshootjack/git/adobe-uxp-testing/src/test-2/ geekshootjack@100.71.185.65:/Users/geekshootjack/git/adobe-uxp-testing/src/test-2/",
}
```
