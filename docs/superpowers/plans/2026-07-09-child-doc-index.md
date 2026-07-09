# Child Doc Index Implementation Plan

> **Status:** Implemented (v1.9.0)  
> **Spec:** `docs/superpowers/specs/2026-07-09-child-doc-index-design.md`

**Goal:** Append missing direct child document block refs `((id 'title'))` at parent doc end; global + per-doc entry points; skip existing refs via `refs` table.

---

### Task 1: Core SQL + append

- [x] `queryDirectChildDocs`, `queryExistingRefTargets`, `appendChildDocRef`
- [x] `buildChildDocRefMarkdown` with single-quote escape
- [x] `syncChildDocIndexForDoc` incremental logic

### Task 2: Global batch

- [x] `queryAllDocumentBlocks`, `groupDirectChildDocsByParent`
- [x] `runGlobalChildDocIndex` with progress + cancel

### Task 3: UI + config

- [x] `childDocIndex` in `fhelper-config.json` defaults
- [x] Settings → General → global button + confirm + progress dialog
- [x] `updateProtyleToolbar` + `addCommand` editorCallback
- [x] i18n zh/en, plugin.json v1.9.0

### Task 4: Manual verify

- [ ] A→B→C non-nested refs
- [ ] Skip existing refs on re-run
- [ ] Re-add after manual delete
- [ ] Global progress + cancel
- [ ] docRefStyle decorates new refs when enabled
