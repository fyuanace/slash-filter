const { Plugin, Dialog, getAllEditor, showMessage, fetchSyncPost } = require("siyuan");

const STORAGE_NAME = "fhelper-config.json";
const LEGACY_STORAGE_NAMES = ["slash-filter-config.json", "slash-filter-config"];
const ZWSP = "\u200b";
const SCREEN_DPI = 96;
const SIYUAN_LOCAL_ZOOM_KEY = "local-zoom";
const IMAGE_CENTER_STYLE_ID = "fhelper-img-center-css";
const SETTING_STYLE_ID = "fhelper-setting-css";
const DOC_REF_STYLE_ID = "fhelper-doc-ref-css";
const DOC_REF_CLASS = "fhelper-doc-ref";
const DOC_REF_BROKEN_CLASS = "fhelper-doc-ref-broken";
const DOC_REF_ICON_CLASS = "fhelper-doc-ref-icon";
const DOC_REF_ATTR_ICON = "data-fhelper-icon";
const DOC_REF_ATTR_ICON_IMG = "data-fhelper-icon-img";
const DOC_REF_DEFAULT_ICON = "📄";
const LOG_PREFIX = "[fhelper]";
const IMAGE_CENTER_CSS = `.p:has(span.img) {
    margin-left: auto;
    margin-right: auto;
}`;
const DOC_REF_CSS = `
.protyle-wysiwyg span[data-type~="block-ref"].${DOC_REF_CLASS},
.protyle-wysiwyg span[data-type~="block-ref"].${DOC_REF_BROKEN_CLASS} {
    text-decoration-skip-ink: none;
}
.protyle-wysiwyg span[data-type~="block-ref"].${DOC_REF_CLASS} {
    text-decoration: underline;
    text-underline-offset: 0.18em;
    cursor: pointer;
}
.protyle-wysiwyg span[data-type~="block-ref"].${DOC_REF_BROKEN_CLASS} {
    text-decoration: line-through;
    opacity: 0.72;
    cursor: pointer;
}
.protyle-wysiwyg span[data-type~="block-ref"].${DOC_REF_CLASS}::before,
.protyle-wysiwyg span[data-type~="block-ref"].${DOC_REF_BROKEN_CLASS}::before {
    content: "${DOC_REF_DEFAULT_ICON}";
    display: inline-block;
    margin-right: 0.25em;
    vertical-align: -0.1em;
    line-height: 1;
    pointer-events: none;
}
.protyle-wysiwyg span[data-type~="block-ref"].${DOC_REF_CLASS}[${DOC_REF_ATTR_ICON}]::before,
.protyle-wysiwyg span[data-type~="block-ref"].${DOC_REF_BROKEN_CLASS}[${DOC_REF_ATTR_ICON}]::before {
    content: attr(${DOC_REF_ATTR_ICON});
}
.protyle-wysiwyg span[data-type~="block-ref"].${DOC_REF_CLASS}[${DOC_REF_ATTR_ICON_IMG}]::before,
.protyle-wysiwyg span[data-type~="block-ref"].${DOC_REF_BROKEN_CLASS}[${DOC_REF_ATTR_ICON_IMG}]::before {
    content: "";
    width: 1em;
    height: 1em;
    background: center / contain no-repeat;
    background-image: var(--fhelper-icon-url);
}
`;
const IMAGE_SCALE_RETRY_DELAYS = [100, 400, 1000, 2500];
const NEW_REF_RETRY_DELAYS = [100, 300, 800, 1500];
const DOC_REF_REBUILD_DEBOUNCE_MS = 150;
const IMAGE_AUTO_WIDTH = "calc(100% - 8px)";

function createDefaultDocRefStyleConfig() {
    return {
        enabled: false,
    };
}

function setImageCenterCssEnabled(enabled) {
    let styleEl = document.getElementById(IMAGE_CENTER_STYLE_ID);
    if (enabled) {
        if (!styleEl) {
            styleEl = document.createElement("style");
            styleEl.id = IMAGE_CENTER_STYLE_ID;
            document.head.appendChild(styleEl);
        }
        styleEl.textContent = IMAGE_CENTER_CSS;
        return;
    }
    styleEl?.remove();
}

function createDefaultImageScaleConfig() {
    return {
        enabled: false,
        center: false,
    };
}

function createDefaultPanguSpacingConfig() {
    return {
        enabled: false,
    };
}

function setDocRefStyleCssEnabled(enabled) {
    let styleEl = document.getElementById(DOC_REF_STYLE_ID);
    if (enabled) {
        if (!styleEl) {
            styleEl = document.createElement("style");
            styleEl.id = DOC_REF_STYLE_ID;
            document.head.appendChild(styleEl);
        }
        styleEl.textContent = DOC_REF_CSS;
        return;
    }
    styleEl?.remove();
}

function parseIalMap(ial) {
    const map = {};
    if (!ial || typeof ial !== "string") {
        return map;
    }
    const re = /([A-Za-z0-9_\-]+)="([^"]*)"/g;
    let match = re.exec(ial);
    while (match) {
        map[match[1]] = match[2];
        match = re.exec(ial);
    }
    return map;
}

function unicodeHexToEmoji(hex) {
    if (!hex || !/^[0-9a-fA-F]+$/.test(hex)) {
        return null;
    }
    try {
        const points = hex.match(/.{1,8}/g) || [hex];
        return points.map((part) => String.fromCodePoint(parseInt(part, 16))).join("");
    } catch (error) {
        console.debug(`${LOG_PREFIX} unicodeHexToEmoji failed`, error);
        return null;
    }
}

function resolveDocIconDisplay(icon) {
    const raw = String(icon || "").trim();
    if (!raw) {
        return { kind: "emoji", value: DOC_REF_DEFAULT_ICON };
    }
    if (raw.includes("/") || raw.includes(".") || raw.startsWith("http") || raw.startsWith("data:")) {
        const src = raw.startsWith("http") || raw.startsWith("data:") || raw.startsWith("/")
            ? raw
            : `/emojis/${raw}`;
        return { kind: "img", value: src };
    }
    const emoji = unicodeHexToEmoji(raw);
    return { kind: "emoji", value: emoji || DOC_REF_DEFAULT_ICON };
}

function parseSqlQueryRows(response) {
    if (Array.isArray(response)) {
        return response;
    }
    if (Array.isArray(response?.data)) {
        return response.data;
    }
    return [];
}

function createBrokenDocRefMeta() {
    return { exists: false, isDoc: false, icon: "" };
}

function escapeSqlId(id) {
    return String(id || "").replace(/'/g, "''");
}

async function queryBlockMetaByIds(ids) {
    const unique = [...new Set((ids || []).filter(Boolean))];
    const result = new Map();
    if (unique.length === 0) {
        return result;
    }
    const chunkSize = 200;
    for (let i = 0; i < unique.length; i += chunkSize) {
        const chunk = unique.slice(i, i + chunkSize);
        const inList = chunk.map((id) => `'${escapeSqlId(id)}'`).join(",");
        const stmt = `SELECT id, type, ial FROM blocks WHERE id IN (${inList})`;
        try {
            const response = await fetchSyncPost("/api/query/sql", { stmt });
            const rows = parseSqlQueryRows(response);
            const found = new Set();
            rows.forEach((row) => {
                const id = row.id;
                if (!id) {
                    return;
                }
                found.add(id);
                const ial = parseIalMap(row.ial);
                result.set(id, {
                    exists: true,
                    isDoc: row.type === "d",
                    icon: ial.icon || "",
                });
            });
            chunk.forEach((id) => {
                if (!found.has(id)) {
                    result.set(id, createBrokenDocRefMeta());
                }
            });
        } catch (error) {
            console.warn(`${LOG_PREFIX} queryBlockMetaByIds failed`, error);
            chunk.forEach((id) => {
                if (!result.has(id)) {
                    result.set(id, createBrokenDocRefMeta());
                }
            });
        }
    }
    return result;
}

function isBlockRefElement(el) {
    if (!el || el.nodeType !== 1) {
        return false;
    }
    const type = el.getAttribute("data-type") || "";
    return type.split(/\s+/).includes("block-ref");
}

function collectBlockRefElements(root) {
    if (!root) {
        return [];
    }
    const list = [];
    if (isBlockRefElement(root)) {
        list.push(root);
    }
    root.querySelectorAll?.('span[data-type~="block-ref"]').forEach((el) => list.push(el));
    return list;
}

function clearDocRefDecoration(el) {
    if (!el) {
        return;
    }
    el.classList.remove(DOC_REF_CLASS, DOC_REF_BROKEN_CLASS);
    el.removeAttribute("contenteditable");
    el.removeAttribute(DOC_REF_ATTR_ICON);
    el.removeAttribute(DOC_REF_ATTR_ICON_IMG);
    el.style.removeProperty("--fhelper-icon-url");
    el.querySelectorAll?.(`.${DOC_REF_ICON_CLASS}`).forEach((node) => node.remove());
}

function applyDocRefIconAttrs(el, display) {
    el.removeAttribute(DOC_REF_ATTR_ICON);
    el.removeAttribute(DOC_REF_ATTR_ICON_IMG);
    el.style.removeProperty("--fhelper-icon-url");
    if (display.kind === "img") {
        el.setAttribute(DOC_REF_ATTR_ICON_IMG, "");
        el.style.setProperty("--fhelper-icon-url", `url("${String(display.value).replace(/"/g, '\\"')}")`);
        return;
    }
    el.setAttribute(DOC_REF_ATTR_ICON, display.value);
}

function applyDocRefDecoration(el, meta) {
    if (!el || !meta) {
        return;
    }
    clearDocRefDecoration(el);
    if (!meta.exists) {
        el.setAttribute("contenteditable", "false");
        el.classList.add(DOC_REF_BROKEN_CLASS);
        applyDocRefIconAttrs(el, resolveDocIconDisplay(""));
        return;
    }
    if (!meta.isDoc) {
        return;
    }
    el.setAttribute("contenteditable", "false");
    el.classList.add(DOC_REF_CLASS);
    applyDocRefIconAttrs(el, resolveDocIconDisplay(meta.icon));
}

function getProtyleFromEvent(event) {
    return event?.detail?.protyle ?? event?.detail ?? event;
}

function getProtyleRootId(protyle) {
    if (!protyle) {
        return null;
    }
    return protyle.block?.id
        || protyle.options?.blockId
        || protyle.block?.rootID
        || protyle.element?.dataset?.id
        || null;
}

function getProtyleWysiwyg(event) {
    const protyle = getProtyleFromEvent(event);
    return protyle?.wysiwyg?.element || null;
}

function findOpenProtyleByRootId(rootId) {
    if (!rootId) {
        return null;
    }
    for (const { protyle } of getAllEditor()) {
        if (getProtyleRootId(protyle) === rootId) {
            return protyle;
        }
    }
    return null;
}

function findOpenProtyleContainingBlock(blockId) {
    if (!blockId) {
        return null;
    }
    for (const { protyle } of getAllEditor()) {
        const wysiwyg = protyle?.wysiwyg?.element;
        if (wysiwyg?.querySelector(`[data-node-id="${blockId}"]`)) {
            return protyle;
        }
    }
    return null;
}

function getDocRefTargetCache(plugin, rootId) {
    if (!rootId) {
        return null;
    }
    if (!plugin.docRefByDoc.has(rootId)) {
        plugin.docRefByDoc.set(rootId, new Map());
    }
    return plugin.docRefByDoc.get(rootId);
}

function clearDocRefCacheForDoc(plugin, rootId, options = {}) {
    const { keepDirty = false } = options;
    if (!rootId) {
        return;
    }
    plugin.docRefByDoc.delete(rootId);
    if (!keepDirty) {
        plugin.docRefDirtyDocs.delete(rootId);
    }
    const timer = plugin.docRefRebuildTimers?.get(rootId);
    if (timer) {
        window.clearTimeout(timer);
        plugin.docRefRebuildTimers.delete(rootId);
    }
}

function markDocRefDirty(plugin, rootId) {
    if (rootId) {
        plugin.docRefDirtyDocs.add(rootId);
    }
}

function getTargetMeta(plugin, rootId, targetId) {
    return getDocRefTargetCache(plugin, rootId)?.get(targetId) || null;
}

function setTargetMeta(plugin, rootId, targetId, meta) {
    const cache = getDocRefTargetCache(plugin, rootId);
    if (cache) {
        cache.set(targetId, meta);
    }
}

async function resolveDocumentRootId(blockId) {
    if (!blockId) {
        return null;
    }
    const stmt = `SELECT root_id FROM blocks WHERE id = '${escapeSqlId(blockId)}'`;
    try {
        const response = await fetchSyncPost("/api/query/sql", { stmt });
        const rows = parseSqlQueryRows(response);
        const rootId = rows[0]?.root_id;
        return typeof rootId === "string" && rootId ? rootId : null;
    } catch (error) {
        console.warn(`${LOG_PREFIX} resolveDocumentRootId failed`, error);
        return null;
    }
}

function extractCreatedocInfo(data) {
    let newDocId = null;
    let parentId = null;
    const walk = (node) => {
        if (!node || typeof node !== "object") {
            return;
        }
        if (!newDocId && typeof node.id === "string" && /^\d{14}-[0-9a-z]{7}$/i.test(node.id) && node.type === "d") {
            newDocId = node.id;
        }
        if (!newDocId && typeof node.id === "string" && /^\d{14}-[0-9a-z]{7}$/i.test(node.id)) {
            newDocId = node.id;
        }
        const parent = node.parentID || node.parentId;
        if (!parentId && typeof parent === "string" && /^\d{14}-[0-9a-z]{7}$/i.test(parent)) {
            parentId = parent;
        }
        if (Array.isArray(node)) {
            node.forEach(walk);
            return;
        }
        Object.values(node).forEach((value) => {
            if (value && typeof value === "object") {
                walk(value);
            }
        });
    };
    walk(data);
    return { newDocId, parentId };
}

function applyRefsFromDocCache(plugin, rootId, refs) {
    (refs || []).forEach((el) => {
        const id = el.getAttribute("data-id");
        if (!id) {
            return;
        }
        const meta = getTargetMeta(plugin, rootId, id);
        if (meta) {
            applyDocRefDecoration(el, meta);
        }
    });
}

async function populateDocRefCache(plugin, rootId, ids) {
    const uniqueIds = [...new Set((ids || []).filter(Boolean))];
    if (uniqueIds.length === 0) {
        return;
    }
    const queried = await queryBlockMetaByIds(uniqueIds);
    const cache = getDocRefTargetCache(plugin, rootId);
    queried.forEach((meta, id) => {
        cache.set(id, meta);
        if (meta.exists) {
            clearDocRefRetry(plugin, rootId, id);
        }
    });
}

async function rebuildDocRefCacheAndDecorate(plugin, protyle) {
    if (!plugin.config.docRefStyle?.enabled || !protyle) {
        return;
    }
    const rootId = getProtyleRootId(protyle);
    const wysiwyg = protyle?.wysiwyg?.element;
    if (!rootId || !wysiwyg) {
        return;
    }
    plugin.docRefByDoc.set(rootId, new Map());
    plugin.docRefDirtyDocs.delete(rootId);
    const refs = collectBlockRefElements(wysiwyg);
    if (refs.length === 0) {
        return;
    }
    const ids = [...new Set(refs.map((el) => el.getAttribute("data-id")).filter(Boolean))];
    await populateDocRefCache(plugin, rootId, ids);
    applyRefsFromDocCache(plugin, rootId, refs);
    ids.forEach((id) => {
        const meta = getTargetMeta(plugin, rootId, id);
        if (!meta?.exists) {
            scheduleNewRefRetry(plugin, rootId, id);
        }
    });
}

function scheduleRebuildDocRef(plugin, protyle) {
    const rootId = getProtyleRootId(protyle);
    if (!rootId) {
        return;
    }
    if (!plugin.docRefRebuildTimers) {
        plugin.docRefRebuildTimers = new Map();
    }
    const existing = plugin.docRefRebuildTimers.get(rootId);
    if (existing) {
        window.clearTimeout(existing);
    }
    const timer = window.setTimeout(() => {
        plugin.docRefRebuildTimers.delete(rootId);
        rebuildDocRefCacheAndDecorate(plugin, protyle).catch((error) => {
            console.warn(`${LOG_PREFIX} rebuildDocRefCacheAndDecorate failed`, error);
        });
    }, DOC_REF_REBUILD_DEBOUNCE_MS);
    plugin.docRefRebuildTimers.set(rootId, timer);
}

async function decorateDynamicRefs(plugin, protyle) {
    if (!plugin.config.docRefStyle?.enabled || !protyle) {
        return;
    }
    const rootId = getProtyleRootId(protyle);
    const wysiwyg = protyle?.wysiwyg?.element;
    if (!rootId || !wysiwyg) {
        return;
    }
    const refs = collectBlockRefElements(wysiwyg);
    if (refs.length === 0) {
        return;
    }
    const cache = getDocRefTargetCache(plugin, rootId);
    const missingIds = [...new Set(refs.map((el) => el.getAttribute("data-id")).filter((id) => id && !cache.has(id)))];
    if (missingIds.length > 0) {
        await populateDocRefCache(plugin, rootId, missingIds);
    }
    applyRefsFromDocCache(plugin, rootId, refs);
}

function applyDocRefMetaInProtyle(plugin, protyle, targetId, meta) {
    const rootId = getProtyleRootId(protyle);
    const wysiwyg = protyle?.wysiwyg?.element;
    if (!rootId || !wysiwyg) {
        return;
    }
    setTargetMeta(plugin, rootId, targetId, meta);
    collectBlockRefElements(wysiwyg)
        .filter((el) => el.getAttribute("data-id") === targetId)
        .forEach((el) => applyDocRefDecoration(el, meta));
}

function applyDocRefMetaToOpenRefs(plugin, targetId, meta) {
    getAllEditor().forEach(({ protyle }) => {
        const wysiwyg = protyle?.wysiwyg?.element;
        if (!wysiwyg) {
            return;
        }
        const hasRef = collectBlockRefElements(wysiwyg).some((el) => el.getAttribute("data-id") === targetId);
        if (hasRef) {
            applyDocRefMetaInProtyle(plugin, protyle, targetId, meta);
        }
    });
}

function clearDocRefRetry(plugin, rootId, id) {
    const key = `${rootId}:${id}`;
    const timers = plugin.docRefRetryTimers?.get(key);
    if (!timers) {
        return;
    }
    timers.forEach((timer) => window.clearTimeout(timer));
    plugin.docRefRetryTimers.delete(key);
}

function clearAllDocRefRetries(plugin) {
    if (!plugin.docRefRetryTimers) {
        return;
    }
    [...plugin.docRefRetryTimers.keys()].forEach((key) => {
        const [rootId, id] = key.split(":");
        clearDocRefRetry(plugin, rootId, id);
    });
}

function scheduleNewRefRetry(plugin, rootId, id) {
    if (!id || !rootId || !plugin.config.docRefStyle?.enabled) {
        return;
    }
    if (!plugin.docRefRetryTimers) {
        plugin.docRefRetryTimers = new Map();
    }
    const key = `${rootId}:${id}`;
    if (plugin.docRefRetryTimers.has(key)) {
        return;
    }
    const timers = NEW_REF_RETRY_DELAYS.map((delay, index) => window.setTimeout(async () => {
        if (!plugin.config.docRefStyle?.enabled) {
            return;
        }
        const queried = await queryBlockMetaByIds([id]);
        const meta = queried.get(id);
        if (!meta) {
            return;
        }
        setTargetMeta(plugin, rootId, id, meta);
        const protyle = findOpenProtyleByRootId(rootId);
        if (protyle) {
            applyDocRefMetaInProtyle(plugin, protyle, id, meta);
        }
        if (meta.exists || index === NEW_REF_RETRY_DELAYS.length - 1) {
            clearDocRefRetry(plugin, rootId, id);
        }
    }, delay));
    plugin.docRefRetryTimers.set(key, timers);
}

function reapplyFromDocCache(plugin, protyle) {
    if (!plugin.config.docRefStyle?.enabled || !protyle) {
        return;
    }
    const rootId = getProtyleRootId(protyle);
    const wysiwyg = protyle?.wysiwyg?.element;
    if (!rootId || !wysiwyg) {
        return;
    }
    if (plugin.docRefDirtyDocs.has(rootId)) {
        scheduleRebuildDocRef(plugin, protyle);
        return;
    }
    collectBlockRefElements(wysiwyg).forEach((el) => {
        reapplyDocRefIfClassLost(plugin, rootId, el);
    });
}

function restoreAllDocRefDecorations(plugin, protyle) {
    const rootId = getProtyleRootId(protyle);
    const wysiwyg = protyle?.wysiwyg?.element;
    if (!rootId || !wysiwyg || !plugin.config.docRefStyle?.enabled) {
        return;
    }
    collectBlockRefElements(wysiwyg).forEach((el) => {
        reapplyDocRefIfClassLost(plugin, rootId, el);
    });
}

function scheduleRestoreDocRefDecorations(plugin, protyle) {
    if (!plugin.docRefRestoreTimer) {
        plugin.docRefRestoreTimer = new Map();
    }
    const rootId = getProtyleRootId(protyle);
    if (!rootId) {
        return;
    }
    const existing = plugin.docRefRestoreTimer.get(rootId);
    if (existing) {
        window.clearTimeout(existing);
    }
    const timer = window.setTimeout(() => {
        plugin.docRefRestoreTimer.delete(rootId);
        restoreAllDocRefDecorations(plugin, protyle);
    }, 50);
    plugin.docRefRestoreTimer.set(rootId, timer);
}

async function handleNewBlockRefs(plugin, protyle, refElements) {
    const refs = (refElements || []).filter((el) => isBlockRefElement(el));
    if (refs.length === 0 || !protyle) {
        return;
    }
    const rootId = getProtyleRootId(protyle);
    if (!rootId) {
        return;
    }
    const cache = getDocRefTargetCache(plugin, rootId);
    const trulyNew = [];
    refs.forEach((el) => {
        const id = el.getAttribute("data-id");
        if (!id) {
            return;
        }
        const meta = cache.get(id);
        if (meta) {
            applyDocRefDecoration(el, meta);
        } else {
            trulyNew.push({ el, id });
        }
    });
    if (trulyNew.length === 0) {
        return;
    }
    const ids = trulyNew.map((item) => item.id);
    await populateDocRefCache(plugin, rootId, ids);
    trulyNew.forEach(({ el, id }) => {
        const meta = getTargetMeta(plugin, rootId, id);
        if (meta) {
            applyDocRefDecoration(el, meta);
        }
        if (!meta?.exists) {
            scheduleNewRefRetry(plugin, rootId, id);
        }
    });
}

function undecorateAllDocRefs() {
    document.querySelectorAll(`span[data-type~="block-ref"].${DOC_REF_CLASS}, span[data-type~="block-ref"].${DOC_REF_BROKEN_CLASS}`)
        .forEach((el) => clearDocRefDecoration(el));
}

async function decorateAllOpenEditors(plugin) {
    if (!plugin.config.docRefStyle?.enabled) {
        return;
    }
    for (const { protyle } of getAllEditor()) {
        watchDocRefMutations(plugin, protyle);
        await rebuildDocRefCacheAndDecorate(plugin, protyle);
    }
}

function reapplyDocRefIfClassLost(plugin, rootId, refEl) {
    if (!isBlockRefElement(refEl)) {
        return;
    }
    const id = refEl.getAttribute("data-id");
    if (!id) {
        return;
    }
    const meta = getTargetMeta(plugin, rootId, id);
    if (!meta) {
        return;
    }
    const shouldBeStyled = meta.exists && meta.isDoc;
    const shouldBeBroken = !meta.exists;
    const hasStyled = refEl.classList.contains(DOC_REF_CLASS);
    const hasBroken = refEl.classList.contains(DOC_REF_BROKEN_CLASS);
    if ((shouldBeStyled && !hasStyled) || (shouldBeBroken && !hasBroken)) {
        applyDocRefDecoration(refEl, meta);
    }
}

function isMutationInsideBlockRef(mutation) {
    const target = mutation.target;
    if (!target) {
        return false;
    }
    if (isBlockRefElement(target)) {
        return mutation.type === "childList";
    }
    return !!target.parentElement?.closest?.('span[data-type~="block-ref"]');
}

function unwatchDocRefMutations(plugin, wysiwyg) {
    const observer = plugin.docRefObservers.get(wysiwyg);
    if (!observer) {
        return;
    }
    observer.disconnect();
    plugin.docRefObservers.delete(wysiwyg);
}

function watchDocRefMutations(plugin, protyle) {
    const wysiwyg = protyle?.wysiwyg?.element;
    if (!wysiwyg || plugin.docRefObservers.has(wysiwyg)) {
        return;
    }
    const observer = new MutationObserver((mutations) => {
        if (!plugin.config.docRefStyle?.enabled) {
            return;
        }
        let newRefs = [];
        const rootId = getProtyleRootId(protyle);
        for (const mutation of mutations) {
            if (isMutationInsideBlockRef(mutation)) {
                if (mutation.type === "attributes"
                    && isBlockRefElement(mutation.target)
                    && mutation.attributeName === "class") {
                    reapplyDocRefIfClassLost(plugin, rootId, mutation.target);
                }
                continue;
            }
            if (mutation.type === "attributes") {
                if (isBlockRefElement(mutation.target) && mutation.attributeName === "class") {
                    reapplyDocRefIfClassLost(plugin, rootId, mutation.target);
                } else if (isBlockRefElement(mutation.target)
                    && (mutation.attributeName === "data-id" || mutation.attributeName === "data-type")) {
                    newRefs.push(mutation.target);
                }
                continue;
            }
            if (mutation.type !== "childList") {
                continue;
            }
            for (const node of mutation.addedNodes) {
                if (node.nodeType !== 1) {
                    continue;
                }
                if (isBlockRefElement(node)) {
                    newRefs.push(node);
                } else {
                    node.querySelectorAll?.('span[data-type~="block-ref"]').forEach((el) => newRefs.push(el));
                }
            }
        }
        if (newRefs.length > 0) {
            handleNewBlockRefs(plugin, protyle, newRefs).catch((error) => {
                console.warn(`${LOG_PREFIX} handleNewBlockRefs failed`, error);
            });
        }
        scheduleRestoreDocRefDecorations(plugin, protyle);
    });
    observer.observe(wysiwyg, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["data-id", "data-type", "class"],
    });
    plugin.docRefObservers.set(wysiwyg, observer);
}

function unwatchAllDocRefMutations(plugin) {
    plugin.docRefObservers.forEach((observer) => observer.disconnect());
    plugin.docRefObservers.clear();
}

function watchAllDocRefEditors(plugin) {
    if (!plugin.config.docRefStyle?.enabled) {
        return;
    }
    getAllEditor().forEach(({ protyle }) => {
        watchDocRefMutations(plugin, protyle);
    });
}

function collectActiveDocRefTargetIds(plugin) {
    const ids = new Set();
    plugin.docRefByDoc.forEach((cache) => {
        cache.forEach((_meta, id) => ids.add(id));
    });
    getAllEditor().forEach(({ protyle }) => {
        collectBlockRefElements(protyle?.wysiwyg?.element).forEach((el) => {
            const id = el.getAttribute("data-id");
            if (id) {
                ids.add(id);
            }
        });
    });
    return ids;
}

function collectIdsFromWsPayload(data, out = new Set()) {
    if (!data) {
        return out;
    }
    if (typeof data === "string") {
        if (/^\d{14}-[0-9a-z]{7}$/i.test(data)) {
            out.add(data);
        }
        return out;
    }
    if (Array.isArray(data)) {
        data.forEach((item) => collectIdsFromWsPayload(item, out));
        return out;
    }
    if (typeof data === "object") {
        ["id", "rootID", "rootId", "blockID", "blockId", "parentID", "defID"].forEach((key) => {
            if (typeof data[key] === "string" && /^\d{14}-[0-9a-z]{7}$/i.test(data[key])) {
                out.add(data[key]);
            }
        });
        Object.values(data).forEach((value) => {
            if (value && typeof value === "object") {
                collectIdsFromWsPayload(value, out);
            }
        });
    }
    return out;
}

function shouldHandleDocRefWs(cmd) {
    if (!cmd) {
        return false;
    }
    const key = String(cmd).toLowerCase();
    return [
        "transactions",
        "removedoc",
        "createdoc",
        "renamedoc",
        "movedoc",
        "movedocs",
        "setblockattrs",
        "reloaddocinfo",
        "undone",
        "redo",
    ].some((item) => key.includes(item));
}

function applyBrokenDocRefFast(plugin, targetIds) {
    const brokenMeta = createBrokenDocRefMeta();
    targetIds.forEach((targetId) => {
        getAllEditor().forEach(({ protyle }) => {
            const rootId = getProtyleRootId(protyle);
            const wysiwyg = protyle?.wysiwyg?.element;
            if (!rootId || !wysiwyg) {
                return;
            }
            const matching = collectBlockRefElements(wysiwyg)
                .filter((el) => el.getAttribute("data-id") === targetId);
            if (matching.length === 0) {
                return;
            }
            clearDocRefRetry(plugin, rootId, targetId);
            setTargetMeta(plugin, rootId, targetId, brokenMeta);
            matching.forEach((el) => applyDocRefDecoration(el, brokenMeta));
        });
    });
}

async function handleCreatedocSignal(plugin, data) {
    const { parentId } = extractCreatedocInfo(data);
    if (!parentId) {
        return;
    }
    let parentRootId = await resolveDocumentRootId(parentId);
    if (!parentRootId) {
        const protyle = findOpenProtyleContainingBlock(parentId);
        parentRootId = getProtyleRootId(protyle);
    }
    if (!parentRootId) {
        return;
    }
    const protyle = findOpenProtyleByRootId(parentRootId);
    clearDocRefCacheForDoc(plugin, parentRootId, { keepDirty: !protyle });
    if (!protyle) {
        markDocRefDirty(plugin, parentRootId);
        return;
    }
    scheduleRebuildDocRef(plugin, protyle);
}

async function refreshTargetMetaInOpenDocs(plugin, targetIds, options = {}) {
    const { force = false } = options;
    const uniqueIds = [...new Set((targetIds || []).filter(Boolean))];
    if (uniqueIds.length === 0) {
        return;
    }
    for (const { protyle } of getAllEditor()) {
        const rootId = getProtyleRootId(protyle);
        const wysiwyg = protyle?.wysiwyg?.element;
        if (!rootId || !wysiwyg) {
            continue;
        }
        const refs = collectBlockRefElements(wysiwyg)
            .filter((el) => uniqueIds.includes(el.getAttribute("data-id")));
        if (refs.length === 0) {
            continue;
        }
        const ids = [...new Set(refs.map((el) => el.getAttribute("data-id")).filter(Boolean))];
        if (force) {
            const cache = getDocRefTargetCache(plugin, rootId);
            ids.forEach((id) => cache.delete(id));
        }
        await populateDocRefCache(plugin, rootId, ids);
        applyRefsFromDocCache(plugin, rootId, refs);
    }
}

async function flushDocRefWsUpdate(plugin) {
    const pending = plugin.docRefWsPending;
    plugin.docRefWsTimer = null;
    plugin.docRefWsPending = null;
    if (!pending || pending.ids.size === 0) {
        return;
    }
    const cmdLower = [...pending.cmds].join(" ").toLowerCase();
    const ids = [...pending.ids];
    if (cmdLower.includes("removedoc")) {
        applyBrokenDocRefFast(plugin, ids);
        return;
    }
    if (cmdLower.includes("createdoc")) {
        await handleCreatedocSignal(plugin, pending.rawData);
        return;
    }
    const activeIds = collectActiveDocRefTargetIds(plugin);
    const relevantIds = ids.filter((id) => activeIds.has(id));
    if (relevantIds.length === 0) {
        return;
    }
    const forceRefresh = cmdLower.includes("setblockattrs")
        || cmdLower.includes("undone")
        || cmdLower.includes("redo");
    await refreshTargetMetaInOpenDocs(plugin, relevantIds, { force: forceRefresh });
}

function scheduleDocRefWsUpdate(plugin, event) {
    const detail = event.detail ?? event;
    const cmd = detail?.cmd;
    if (!shouldHandleDocRefWs(cmd)) {
        return;
    }
    const cmdLower = String(cmd).toLowerCase();
    const ids = [...collectIdsFromWsPayload(detail?.data)];
    if (cmdLower.includes("removedoc") && ids.length > 0) {
        applyBrokenDocRefFast(plugin, ids);
        return;
    }
    if (cmdLower.includes("createdoc")) {
        handleCreatedocSignal(plugin, detail?.data).catch((error) => {
            console.warn(`${LOG_PREFIX} handleCreatedocSignal failed`, error);
        });
        return;
    }
    if (!plugin.docRefWsPending) {
        plugin.docRefWsPending = { cmds: new Set(), ids: new Set(), rawData: null };
    }
    plugin.docRefWsPending.cmds.add(String(cmd));
    plugin.docRefWsPending.rawData = detail?.data;
    ids.forEach((id) => plugin.docRefWsPending.ids.add(id));
    if (plugin.docRefWsTimer) {
        window.clearTimeout(plugin.docRefWsTimer);
    }
    plugin.docRefWsTimer = window.setTimeout(() => {
        flushDocRefWsUpdate(plugin).catch((error) => {
            console.warn(`${LOG_PREFIX} flushDocRefWsUpdate failed`, error);
        });
    }, 150);
}

function handleDocRefWsMain(plugin, event) {
    if (!plugin.config.docRefStyle?.enabled) {
        return;
    }
    scheduleDocRefWsUpdate(plugin, event);
}

function handleProtyleDocRefStaticLoad(plugin, event) {
    if (!plugin.config.docRefStyle?.enabled) {
        return;
    }
    const protyle = getProtyleFromEvent(event);
    if (!protyle?.wysiwyg?.element) {
        return;
    }
    watchDocRefMutations(plugin, protyle);
    rebuildDocRefCacheAndDecorate(plugin, protyle).catch((error) => {
        console.warn(`${LOG_PREFIX} rebuildDocRefCacheAndDecorate failed`, error);
    });
}

function handleProtyleDocRefDynamicLoad(plugin, event) {
    if (!plugin.config.docRefStyle?.enabled) {
        return;
    }
    const protyle = getProtyleFromEvent(event);
    if (!protyle?.wysiwyg?.element) {
        return;
    }
    watchDocRefMutations(plugin, protyle);
    decorateDynamicRefs(plugin, protyle).catch((error) => {
        console.warn(`${LOG_PREFIX} decorateDynamicRefs failed`, error);
    });
}

function handleProtyleDocRefSwitch(plugin, event) {
    if (!plugin.config.docRefStyle?.enabled) {
        return;
    }
    const protyle = getProtyleFromEvent(event);
    if (!protyle?.wysiwyg?.element) {
        return;
    }
    const rootId = getProtyleRootId(protyle);
    if (plugin.docRefDirtyDocs.has(rootId) || !plugin.docRefByDoc.has(rootId)) {
        rebuildDocRefCacheAndDecorate(plugin, protyle).catch((error) => {
            console.warn(`${LOG_PREFIX} rebuildDocRefCacheAndDecorate failed`, error);
        });
        return;
    }
    reapplyFromDocCache(plugin, protyle);
}

function handleProtyleDocRefDestroy(plugin, event) {
    const protyle = getProtyleFromEvent(event);
    const wysiwyg = protyle?.wysiwyg?.element;
    if (wysiwyg) {
        unwatchDocRefMutations(plugin, wysiwyg);
    }
    clearDocRefCacheForDoc(plugin, getProtyleRootId(protyle));
}

function syncDocRefStyleFeature(plugin) {
    const enabled = plugin.config.docRefStyle?.enabled === true;
    setDocRefStyleCssEnabled(enabled);
    if (!enabled) {
        clearAllDocRefRetries(plugin);
        unwatchAllDocRefMutations(plugin);
        undecorateAllDocRefs();
        plugin.docRefByDoc.clear();
        plugin.docRefDirtyDocs.clear();
        plugin.docRefRebuildTimers?.forEach((timer) => window.clearTimeout(timer));
        plugin.docRefRebuildTimers?.clear();
        plugin.docRefRestoreTimer?.forEach((timer) => window.clearTimeout(timer));
        plugin.docRefRestoreTimer?.clear();
        if (plugin.docRefWsTimer) {
            window.clearTimeout(plugin.docRefWsTimer);
            plugin.docRefWsTimer = null;
        }
        plugin.docRefWsPending = null;
        return;
    }
    watchAllDocRefEditors(plugin);
    decorateAllOpenEditors(plugin).catch((error) => {
        console.warn(`${LOG_PREFIX} decorateAllOpenEditors failed`, error);
    });
}

const RE_CJK_CHAR = /[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]/;
const RE_ASCII_CHAR = /[A-Za-z0-9]/;
const RE_PANGU_SPACING = /([\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF])([A-Za-z0-9])|([A-Za-z0-9])([\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF])/g;

function isCjkChar(ch) {
    return !!ch && RE_CJK_CHAR.test(ch);
}

function isAsciiChar(ch) {
    return !!ch && RE_ASCII_CHAR.test(ch);
}

function needsPanguSpaceBetween(prev, next) {
    if (!prev || !next || prev === " " || next === " ") {
        return false;
    }
    return (isCjkChar(prev) && isAsciiChar(next)) || (isAsciiChar(prev) && isCjkChar(next));
}

function addPanguSpacingToText(text) {
    if (!text) {
        return text;
    }
    return text.replace(RE_PANGU_SPACING, (match, cjkBefore, asciiAfter, asciiBefore, cjkAfter) => {
        if (cjkBefore && asciiAfter) {
            return `${cjkBefore} ${asciiAfter}`;
        }
        if (asciiBefore && cjkAfter) {
            return `${asciiBefore} ${cjkAfter}`;
        }
        return match;
    });
}

function isIgnorableSpacingChar(ch) {
    return !ch || ch === ZWSP || ch === "\uFEFF";
}

function getEditableTextRoot(node) {
    const anchor = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    if (!anchor) {
        return null;
    }
    const blockRoot = anchor.closest?.("[data-node-id] div[contenteditable=\"true\"]");
    if (blockRoot) {
        return blockRoot;
    }
    return anchor.closest?.("[contenteditable=\"true\"]") || null;
}

function adjustCursorAfterInsertions(range, toInsert, selection) {
    if (!toInsert.length || !range || !selection) {
        return;
    }
    let adjust = 0;
    for (const item of toInsert) {
        try {
            if (range.comparePoint(item.node, item.offset) > 0) {
                adjust += 1;
            }
        } catch (error) {
            if (range.startContainer.nodeType === Node.TEXT_NODE
                && item.node === range.startContainer
                && item.offset <= range.startOffset) {
                adjust += 1;
            }
        }
    }
    if (adjust === 0) {
        return;
    }
    const cursorNode = range.startContainer;
    const cursorOffset = range.startOffset;
    if (cursorNode.nodeType !== Node.TEXT_NODE) {
        return;
    }
    const newRange = document.createRange();
    newRange.setStart(cursorNode, cursorOffset + adjust);
    newRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(newRange);
}

function isInsideBlockCode(node) {
    return !!node?.parentElement?.closest?.(
        '[data-type="NodeCodeBlock"], .code-block, .hljs'
    );
}

function getInlineCodeRoot(node) {
    if (!node?.parentElement || isInsideBlockCode(node)) {
        return null;
    }
    return node.parentElement.closest('[data-type="code"]');
}

function isInSkippableEditableBlock(node) {
    return !!node?.closest?.(
        '[data-type="NodeCodeBlock"], .code-block, .hljs, .protyle-action, .protyle-attr, .protyle-title'
    );
}

function lastMeaningfulChar(text) {
    for (let i = text.length - 1; i >= 0; i--) {
        if (!isIgnorableSpacingChar(text[i])) {
            return text[i];
        }
    }
    return "";
}

function firstMeaningfulChar(text) {
    for (let i = 0; i < text.length; i++) {
        if (!isIgnorableSpacingChar(text[i])) {
            return text[i];
        }
    }
    return "";
}

function splitMarkdownInlineCode(text) {
    const segments = [];
    let i = 0;
    while (i < text.length) {
        if (text[i] === "`") {
            let j = i + 1;
            while (j < text.length && text[j] !== "`") {
                j++;
            }
            if (j < text.length) {
                segments.push({ type: "code", text: text.slice(i, j + 1) });
                i = j + 1;
                continue;
            }
        }
        let j = i;
        while (j < text.length && text[j] !== "`") {
            j++;
        }
        segments.push({ type: "plain", text: text.slice(i, j) });
        i = j;
    }
    return segments;
}

function addPanguSpacingToMarkdownAware(text) {
    if (!text) {
        return text;
    }
    const segments = splitMarkdownInlineCode(text);
    if (segments.length === 1 && segments[0].type === "plain") {
        return addPanguSpacingToText(segments[0].text);
    }
    const processed = segments.map((seg) => (
        seg.type === "code" ? seg.text : addPanguSpacingToText(seg.text)
    ));
    let result = "";
    for (let i = 0; i < processed.length; i++) {
        if (i > 0) {
            const leftCh = lastMeaningfulChar(result);
            const seg = segments[i];
            const rightCh = seg.type === "code"
                ? firstMeaningfulChar(seg.text.slice(1, -1))
                : firstMeaningfulChar(processed[i]);
            if (needsPanguSpaceBetween(leftCh, rightCh)) {
                result += " ";
            }
        }
        result += processed[i];
    }
    return result;
}

const PANGU_LOOKBACK_CHARS = 120;
const PANGU_IME_LOOKBACK_CHARS = 200;
const PANGU_PASTE_RADIUS_CHARS = 400;

const PANGU_TEXT_WALKER_FILTER = {
    acceptNode(node) {
        return isInsideBlockCode(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
};

function annotateInlineCodeBoundaries(chars) {
    for (let i = 0; i < chars.length; i++) {
        const entry = chars[i];
        if (!entry.codeRoot) {
            entry.isFirstInCode = false;
            entry.isLastInCode = false;
            continue;
        }
        entry.isFirstInCode = i === 0 || chars[i - 1].codeRoot !== entry.codeRoot;
        entry.isLastInCode = i === chars.length - 1 || chars[i + 1].codeRoot !== entry.codeRoot;
    }
}

function collectMeaningfulCharsBeforeCursor(root, range, maxLookback) {
    const chars = [];
    if (!root || !range || maxLookback <= 0) {
        return chars;
    }
    const pushChar = (textNode, index) => {
        const ch = textNode.data[index];
        if (isIgnorableSpacingChar(ch)) {
            return;
        }
        chars.unshift({
            node: textNode,
            offset: index,
            ch,
            codeRoot: getInlineCodeRoot(textNode),
        });
    };
    let node = range.startContainer;
    let offset = range.startOffset;
    if (node.nodeType === Node.TEXT_NODE) {
        while (offset > 0 && chars.length < maxLookback) {
            offset--;
            pushChar(node, offset);
        }
    }
    if (chars.length >= maxLookback) {
        annotateInlineCodeBoundaries(chars);
        return chars;
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, PANGU_TEXT_WALKER_FILTER);
    if (node.nodeType === Node.TEXT_NODE && walker.currentNode !== node) {
        try {
            walker.currentNode = node;
        } catch (error) {
            console.debug("[fhelper] walker anchor failed", error);
        }
    }
    let prev = node.nodeType === Node.TEXT_NODE ? walker.previousNode() : walker.previousNode();
    while (prev && chars.length < maxLookback) {
        for (let i = prev.data.length - 1; i >= 0 && chars.length < maxLookback; i--) {
            pushChar(prev, i);
        }
        prev = walker.previousNode();
    }
    annotateInlineCodeBoundaries(chars);
    return chars;
}

function collectMeaningfulCharsAfterCursor(root, range, maxLookahead) {
    const chars = [];
    if (!root || !range || maxLookahead <= 0) {
        return chars;
    }
    const pushChar = (textNode, index) => {
        const ch = textNode.data[index];
        if (isIgnorableSpacingChar(ch)) {
            return;
        }
        chars.push({
            node: textNode,
            offset: index,
            ch,
            codeRoot: getInlineCodeRoot(textNode),
        });
    };
    let node = range.startContainer;
    let offset = range.startOffset;
    if (node.nodeType === Node.TEXT_NODE) {
        const text = node.data;
        while (offset < text.length && chars.length < maxLookahead) {
            pushChar(node, offset);
            offset++;
        }
    }
    if (chars.length >= maxLookahead) {
        annotateInlineCodeBoundaries(chars);
        return chars;
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, PANGU_TEXT_WALKER_FILTER);
    if (node.nodeType === Node.TEXT_NODE) {
        try {
            walker.currentNode = node;
        } catch (error) {
            console.debug("[fhelper] walker anchor failed", error);
        }
    }
    let next = walker.nextNode();
    while (next && chars.length < maxLookahead) {
        for (let i = 0; i < next.data.length && chars.length < maxLookahead; i++) {
            pushChar(next, i);
        }
        next = walker.nextNode();
    }
    annotateInlineCodeBoundaries(chars);
    return chars;
}

function collectMeaningfulCharsNearCursor(root, range, radius) {
    const before = collectMeaningfulCharsBeforeCursor(root, range, radius);
    const after = collectMeaningfulCharsAfterCursor(root, range, radius);
    if (!after.length) {
        return before;
    }
    const merged = before.concat(after);
    annotateInlineCodeBoundaries(merged);
    return merged;
}

function rootHasInlineCode(root) {
    return !!root?.querySelector?.('[data-type="code"]');
}

function applyPanguSpacingToTextNodes(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, PANGU_TEXT_WALKER_FILTER);
    while (walker.nextNode()) {
        const node = walker.currentNode;
        const spaced = addPanguSpacingToText(node.data);
        if (spaced !== node.data) {
            node.data = spaced;
        }
    }
}

function collectMeaningfulCharsInRoot(root) {
    const chars = [];
    if (!root) {
        return chars;
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, PANGU_TEXT_WALKER_FILTER);
    while (walker.nextNode()) {
        const node = walker.currentNode;
        const codeRoot = getInlineCodeRoot(node);
        const text = node.data;
        for (let i = 0; i < text.length; i++) {
            if (!isIgnorableSpacingChar(text[i])) {
                chars.push({ node, offset: i, ch: text[i], codeRoot });
            }
        }
    }
    annotateInlineCodeBoundaries(chars);
    return chars;
}

function findPanguInsertionActions(chars, lookback = PANGU_LOOKBACK_CHARS) {
    if (chars.length < 2) {
        return [];
    }
    const scanStart = Math.max(0, chars.length - 1 - lookback);
    const actions = [];
    const seenText = new Set();
    const seenBefore = new Set();
    const seenAfter = new Set();

    for (let i = scanStart; i < chars.length - 1; i++) {
        const left = chars[i];
        const right = chars[i + 1];
        if (!needsPanguSpaceBetween(left.ch, right.ch)) {
            continue;
        }

        if (!left.codeRoot && right.codeRoot && right.isFirstInCode) {
            const key = right.codeRoot;
            if (!seenBefore.has(key)) {
                seenBefore.add(key);
                actions.push({ type: "beforeElement", element: right.codeRoot });
            }
            continue;
        }

        if (left.codeRoot && !right.codeRoot && left.isLastInCode) {
            const key = left.codeRoot;
            if (!seenAfter.has(key)) {
                seenAfter.add(key);
                actions.push({ type: "afterElement", element: left.codeRoot });
            }
            continue;
        }

        if (left.codeRoot && right.codeRoot && left.codeRoot !== right.codeRoot) {
            if (!seenAfter.has(left.codeRoot)) {
                seenAfter.add(left.codeRoot);
                actions.push({ type: "afterElement", element: left.codeRoot });
            }
            continue;
        }

        if (left.codeRoot && right.codeRoot) {
            continue;
        }

        const key = `${right.node}${right.offset}`;
        if (!seenText.has(key)) {
            seenText.add(key);
            actions.push({ type: "text", node: right.node, offset: right.offset });
        }
    }
    return actions;
}

function elementHasAdjacentSpace(el, side) {
    const sibling = side === "before" ? el.previousSibling : el.nextSibling;
    if (!sibling) {
        return false;
    }
    if (sibling.nodeType === Node.TEXT_NODE) {
        const text = sibling.data;
        return side === "before" ? /\s$/.test(text) : /^\s/.test(text);
    }
    return false;
}

function applyPanguInsertionActions(actions, range, selection) {
    if (!actions.length) {
        return false;
    }
    const textActions = actions.filter((a) => a.type === "text");
    for (let i = textActions.length - 1; i >= 0; i--) {
        textActions[i].node.insertData(textActions[i].offset, " ");
    }
    actions.filter((a) => a.type === "beforeElement").forEach((a) => {
        if (!a.element?.parentNode || elementHasAdjacentSpace(a.element, "before")) {
            return;
        }
        a.element.parentNode.insertBefore(document.createTextNode(" "), a.element);
    });
    actions.filter((a) => a.type === "afterElement").forEach((a) => {
        if (!a.element?.parentNode || elementHasAdjacentSpace(a.element, "after")) {
            return;
        }
        a.element.parentNode.insertBefore(document.createTextNode(" "), a.element.nextSibling);
    });
    if (range && selection) {
        adjustCursorAfterInsertions(range, textActions, selection);
    }
    return true;
}

function processPanguSpacingInRoot(root, range = null) {
    if (!root) {
        return;
    }
    if (range) {
        const chars = collectMeaningfulCharsNearCursor(root, range, PANGU_PASTE_RADIUS_CHARS);
        const actions = findPanguInsertionActions(chars, chars.length);
        applyPanguInsertionActions(actions, range, window.getSelection());
        return;
    }
    if (!rootHasInlineCode(root)) {
        applyPanguSpacingToTextNodes(root);
        return;
    }
    const chars = collectMeaningfulCharsInRoot(root);
    const actions = findPanguInsertionActions(chars, chars.length);
    applyPanguInsertionActions(actions, null, null);
}

function addPanguSpacingToHtml(html) {
    if (!html || !html.trim()) {
        return html;
    }
    const template = document.createElement("template");
    template.innerHTML = html;
    const container = template.content;
    const blockRoots = container.querySelectorAll('[data-node-id] div[contenteditable="true"]');
    if (blockRoots.length > 0) {
        blockRoots.forEach((root) => processPanguSpacingInRoot(root));
    } else {
        processPanguSpacingInRoot(container);
    }
    if (container.childNodes.length === 1 && container.firstElementChild) {
        return container.firstElementChild.innerHTML;
    }
    let result = "";
    container.childNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
            result += node.outerHTML;
        } else if (node.nodeType === Node.TEXT_NODE) {
            result += node.textContent;
        }
    });
    return result || html;
}

function buildPanguPastePayload(detail) {
    const payload = {};
    if (typeof detail.siyuanHTML === "string" && detail.siyuanHTML !== "") {
        payload.siyuanHTML = addPanguSpacingToHtml(detail.siyuanHTML);
    }
    if (typeof detail.textPlain === "string" && detail.textPlain !== "") {
        payload.textPlain = addPanguSpacingToMarkdownAware(detail.textPlain);
    }
    if (typeof detail.textHTML === "string" && detail.textHTML !== "") {
        payload.textHTML = addPanguSpacingToHtml(detail.textHTML);
    }
    return payload;
}

function applyPanguSpacingScan(state, options = {}) {
    if (state.suppressInput) {
        state.suppressInput = false;
        return false;
    }
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) {
        return false;
    }
    const range = selection.getRangeAt(0);
    const root = getEditableTextRoot(range.startContainer);
    if (!root || isInSkippableEditableBlock(root)) {
        return false;
    }
    const radius = options.imeSettle ? PANGU_IME_LOOKBACK_CHARS : PANGU_LOOKBACK_CHARS;
    const meaningful = collectMeaningfulCharsBeforeCursor(root, range, radius);
    const actions = findPanguInsertionActions(meaningful, meaningful.length);
    if (!actions.length) {
        return false;
    }
    state.suppressInput = true;
    return applyPanguInsertionActions(actions, range, selection);
}

function getPreviousBlockEditableRoot(blockRoot) {
    const block = blockRoot?.closest?.("[data-node-id]");
    if (!block) {
        return null;
    }
    let prev = block.previousElementSibling;
    while (prev) {
        const editable = prev.querySelector?.('div[contenteditable="true"]');
        if (editable && !isInSkippableEditableBlock(editable)) {
            return editable;
        }
        prev = prev.previousElementSibling;
    }
    return null;
}

function getFirstMeaningfulCharInRoot(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, PANGU_TEXT_WALKER_FILTER);
    while (walker.nextNode()) {
        const node = walker.currentNode;
        const text = node.data;
        for (let i = 0; i < text.length; i++) {
            if (!isIgnorableSpacingChar(text[i])) {
                return {
                    node,
                    offset: i,
                    ch: text[i],
                    codeRoot: getInlineCodeRoot(node),
                    isFirstInCode: true,
                    isLastInCode: true,
                };
            }
        }
    }
    return null;
}

function getLastMeaningfulCharInRoot(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, PANGU_TEXT_WALKER_FILTER);
    const textNodes = [];
    while (walker.nextNode()) {
        textNodes.push(walker.currentNode);
    }
    for (let n = textNodes.length - 1; n >= 0; n--) {
        const node = textNodes[n];
        const text = node.data;
        for (let i = text.length - 1; i >= 0; i--) {
            if (!isIgnorableSpacingChar(text[i])) {
                return {
                    node,
                    offset: i,
                    ch: text[i],
                    codeRoot: getInlineCodeRoot(node),
                    isFirstInCode: true,
                    isLastInCode: true,
                };
            }
        }
    }
    return null;
}

function fixAdjacentBlockBoundary(leftRoot, rightRoot) {
    const left = getLastMeaningfulCharInRoot(leftRoot);
    const right = getFirstMeaningfulCharInRoot(rightRoot);
    if (!left || !right || !needsPanguSpaceBetween(left.ch, right.ch)) {
        return;
    }
    if (!left.codeRoot && right.codeRoot) {
        left.isFirstInCode = false;
        left.isLastInCode = false;
        right.isFirstInCode = true;
        right.isLastInCode = false;
        annotateInlineCodeBoundaries([left, right]);
        applyPanguInsertionActions(
            [{ type: "beforeElement", element: right.codeRoot }],
            null,
            null,
        );
        return;
    }
    if (left.codeRoot && !right.codeRoot) {
        annotateInlineCodeBoundaries([left, right]);
        applyPanguInsertionActions(
            [{ type: "afterElement", element: left.codeRoot }],
            null,
            null,
        );
        return;
    }
    applyPanguInsertionActions(
        [{ type: "text", node: right.node, offset: right.offset }],
        null,
        null,
    );
}

function applyPanguSpacingNearPasteSite(protyle) {
    const selection = window.getSelection();
    if (!selection?.rangeCount) {
        return;
    }
    const range = selection.getRangeAt(0);
    const blockRoot = getEditableTextRoot(range.startContainer);
    if (!blockRoot || isInSkippableEditableBlock(blockRoot)) {
        return;
    }
    processPanguSpacingInRoot(blockRoot, range);
    if (collectMeaningfulCharsBeforeCursor(blockRoot, range, 1).length === 0) {
        const prevRoot = getPreviousBlockEditableRoot(blockRoot);
        if (prevRoot) {
            fixAdjacentBlockBoundary(prevRoot, blockRoot);
        }
    }
}

function clearPanguSpacingTimers(state) {
    if (state.debounceTimer) {
        window.clearTimeout(state.debounceTimer);
        state.debounceTimer = null;
    }
    state.imeSettleTimers.forEach((timer) => {
        window.cancelAnimationFrame(timer);
    });
    state.imeSettleTimers = [];
}

function schedulePanguSpacingCheck(state, options = {}) {
    const { imeSettle = false } = options;
    if (state.debounceTimer) {
        window.clearTimeout(state.debounceTimer);
    }
    state.debounceTimer = window.setTimeout(() => {
        state.debounceTimer = null;
        applyPanguSpacingScan(state, { imeSettle });
    }, 10);

    if (!imeSettle) {
        return;
    }
    state.imeSettleTimers.forEach((timer) => window.clearTimeout(timer));
    state.imeSettleTimers = [];
    const timer = window.requestAnimationFrame(() => {
        state.imeSettleTimers = state.imeSettleTimers.filter((item) => item !== timer);
        applyPanguSpacingScan(state, { imeSettle: true });
    });
    state.imeSettleTimers.push(timer);
}

function shouldHandlePanguInput(event) {
    if (!event?.inputType) {
        return true;
    }
    return event.inputType.startsWith("insert");
}

function createPanguSpacingState() {
    return {
        composing: false,
        justEndedComposition: false,
        suppressInput: false,
        debounceTimer: null,
        imeSettleTimers: [],
    };
}

function bindPanguSpacingHandlers(wysiwyg, state) {
    const onCompositionStart = () => {
        state.composing = true;
        state.justEndedComposition = false;
    };
    const onCompositionEnd = () => {
        state.composing = false;
        state.justEndedComposition = true;
        schedulePanguSpacingCheck(state, { imeSettle: true });
        window.setTimeout(() => {
            state.justEndedComposition = false;
        }, 200);
    };
    const onInput = (event) => {
        if (!shouldHandlePanguInput(event)) {
            return;
        }
        if (state.composing) {
            return;
        }
        const imeSettle = state.justEndedComposition
            || event.inputType === "insertCompositionText"
            || event.inputType === "insertFromComposition";
        schedulePanguSpacingCheck(state, { imeSettle });
    };
    wysiwyg.addEventListener("compositionstart", onCompositionStart, true);
    wysiwyg.addEventListener("compositionend", onCompositionEnd, true);
    wysiwyg.addEventListener("input", onInput, true);
    return { onCompositionStart, onCompositionEnd, onInput, state };
}

function unbindPanguSpacingHandlers(wysiwyg, handlers) {
    if (!wysiwyg || !handlers) {
        return;
    }
    if (handlers.state) {
        clearPanguSpacingTimers(handlers.state);
    }
    wysiwyg.removeEventListener("compositionstart", handlers.onCompositionStart, true);
    wysiwyg.removeEventListener("compositionend", handlers.onCompositionEnd, true);
    wysiwyg.removeEventListener("input", handlers.onInput, true);
}

function watchPanguSpacing(plugin, protyle) {
    if (!plugin.config.panguSpacing?.enabled) {
        return;
    }
    const wysiwyg = protyle?.wysiwyg?.element;
    if (!wysiwyg || plugin.panguSpacingWatchers.has(wysiwyg)) {
        return;
    }
    const state = createPanguSpacingState();
    const handlers = bindPanguSpacingHandlers(wysiwyg, state);
    plugin.panguSpacingWatchers.set(wysiwyg, { handlers, state });
}

function unwatchPanguSpacing(plugin, wysiwyg) {
    const entry = plugin.panguSpacingWatchers.get(wysiwyg);
    if (!entry) {
        return;
    }
    unbindPanguSpacingHandlers(wysiwyg, entry.handlers);
    plugin.panguSpacingWatchers.delete(wysiwyg);
}

function watchAllPanguSpacing(plugin) {
    if (!plugin.config.panguSpacing?.enabled) {
        return;
    }
    getAllEditor().forEach(({ protyle }) => watchPanguSpacing(plugin, protyle));
}

function unwatchAllPanguSpacing(plugin) {
    [...plugin.panguSpacingWatchers.keys()].forEach((wysiwyg) => {
        unwatchPanguSpacing(plugin, wysiwyg);
    });
}

function syncPanguSpacingWatchers(plugin) {
    if (plugin.config.panguSpacing?.enabled) {
        watchAllPanguSpacing(plugin);
        return;
    }
    unwatchAllPanguSpacing(plugin);
}

function schedulePanguSpacingAfterPaste(plugin, protyle) {
    if (!plugin.config.panguSpacing?.enabled || !protyle?.wysiwyg?.element) {
        return;
    }
    watchPanguSpacing(plugin, protyle);
    window.requestAnimationFrame(() => {
        applyPanguSpacingNearPasteSite(protyle);
    });
}

function tryGetSiyuanAppZoom() {
    const storageZoom = window.siyuan?.storage?.[SIYUAN_LOCAL_ZOOM_KEY];
    if (Number.isFinite(storageZoom) && storageZoom > 0) {
        return storageZoom;
    }
    try {
        const req = typeof window !== "undefined" && window.require;
        if (req) {
            const { webFrame } = req("electron");
            const zoomFactor = webFrame?.getZoomFactor?.();
            if (Number.isFinite(zoomFactor) && zoomFactor > 0) {
                return zoomFactor;
            }
        }
    } catch (error) {
        console.debug("[fhelper] webFrame zoom unavailable", error);
    }
    return 1;
}

function getAutoDpiInfo() {
    if (typeof window === "undefined") {
        return null;
    }
    const rawDpr = window.devicePixelRatio;
    if (!Number.isFinite(rawDpr) || rawDpr <= 0) {
        return null;
    }
    const appZoom = tryGetSiyuanAppZoom();
    const dpr = rawDpr / appZoom;
    if (!Number.isFinite(dpr) || dpr <= 0) {
        return null;
    }
    const percent = Math.round(dpr * 100);
    return {
        dpr,
        rawDpr,
        appZoom,
        percent,
        dpi: Math.round((SCREEN_DPI * percent) / 100),
        compensated: Math.abs(appZoom - 1) > 0.001,
    };
}

function getAutoDpi() {
    return getAutoDpiInfo()?.dpi ?? null;
}

function getEffectiveDpi() {
    return getAutoDpi();
}

function canUseImageScale() {
    return getEffectiveDpi() !== null;
}

function getAutoDpiDescription(i18n) {
    const info = getAutoDpiInfo();
    if (!info) {
        return i18n.autoDpiUnavailable;
    }
    if (info.compensated) {
        return i18n.autoDpiCompensatedLabel
            .replace("${dpi}", String(info.dpi))
            .replace("${percent}", String(info.percent))
            .replace("${appZoomPercent}", String(Math.round(info.appZoom * 100)))
            .replace("${rawPercent}", String(Math.round(info.rawDpr * 100)));
    }
    return i18n.autoDpiLabel
        .replace("${dpi}", String(info.dpi))
        .replace("${percent}", String(info.percent));
}

function calcImageWidthFromDpi(naturalWidth, dpi) {
    const safeDpi = Math.max(1, Number(dpi) || SCREEN_DPI);
    return Math.max(17, Math.round(naturalWidth * SCREEN_DPI / safeDpi));
}

function getProtyleContentMaxWidth(protyle) {
    const wysiwyg = protyle?.wysiwyg?.element;
    if (!wysiwyg) {
        return null;
    }
    const realWidth = parseInt(wysiwyg.getAttribute("data-realwidth") || "", 10);
    if (Number.isFinite(realWidth) && realWidth > 0) {
        return realWidth;
    }
    const protyleEl = protyle.element || wysiwyg.closest(".protyle");
    if (protyleEl) {
        const cssWidth = getComputedStyle(protyleEl).getPropertyValue("--b3-width-protyle-wysiwyg").trim();
        const parsed = parseInt(cssWidth, 10);
        if (Number.isFinite(parsed) && parsed > 0) {
            return parsed;
        }
    }
    const style = window.getComputedStyle(wysiwyg);
    const paddingLeft = parseFloat(style.paddingLeft) || 0;
    const paddingRight = parseFloat(style.paddingRight) || 0;
    const contentWidth = wysiwyg.clientWidth - paddingLeft - paddingRight;
    return contentWidth > 0 ? Math.round(contentWidth) : null;
}

function resolveImageWidthPolicy(naturalWidth, dpi, editorMaxWidth) {
    const targetWidth = calcImageWidthFromDpi(naturalWidth, dpi);
    if (!editorMaxWidth || targetWidth >= editorMaxWidth) {
        return { mode: "auto", targetWidth };
    }
    return { mode: "fixed", targetWidth, width: targetWidth };
}

function normalizeWidthStyle(value) {
    return String(value || "").replace(/\s/g, "");
}

function getPolicyWidthStyle(policy) {
    return policy.mode === "auto" ? IMAGE_AUTO_WIDTH : `${policy.width}px`;
}

function resetImgWrapperStyle(wrapper) {
    if (!wrapper) {
        return;
    }
    if (wrapper.style.minWidth) {
        wrapper.style.width = "";
    } else {
        wrapper.removeAttribute("style");
    }
}

function applyWidthPolicyToImage(img, policy) {
    const widthSpan = getImageWidthSpan(img);
    if (!widthSpan) {
        return false;
    }
    const wrapper = widthSpan.parentElement;
    resetImgWrapperStyle(wrapper);
    img.style.height = "";
    widthSpan.style.width = getPolicyWidthStyle(policy);
    return true;
}

function isSameWidthPolicy(widthSpan, policy) {
    if (!widthSpan) {
        return false;
    }
    return normalizeWidthStyle(widthSpan.style.width) === normalizeWidthStyle(getPolicyWidthStyle(policy));
}

function getImageWidthSpan(img) {
    const widthSpan = img?.parentElement;
    if (!widthSpan || widthSpan.tagName !== "SPAN") {
        return null;
    }
    const wrapper = widthSpan.parentElement;
    if (!wrapper || wrapper.getAttribute("data-type") !== "img") {
        return null;
    }
    return widthSpan;
}

function persistBlockUpdate(protyle, nodeElement) {
    const id = nodeElement?.getAttribute("data-node-id");
    if (!id || !protyle) {
        return;
    }
    const instance = typeof protyle.getInstance === "function" ? protyle.getInstance() : protyle;
    if (!instance?.transaction) {
        return;
    }
    instance.transaction([{
        action: "update",
        id,
        data: nodeElement.outerHTML,
    }]);
}

function refreshAllImagesInProtyle(plugin, protyle) {
    if (!plugin?.config?.imageScale?.enabled || !protyle?.wysiwyg?.element) {
        return;
    }
    const dpi = getEffectiveDpi();
    if (dpi === null) {
        return;
    }
    const editorMaxWidth = getProtyleContentMaxWidth(protyle);
    protyle.wysiwyg.element.querySelectorAll('[data-type="img"] img').forEach((img) => {
        const naturalWidth = img.naturalWidth;
        if (!naturalWidth) {
            return;
        }
        const widthSpan = getImageWidthSpan(img);
        if (!widthSpan) {
            return;
        }
        const policy = resolveImageWidthPolicy(naturalWidth, dpi, editorMaxWidth);
        if (isSameWidthPolicy(widthSpan, policy)) {
            return;
        }
        const nodeElement = widthSpan.parentElement?.closest('[data-node-id][data-type="NodeParagraph"]');
        if (!nodeElement) {
            return;
        }
        applyWidthPolicyToImage(img, policy);
        persistBlockUpdate(protyle, nodeElement);
    });
}

function scheduleLayoutRefresh(plugin) {
    window.clearTimeout(plugin.layoutRefreshTimer);
    plugin.layoutRefreshTimer = window.setTimeout(() => {
        getAllEditor().forEach(({ protyle }) => refreshAllImagesInProtyle(plugin, protyle));
    }, 150);
}

function watchProtyleLayout(plugin, protyle) {
    const wysiwyg = protyle?.wysiwyg?.element;
    if (!wysiwyg || plugin.protyleLayoutWatchers.has(wysiwyg)) {
        return;
    }
    const triggerRefresh = () => scheduleLayoutRefresh(plugin);
    const resizeObserver = new ResizeObserver(triggerRefresh);
    resizeObserver.observe(wysiwyg);
    const attrObserver = new MutationObserver((mutations) => {
        if (mutations.some((item) => item.attributeName === "data-realwidth")) {
            triggerRefresh();
        }
    });
    attrObserver.observe(wysiwyg, {
        attributes: true,
        attributeFilter: ["data-realwidth"],
    });
    plugin.protyleLayoutWatchers.set(wysiwyg, { resizeObserver, attrObserver });
}

function watchAllEditorLayouts(plugin) {
    getAllEditor().forEach(({ protyle }) => watchProtyleLayout(plugin, protyle));
}

function unwatchAllProtyleLayouts(plugin) {
    plugin.protyleLayoutWatchers.forEach(({ resizeObserver, attrObserver }) => {
        resizeObserver.disconnect();
        attrObserver.disconnect();
    });
    plugin.protyleLayoutWatchers.clear();
    window.clearTimeout(plugin.layoutRefreshTimer);
    plugin.layoutRefreshTimer = null;
}

function scheduleImageScaleForProtyle(plugin, protyle) {
    if (!plugin?.config?.imageScale?.enabled || !protyle) {
        return;
    }
    IMAGE_SCALE_RETRY_DELAYS.forEach((delay) => {
        window.setTimeout(() => refreshAllImagesInProtyle(plugin, protyle), delay);
    });
}

function buildNativeSlashCatalog() {
    const L = window.siyuan?.languages || {};
    const t = (key, fb) => L[key] || fb || key;
    const items = [];
    const push = (id, label, extraFilter, html) => {
        items.push({
            id,
            filter: [label, ...extraFilter].filter(Boolean),
            html: html || `<span>${label}</span>`,
            value: id,
        });
    };
    const sep = (id) => items.push({ id, html: "separator", value: "" });

    push("template", t("template"), ["template", "模板", "moban", "muban", "mb"]);
    push("widget", t("widget"), ["widget", "挂件", "guajian", "gj"]);
    push("assets", t("assets"), ["assets", "资源", "ziyuan", "zy"]);
    push("ref", t("ref"), ["block reference", "块引用", "kuaiyinyong", "kyy"], `<span>${t("ref")} ((</span>`);
    push("blockEmbed", t("blockEmbed"), ["embed block", "嵌入块", "qianrukuai", "qrk"], `<span>${t("blockEmbed")} {{</span>`);
    push("aiWriting", t("aiWriting"), ["ai writing", "ai编写", "aibianxie", "aibx", "人工智能", "rengongzhineng", "rgzn"]);
    push("database", t("database"), ["database", "db", "数据库", "shujuku", "sjk", "视图", "view"]);
    push("newFileRef", t("newFileRef"), ["create new doc with reference", "新建文档并引用", "xinjianwendangbingyinyong", "xjwdbyy"]);
    push("newSubDocRef", t("newSubDocRef"), ["create sub doc with reference", "新建子文档并引用", "xinjianziwendangbingyinyong", "xjzwdbyy"]);
    sep("separator_1");
    push("heading1", t("heading1"), ["heading1", "h1", "一级标题", "yijibiaoti", "yjbt"]);
    push("heading2", t("heading2"), ["heading2", "h2", "二级标题", "erjibiaoti", "ejbt"]);
    push("heading3", t("heading3"), ["heading3", "h3", "三级标题", "sanjibiaoti", "sjbt"]);
    push("heading4", t("heading4"), ["heading4", "h4", "四级标题", "sijibiaoti", "sjbt"]);
    push("heading5", t("heading5"), ["heading5", "h5", "五级标题", "wujibiaoti", "wjbt"]);
    push("heading6", t("heading6"), ["heading6", "h6", "六级标题", "liujibiaoti", "ljbt"]);
    push("list", t("list"), ["unordered list", "无序列表", "wuxvliebiao", "wuxuliebiao", "wxlb"]);
    push("orderedList", t("ordered-list"), ["order list", "ordered list", "有序列表", "youxvliebiao", "youxuliebiao", "yxlb"]);
    push("check", t("check"), ["task list", "todo list", "任务列表", "renwuliebiao", "rwlb"]);
    push("quote", t("quote"), ["blockquote", "bq", "引述", "yinshu", "ys"]);
    push("calloutNote", `${t("callout")} - Note`, ["callout", "ts", "提示", "tishi", "note"], `<span>✏️ ${t("callout")} - Note</span>`);
    push("calloutTip", `${t("callout")} - Tip`, ["callout", "ts", "提示", "tishi", "tip"], `<span>💡 ${t("callout")} - Tip</span>`);
    push("calloutImportant", `${t("callout")} - Important`, ["callout", "ts", "提示", "tishi", "important"], `<span>❗ ${t("callout")} - Important</span>`);
    push("calloutWarning", `${t("callout")} - Warning`, ["callout", "ts", "提示", "tishi", "warning"], `<span>⚠️ ${t("callout")} - Warning</span>`);
    push("calloutCaution", `${t("callout")} - Caution`, ["callout", "ts", "提示", "tishi", "caution"], `<span>🚨 ${t("callout")} - Caution</span>`);
    push("code", t("code"), ["code block", "代码块", "daimakuai", "dmk"]);
    push("table", t("table"), ["table", "表格", "biaoge", "bg"]);
    push("line", t("line"), ["thematic break", "divider", "分隔线", "分割线", "fengexian", "fgx"]);
    push("math", t("math"), ["formulas block", "math block", "数学公式块", "shuxuegongshikuai", "sxgsk"]);
    push("html", "HTML", ["html"], "<span>HTML</span>");
    sep("separator_2");
    push("emoji", t("emoji"), ["emoji", "表情", "biaoqing", "bq"], `<span>${t("emoji")}:</span>`);
    push("link", t("link"), ["link", "a", "链接", "lianjie", "lj"]);
    push("bold", t("bold"), ["bold", "strong", "粗体", "cuti", "ct", "加粗", "jiacu", "jc"]);
    push("italic", t("italic"), ["italic", "em", "斜体", "xieti", "xt"]);
    push("underline", t("underline"), ["underline", "下划线", "xiahuaxian", "xhx"]);
    push("strike", t("strike"), ["strike", "delete", "删除线", "shanchuxian", "scx"]);
    push("mark", t("mark"), ["mark", "标记", "biaoji", "bj", "高亮", "gaoliang", "gl"]);
    push("sup", t("sup"), ["superscript", "上标", "shangbiao", "sb"]);
    push("sub", t("sub"), ["subscript", "下标", "xiaobiao", "xb"]);
    push("inlineCode", t("inline-code"), ["inline code", "行级代码", "hangjidaima", "hjdm"]);
    push("kbd", t("kbd"), ["kbd", "键盘", "jianpan", "jp"]);
    push("tag", t("tag"), ["tags", "标签", "biaoqian", "bq"]);
    push("inlineMath", t("inline-math"), ["inline formulas", "inline math", "行级公式", "hangjigongshi", "hjgs", "行级数学公式", "hangjishuxuegongshi", "hjsxgs"]);
    sep("separator_3");
    push("insertAsset", t("insertAsset"), ["insert image or file", "upload", "插入图片或文件", "charutupianhuowenjian", "crtphwj", "上传", "sc"]);
    push("insertIframeURL", t("insertIframeURL"), ["insert iframe link", "插入 iframe 链接", "charuiframelianjie", "criframelj"]);
    push("insertImgURL", t("insertImgURL"), ["insert image link", "image", "img", "插入图片链接", "charutupianlianjie", "crtplj"]);
    push("insertVideoURL", t("insertVideoURL"), ["insert video link", "插入视频链接", "charushipinlianjie", "crsplj"]);
    push("insertAudioURL", t("insertAudioURL"), ["insert audio link", "插入音频链接", "charuyinpinlianjie", "cryplj"]);
    sep("separator_4");
    push("staff", `ABC ${t("staff")}`, ["staff", "五线谱", "wuxianpu", "wxp"]);
    push("chart", `Chart ${t("chart")}`, ["chart", "图表", "tubiao", "tb"]);
    push("flowChart", "FlowChart Flow Chart", ["flowchart", "flow chart", "流程图", "liuchengtu", "lct"]);
    push("graph", "Graphviz Graph", ["graphviz", "状态图", "zhuangtaitu", "ztt"]);
    push("mermaid", "Mermaid Mermaid", ["mermaid", "diagram", "图表", "tubiao", "tb"]);
    push("mindmap", `Mind map ${t("mindmap")}`, ["mindmap", "脑图", "naotu", "nt"]);
    push("UML", "PlantUML UML", ["plantuml", "建模语言", "jianmoyuyan", "jmyy"]);
    sep("separator_5");
    push("infoStyle", `A ${t("infoStyle")}`, ["info style", "信息样式", "xinxiyangshi", "xxys"]);
    push("successStyle", `A ${t("successStyle")}`, ["success style", "成功样式", "chenggongyangshi", "cgys"]);
    push("warningStyle", `A ${t("warningStyle")}`, ["warning style", "警告样式", "jinggaoyangshi", "jgys"]);
    push("errorStyle", `A ${t("errorStyle")}`, ["error style", "错误样式", "cuowuyangshi", "cwys"]);
    push("clearFontStyle", `A ${t("clearFontStyle")}`, ["clear style", "清除样式", "qingchuyangshi", "qcys"]);
    sep("separator_6");
    return items;
}

function collectPluginSlashItems(app) {
    const items = [];
    app?.plugins?.forEach((plugin) => {
        plugin.protyleSlash?.forEach((slash) => {
            items.push({
                id: slash.id,
                filter: slash.filter,
                html: slash.html,
                value: `plugin${ZWSP}${plugin.name}${ZWSP}${slash.id}`,
                pluginDisplayName: plugin.displayName || plugin.name,
            });
        });
    });
    return items;
}

function getSlashItemKey(item) {
    if (!item || isSeparatorItem(item)) {
        return null;
    }
    const value = String(item.value || "");
    if (value.startsWith("plugin")) {
        const parts = value.split(ZWSP);
        if (parts.length >= 3) {
            return `plugin:${parts[1]}:${parts[2]}`;
        }
    }
    if (item.id && !String(item.id).startsWith("separator")) {
        return `core:${item.id}`;
    }
    if (item.name) {
        return `name:${item.name}`;
    }
    const firstFilter = item.filter?.[0];
    if (firstFilter) {
        return `filter:${String(firstFilter).toLowerCase()}`;
    }
    return null;
}

function extractSlashItemLabel(item) {
    if (item.name) {
        return item.name;
    }
    const tmp = document.createElement("div");
    tmp.innerHTML = item.html || "";
    const text = (tmp.textContent || "").replace(/\s+/g, " ").trim();
    if (text) {
        return text;
    }
    return item.id || item.filter?.[0] || "unknown";
}

function registerSlashItem(catalog, item, group, order) {
    const key = getSlashItemKey(item);
    if (!key) {
        return;
    }
    catalog.set(key, {
        key,
        label: extractSlashItemLabel(item),
        filterText: (item.filter || []).join(" · "),
        group: group || item.pluginDisplayName || "内置",
        order,
    });
}

function buildSlashMenuItems(app) {
    const items = [...buildNativeSlashCatalog()];
    const pluginItems = collectPluginSlashItems(app);
    if (pluginItems.length > 0) {
        items.push(...pluginItems);
    } else if (items.length > 0 && items[items.length - 1].html === "separator") {
        items.pop();
    }
    return items;
}

function buildSlashCatalog(app) {
    const catalog = new Map();
    let order = 0;
    for (const item of buildSlashMenuItems(app)) {
        if (isSeparatorItem(item)) {
            continue;
        }
        const group = item.pluginDisplayName || "内置";
        registerSlashItem(catalog, item, group, order++);
    }
    return catalog;
}

function isSeparatorItem(item) {
    if (!item) {
        return false;
    }
    if (item.html === "separator") {
        return true;
    }
    return String(item.id || "").startsWith("separator");
}

function findHintItem(hintData, catalogItem) {
    const key = getSlashItemKey(catalogItem);
    if (!key || !Array.isArray(hintData)) {
        return null;
    }
    return hintData.find((item) => getSlashItemKey(item) === key) || null;
}

function removeConsecutiveSeparators(items) {
    const result = [];
    for (const item of items) {
        if (isSeparatorItem(item)) {
            if (result.length === 0 || isSeparatorItem(result[result.length - 1])) {
                continue;
            }
        }
        result.push(item);
    }
    while (result.length > 0 && isSeparatorItem(result[0])) {
        result.shift();
    }
    while (result.length > 0 && isSeparatorItem(result[result.length - 1])) {
        result.pop();
    }
    return result;
}

function rebuildFilteredSlashMenu(app, hintData, isEnabled) {
    const menuItems = buildSlashMenuItems(app);
    const result = [];
    let pending = [];

    const flushGroup = () => {
        if (pending.length === 0) {
            return;
        }
        if (result.length > 0) {
            result.push({ html: "separator", id: "separator", value: "" });
        }
        result.push(...pending);
        pending = [];
    };

    for (const item of menuItems) {
        if (isSeparatorItem(item)) {
            flushGroup();
            continue;
        }
        if (!isEnabled(item)) {
            continue;
        }
        pending.push(findHintItem(hintData, item) || item);
    }
    flushGroup();
    return removeConsecutiveSeparators(result);
}

function cleanupSeparators(items, isEnabled) {
    if (!Array.isArray(items) || items.length === 0) {
        return items;
    }

    const groups = [];
    let currentGroup = [];
    for (const item of items) {
        if (isSeparatorItem(item)) {
            if (currentGroup.length > 0) {
                groups.push(currentGroup);
                currentGroup = [];
            }
            continue;
        }
        currentGroup.push(item);
    }
    if (currentGroup.length > 0) {
        groups.push(currentGroup);
    }

    const result = [];
    for (const group of groups) {
        const enabledInGroup = group.filter((item) => isEnabled(item));
        if (enabledInGroup.length === 0) {
            continue;
        }
        if (result.length > 0) {
            result.push({ html: "separator", id: "separator", value: "" });
        }
        result.push(...enabledInGroup);
    }
    return removeConsecutiveSeparators(result);
}

function stripOrphanSeparators(items, isEnabled) {
    const result = [];
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!isSeparatorItem(item)) {
            result.push(item);
            continue;
        }
        const hasPrev = result.length > 0 && !isSeparatorItem(result[result.length - 1]);
        const hasNext = items.slice(i + 1).some((next) => !isSeparatorItem(next) && isEnabled(next));
        if (hasPrev && hasNext) {
            result.push(item);
        }
    }
    return removeConsecutiveSeparators(result);
}

function resolvePluginApp(plugin, protyleArg) {
    return protyleArg?.app || plugin?.app || window.siyuan?.app || getAllEditor()[0]?.protyle?.app || null;
}

function filterSlashItems(data, plugin, protyleArg = null) {
    if (!Array.isArray(data)) {
        return data;
    }
    const config = plugin?.config || createDefaultConfig();
    const isEnabled = (item) => isItemEnabled(item, config);
    for (const item of data) {
        if (isSeparatorItem(item)) {
            continue;
        }
        const key = getSlashItemKey(item);
        if (key) {
            plugin?.registerSlashItemFromMenu?.(item);
        }
    }

    const app = resolvePluginApp(plugin, protyleArg);
    const hasSeparators = data.some(isSeparatorItem);
    let result;
    if (hasSeparators && app) {
        result = rebuildFilteredSlashMenu(app, data, isEnabled);
    } else if (hasSeparators) {
        result = cleanupSeparators(
            data.filter((item) => isSeparatorItem(item) || isEnabled(item)),
            isEnabled,
        );
    } else {
        result = data.filter((item) => !isSeparatorItem(item) && isEnabled(item));
    }
    return stripOrphanSeparators(result, isEnabled);
}

function createDefaultConfig() {
    return {
        disabled: {},
        imageScale: createDefaultImageScaleConfig(),
        panguSpacing: createDefaultPanguSpacingConfig(),
        docRefStyle: createDefaultDocRefStyleConfig(),
    };
}

function isItemEnabled(item, config) {
    const key = getSlashItemKey(item);
    if (!key) {
        return true;
    }
    return config?.disabled?.[key] !== true;
}

let activeFhelperPlugin = null;
let originalHintGenHTML = null;
let originalHintRender = null;

function isSlashHintInstance(hint) {
    return hint?.splitChar === "/" || hint?.splitChar === "、";
}

function cleanupHintSeparatorDOM(element) {
    if (!element) {
        return;
    }
    const isSep = (node) => node?.nodeType === 1 && node.classList.contains("b3-menu__separator");
    const isItem = (node) => node?.nodeType === 1 && node.classList.contains("b3-list-item");

    for (let pass = 0; pass < 3; pass++) {
        const children = [...element.children];
        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            if (!isSep(child)) {
                continue;
            }
            const hasItemBefore = children.slice(0, i).some(isItem);
            const hasItemAfter = children.slice(i + 1).some(isItem);
            if (!hasItemBefore || !hasItemAfter) {
                child.remove();
            }
        }
    }

    let lastWasSep = false;
    for (const child of [...element.children]) {
        if (isSep(child)) {
            if (lastWasSep) {
                child.remove();
            }
            lastWasSep = true;
        } else if (isItem(child)) {
            lastWasSep = false;
        }
    }
}

function installSlashHintHook(plugin) {
    activeFhelperPlugin = plugin;
    const hint = getAllEditor()[0]?.protyle?.hint;
    if (!hint) {
        return false;
    }
    const proto = Object.getPrototypeOf(hint);
    if (!proto?.genHTML) {
        return false;
    }

    if (!originalHintGenHTML) {
        originalHintGenHTML = proto.genHTML;
        proto.genHTML = function fhelperGenHTML(data, protyleArg, hide, source) {
            const currentPlugin = activeFhelperPlugin;
            const slashMenu = source === "hint" && isSlashHintInstance(this) && Array.isArray(data);
            if (slashMenu && currentPlugin) {
                data.forEach((item) => currentPlugin.registerSlashItemFromMenu(item));
                data = filterSlashItems(data, currentPlugin, protyleArg);
            }
            originalHintGenHTML.call(this, data, protyleArg, hide, source);
            if (slashMenu && currentPlugin && this.element) {
                cleanupHintSeparatorDOM(this.element);
            }
        };
    }

    if (!originalHintRender && proto.render) {
        originalHintRender = proto.render;
        proto.render = function fhelperRender(protyle) {
            originalHintRender.call(this, protyle);
            if (!activeFhelperPlugin || !isSlashHintInstance(this) || !this.element) {
                return;
            }
            if (this.element.classList.contains("fn__none")) {
                return;
            }
            cleanupHintSeparatorDOM(this.element);
        };
    }
    return true;
}

function uninstallSlashHintHook() {
    activeFhelperPlugin = null;
}

function scheduleSlashHintHook(plugin) {
    installSlashHintHook(plugin);
    window.setTimeout(() => installSlashHintHook(plugin), 300);
    window.setTimeout(() => installSlashHintHook(plugin), 1500);
}

function patchAllEditors(plugin) {
    scheduleSlashHintHook(plugin);
    watchAllEditorLayouts(plugin);
    syncPanguSpacingWatchers(plugin);
    if (plugin.config.docRefStyle?.enabled) {
        watchAllDocRefEditors(plugin);
        decorateAllOpenEditors(plugin).catch((error) => {
            console.warn(`${LOG_PREFIX} decorateAllOpenEditors failed`, error);
        });
    }
}

module.exports = class FhelperPlugin extends Plugin {
    slashHandler = null;
    pasteHandler = null;
    pastePanguHandler = null;
    protyleStaticLoadHandler = null;
    protyleDynamicLoadHandler = null;
    protyleDestroyHandler = null;
    protyleSwitchHandler = null;
    bazaarObserver = null;
    topBarEntry = null;
    settingDialog = null;
    settingRoot = null;
    slashSearchEl = null;
    slashListEl = null;
    slashEmptyEl = null;
    config = createDefaultConfig();
    slashCatalog = new Map();
    settingToggleEls = new Map();
    imageScaleEnableEl = null;
    imageScaleCenterEl = null;
    panguSpacingEnableEl = null;
    docRefStyleEnableEl = null;
    protyleLayoutWatchers = new Map();
    panguSpacingWatchers = new Map();
    docRefByDoc = new Map();
    docRefDirtyDocs = new Set();
    docRefRebuildTimers = null;
    docRefRestoreTimer = null;
    docRefObservers = new Map();
    docRefRetryTimers = null;
    docRefWsHandler = null;
    docRefWsTimer = null;
    docRefWsPending = null;
    layoutRefreshTimer = null;
    windowResizeHandler = null;

    onload() {
        this.data[STORAGE_NAME] = createDefaultConfig();

        this.addCommand({
            langKey: "openFhelperSetting",
            hotkey: "",
            callback: () => {
                this.openSetting();
            },
        });

        this.loadSlashConfig();
        this.ensureSettingStyles();

        this.refreshSlashCatalog();
        scheduleSlashHintHook(this);

        this.slashHandler = (event) => {
            const payload = event.detail ?? event;
            if (Array.isArray(payload?.data)) {
                payload.data.forEach((item) => this.registerSlashItemFromMenu(item));
                payload.data = filterSlashItems(payload.data, this);
            }
        };
        this.eventBus.on("protyle-slash", this.slashHandler);

        this.pasteHandler = (event) => {
            const detail = event.detail ?? event;
            if (detail?.protyle && this.config.imageScale?.enabled) {
                scheduleImageScaleForProtyle(this, detail.protyle);
            }
        };
        this.eventBus.on("paste", this.pasteHandler);

        this.pastePanguHandler = (event) => {
            const detail = event.detail ?? event;
            if (!this.config.panguSpacing?.enabled || !detail) {
                return;
            }
            if (typeof detail.resolve === "function") {
                const payload = buildPanguPastePayload(detail);
                if (Object.keys(payload).length > 0) {
                    detail.resolve(payload);
                }
            }
            if (detail.protyle) {
                schedulePanguSpacingAfterPaste(this, detail.protyle);
            }
        };
        this.eventBus.on("paste", this.pastePanguHandler);

        this.protyleStaticLoadHandler = (event) => {
            patchAllEditors(this);
            handleProtyleDocRefStaticLoad(this, event);
        };
        this.eventBus.on("loaded-protyle-static", this.protyleStaticLoadHandler);

        this.protyleDynamicLoadHandler = (event) => {
            handleProtyleDocRefDynamicLoad(this, event);
        };
        this.eventBus.on("loaded-protyle-dynamic", this.protyleDynamicLoadHandler);

        this.protyleDestroyHandler = (event) => handleProtyleDocRefDestroy(this, event);
        this.eventBus.on("destroy-protyle", this.protyleDestroyHandler);

        this.protyleSwitchHandler = (event) => handleProtyleDocRefSwitch(this, event);
        this.eventBus.on("switch-protyle", this.protyleSwitchHandler);

        this.docRefWsHandler = (event) => {
            handleDocRefWsMain(this, event);
        };
        this.eventBus.on("ws-main", this.docRefWsHandler);

        this.windowResizeHandler = () => {
            if (!this.config.imageScale?.enabled) {
                return;
            }
            scheduleLayoutRefresh(this);
        };
        window.addEventListener("resize", this.windowResizeHandler);

        this.registerBazaarSettingWatcher();
        this.scheduleBazaarSettingButtonFix();
    }

    onLayoutReady() {
        this.refreshSlashCatalog();
        patchAllEditors(this);
        this.registerTopBarEntry();
        this.ensureBazaarSettingButton();
        this.scheduleBazaarSettingButtonFix();
        syncDocRefStyleFeature(this);
    }

    onunload() {
        uninstallSlashHintHook();
        if (this.bazaarObserver) {
            this.bazaarObserver.disconnect();
            this.bazaarObserver = null;
        }
        if (this.slashHandler) {
            this.eventBus.off("protyle-slash", this.slashHandler);
            this.slashHandler = null;
        }
        if (this.pasteHandler) {
            this.eventBus.off("paste", this.pasteHandler);
            this.pasteHandler = null;
        }
        if (this.pastePanguHandler) {
            this.eventBus.off("paste", this.pastePanguHandler);
            this.pastePanguHandler = null;
        }
        if (this.protyleStaticLoadHandler) {
            this.eventBus.off("loaded-protyle-static", this.protyleStaticLoadHandler);
            this.protyleStaticLoadHandler = null;
        }
        if (this.protyleDynamicLoadHandler) {
            this.eventBus.off("loaded-protyle-dynamic", this.protyleDynamicLoadHandler);
            this.protyleDynamicLoadHandler = null;
        }
        if (this.protyleDestroyHandler) {
            this.eventBus.off("destroy-protyle", this.protyleDestroyHandler);
            this.protyleDestroyHandler = null;
        }
        if (this.protyleSwitchHandler) {
            this.eventBus.off("switch-protyle", this.protyleSwitchHandler);
            this.protyleSwitchHandler = null;
        }
        if (this.docRefWsHandler) {
            this.eventBus.off("ws-main", this.docRefWsHandler);
            this.docRefWsHandler = null;
        }
        if (this.windowResizeHandler) {
            window.removeEventListener("resize", this.windowResizeHandler);
            this.windowResizeHandler = null;
        }
        unwatchAllProtyleLayouts(this);
        unwatchAllPanguSpacing(this);
        clearAllDocRefRetries(this);
        this.config.docRefStyle = { enabled: false };
        syncDocRefStyleFeature(this);
        setImageCenterCssEnabled(false);
        this.settingDialog?.destroy();
        this.settingDialog = null;
        document.getElementById(SETTING_STYLE_ID)?.remove();
    }

    uninstall() {
        this.removeData(STORAGE_NAME).catch((error) => {
            console.warn(`${LOG_PREFIX} removeData failed`, error);
        });
        LEGACY_STORAGE_NAMES.forEach((legacyName) => {
            this.removeData(legacyName).catch((error) => {
                console.warn(`${LOG_PREFIX} remove legacy data failed`, error);
            });
        });
    }

    refreshSlashCatalog() {
        const editors = getAllEditor();
        const app = editors[0]?.protyle?.app || this.app;
        this.slashCatalog = buildSlashCatalog(app);
    }

    registerSlashItemFromMenu(item) {
        if (!item || isSeparatorItem(item)) {
            return;
        }
        const key = getSlashItemKey(item);
        if (!key || this.slashCatalog.has(key)) {
            return;
        }
        let maxOrder = -1;
        for (const entry of this.slashCatalog.values()) {
            if (entry.order > maxOrder) {
                maxOrder = entry.order;
            }
        }
        registerSlashItem(
            this.slashCatalog,
            item,
            item.pluginDisplayName || this.i18n.groupBuiltin,
            maxOrder + 1,
        );
    }

    applyConfig(data) {
        if (data && typeof data === "object") {
            this.config = {
                disabled: { ...(data.disabled || {}) },
                imageScale: {
                    ...createDefaultImageScaleConfig(),
                    ...(data.imageScale || {}),
                },
                panguSpacing: {
                    ...createDefaultPanguSpacingConfig(),
                    ...(data.panguSpacing || {}),
                },
                docRefStyle: {
                    ...createDefaultDocRefStyleConfig(),
                    ...(data.docRefStyle || {}),
                },
            };
            this.data[STORAGE_NAME] = this.config;
            this.applyImageCenterStyle();
            syncPanguSpacingWatchers(this);
            syncDocRefStyleFeature(this);
            if (this.config.imageScale?.enabled) {
                scheduleLayoutRefresh(this);
            }
        }
    }

    applyImageCenterStyle() {
        setImageCenterCssEnabled(this.config?.imageScale?.center === true);
    }

    loadSlashConfig() {
        return this.loadData(STORAGE_NAME).then((data) => {
            const hasNewConfig = data
                && typeof data === "object"
                && (Object.keys(data.disabled || {}).length > 0
                    || data.imageScale
                    || data.panguSpacing
                    || data.docRefStyle);
            if (hasNewConfig) {
                this.applyConfig(data);
                return;
            }
            const tryLegacy = (index = 0) => {
                if (index >= LEGACY_STORAGE_NAMES.length) {
                    this.applyConfig(data);
                    return Promise.resolve();
                }
                return this.loadData(LEGACY_STORAGE_NAMES[index]).then((legacyData) => {
                    if (legacyData && typeof legacyData === "object") {
                        this.applyConfig(legacyData);
                        const shouldMigrate = Object.keys(legacyData.disabled || {}).length > 0
                            || legacyData.imageScale
                            || legacyData.panguSpacing
                            || legacyData.docRefStyle;
                        if (shouldMigrate) {
                            return this.saveData(STORAGE_NAME, this.config).then(() => {
                                return this.removeData(LEGACY_STORAGE_NAMES[index]);
                            });
                        }
                        return;
                    }
                    return tryLegacy(index + 1);
                });
            };
            return tryLegacy();
        }).catch((error) => {
            console.warn(`${LOG_PREFIX} loadData failed`, error);
        });
    }

    getStoragePathDisplay() {
        return `data/storage/petal/${this.name}/${STORAGE_NAME}`;
    }

    isSlashItemEnabled(key) {
        return this.config?.disabled?.[key] !== true;
    }

    setAllSlashItemsEnabled(enabled) {
        const disabled = { ...(this.config.disabled || {}) };
        for (const key of this.slashCatalog.keys()) {
            if (enabled) {
                delete disabled[key];
            } else {
                disabled[key] = true;
            }
        }
        this.config = {
            disabled,
            imageScale: { ...(this.config.imageScale || createDefaultImageScaleConfig()) },
            panguSpacing: { ...(this.config.panguSpacing || createDefaultPanguSpacingConfig()) },
            docRefStyle: { ...(this.config.docRefStyle || createDefaultDocRefStyleConfig()) },
        };
        this.settingToggleEls.forEach((input) => {
            input.checked = enabled;
        });
    }

    registerTopBarEntry() {
        if (this.topBarEntry) {
            return;
        }
        this.topBarEntry = this.addTopBar({
            icon: "iconSettings",
            title: this.i18n.topBarTitle,
            position: "right",
            callback: () => {
                this.openSetting();
            },
        });
    }

    ensureBazaarSettingButton() {
        document.querySelectorAll("#configBazaarDownloaded .b3-card").forEach((card) => {
            try {
                const data = JSON.parse(card.getAttribute("data-obj") || "{}");
                if (data.name !== this.name) {
                    return;
                }
                card.querySelector('[data-type="setting"]')?.classList.remove("fn__none");
            } catch (error) {
                console.warn(`${LOG_PREFIX} ensureBazaarSettingButton failed`, error);
            }
        });
    }

    registerBazaarSettingWatcher() {
        const root = document.getElementById("configBazaarDownloaded");
        if (!root || this.bazaarObserver) {
            return;
        }
        this.bazaarObserver = new MutationObserver(() => {
            this.ensureBazaarSettingButton();
        });
        this.bazaarObserver.observe(root, { childList: true, subtree: true });
    }

    scheduleBazaarSettingButtonFix() {
        [0, 300, 1000, 3000].forEach((delay) => {
            window.setTimeout(() => this.ensureBazaarSettingButton(), delay);
        });
    }

    syncSettingFormToConfig() {
        const disabled = { ...(this.config.disabled || {}) };
        this.settingToggleEls.forEach((input, key) => {
            if (input.checked) {
                delete disabled[key];
            } else {
                disabled[key] = true;
            }
        });
        this.config.disabled = disabled;
        if (this.imageScaleEnableEl) {
            this.config.imageScale.enabled = this.imageScaleEnableEl.checked;
        }
        if (this.imageScaleCenterEl) {
            this.config.imageScale.center = this.imageScaleCenterEl.checked;
        }
        if (this.panguSpacingEnableEl) {
            this.config.panguSpacing.enabled = this.panguSpacingEnableEl.checked;
        }
        if (this.docRefStyleEnableEl) {
            this.config.docRefStyle.enabled = this.docRefStyleEnableEl.checked;
        }
    }

    updateImageScaleControlState() {
        if (this.imageScaleEnableEl) {
            this.imageScaleEnableEl.disabled = !canUseImageScale();
        }
    }

    saveConfig() {
        this.syncSettingFormToConfig();
        this.applyImageCenterStyle();
        syncPanguSpacingWatchers(this);
        syncDocRefStyleFeature(this);
        this.data[STORAGE_NAME] = this.config;
        scheduleLayoutRefresh(this);
        return this.saveData(STORAGE_NAME, this.config);
    }

    createSettingSwitch(checked, disabled = false) {
        const input = document.createElement("input");
        input.className = "b3-switch fn__flex-center";
        input.type = "checkbox";
        input.checked = checked;
        input.disabled = disabled;
        return input;
    }

    createSettingRow({ title, description = "", control = null }) {
        const row = document.createElement("div");
        row.className = "fhelper-setting__row";
        const text = document.createElement("div");
        text.className = "fhelper-setting__text";
        const titleEl = document.createElement("div");
        titleEl.className = "fhelper-setting__title";
        titleEl.textContent = title;
        text.appendChild(titleEl);
        if (description) {
            const descEl = document.createElement("div");
            descEl.className = "fhelper-setting__desc";
            descEl.textContent = description;
            text.appendChild(descEl);
        }
        row.appendChild(text);
        if (control) {
            const action = document.createElement("div");
            action.className = "fhelper-setting__action";
            action.appendChild(control);
            row.appendChild(action);
        }
        return row;
    }

    createSettingSection(title) {
        const section = document.createElement("div");
        section.className = "fhelper-setting__section";
        const heading = document.createElement("div");
        heading.className = "fhelper-setting__section-title";
        heading.textContent = title;
        section.appendChild(heading);
        return section;
    }

    buildGeneralTab() {
        const panel = document.createElement("div");
        panel.className = "fhelper-setting__panel";
        panel.dataset.tab = "general";

        const imageScale = this.config.imageScale || createDefaultImageScaleConfig();
        const panguSpacing = this.config.panguSpacing || createDefaultPanguSpacingConfig();
        const docRefStyle = this.config.docRefStyle || createDefaultDocRefStyleConfig();
        const dpiAvailable = canUseImageScale();

        const imageSection = this.createSettingSection(this.i18n.sectionImage);
        this.imageScaleEnableEl = this.createSettingSwitch(imageScale.enabled === true, !dpiAvailable);
        imageSection.appendChild(this.createSettingRow({
            title: this.i18n.imageScaleEnable,
            description: `${this.i18n.imageScaleEnableDesc}\n${getAutoDpiDescription(this.i18n)}`,
            control: this.imageScaleEnableEl,
        }));

        this.imageScaleCenterEl = this.createSettingSwitch(imageScale.center === true);
        imageSection.appendChild(this.createSettingRow({
            title: this.i18n.imageScaleCenter,
            description: this.i18n.imageScaleCenterDesc,
            control: this.imageScaleCenterEl,
        }));
        panel.appendChild(imageSection);

        const panguSection = this.createSettingSection(this.i18n.sectionPangu);
        this.panguSpacingEnableEl = this.createSettingSwitch(panguSpacing.enabled === true);
        panguSection.appendChild(this.createSettingRow({
            title: this.i18n.panguSpacingEnable,
            description: this.i18n.panguSpacingEnableDesc,
            control: this.panguSpacingEnableEl,
        }));
        this.docRefStyleEnableEl = this.createSettingSwitch(docRefStyle.enabled === true);
        panguSection.appendChild(this.createSettingRow({
            title: this.i18n.docRefStyleEnable,
            description: this.i18n.docRefStyleEnableDesc,
            control: this.docRefStyleEnableEl,
        }));
        panel.appendChild(panguSection);

        const aboutSection = this.createSettingSection(this.i18n.sectionAbout);
        aboutSection.appendChild(this.createSettingRow({
            title: this.i18n.configPathLabel,
            description: this.getStoragePathDisplay(),
        }));
        panel.appendChild(aboutSection);

        return panel;
    }

    getSortedSlashEntries() {
        return [...this.slashCatalog.values()].sort((a, b) => {
            if (a.order !== b.order) {
                return a.order - b.order;
            }
            return a.label.localeCompare(b.label, "zh-CN");
        });
    }

    filterSlashList(keyword = "") {
        const query = String(keyword || "").trim().toLowerCase();
        let visibleCount = 0;
        this.slashListEl?.querySelectorAll("[data-slash-item]").forEach((row) => {
            const haystack = row.dataset.searchText || "";
            const matched = !query || haystack.includes(query);
            row.classList.toggle("fn__none", !matched);
            if (matched) {
                visibleCount += 1;
            }
        });
        this.slashListEl?.querySelectorAll("[data-slash-group]").forEach((group) => {
            const hasVisible = [...group.querySelectorAll("[data-slash-item]")]
                .some((row) => !row.classList.contains("fn__none"));
            group.classList.toggle("fn__none", !hasVisible);
        });
        if (this.slashEmptyEl) {
            this.slashEmptyEl.classList.toggle("fn__none", visibleCount > 0 || this.slashCatalog.size === 0);
            if (this.slashCatalog.size > 0) {
                this.slashEmptyEl.textContent = this.i18n.settingEmptySearch;
            }
        }
    }

    buildSlashTab() {
        const panel = document.createElement("div");
        panel.className = "fhelper-setting__panel fn__none";
        panel.dataset.tab = "slash";

        const toolbar = document.createElement("div");
        toolbar.className = "fhelper-setting__toolbar";

        const search = document.createElement("input");
        search.className = "b3-text-field fhelper-setting__search";
        search.type = "search";
        search.placeholder = this.i18n.slashSearchPlaceholder;
        search.addEventListener("input", () => this.filterSlashList(search.value));
        this.slashSearchEl = search;
        toolbar.appendChild(search);

        const actions = document.createElement("div");
        actions.className = "fhelper-setting__toolbar-actions";

        const enableAllBtn = document.createElement("button");
        enableAllBtn.className = "b3-button b3-button--outline";
        enableAllBtn.textContent = this.i18n.enableAll;
        enableAllBtn.addEventListener("click", () => this.setAllSlashItemsEnabled(true));

        const disableAllBtn = document.createElement("button");
        disableAllBtn.className = "b3-button b3-button--outline";
        disableAllBtn.textContent = this.i18n.disableAll;
        disableAllBtn.addEventListener("click", () => this.setAllSlashItemsEnabled(false));

        actions.appendChild(enableAllBtn);
        actions.appendChild(disableAllBtn);
        toolbar.appendChild(actions);
        panel.appendChild(toolbar);

        const hint = document.createElement("div");
        hint.className = "fhelper-setting__hint";
        hint.textContent = this.i18n.settingHint;
        panel.appendChild(hint);

        const list = document.createElement("div");
        list.className = "fhelper-setting__list";
        this.slashListEl = list;

        const empty = document.createElement("div");
        empty.className = "fhelper-setting__empty";
        empty.textContent = this.i18n.settingEmpty;
        this.slashEmptyEl = empty;

        const entries = this.getSortedSlashEntries();
        if (entries.length === 0) {
            empty.classList.remove("fn__none");
            list.appendChild(empty);
            panel.appendChild(list);
            return panel;
        }

        empty.classList.add("fn__none");
        list.appendChild(empty);

        let currentGroup = null;
        let groupEl = null;
        for (const entry of entries) {
            const displayGroup = entry.group === "内置" ? this.i18n.groupBuiltin : entry.group;
            if (displayGroup !== currentGroup) {
                currentGroup = displayGroup;
                groupEl = document.createElement("div");
                groupEl.className = "fhelper-setting__group";
                groupEl.dataset.slashGroup = displayGroup;
                const groupTitle = document.createElement("div");
                groupTitle.className = "fhelper-setting__group-title";
                groupTitle.textContent = displayGroup;
                groupEl.appendChild(groupTitle);
                list.appendChild(groupEl);
            }
            const key = entry.key;
            const switchEl = this.createSettingSwitch(this.isSlashItemEnabled(key));
            this.settingToggleEls.set(key, switchEl);
            const row = this.createSettingRow({
                title: entry.label,
                description: entry.filterText
                    ? `${this.i18n.filterKeywords}: ${entry.filterText}`
                    : "",
                control: switchEl,
            });
            row.dataset.slashItem = key;
            row.dataset.searchText = `${entry.label} ${entry.filterText || ""} ${displayGroup}`.toLowerCase();
            groupEl.appendChild(row);
        }

        panel.appendChild(list);
        return panel;
    }

    ensureSettingStyles() {
        if (document.getElementById(SETTING_STYLE_ID)) {
            return;
        }
        const style = document.createElement("style");
        style.id = SETTING_STYLE_ID;
        style.textContent = `
.fhelper-setting {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
}
.fhelper-setting__tabs {
    display: flex;
    gap: 4px;
    padding: 12px 16px 0;
    border-bottom: 1px solid var(--b3-border-color);
}
.fhelper-setting__tab {
    appearance: none;
    border: 0;
    background: transparent;
    color: var(--b3-theme-on-surface);
    padding: 8px 14px;
    border-radius: 8px 8px 0 0;
    cursor: pointer;
    font-size: 14px;
    opacity: 0.72;
}
.fhelper-setting__tab:hover {
    opacity: 1;
    background: var(--b3-list-hover);
}
.fhelper-setting__tab.is-active {
    opacity: 1;
    color: var(--b3-theme-primary);
    box-shadow: inset 0 -2px 0 var(--b3-theme-primary);
}
.fhelper-setting__body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 12px 16px 8px;
}
.fhelper-setting__panel {
    display: flex;
    flex-direction: column;
    gap: 16px;
}
.fhelper-setting__section,
.fhelper-setting__group {
    display: flex;
    flex-direction: column;
    gap: 0;
    border: 1px solid var(--b3-border-color);
    border-radius: 10px;
    overflow: hidden;
    background: var(--b3-theme-surface);
}
.fhelper-setting__section-title,
.fhelper-setting__group-title {
    padding: 10px 14px;
    font-weight: 600;
    font-size: 13px;
    color: var(--b3-theme-on-surface);
    background: var(--b3-theme-background);
    border-bottom: 1px solid var(--b3-border-color);
}
.fhelper-setting__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 12px 14px;
}
.fhelper-setting__row + .fhelper-setting__row {
    border-top: 1px solid var(--b3-border-color);
}
.fhelper-setting__text {
    min-width: 0;
    flex: 1;
}
.fhelper-setting__title {
    font-size: 14px;
    color: var(--b3-theme-on-background);
    line-height: 1.4;
}
.fhelper-setting__desc {
    margin-top: 4px;
    font-size: 12px;
    color: var(--b3-theme-on-surface);
    opacity: 0.8;
    line-height: 1.45;
    word-break: break-word;
}
.fhelper-setting__action {
    flex-shrink: 0;
}
.fhelper-setting__toolbar {
    display: flex;
    gap: 10px;
    align-items: center;
    flex-wrap: wrap;
}
.fhelper-setting__search {
    flex: 1;
    min-width: 180px;
}
.fhelper-setting__toolbar-actions {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
}
.fhelper-setting__hint {
    font-size: 12px;
    color: var(--b3-theme-on-surface);
    opacity: 0.8;
}
.fhelper-setting__list {
    display: flex;
    flex-direction: column;
    gap: 12px;
}
.fhelper-setting__empty {
    padding: 28px 12px;
    text-align: center;
    color: var(--b3-theme-on-surface);
    opacity: 0.7;
}
.fhelper-setting__footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid var(--b3-border-color);
}
`;
        document.head.appendChild(style);
    }

    switchSettingTab(tabName) {
        this.settingRoot?.querySelectorAll("[data-tab-btn]").forEach((btn) => {
            btn.classList.toggle("is-active", btn.dataset.tabBtn === tabName);
        });
        this.settingRoot?.querySelectorAll("[data-tab]").forEach((panel) => {
            panel.classList.toggle("fn__none", panel.dataset.tab !== tabName);
        });
        if (tabName === "slash") {
            this.slashSearchEl?.focus();
        }
    }

    buildSettingDialogContent() {
        this.settingToggleEls.clear();
        this.imageScaleEnableEl = null;
        this.imageScaleCenterEl = null;
        this.panguSpacingEnableEl = null;
        this.docRefStyleEnableEl = null;
        this.slashSearchEl = null;
        this.slashListEl = null;
        this.slashEmptyEl = null;

        const root = document.createElement("div");
        root.className = "fhelper-setting";
        this.settingRoot = root;

        const tabs = document.createElement("div");
        tabs.className = "fhelper-setting__tabs";
        [
            { id: "general", label: this.i18n.tabGeneral },
            { id: "slash", label: this.i18n.tabSlash },
        ].forEach(({ id, label }, index) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = `fhelper-setting__tab${index === 0 ? " is-active" : ""}`;
            btn.dataset.tabBtn = id;
            btn.textContent = label;
            btn.addEventListener("click", () => this.switchSettingTab(id));
            tabs.appendChild(btn);
        });
        root.appendChild(tabs);

        const body = document.createElement("div");
        body.className = "fhelper-setting__body";
        body.appendChild(this.buildGeneralTab());
        body.appendChild(this.buildSlashTab());
        root.appendChild(body);

        const footer = document.createElement("div");
        footer.className = "fhelper-setting__footer";
        const cancelBtn = document.createElement("button");
        cancelBtn.className = "b3-button b3-button--cancel";
        cancelBtn.textContent = this.i18n.cancel;
        cancelBtn.addEventListener("click", () => this.settingDialog?.destroy());
        const confirmBtn = document.createElement("button");
        confirmBtn.className = "b3-button b3-button--text";
        confirmBtn.textContent = this.i18n.confirm;
        confirmBtn.addEventListener("click", () => {
            this.saveConfig().then(() => {
                this.settingDialog?.destroy();
            }).catch((error) => {
                console.warn(`${LOG_PREFIX} saveData failed`, error);
                showMessage(this.i18n.saveFailed);
            });
        });
        footer.appendChild(cancelBtn);
        footer.appendChild(confirmBtn);
        root.appendChild(footer);

        return root;
    }

    openSetting() {
        this.refreshSlashCatalog();
        this.ensureSettingStyles();
        if (this.settingDialog) {
            this.settingDialog.destroy();
            this.settingDialog = null;
        }
        const content = this.buildSettingDialogContent();
        this.settingDialog = new Dialog({
            title: this.i18n.topBarTitle,
            content: `<div class="fhelper-setting-mount" style="height:100%;"></div>`,
            width: "780px",
            height: "80vh",
            destroyCallback: () => {
                this.settingDialog = null;
                this.settingRoot = null;
            },
        });
        const mount = this.settingDialog.element.querySelector(".fhelper-setting-mount");
        mount?.appendChild(content);
        this.switchSettingTab("general");
    }
};
