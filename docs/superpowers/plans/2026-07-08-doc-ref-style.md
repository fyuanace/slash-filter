# Doc Ref Style Implementation Plan

> **Status:** Implemented through v1.8.2  
> **Spec:** `docs/superpowers/specs/2026-07-08-doc-ref-style-design.md`  
> **Changelog:** `docs/superpowers/specs/2026-07-08-doc-ref-style-changelog.md`

**Goal:** Add a fhelper General-tab switch that styles document-block refs (underline + icon), marks missing targets with strikethrough, syncs icon/delete/restore, and treats styled refs as atomic.

**Architecture:** Per-document cache buckets; batch SQL classify `data-id` targets; CSS `::before` icons; MutationObserver + `ws-main` for narrow invalidation. Never use ref `subtype=d` as “is document”.

**Tech Stack:** SiYuan plugin JS (`fetchPost`/`fetchSyncPost`), `getAllEditor`, eventBus, Dialog settings UI in `index.js`.

---

### Task 1: Config + i18n + settings switch

**Files:** `index.js`, `i18n/zh_CN.json`, `i18n/en_US.json`, `plugin.json`

- [x] Add `docRefStyle: { enabled: false }` to defaults / applyConfig / save sync
- [x] General tab switch + section
- [x] Bump version to `1.8.0`

### Task 2: Query + cache + CSS + decorate DOM

**Files:** `index.js`

- [x] Batch `SELECT id, type, ial FROM blocks WHERE id IN (...)`
- [x] Parse icon from IAL; emoji / custom / default 📄
- [x] Classes: doc styled vs broken; `contenteditable=false`
- [x] Icons via CSS `::before` + `data-fhelper-icon` (no DOM icon nodes)
- [x] Clear/undecorate helpers

### Task 3: Wire lifecycle, observer, ws-main

**Files:** `index.js`

- [x] On enable: CSS + scan open editors + observers
- [x] `loaded-protyle-static` / `dynamic` / `switch-protyle` / `destroy-protyle`
- [x] Observer for new refs + short retry
- [x] `ws-main`: icon / delete / restore / `createdoc` → invalidate + refresh matching refs

### Task 4: v1.8.0 polish

- [x] Global cache + switch cache-only reapply (superseded in v1.8.1)
- [x] No optimistic pending; not found = broken
- [x] Short retry for new refs

### Task 5: v1.8.1 per-document cache refactor

- [x] `docRefByDoc` per `rootId`; clear on `destroy-protyle`
- [x] `docRefDirtyDocs` for background changes
- [x] `switch-protyle`: cache hit → zero SQL; miss/dirty → rebuild
- [x] `handleCreatedocSignal` + 150ms debounced rebuild
- [x] `decorateDynamicRefs` for lazy-loaded regions only
- [x] Retry delays `[100, 300, 800, 1500]` ms
- [x] Bump version to `1.8.1`

### Task 6: v1.8.2 editing resilience

- [x] `handleNewBlockRefs`: do not clear cache for existing `data-id`
- [x] `scheduleRestoreDocRefDecorations` (50ms debounce) after DOM mutations
- [x] Reapply on `class` attribute changes inside block-ref
- [x] Bump version to `1.8.2`

### Task 7: Documentation

- [x] Update design spec to final architecture
- [x] Add changelog / feature summary
- [x] Update this plan

### Task 8: Manual verify (recommended)

- [ ] Document ref / paragraph ref / delete / restore / icon change
- [ ] Atomic delete (Backspace on styled ref)
- [ ] Toggle off restores native appearance
- [ ] Tab switch / close-reopen without flash
- [ ] `/新建子文档并引用`
- [ ] Enter near block ref — style persists, no icon duplication
- [ ] Large doc with few refs — acceptable switch/edit performance
