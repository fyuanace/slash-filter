const {
    Plugin,
    Dialog,
    getAllEditor,
    showMessage,
    fetchSyncPost,
    getModelByDockType,
    expandDocTree,
} = require("siyuan");

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
const IMAGE_SCALE_RETRY_DELAYS = [100, 400, 1000, 2500];
const NEW_REF_RETRY_DELAYS = [100, 300, 800, 1500];
const DOC_REF_REBUILD_DEBOUNCE_MS = 150;
const DOC_REF_OUTLINE_SCOPES = [".sy__outline", '[data-type="sidebar-outline"]'];
const IMAGE_AUTO_WIDTH = "calc(100% - 8px)";

function docRefScopeSelector(suffix) {
    return [".protyle-wysiwyg", ...DOC_REF_OUTLINE_SCOPES]
        .map((scope) => `${scope} ${suffix}`)
        .join(",\n");
}

const DOC_REF_CSS = `
${docRefScopeSelector(`span[data-type~="block-ref"].${DOC_REF_CLASS}`)},
${docRefScopeSelector(`span[data-type~="block-ref"].${DOC_REF_BROKEN_CLASS}`)} {
    text-decoration-skip-ink: none;
}
${docRefScopeSelector(`span[data-type~="block-ref"].${DOC_REF_CLASS}`)} {
    text-decoration: underline;
    text-underline-offset: 0.18em;
    cursor: pointer;
}
${docRefScopeSelector(`span[data-type~="block-ref"].${DOC_REF_BROKEN_CLASS}`)} {
    text-decoration: line-through;
    opacity: 0.72;
    cursor: pointer;
}
${docRefScopeSelector(`span[data-type~="block-ref"].${DOC_REF_CLASS}::before`)},
${docRefScopeSelector(`span[data-type~="block-ref"].${DOC_REF_BROKEN_CLASS}::before`)} {
    content: "${DOC_REF_DEFAULT_ICON}";
    display: inline-block;
    margin-right: 0.25em;
    vertical-align: -0.1em;
    line-height: 1;
    pointer-events: none;
}
${docRefScopeSelector(`span[data-type~="block-ref"].${DOC_REF_CLASS}[${DOC_REF_ATTR_ICON}]::before`)},
${docRefScopeSelector(`span[data-type~="block-ref"].${DOC_REF_BROKEN_CLASS}[${DOC_REF_ATTR_ICON}]::before`)} {
    content: attr(${DOC_REF_ATTR_ICON});
}
${docRefScopeSelector(`span[data-type~="block-ref"].${DOC_REF_CLASS}[${DOC_REF_ATTR_ICON_IMG}]::before`)},
${docRefScopeSelector(`span[data-type~="block-ref"].${DOC_REF_BROKEN_CLASS}[${DOC_REF_ATTR_ICON_IMG}]::before`)} {
    content: "";
    width: 1em;
    height: 1em;
    background: center / contain no-repeat;
    background-image: var(--fhelper-icon-url);
}
`;

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
        scheduleDecorateOutlineDocRefs(plugin);
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
    scheduleDecorateOutlineDocRefs(plugin);
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

function getOutlineDocRefRoots() {
    return document.querySelectorAll(DOC_REF_OUTLINE_SCOPES.join(", "));
}

function collectOutlineBlockRefElements() {
    const refs = [];
    getOutlineDocRefRoots().forEach((root) => {
        collectBlockRefElements(root).forEach((el) => refs.push(el));
    });
    return refs;
}

function scheduleDecorateOutlineDocRefs(plugin) {
    if (!plugin.config.docRefStyle?.enabled) {
        return;
    }
    if (plugin.outlineDocRefTimer) {
        window.clearTimeout(plugin.outlineDocRefTimer);
    }
    plugin.outlineDocRefTimer = window.setTimeout(() => {
        plugin.outlineDocRefTimer = null;
        decorateOutlineDocRefs(plugin).catch((error) => {
            console.warn(`${LOG_PREFIX} decorateOutlineDocRefs failed`, error);
        });
    }, DOC_REF_REBUILD_DEBOUNCE_MS);
}

function ensureOutlineDocRefWatch(plugin) {
    if (!plugin.config.docRefStyle?.enabled) {
        return;
    }
    if (!plugin.outlineDocRefObservers) {
        plugin.outlineDocRefObservers = new Map();
    }
    getOutlineDocRefRoots().forEach((root) => {
        if (plugin.outlineDocRefObservers.has(root)) {
            return;
        }
        const observer = new MutationObserver(() => {
            scheduleDecorateOutlineDocRefs(plugin);
        });
        observer.observe(root, { childList: true, subtree: true });
        plugin.outlineDocRefObservers.set(root, observer);
    });
}

function unwatchOutlineDocRefs(plugin) {
    plugin.outlineDocRefObservers?.forEach((observer) => observer.disconnect());
    plugin.outlineDocRefObservers?.clear();
    if (plugin.outlineDocRefTimer) {
        window.clearTimeout(plugin.outlineDocRefTimer);
        plugin.outlineDocRefTimer = null;
    }
}

async function decorateOutlineDocRefs(plugin) {
    if (!plugin.config.docRefStyle?.enabled) {
        return;
    }
    ensureOutlineDocRefWatch(plugin);
    const refs = collectOutlineBlockRefElements();
    if (refs.length === 0) {
        return;
    }
    const ids = [...new Set(refs.map((el) => el.getAttribute("data-id")).filter(Boolean))];
    const metaMap = await queryBlockMetaByIds(ids);
    refs.forEach((el) => {
        const id = el.getAttribute("data-id");
        const meta = metaMap.get(id);
        if (meta) {
            applyDocRefDecoration(el, meta);
        }
    });
}

function undecorateAllDocRefs() {
    const selector = [".protyle-wysiwyg", ...DOC_REF_OUTLINE_SCOPES]
        .map((scope) => (
            `${scope} span[data-type~="block-ref"].${DOC_REF_CLASS}, `
            + `${scope} span[data-type~="block-ref"].${DOC_REF_BROKEN_CLASS}`
        ))
        .join(", ");
    document.querySelectorAll(selector)
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
    scheduleDecorateOutlineDocRefs(plugin);
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
    scheduleDecorateOutlineDocRefs(plugin);
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
    scheduleChildNavWsRefresh(plugin, event);
    if (!plugin.config.docRefStyle?.enabled) {
        return;
    }
    scheduleDocRefWsUpdate(plugin, event);
}

function handleProtyleDocRefStaticLoad(plugin, event) {
    handleProtyleChildNavStaticLoad(plugin, event);
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
    const protyle = getProtyleFromEvent(event);
    if (protyle) {
        ensureDocActionBreadcrumbButtons(plugin, protyle);
    }
    handleProtyleChildNavSwitch(plugin, event);
    if (!plugin.config.docRefStyle?.enabled || !protyle?.wysiwyg?.element) {
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
    const p = unwrapProtyle(protyle);
    p?.element?.querySelectorAll?.(`.${CHILD_NAV_HOST_CLASS}`)?.forEach(removeChildNavHost);
}

const CHILD_DOC_INDEX_DEFAULT_CONCURRENCY = 3;
const LIST_DOCS_SORT_UNASSIGNED = 256;

// const notebookSortModeCache = new Map();

function createDefaultChildDocIndexConfig() {
    return {
        sortBy: "tree",
        scope: "all",
        notebookIds: [],
        selectedNotebookId: "",
        batchConcurrency: CHILD_DOC_INDEX_DEFAULT_CONCURRENCY,
    };
}

const CHILD_NAV_HOST_CLASS = "fhelper-child-nav";
const CHILD_NAV_LEGACY_ATTR = "custom-fhelper-child-nav";
const CHILD_NAV_SRC_MARK = "/plugins/fhelper/child-nav/";
const CHILD_NAV_MOUNT_DEBOUNCE_MS = 120;

function createDefaultChildDocWidgetConfig() {
    return {
        enabled: false,
        mode: "direct",
    };
}

function normalizeChildNavMode(mode) {
    return mode === "nested" ? "nested" : "direct";
}

function getChildNavMode(plugin) {
    return normalizeChildNavMode(plugin?.config?.childDocWidget?.mode);
}

function sleepMs(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function getDocPathBySql(docId) {
    if (!docId) {
        return null;
    }
    try {
        const rows = await runSqlQuery(
            `SELECT id, box, path FROM blocks WHERE id = '${escapeSqlId(docId)}' AND type = 'd' LIMIT 1`,
        );
        const row = rows?.[0];
        if (!row?.box || !row?.path) {
            return null;
        }
        return { notebook: row.box, path: row.path };
    } catch (error) {
        console.warn(`${LOG_PREFIX} getDocPathBySql failed`, docId, error);
        return null;
    }
}

/** Parent doc storage path: `/a/b/c.sy` -> `/a/b.sy`; `/a.sy` -> null */
function getParentDocStoragePath(docPath) {
    const normalized = String(docPath || "");
    if (!/\.sy$/i.test(normalized)) {
        return null;
    }
    const withoutExt = normalized.replace(/\.sy$/i, "");
    const idx = withoutExt.lastIndexOf("/");
    if (idx <= 0) {
        return null;
    }
    return `${withoutExt.slice(0, idx)}.sy`;
}

function toChildNavNode(row) {
    const title = String(row?.content || "").trim()
        || stripDocFileName(row?.path)
        || row?.id;
    return {
        id: row.id,
        title,
        path: row.path || "",
        subFileCount: 0,
        open: false,
        children: [],
    };
}

/**
 * List child docs via SQL only — never call listDocsByPath here.
 * Missing on-disk folders would otherwise toast "open ... file not found".
 */
async function queryChildNavDescendants(notebook, parentDocPath) {
    const folder = toListDocsFolderPath(parentDocPath);
    const prefix = folder === "/" ? "/" : `${folder}/`;
    try {
        const rows = await runSqlQuery(
            `SELECT id, content, path FROM blocks WHERE type = 'd' AND box = '${escapeSqlId(notebook)}' AND path LIKE '${escapeSqlId(prefix)}%' ORDER BY path ASC LIMIT 2000`,
        );
        return Array.isArray(rows) ? rows : [];
    } catch (error) {
        console.warn(`${LOG_PREFIX} queryChildNavDescendants failed`, notebook, parentDocPath, error);
        return [];
    }
}

async function buildChildNavTree(docId, mode) {
    const pathInfo = await getDocPathBySql(docId);
    if (!pathInfo) {
        return [];
    }
    const rows = await queryChildNavDescendants(pathInfo.notebook, pathInfo.path);
    const nested = normalizeChildNavMode(mode) === "nested";

    if (!nested) {
        return rows
            .filter((row) => getParentDocStoragePath(row.path) === pathInfo.path)
            .map(toChildNavNode);
    }

    const byPath = new Map();
    rows.forEach((row) => {
        if (row?.path && row?.id) {
            byPath.set(row.path, toChildNavNode(row));
        }
    });
    const roots = [];
    byPath.forEach((node) => {
        const parentPath = getParentDocStoragePath(node.path);
        const parent = parentPath ? byPath.get(parentPath) : null;
        if (parent) {
            parent.children.push(node);
            parent.subFileCount = parent.children.length;
            return;
        }
        if (parentPath === pathInfo.path) {
            roots.push(node);
        }
    });
    roots.forEach((node) => {
        node.open = node.children.length > 0;
        node.subFileCount = node.children.length;
    });
    return roots;
}

function countChildNavNodes(nodes) {
    let n = 0;
    (nodes || []).forEach((node) => {
        n += 1;
        if (node.children?.length) {
            n += countChildNavNodes(node.children);
        }
    });
    return n;
}

function removeChildNavHost(host) {
    if (host?.parentElement) {
        host.remove();
    }
}

function removeAllChildNavHosts(root = document) {
    root.querySelectorAll?.(`.${CHILD_NAV_HOST_CLASS}`)?.forEach((el) => removeChildNavHost(el));
}

function findChildNavInsertAnchor(protyle) {
    const p = unwrapProtyle(protyle);
    if (!p) {
        return null;
    }
    const title = p.title?.element
        || p.element?.querySelector?.(".protyle-title");
    const wysiwyg = p.wysiwyg?.element;
    const parent = title?.parentElement || wysiwyg?.parentElement;
    if (!parent) {
        return null;
    }
    return { parent, before: wysiwyg || title?.nextElementSibling || null, title, wysiwyg };
}

/** Match editor title/wysiwyg horizontal layout (fixed vs adaptive width). */
function syncChildNavHostLayout(host, protyle) {
    const p = unwrapProtyle(protyle);
    const ref = p?.wysiwyg?.element || p?.title?.element;
    if (!host || !ref) {
        return;
    }
    const cs = window.getComputedStyle(ref);
    host.style.boxSizing = "border-box";
    host.style.width = "100%";
    host.style.maxWidth = cs.maxWidth && cs.maxWidth !== "none" ? cs.maxWidth : "";
    host.style.paddingLeft = cs.paddingLeft;
    host.style.paddingRight = cs.paddingRight;
    host.style.marginLeft = cs.marginLeft;
    host.style.marginRight = cs.marginRight;
    const realWidth = parseInt(ref.getAttribute("data-realwidth") || "", 10);
    if (Number.isFinite(realWidth) && realWidth > 0) {
        // data-realwidth is content width; keep same side padding as the editor.
        host.style.maxWidth = `calc(${realWidth}px + ${cs.paddingLeft} + ${cs.paddingRight})`;
        if (!cs.marginLeft || cs.marginLeft === "0px") {
            host.style.marginLeft = "auto";
            host.style.marginRight = "auto";
        }
    }
}

function syncAllChildNavHostLayouts(plugin) {
    getAllEditor().forEach(({ protyle }) => {
        const p = unwrapProtyle(protyle);
        const host = p?.element?.querySelector?.(`.${CHILD_NAV_HOST_CLASS}`);
        if (host) {
            syncChildNavHostLayout(host, p);
        }
    });
}

function ensureChildNavHost(protyle, docId) {
    const anchor = findChildNavInsertAnchor(protyle);
    if (!anchor) {
        return null;
    }
    const { parent, before } = anchor;
    let host = parent.querySelector(`:scope > .${CHILD_NAV_HOST_CLASS}`);
    if (!host) {
        host = document.createElement("div");
        host.className = CHILD_NAV_HOST_CLASS;
        host.contentEditable = "false";
        host.setAttribute("spellcheck", "false");
        if (before && before.parentElement === parent) {
            parent.insertBefore(host, before);
        } else if (anchor.title?.nextSibling) {
            parent.insertBefore(host, anchor.title.nextSibling);
        } else {
            parent.appendChild(host);
        }
    }
    if (host.dataset.docId && host.dataset.docId !== docId) {
        host.innerHTML = "";
        host._fhelperTree = null;
        host._fhelperFetchedAt = 0;
        host.dataset.treeSig = "";
        host.dataset.paintedDocId = "";
    }
    host.dataset.docId = docId;
    syncChildNavHostLayout(host, protyle);
    return host;
}

function openChildNavDoc(id) {
    if (!id) {
        return;
    }
    try {
        window.open(`siyuan://blocks/${id}`);
    } catch (error) {
        console.warn(`${LOG_PREFIX} openChildNavDoc failed`, id, error);
    }
}

function renderChildNavNodeEl(node, onToggle) {
    const wrap = document.createElement("div");
    wrap.className = "fhelper-child-nav__node";

    const row = document.createElement("div");
    row.className = "fhelper-child-nav__row";

    const twist = document.createElement("button");
    twist.type = "button";
    twist.className = "fhelper-child-nav__twist"
        + (node.children?.length ? "" : " is-placeholder")
        + (node.open ? " is-open" : "");
    twist.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M6 3l5 5-5 5z"/></svg>';
    if (node.children?.length) {
        twist.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            onToggle(node);
        });
    }

    const icon = document.createElement("span");
    icon.className = "fhelper-child-nav__icon";
    icon.textContent = node.subFileCount > 0 ? "📂" : "📄";

    const label = document.createElement("span");
    label.className = "fhelper-child-nav__label";
    label.textContent = node.title;
    label.title = node.title;

    row.appendChild(twist);
    row.appendChild(icon);
    row.appendChild(label);
    row.addEventListener("click", () => openChildNavDoc(node.id));
    wrap.appendChild(row);

    if (node.children?.length && node.open) {
        const kids = document.createElement("div");
        kids.className = "fhelper-child-nav__children";
        node.children.forEach((child) => kids.appendChild(renderChildNavNodeEl(child, onToggle)));
        wrap.appendChild(kids);
    }
    return wrap;
}

function collectChildNavOpenIds(nodes, out = new Set()) {
    (nodes || []).forEach((node) => {
        if (node.open) {
            out.add(node.id);
        }
        if (node.children?.length) {
            collectChildNavOpenIds(node.children, out);
        }
    });
    return out;
}

function applyChildNavOpenIds(nodes, openIds, depth = 0) {
    (nodes || []).forEach((node) => {
        if (openIds && openIds.size > 0) {
            node.open = openIds.has(node.id);
        } else {
            node.open = depth < 1 && node.children.length > 0;
        }
        if (node.children?.length) {
            applyChildNavOpenIds(node.children, openIds, depth + 1);
        }
    });
}

function childNavTreeSignature(nodes) {
    const walk = (list) => (list || []).map((node) => [
        node.id,
        node.title,
        node.open ? 1 : 0,
        walk(node.children),
    ]);
    return JSON.stringify(walk(nodes));
}

function paintChildNavHost(host, plugin, docId, tree, errorText) {
    const mode = getChildNavMode(plugin);
    const count = countChildNavNodes(tree);
    host.innerHTML = "";

    const shell = document.createElement("div");
    shell.className = "fhelper-child-nav__shell";

    const head = document.createElement("div");
    head.className = "fhelper-child-nav__head";
    head.innerHTML = `<div class="fhelper-child-nav__title"><span>子文档</span><span class="fhelper-child-nav__badge">${count}</span></div>`
        + `<div class="fhelper-child-nav__meta">${mode === "nested" ? "嵌套子文档" : "直接子文档"}</div>`;
    shell.appendChild(head);

    const treeEl = document.createElement("div");
    treeEl.className = "fhelper-child-nav__tree";
    if (errorText) {
        const err = document.createElement("div");
        err.className = "fhelper-child-nav__error";
        err.textContent = errorText;
        treeEl.appendChild(err);
    } else if (!tree.length) {
        const empty = document.createElement("div");
        empty.className = "fhelper-child-nav__empty";
        empty.textContent = "暂无子文档";
        treeEl.appendChild(empty);
    } else {
        const onToggle = (node) => {
            node.open = !node.open;
            host._fhelperTree = tree;
            host.dataset.treeSig = childNavTreeSignature(tree);
            paintChildNavHost(host, plugin, docId, tree, "");
        };
        tree.forEach((node) => treeEl.appendChild(renderChildNavNodeEl(node, onToggle)));
    }
    shell.appendChild(treeEl);
    host.appendChild(shell);
    host._fhelperTree = tree;
    host.dataset.treeSig = childNavTreeSignature(tree);
    host.dataset.paintedDocId = docId;
}

async function refreshChildNavHost(plugin, host, docId, options = {}) {
    if (!host || !docId) {
        return;
    }
    const silent = options.silent === true;
    const hasContent = host.dataset.paintedDocId === docId
        && !!host.querySelector(".fhelper-child-nav__shell");
    // Keep current UI while fetching — avoids flash on tab switch.
    if (!silent && !hasContent) {
        paintChildNavHost(host, plugin, docId, [], "");
        const loading = host.querySelector(".fhelper-child-nav__tree");
        if (loading) {
            loading.innerHTML = '<div class="fhelper-child-nav__empty">加载中…</div>';
        }
    }
    try {
        const tree = await buildChildNavTree(docId, getChildNavMode(plugin));
        if (host.dataset.docId !== docId || !host.isConnected) {
            return;
        }
        const prevOpen = collectChildNavOpenIds(host._fhelperTree || []);
        applyChildNavOpenIds(tree, prevOpen);
        const nextSig = childNavTreeSignature(tree);
        if (hasContent && host.dataset.treeSig === nextSig) {
            host._fhelperFetchedAt = Date.now();
            return;
        }
        paintChildNavHost(host, plugin, docId, tree, "");
        host._fhelperFetchedAt = Date.now();
    } catch (error) {
        console.warn(`${LOG_PREFIX} refreshChildNavHost failed`, docId, error);
        if (host.isConnected && !hasContent) {
            paintChildNavHost(host, plugin, docId, [], error?.message || String(error));
        }
    }
}

async function cleanupLegacyChildNavBlocks(docId) {
    if (!docId) {
        return;
    }
    let ids = [];
    try {
        const rows = await runSqlQuery(
            `SELECT id FROM blocks WHERE root_id = '${escapeSqlId(docId)}' AND (ial LIKE '%${CHILD_NAV_LEGACY_ATTR}%' OR markdown LIKE '%${CHILD_NAV_SRC_MARK}%') LIMIT 50`,
        );
        ids = (rows || []).map((row) => row.id).filter(Boolean);
    } catch (error) {
        console.warn(`${LOG_PREFIX} cleanupLegacyChildNavBlocks sql failed`, error);
        return;
    }
    for (const id of ids) {
        try {
            await fetchSyncPost("/api/block/deleteBlock", { id });
        } catch (error) {
            console.warn(`${LOG_PREFIX} cleanup legacy child-nav block failed`, id, error);
        }
    }
}

async function mountChildNavForProtyle(plugin, protyle) {
    const p = unwrapProtyle(protyle);
    if (!p) {
        return;
    }
    const docId = getProtyleDocId(p);
    if (!plugin?.config?.childDocWidget?.enabled || !docId) {
        const anchor = findChildNavInsertAnchor(p);
        anchor?.parent?.querySelectorAll?.(`:scope > .${CHILD_NAV_HOST_CLASS}`)?.forEach(removeChildNavHost);
        return;
    }
    if (!plugin.childNavCleanupDocs) {
        plugin.childNavCleanupDocs = new Set();
    }
    if (!plugin.childNavCleanupDocs.has(docId)) {
        plugin.childNavCleanupDocs.add(docId);
        cleanupLegacyChildNavBlocks(docId).catch((error) => {
            console.warn(`${LOG_PREFIX} cleanupLegacyChildNavBlocks failed`, docId, error);
        });
    }
    const host = ensureChildNavHost(p, docId);
    if (!host) {
        return;
    }
    syncChildNavHostLayout(host, p);
    const hasContent = host.dataset.paintedDocId === docId
        && !!host.querySelector(".fhelper-child-nav__shell");
    // Switch-back: reuse existing panel; skip refetch if freshly painted.
    if (hasContent && host._fhelperFetchedAt && (Date.now() - host._fhelperFetchedAt) < 4000) {
        return;
    }
    await refreshChildNavHost(plugin, host, docId, { silent: hasContent });
}

function scheduleMountChildNav(plugin, protyle) {
    if (!plugin) {
        return;
    }
    const p = unwrapProtyle(protyle);
    const docId = getProtyleDocId(p) || "_";
    if (!plugin.childNavMountTimers) {
        plugin.childNavMountTimers = new Map();
    }
    const prev = plugin.childNavMountTimers.get(docId);
    if (prev) {
        window.clearTimeout(prev);
    }
    const timer = window.setTimeout(() => {
        plugin.childNavMountTimers.delete(docId);
        mountChildNavForProtyle(plugin, p).catch((error) => {
            console.warn(`${LOG_PREFIX} mountChildNavForProtyle failed`, docId, error);
        });
    }, CHILD_NAV_MOUNT_DEBOUNCE_MS);
    plugin.childNavMountTimers.set(docId, timer);
}

function syncAllChildNavPanels(plugin) {
    if (!plugin?.config?.childDocWidget?.enabled) {
        removeAllChildNavHosts();
        return;
    }
    getAllEditor().forEach(({ protyle }) => scheduleMountChildNav(plugin, protyle));
}

function refreshOpenChildNavWidgets(plugin, docId = null) {
    document.querySelectorAll(`.${CHILD_NAV_HOST_CLASS}`).forEach((host) => {
        const hostDocId = host.dataset.docId;
        if (docId && hostDocId && hostDocId !== docId) {
            return;
        }
        if (!hostDocId) {
            return;
        }
        // Force refresh after doc tree changes, but keep UI until data arrives.
        host._fhelperFetchedAt = 0;
        refreshChildNavHost(plugin, host, hostDocId, { silent: true }).catch((error) => {
            console.warn(`${LOG_PREFIX} refreshOpenChildNavWidgets failed`, hostDocId, error);
        });
    });
}

function shouldHandleChildNavWs(cmd) {
    if (!cmd) {
        return false;
    }
    const key = String(cmd).toLowerCase();
    return [
        "createdoc",
        "removedoc",
        "movedoc",
        "movedocs",
        "renamedoc",
        "reloadfiletree",
    ].some((item) => key.includes(item));
}

function scheduleChildNavWsRefresh(plugin, event) {
    if (!plugin.config.childDocWidget?.enabled) {
        return;
    }
    const detail = event.detail ?? event;
    if (!shouldHandleChildNavWs(detail?.cmd)) {
        return;
    }
    if (plugin.childNavWsTimer) {
        window.clearTimeout(plugin.childNavWsTimer);
    }
    plugin.childNavWsTimer = window.setTimeout(() => {
        plugin.childNavWsTimer = null;
        refreshOpenChildNavWidgets(plugin);
    }, 220);
}

function handleProtyleChildNavStaticLoad(plugin, event) {
    scheduleMountChildNav(plugin, getProtyleFromEvent(event));
}

function handleProtyleChildNavSwitch(plugin, event) {
    scheduleMountChildNav(plugin, getProtyleFromEvent(event));
}

// Compatibility aliases used by settings/config save paths.
function scheduleEnsureChildNavWidget(plugin, protyle) {
    scheduleMountChildNav(plugin, protyle);
}
function unwrapProtyle(protyle) {
    if (!protyle) {
        return null;
    }
    if (protyle.block || protyle.wysiwyg) {
        return protyle;
    }
    if (protyle.protyle?.block || protyle.protyle?.wysiwyg) {
        return protyle.protyle;
    }
    return protyle;
}

function getProtyleDocId(protyle) {
    const p = unwrapProtyle(protyle);
    if (!p) {
        return null;
    }
    // Document ID must be rootID. Never fall back to the focused block id —
    // that is often a paragraph/heading and listDocsByPath would look under the wrong path.
    const fromTitle = p.title?.element?.getAttribute?.("data-node-id")
        || p.element?.querySelector?.(".protyle-title")?.getAttribute?.("data-node-id");
    return p.block?.rootID
        || fromTitle
        || p.options?.rootId
        || null;
}

function findProtyleByElement(el) {
    if (!el) {
        return null;
    }
    const breadcrumbRoot = el.closest?.(".protyle-breadcrumb");
    if (breadcrumbRoot) {
        const protyleHost = breadcrumbRoot.closest(".protyle");
        if (protyleHost) {
            for (const { protyle } of getAllEditor()) {
                const p = unwrapProtyle(protyle);
                if (!p?.element) {
                    continue;
                }
                if (p.element === protyleHost || p.element.contains(protyleHost)) {
                    return p;
                }
            }
        }
    }
    const host = el.closest?.(".protyle");
    if (!host) {
        return null;
    }
    for (const { protyle } of getAllEditor()) {
        const p = unwrapProtyle(protyle);
        if (!p?.element) {
            continue;
        }
        if (p.element === host || p.element.contains(el)) {
            return p;
        }
    }
    return null;
}

function resolveProtyleDocId(editor) {
    const p = unwrapProtyle(editor);
    if (!p) {
        return null;
    }
    let docId = getProtyleDocId(p);
    if (docId) {
        return { editor: p, docId };
    }
    const titleEl = p.element?.querySelector?.(".protyle-title[data-node-id]");
    const titleId = titleEl?.getAttribute?.("data-node-id");
    if (titleId) {
        return { editor: p, docId: titleId };
    }
    return { editor: p, docId: null };
}

function escapeKramdownSingleQuoted(text) {
    return String(text ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function buildChildDocRefMarkdown(childId, title) {
    const label = escapeKramdownSingleQuoted((title || "").trim() || childId);
    return `((${childId} '${label}'))`;
}

async function runSqlQuery(stmt) {
    const response = await fetchSyncPost("/api/query/sql", { stmt });
    return parseSqlQueryRows(response);
}

function stripDocFileName(name) {
    const text = String(name || "").trim();
    return text.replace(/\.sy$/i, "");
}

function toListDocsFolderPath(storagePath) {
    let path = String(storagePath || "").trim();
    if (!path) {
        return "/";
    }
    if (!path.startsWith("/")) {
        path = `/${path}`;
    }
    if (path.toLowerCase().endsWith(".sy")) {
        path = path.slice(0, -3);
    }
    return path || "/";
}

/*
function getGlobalFileTreeSortMode() {
    const raw = window.siyuan?.config?.fileTree?.sort;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : LIST_DOCS_SORT_UNASSIGNED;
}

async function fetchNotebookSortMode(notebookId) {
    if (!notebookId) {
        return null;
    }
    if (notebookSortModeCache.has(notebookId)) {
        return notebookSortModeCache.get(notebookId);
    }
    let mode = null;
    try {
        const response = await fetchSyncPost("/api/notebook/getNotebookConf", { notebook: notebookId });
        const parsed = Number(response?.data?.conf?.sortMode);
        mode = Number.isFinite(parsed) ? parsed : null;
    } catch (error) {
        console.warn(`${LOG_PREFIX} fetchNotebookSortMode failed`, notebookId, error);
    }
    notebookSortModeCache.set(notebookId, mode);
    return mode;
}

function formatSortModeLabel(mode) {
    const labels = {
        0: "名称字母升序",
        1: "名称字母降序",
        2: "更新时间升序",
        3: "更新时间降序",
        4: "名称自然升序",
        5: "名称自然降序",
        6: "自定义排序",
        7: "引用数升序",
        8: "引用数降序",
        9: "创建时间升序",
        10: "创建时间降序",
        11: "文件大小升序",
        12: "文件大小降序",
        13: "子文档数升序",
        14: "子文档数降序",
        15: "使用文档树排序规则",
        256: "未指定",
    };
    if (mode === null || mode === undefined || Number.isNaN(Number(mode))) {
        return "unknown";
    }
    const key = Number(mode);
    return labels[key] !== undefined ? `${labels[key]} (${key})` : String(key);
}

function formatChildDocLogList(children) {
    return (children || []).map((child) => ({
        id: child.id,
        title: child.content || child.id,
    }));
}

function logChildDocIndexBuild(parentId, context) {
    console.log(`${LOG_PREFIX} childDocIndex build`, {
        parentId,
        globalSort: formatSortModeLabel(context.globalSort),
        notebookSort: formatSortModeLabel(context.notebookSortMode),
        apiChildOrder: context.apiChildOrder,
        createOrder: context.createOrder,
        skipped: context.skipped,
    });
}
*/

function mapRawFilesToChildren(rawFiles, notebook) {
    return (rawFiles || [])
        .map((file) => mapListDocsFileToChild(file, notebook))
        .filter(Boolean);
}

async function getDocPathById(docId) {
    if (!docId) {
        return null;
    }
    try {
        const response = await fetchSyncPost("/api/filetree/getPathByID", { id: docId });
        const data = response?.data ?? response;
        const notebook = data?.notebook || data?.box;
        const path = data?.path;
        if (!notebook || !path) {
            return null;
        }
        return { notebook, path };
    } catch (error) {
        console.warn(`${LOG_PREFIX} getPathByID failed`, docId, error);
        return null;
    }
}

function mapListDocsFileToChild(file, notebook) {
    if (!file?.id) {
        return null;
    }
    const title = stripDocFileName(file.name1 || file.name || file.id);
    const subFileCount = typeof file.subFileCount === "number" ? file.subFileCount : null;
    return {
        id: file.id,
        content: title,
        hpath: file.path || "",
        path: file.path || "",
        created: String(file.ctime || file.hCtime || ""),
        box: notebook || "",
        subFileCount,
        sort: typeof file.sort === "number" ? file.sort : 0,
    };
}

async function fetchDocsByPathRaw(notebook, path, options = {}) {
    if (!notebook) {
        return [];
    }
    const payload = {
        notebook,
        path: path || "/",
        sort: typeof options.sort === "number" ? options.sort : LIST_DOCS_SORT_UNASSIGNED,
        maxListCount: typeof options.maxListCount === "number" ? options.maxListCount : 0,
    };
    const response = await fetchSyncPost("/api/filetree/listDocsByPath", payload);
    if (response && typeof response.code === "number" && response.code !== 0) {
        throw new Error(response.msg || "listDocsByPath failed");
    }
    return response?.data?.files || response?.files || [];
}

async function listDocsByPath(notebook, path, options = {}) {
    const rawFiles = await fetchDocsByPathRaw(notebook, path, options);
    return (rawFiles || [])
        .map((file) => mapListDocsFileToChild(file, notebook))
        .filter(Boolean);
}

async function queryDirectChildDocs(parentId, config) {
    if (!parentId) {
        return { children: [], notebookId: null };
    }
    const pathInfo = await getDocPathById(parentId);
    if (!pathInfo) {
        console.warn(`${LOG_PREFIX} queryDirectChildDocs: path not found`, parentId);
        return { children: [], notebookId: null };
    }
    const folderPath = toListDocsFolderPath(pathInfo.path);
    try {
        const rawFiles = await fetchDocsByPathRaw(pathInfo.notebook, folderPath, { sort: LIST_DOCS_SORT_UNASSIGNED });
        return {
            children: mapRawFilesToChildren(rawFiles, pathInfo.notebook),
            notebookId: pathInfo.notebook,
        };
    } catch (error) {
        console.warn(`${LOG_PREFIX} listDocsByPath failed`, parentId, folderPath, error);
        try {
            const rawFiles = await fetchDocsByPathRaw(pathInfo.notebook, pathInfo.path, { sort: LIST_DOCS_SORT_UNASSIGNED });
            return {
                children: mapRawFilesToChildren(rawFiles, pathInfo.notebook),
                notebookId: pathInfo.notebook,
            };
        } catch (fallbackError) {
            console.warn(`${LOG_PREFIX} listDocsByPath fallback failed`, parentId, pathInfo.path, fallbackError);
            return { children: [], notebookId: pathInfo.notebook };
        }
    }
}

async function queryExistingRefTargets(rootId) {
    const existing = new Set();
    if (!rootId) {
        return existing;
    }
    try {
        const stmt = `SELECT DISTINCT def_block_id FROM refs WHERE root_id = '${escapeSqlId(rootId)}'`;
        const rows = await runSqlQuery(stmt);
        rows.forEach((row) => {
            if (row.def_block_id) {
                existing.add(row.def_block_id);
            }
        });
        if (existing.size > 0) {
            return existing;
        }
    } catch (error) {
        console.warn(`${LOG_PREFIX} queryExistingRefTargets refs failed`, error);
    }
    try {
        const stmt = `SELECT markdown, content FROM blocks WHERE root_id = '${escapeSqlId(rootId)}' AND markdown LIKE '%block-ref%'`;
        const rows = await runSqlQuery(stmt);
        rows.forEach((row) => {
            const text = `${row.markdown || ""}\n${row.content || ""}`;
            const re = /data-id="(\d{14}-[0-9a-z]{7})"/g;
            let match = re.exec(text);
            while (match) {
                existing.add(match[1]);
                match = re.exec(text);
            }
            const mdRe = /\(\((\d{14}-[0-9a-z]{7})\s/g;
            match = mdRe.exec(text);
            while (match) {
                existing.add(match[1]);
                match = mdRe.exec(text);
            }
        });
    } catch (error) {
        console.warn(`${LOG_PREFIX} queryExistingRefTargets fallback failed`, error);
    }
    return existing;
}

async function appendChildDocRef(parentId, childId, title) {
    const response = await fetchSyncPost("/api/block/appendBlock", {
        dataType: "markdown",
        data: buildChildDocRefMarkdown(childId, title),
        parentID: parentId,
    });
    if (response && typeof response.code === "number" && response.code !== 0) {
        throw new Error(response.msg || "appendBlock failed");
    }
    return response;
}

async function syncChildDocIndexForDoc(parentId, config, options = {}) {
    const result = {
        parentId,
        added: 0,
        skipped: 0,
        failed: 0,
        noChildren: false,
    };
    if (!parentId) {
        return result;
    }
    if (options.cancelled?.()) {
        result.cancelled = true;
        return result;
    }
    const queryResult = options.prefetchedChildren
        ? { children: options.prefetchedChildren, notebookId: options.notebookId || options.prefetchedChildren[0]?.box || null }
        : await queryDirectChildDocs(parentId, config);
    const children = queryResult.children || [];
    if (!children.length) {
        result.noChildren = true;
        return result;
    }
    const existing = await queryExistingRefTargets(parentId);
    for (const child of children) {
        if (options.cancelled?.()) {
            result.cancelled = true;
            break;
        }
        if (existing.has(child.id)) {
            result.skipped += 1;
            continue;
        }
        try {
            await appendChildDocRef(parentId, child.id, child.content);
            existing.add(child.id);
            result.added += 1;
        } catch (error) {
            console.warn(`${LOG_PREFIX} appendChildDocRef failed`, parentId, child.id, error);
            result.failed += 1;
        }
    }
    return result;
}

async function resolveNotebookIdsForIndex(config) {
    if (config?.scope === "selectedNotebooks" && Array.isArray(config.notebookIds) && config.notebookIds.length > 0) {
        return [...new Set(config.notebookIds.filter(Boolean))];
    }
    const notebooks = await listOpenNotebooks();
    return notebooks.map((item) => item.id).filter(Boolean);
}

async function collectDirectChildrenByParentInNotebook(notebook, options = {}) {
    const childrenByParent = new Map();
    if (!notebook) {
        return childrenByParent;
    }
    const queue = [{ parentId: null, folderPath: "/" }];
    const visited = new Set();
    while (queue.length > 0) {
        if (options.cancelled?.()) {
            break;
        }
        const { parentId, folderPath } = queue.shift();
        const key = `${notebook}:${folderPath}`;
        if (visited.has(key)) {
            continue;
        }
        visited.add(key);
        let rawFiles = [];
        try {
            rawFiles = await fetchDocsByPathRaw(notebook, folderPath, { sort: LIST_DOCS_SORT_UNASSIGNED });
        } catch (error) {
            console.warn(`${LOG_PREFIX} collect children failed`, notebook, folderPath, error);
            continue;
        }
        const files = mapRawFilesToChildren(rawFiles, notebook);
        if (parentId && files.length > 0) {
            childrenByParent.set(parentId, files);
        }
        files.forEach((file) => {
            // Prefer subFileCount when known; if unknown, still probe one level deeper.
            if (file.subFileCount === 0) {
                return;
            }
            queue.push({
                parentId: file.id,
                folderPath: toListDocsFolderPath(file.path),
            });
        });
    }
    return childrenByParent;
}

async function runGlobalChildDocIndex(plugin, callbacks = {}) {
    const config = callbacks.config
        || plugin.config.childDocIndex
        || createDefaultChildDocIndexConfig();
    const { onProgress, isCancelled } = callbacks;
    const summary = {
        parents: 0,
        added: 0,
        skipped: 0,
        failed: 0,
        cancelled: false,
    };
    const notebookIds = await resolveNotebookIdsForIndex(config);
    const childrenByParent = new Map();
    for (const notebookId of notebookIds) {
        if (isCancelled?.()) {
            summary.cancelled = true;
            break;
        }
        const partial = await collectDirectChildrenByParentInNotebook(notebookId, {
            config,
            cancelled: isCancelled,
        });
        partial.forEach((children, parentId) => {
            childrenByParent.set(parentId, children);
        });
    }
    const parentIds = [...childrenByParent.keys()];
    summary.parents = parentIds.length;
    for (let index = 0; index < parentIds.length; index += 1) {
        if (isCancelled?.()) {
            summary.cancelled = true;
            break;
        }
        const parentId = parentIds[index];
        const prefetchedChildren = childrenByParent.get(parentId);
        const result = await syncChildDocIndexForDoc(parentId, config, {
            prefetchedChildren,
            notebookId: prefetchedChildren?.[0]?.box || null,
            cancelled: isCancelled,
        });
        summary.added += result.added;
        summary.skipped += result.skipped;
        summary.failed += result.failed;
        if (result.cancelled) {
            summary.cancelled = true;
            break;
        }
        onProgress?.({
            current: index + 1,
            total: parentIds.length,
            added: summary.added,
            skipped: summary.skipped,
            failed: summary.failed,
        });
    }
    return summary;
}

function formatChildDocIndexMessage(i18n, key, params = {}) {
    let text = i18n[key] || key;
    Object.entries(params).forEach(([name, value]) => {
        text = text.replace(new RegExp(`\\$\\{${name}\\}`, "g"), String(value));
    });
    return text;
}

async function handleChildDocIndexForProtyle(plugin, protyle) {
    if (plugin.childDocIndexBusy) {
        return;
    }
    plugin.childDocIndexBusy = true;
    try {
        const editor = unwrapProtyle(protyle) || findProtyleByElement(protyle?.element);
        const { editor: resolvedEditor, docId } = resolveProtyleDocId(editor);
        if (!docId) {
            console.warn(`${LOG_PREFIX} childDocIndex: cannot resolve doc id`, {
                hasEditor: !!resolvedEditor,
                rootID: resolvedEditor?.block?.rootID,
                blockId: resolvedEditor?.block?.id,
                titleId: resolvedEditor?.title?.element?.getAttribute?.("data-node-id"),
            });
            showMessage(plugin.i18n.childDocIndexNoDoc);
            return;
        }
        const config = plugin.config.childDocIndex || createDefaultChildDocIndexConfig();
        const result = await syncChildDocIndexForDoc(docId, config);
        if (result.noChildren) {
            console.warn(`${LOG_PREFIX} childDocIndex: no children for`, docId);
            showMessage(plugin.i18n.childDocIndexNoChildren);
            return;
        }
        if (result.added === 0 && result.failed === 0) {
            showMessage(plugin.i18n.childDocIndexAllExist);
            return;
        }
        if (result.failed > 0) {
            showMessage(formatChildDocIndexMessage(plugin.i18n, "childDocIndexPartial", {
                added: result.added,
                failed: result.failed,
            }));
            return;
        }
        showMessage(formatChildDocIndexMessage(plugin.i18n, "childDocIndexAdded", { count: result.added }));
        if (plugin.config.docRefStyle?.enabled && resolvedEditor) {
            markDocRefDirty(plugin, docId);
            scheduleRebuildDocRef(plugin, resolvedEditor);
        }
    } finally {
        plugin.childDocIndexBusy = false;
    }
}

function toDocDirPath(path) {
    if (!path || path === "/") {
        return "/";
    }
    return String(path).replace(/\.sy$/i, "");
}

function isDocPathUnderParent(childPath, parentPath) {
    if (!childPath || !parentPath) {
        return false;
    }
    if (childPath === parentPath) {
        return true;
    }
    const parentDir = toDocDirPath(parentPath);
    if (parentDir === "/") {
        return childPath !== "/";
    }
    return childPath === parentDir || childPath.startsWith(`${parentDir}/`);
}

function openFileTreeDock() {
    const layouts = [
        window.siyuan?.layout?.leftDock,
        window.siyuan?.layout?.rightDock,
        window.siyuan?.layout?.bottomDock,
    ];
    for (const dock of layouts) {
        if (dock?.data?.file && typeof dock.toggleModel === "function") {
            dock.toggleModel("file", true);
            return true;
        }
    }
    return false;
}

async function locateDocInFileTree(docId, protyle) {
    openFileTreeDock();
    if (typeof expandDocTree === "function") {
        await expandDocTree({ id: docId, isSetCurrent: true });
        return;
    }
    const p = unwrapProtyle(protyle);
    const notebookId = p?.notebookId;
    const path = p?.path;
    if (!notebookId || !path) {
        const info = await getDocPathById(docId);
        if (!info?.notebook || !info?.path) {
            throw new Error("path not found");
        }
        const file = getModelByDockType?.("file");
        if (!file?.selectItem) {
            throw new Error("file dock unavailable");
        }
        await file.selectItem(info.notebook, info.path);
        return;
    }
    const file = getModelByDockType?.("file");
    if (!file?.selectItem) {
        throw new Error("file dock unavailable");
    }
    await file.selectItem(notebookId, path);
}

async function handleLocateDocInTreeForProtyle(plugin, protyle) {
    try {
        const editor = unwrapProtyle(protyle) || findProtyleByElement(protyle?.element);
        const { docId } = resolveProtyleDocId(editor);
        if (!docId) {
            showMessage(plugin.i18n.childDocIndexNoDoc);
            return;
        }
        await locateDocInFileTree(docId, editor);
        showMessage(plugin.i18n.locateInTreeDone);
    } catch (error) {
        console.warn(`${LOG_PREFIX} locateDocInFileTree failed`, error);
        showMessage(plugin.i18n.locateInTreeFailed);
    }
}

async function queryReferencedDocsOutsideChildren(parentId) {
    if (!parentId) {
        return [];
    }
    const parentPathInfo = await getDocPathById(parentId);
    if (!parentPathInfo?.path) {
        return [];
    }
    // Resolve referenced targets to their document ids (doc block itself, or containing root).
    const idStmt = `
SELECT DISTINCT
  CASE WHEN b.type = 'd' THEN b.id ELSE b.root_id END AS id
FROM refs r
JOIN blocks b ON b.id = r.def_block_id
WHERE r.root_id = '${escapeSqlId(parentId)}'
`.replace(/\s+/g, " ").trim();
    const idRows = await runSqlQuery(idStmt);
    const candidateIds = [...new Set(
        (idRows || [])
            .map((row) => row?.id)
            .filter((id) => id && id !== parentId),
    )];
    if (!candidateIds.length) {
        return [];
    }
    const inList = candidateIds.map((id) => `'${escapeSqlId(id)}'`).join(",");
    const metaStmt = `
SELECT id, content AS title, path, box
FROM blocks
WHERE type = 'd' AND id IN (${inList})
`.replace(/\s+/g, " ").trim();
    const rows = await runSqlQuery(metaStmt);
    const result = [];
    for (const row of rows || []) {
        const id = row?.id;
        if (!id) {
            continue;
        }
        const path = row.path || "";
        // Already under this doc (incl. deeper descendants): skip.
        if (isDocPathUnderParent(path, parentPathInfo.path)) {
            continue;
        }
        // Would create a cycle if we move an ancestor under this doc.
        if (isDocPathUnderParent(parentPathInfo.path, path)) {
            continue;
        }
        result.push({
            id,
            title: row.title || id,
            path,
            box: row.box || "",
        });
    }
    return result;
}

async function moveDocsAsChildren(parentId, docIds) {
    if (!parentId || !docIds?.length) {
        return { moved: 0, failed: 0 };
    }
    const response = await fetchSyncPost("/api/filetree/moveDocsByID", {
        fromIDs: docIds,
        toID: parentId,
    });
    if (response && typeof response.code === "number" && response.code !== 0) {
        throw new Error(response.msg || "moveDocsByID failed");
    }
    return { moved: docIds.length, failed: 0 };
}

async function handleGatherReferencedDocsForProtyle(plugin, protyle) {
    if (plugin.gatherRefsBusy) {
        return;
    }
    plugin.gatherRefsBusy = true;
    try {
        const editor = unwrapProtyle(protyle) || findProtyleByElement(protyle?.element);
        const { docId } = resolveProtyleDocId(editor);
        if (!docId) {
            showMessage(plugin.i18n.childDocIndexNoDoc);
            return;
        }
        const candidates = await queryReferencedDocsOutsideChildren(docId);
        if (!candidates.length) {
            showMessage(plugin.i18n.gatherRefsNone);
            return;
        }
        const preview = candidates
            .slice(0, 8)
            .map((item) => `· ${item.title}`)
            .join("\n");
        const extra = candidates.length > 8
            ? formatChildDocIndexMessage(plugin.i18n, "gatherRefsConfirmMore", {
                count: candidates.length - 8,
            })
            : "";
        const confirmed = window.confirm(
            formatChildDocIndexMessage(plugin.i18n, "gatherRefsConfirm", {
                count: candidates.length,
                list: `${preview}${extra ? `\n${extra}` : ""}`,
            }),
        );
        if (!confirmed) {
            return;
        }
        const { moved } = await moveDocsAsChildren(docId, candidates.map((item) => item.id));
        showMessage(formatChildDocIndexMessage(plugin.i18n, "gatherRefsDone", { count: moved }));
    } catch (error) {
        console.warn(`${LOG_PREFIX} gatherReferencedDocs failed`, error);
        showMessage(plugin.i18n.gatherRefsFailed);
    } finally {
        plugin.gatherRefsBusy = false;
    }
}

async function queryReferencedDocIds(rootId) {
    const ids = new Set();
    if (!rootId) {
        return ids;
    }
    const stmt = `
SELECT DISTINCT
  CASE WHEN b.type = 'd' THEN b.id ELSE b.root_id END AS id
FROM refs r
JOIN blocks b ON b.id = r.def_block_id
WHERE r.root_id = '${escapeSqlId(rootId)}'
`.replace(/\s+/g, " ").trim();
    try {
        const rows = await runSqlQuery(stmt);
        (rows || []).forEach((row) => {
            if (row?.id) {
                ids.add(row.id);
            }
        });
    } catch (error) {
        console.warn(`${LOG_PREFIX} queryReferencedDocIds failed`, error);
    }
    return ids;
}

async function queryUnreferencedChildDocs(parentId) {
    if (!parentId) {
        return [];
    }
    const { children } = await queryDirectChildDocs(parentId, createDefaultChildDocIndexConfig());
    if (!children.length) {
        return [];
    }
    const referenced = await queryReferencedDocIds(parentId);
    return children.filter((child) => child?.id && !referenced.has(child.id));
}

async function removeDocById(docId) {
    const response = await fetchSyncPost("/api/filetree/removeDocByID", { id: docId });
    if (response && typeof response.code === "number" && response.code !== 0) {
        throw new Error(response.msg || "removeDocByID failed");
    }
    return response;
}

async function handleDeleteUnreferencedChildrenForProtyle(plugin, protyle) {
    if (plugin.deleteUnrefBusy) {
        return;
    }
    plugin.deleteUnrefBusy = true;
    try {
        const editor = unwrapProtyle(protyle) || findProtyleByElement(protyle?.element);
        const { docId } = resolveProtyleDocId(editor);
        if (!docId) {
            showMessage(plugin.i18n.childDocIndexNoDoc);
            return;
        }
        const candidates = await queryUnreferencedChildDocs(docId);
        if (!candidates.length) {
            showMessage(plugin.i18n.deleteUnrefNone);
            return;
        }
        const withSubtree = candidates.filter((item) => (item.subFileCount || 0) > 0).length;
        const preview = candidates
            .slice(0, 8)
            .map((item) => {
                const sub = (item.subFileCount || 0) > 0
                    ? formatChildDocIndexMessage(plugin.i18n, "deleteUnrefHasChildren", {
                        count: item.subFileCount,
                    })
                    : "";
                return `· ${item.content || item.id}${sub}`;
            })
            .join("\n");
        const extra = candidates.length > 8
            ? formatChildDocIndexMessage(plugin.i18n, "deleteUnrefConfirmMore", {
                count: candidates.length - 8,
            })
            : "";
        const confirmed = window.confirm(
            formatChildDocIndexMessage(plugin.i18n, "deleteUnrefConfirm", {
                count: candidates.length,
                subtreeHint: withSubtree > 0
                    ? formatChildDocIndexMessage(plugin.i18n, "deleteUnrefSubtreeHint", {
                        count: withSubtree,
                    })
                    : "",
                list: `${preview}${extra ? `\n${extra}` : ""}`,
            }),
        );
        if (!confirmed) {
            return;
        }
        let deleted = 0;
        let failed = 0;
        for (const child of candidates) {
            try {
                await removeDocById(child.id);
                deleted += 1;
            } catch (error) {
                failed += 1;
                console.warn(`${LOG_PREFIX} removeDocByID failed`, child.id, error);
            }
        }
        if (failed > 0) {
            showMessage(formatChildDocIndexMessage(plugin.i18n, "deleteUnrefPartial", {
                deleted,
                failed,
            }));
            return;
        }
        showMessage(formatChildDocIndexMessage(plugin.i18n, "deleteUnrefDone", { count: deleted }));
    } catch (error) {
        console.warn(`${LOG_PREFIX} deleteUnreferencedChildren failed`, error);
        showMessage(plugin.i18n.deleteUnrefFailed);
    } finally {
        plugin.deleteUnrefBusy = false;
    }
}

const BREADCRUMB_BTN_CHILD_INDEX = "fhelper-child-doc-index";
const BREADCRUMB_BTN_LOCATE = "fhelper-locate-in-tree";
const BREADCRUMB_BTN_GATHER = "fhelper-gather-refs";
const BREADCRUMB_BTN_DELETE_UNREF = "fhelper-delete-unref-children";
const FHELPER_ICON_CHILD_INDEX = "iconFhelperChildIndex";
const FHELPER_ICON_GATHER_REFS = "iconFhelperGatherRefs";
const FHELPER_ICON_DELETE_UNREF = "iconFhelperDeleteUnref";

const BREADCRUMB_DOC_ACTIONS = [
    {
        type: BREADCRUMB_BTN_CHILD_INDEX,
        iconHref: `#${FHELPER_ICON_CHILD_INDEX}`,
        tipKey: "childDocIndexBreadcrumbTip",
        run: (plugin, editor) => handleChildDocIndexForProtyle(plugin, editor),
        failKey: "childDocIndexFailed",
    },
    {
        type: BREADCRUMB_BTN_LOCATE,
        iconHref: "#iconFocus",
        tipKey: "locateInTreeBreadcrumbTip",
        run: (plugin, editor) => handleLocateDocInTreeForProtyle(plugin, editor),
        failKey: "locateInTreeFailed",
    },
    {
        type: BREADCRUMB_BTN_GATHER,
        iconHref: `#${FHELPER_ICON_GATHER_REFS}`,
        tipKey: "gatherRefsBreadcrumbTip",
        run: (plugin, editor) => handleGatherReferencedDocsForProtyle(plugin, editor),
        failKey: "gatherRefsFailed",
    },
    {
        type: BREADCRUMB_BTN_DELETE_UNREF,
        iconHref: `#${FHELPER_ICON_DELETE_UNREF}`,
        tipKey: "deleteUnrefBreadcrumbTip",
        run: (plugin, editor) => handleDeleteUnreferencedChildrenForProtyle(plugin, editor),
        failKey: "deleteUnrefFailed",
    },
];

async function listOpenNotebooks() {
    try {
        const response = await fetchSyncPost("/api/notebook/lsNotebooks", {});
        const notebooks = response?.data?.notebooks || response?.notebooks || [];
        return (notebooks || []).filter((item) => item && !item.closed);
    } catch (error) {
        console.warn(`${LOG_PREFIX} listOpenNotebooks failed`, error);
        return [];
    }
}

function getBreadcrumbRoot(protyle) {
    const p = unwrapProtyle(protyle);
    const bar = p?.breadcrumb?.element;
    // In SiYuan, breadcrumb.element is the __bar; its parent is .protyle-breadcrumb.
    let root = bar?.parentElement;
    if (root?.classList?.contains("protyle-breadcrumb")) {
        return root;
    }
    root = p?.element?.querySelector?.(".protyle-breadcrumb");
    return root || null;
}

function bindDocActionBreadcrumbButton(plugin, btn, action) {
    const tip = plugin.i18n[action.tipKey] || action.tipKey;
    const fresh = btn.cloneNode(true);
    btn.replaceWith(fresh);
    fresh.setAttribute("aria-label", tip);
    fresh.title = tip;
    fresh.innerHTML = `<svg><use xlink:href="${action.iconHref}"></use></svg>`;
    fresh.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        const editor = findProtyleByElement(fresh);
        Promise.resolve(action.run(plugin, editor)).catch((error) => {
            console.warn(`${LOG_PREFIX} breadcrumb action failed`, action.type, error);
            showMessage(plugin.i18n[action.failKey] || plugin.i18n.childDocIndexFailed);
        });
    }, true);
    return fresh;
}

function ensureDocActionBreadcrumbButtons(plugin, protyle) {
    const root = getBreadcrumbRoot(protyle);
    if (!root) {
        return;
    }
    const lockBtn = root.querySelector('[data-type="readonly"]');
    let insertBefore = lockBtn;
    BREADCRUMB_DOC_ACTIONS.forEach((action) => {
        let btn = root.querySelector(`[data-type="${action.type}"]`);
        if (!btn) {
            btn = document.createElement("button");
            btn.type = "button";
            btn.className = "block__icon fn__flex-center ariaLabel";
            btn.setAttribute("data-type", action.type);
            btn.innerHTML = `<svg><use xlink:href="${action.iconHref}"></use></svg>`;
            if (insertBefore) {
                root.insertBefore(btn, insertBefore);
            } else {
                root.appendChild(btn);
            }
        }
        const bound = bindDocActionBreadcrumbButton(plugin, btn, action);
        insertBefore = bound.nextElementSibling;
    });
}

function patchChildDocIndexBreadcrumbButtons(plugin) {
    getAllEditor().forEach(({ protyle }) => {
        ensureDocActionBreadcrumbButtons(plugin, protyle);
    });
}

function syncDocRefStyleFeature(plugin) {
    const enabled = plugin.config.docRefStyle?.enabled === true;
    setDocRefStyleCssEnabled(enabled);
    if (!enabled) {
        clearAllDocRefRetries(plugin);
        unwatchAllDocRefMutations(plugin);
        unwatchOutlineDocRefs(plugin);
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
    ensureOutlineDocRefWatch(plugin);
    decorateAllOpenEditors(plugin).catch((error) => {
        console.warn(`${LOG_PREFIX} decorateAllOpenEditors failed`, error);
    });
    scheduleDecorateOutlineDocRefs(plugin);
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

function isInsideImageLikeInline(node) {
    return !!node?.parentElement?.closest?.('.img, [data-type~="img"]');
}

const PANGU_TEXT_WALKER_FILTER = {
    acceptNode(node) {
        if (isInsideBlockCode(node) || isInsideImageLikeInline(node)) {
            return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
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

function shouldKeepPanguHtmlRootOuter(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) {
        return false;
    }
    if (el.hasAttribute("data-node-id")) {
        return true;
    }
    const tag = el.tagName;
    if (tag === "IMG" || tag === "BR" || tag === "HR" || tag === "INPUT" || tag === "VIDEO" || tag === "AUDIO" || tag === "IFRAME") {
        return true;
    }
    const dataType = el.getAttribute("data-type") || "";
    if (dataType.includes("img") || el.classList?.contains("img")) {
        return true;
    }
    return false;
}

function serializePanguHtmlContainer(container, originalHtml) {
    if (container.childNodes.length === 1 && container.firstElementChild) {
        const el = container.firstElementChild;
        // Keep block roots / void media nodes; unwrapping them breaks image paste.
        if (shouldKeepPanguHtmlRootOuter(el)) {
            return el.outerHTML;
        }
        return el.innerHTML;
    }
    let result = "";
    container.childNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
            result += node.outerHTML;
        } else if (node.nodeType === Node.TEXT_NODE) {
            result += node.textContent;
        }
    });
    return result || originalHtml;
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
    return serializePanguHtmlContainer(container, html);
}

function isBinaryClipboardPaste(detail) {
    if (!detail) {
        return false;
    }
    if (detail.files && detail.files.length > 0) {
        return true;
    }
    if (detail.localFiles && detail.localFiles.length > 0) {
        return true;
    }
    return false;
}

function clipboardHtmlContainsImage(html) {
    if (typeof html !== "string" || html === "") {
        return false;
    }
    // Native <img>, SiYuan span.img / data-type=img (internal multi-block copy).
    return /<img\b/i.test(html)
        || /data-type=["'][^"']*\bimg\b/i.test(html)
        || /class=["'][^"']*\bimg\b/i.test(html);
}

function shouldSkipPanguPasteRewrite(detail) {
    // Any image-bearing paste must keep SiYuan's native path (files upload or siyuanHTML blocks).
    // Rewriting HTML here can drop images when text blocks are copied together with images.
    if (isBinaryClipboardPaste(detail)) {
        return true;
    }
    return clipboardHtmlContainsImage(detail?.siyuanHTML)
        || clipboardHtmlContainsImage(detail?.textHTML);
}

function buildPanguPastePayload(detail) {
    if (shouldSkipPanguPasteRewrite(detail)) {
        return {};
    }
    const payload = {};
    if (typeof detail.siyuanHTML === "string" && detail.siyuanHTML !== "") {
        const next = addPanguSpacingToHtml(detail.siyuanHTML);
        if (next && next !== detail.siyuanHTML) {
            payload.siyuanHTML = next;
        }
    }
    if (typeof detail.textPlain === "string" && detail.textPlain !== "") {
        const next = addPanguSpacingToMarkdownAware(detail.textPlain);
        if (next && next !== detail.textPlain) {
            payload.textPlain = next;
        }
    }
    if (typeof detail.textHTML === "string" && detail.textHTML !== "") {
        const next = addPanguSpacingToHtml(detail.textHTML);
        if (next && next !== detail.textHTML) {
            payload.textHTML = next;
        }
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
        syncAllChildNavHostLayouts(plugin);
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
        childDocIndex: createDefaultChildDocIndexConfig(),
        childDocWidget: createDefaultChildDocWidgetConfig(),
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
    patchChildDocIndexBreadcrumbButtons(plugin);
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
    childDocWidgetEnableEl = null;
    childDocWidgetModeEl = null;
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
    childNavWsTimer = null;
    childNavMountTimers = null;
    childNavCleanupDocs = null;
    layoutRefreshTimer = null;
    windowResizeHandler = null;
    childDocIndexProgressDialog = null;
    childDocIndexCancelFlag = null;
    childDocIndexNotebookSelectEl = null;
    childDocIndexBusy = false;
    gatherRefsBusy = false;
    deleteUnrefBusy = false;
    breadcrumbMoreHandler = null;

    updateProtyleToolbar(toolbar) {
        toolbar.push("|");
        toolbar.push({
            name: "fhelper-child-doc-index",
            icon: FHELPER_ICON_CHILD_INDEX,
            hotkey: "",
            tipPosition: "n",
            tip: this.i18n.childDocIndexToolbarTip,
            click: (protyle) => {
                handleChildDocIndexForProtyle(this, protyle).catch((error) => {
                    console.warn(`${LOG_PREFIX} handleChildDocIndexForProtyle failed`, error);
                    showMessage(this.i18n.childDocIndexFailed);
                });
            },
        });
        toolbar.push({
            name: "fhelper-locate-in-tree",
            icon: "iconFocus",
            hotkey: "",
            tipPosition: "n",
            tip: this.i18n.locateInTreeToolbarTip,
            click: (protyle) => {
                handleLocateDocInTreeForProtyle(this, protyle).catch((error) => {
                    console.warn(`${LOG_PREFIX} handleLocateDocInTreeForProtyle failed`, error);
                    showMessage(this.i18n.locateInTreeFailed);
                });
            },
        });
        toolbar.push({
            name: "fhelper-gather-refs",
            icon: FHELPER_ICON_GATHER_REFS,
            hotkey: "",
            tipPosition: "n",
            tip: this.i18n.gatherRefsToolbarTip,
            click: (protyle) => {
                handleGatherReferencedDocsForProtyle(this, protyle).catch((error) => {
                    console.warn(`${LOG_PREFIX} handleGatherReferencedDocsForProtyle failed`, error);
                    showMessage(this.i18n.gatherRefsFailed);
                });
            },
        });
        toolbar.push({
            name: "fhelper-delete-unref-children",
            icon: FHELPER_ICON_DELETE_UNREF,
            hotkey: "",
            tipPosition: "n",
            tip: this.i18n.deleteUnrefToolbarTip,
            click: (protyle) => {
                handleDeleteUnreferencedChildrenForProtyle(this, protyle).catch((error) => {
                    console.warn(`${LOG_PREFIX} handleDeleteUnreferencedChildrenForProtyle failed`, error);
                    showMessage(this.i18n.deleteUnrefFailed);
                });
            },
        });
        return toolbar;
    }

    onload() {
        this.data[STORAGE_NAME] = createDefaultConfig();

        this.addIcons(`
<symbol id="${FHELPER_ICON_CHILD_INDEX}" viewBox="0 0 32 32">
  <path d="M5 5h9v5H5zm13 0h9v5h-9zM5 14h22v2.2H5zm0 6h14v2.2H5zm0 5h18v2.2H5z" fill="currentColor"></path>
  <path d="M24 19.2l5 3.4-5 3.4v-2.2h-6.5v-2.4H24z" fill="currentColor"></path>
</symbol>
<symbol id="${FHELPER_ICON_GATHER_REFS}" viewBox="0 0 32 32">
  <path d="M6 4.5h11v7H6zm0 11h8v7H6zm14-5.5h6.5v17H20z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"></path>
  <path d="M17 8h4v2.2h-4zM14 19h4v2.2h-4z" fill="currentColor"></path>
</symbol>
<symbol id="${FHELPER_ICON_DELETE_UNREF}" viewBox="0 0 32 32">
  <path d="M7 6h18v2.4H7zm3.2 4.2h11.6v16.2H10.2z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"></path>
  <path d="M13 13.2v9M19 13.2v9M12.2 6V4.2h7.6V6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"></path>
  <path d="M22.5 20.5l5 5M27.5 20.5l-5 5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"></path>
</symbol>
`);

        this.addCommand({
            langKey: "openFhelperSetting",
            hotkey: "",
            callback: () => {
                this.openSetting();
            },
        });

        this.addCommand({
            langKey: "childDocIndexCurrentDoc",
            hotkey: "",
            editorCallback: (protyle) => {
                handleChildDocIndexForProtyle(this, protyle).catch((error) => {
                    console.warn(`${LOG_PREFIX} handleChildDocIndexForProtyle failed`, error);
                    showMessage(this.i18n.childDocIndexFailed);
                });
            },
        });

        this.addCommand({
            langKey: "locateInTreeCurrentDoc",
            hotkey: "",
            editorCallback: (protyle) => {
                handleLocateDocInTreeForProtyle(this, protyle).catch((error) => {
                    console.warn(`${LOG_PREFIX} handleLocateDocInTreeForProtyle failed`, error);
                    showMessage(this.i18n.locateInTreeFailed);
                });
            },
        });

        this.addCommand({
            langKey: "gatherRefsCurrentDoc",
            hotkey: "",
            editorCallback: (protyle) => {
                handleGatherReferencedDocsForProtyle(this, protyle).catch((error) => {
                    console.warn(`${LOG_PREFIX} handleGatherReferencedDocsForProtyle failed`, error);
                    showMessage(this.i18n.gatherRefsFailed);
                });
            },
        });

        this.addCommand({
            langKey: "deleteUnrefCurrentDoc",
            hotkey: "",
            editorCallback: (protyle) => {
                handleDeleteUnreferencedChildrenForProtyle(this, protyle).catch((error) => {
                    console.warn(`${LOG_PREFIX} handleDeleteUnreferencedChildrenForProtyle failed`, error);
                    showMessage(this.i18n.deleteUnrefFailed);
                });
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

        this.breadcrumbMoreHandler = ({ detail }) => {
            const protyle = detail?.protyle;
            // Official detail.menu is forced into the "插件" submenu by emitOpenMenu.
            // Top-level Menu supports addItem (not addSeparator); use that for first-level entries.
            const topMenu = window.siyuan?.menus?.menu;
            if (!topMenu?.addItem || !protyle) {
                return;
            }
            topMenu.addItem({ type: "separator", id: "fhelper-breadcrumb-sep" });
            topMenu.addItem({
                id: "fhelper-child-doc-index",
                icon: FHELPER_ICON_CHILD_INDEX,
                label: this.i18n.childDocIndexMenuLabel,
                click: () => {
                    handleChildDocIndexForProtyle(this, protyle).catch((error) => {
                        console.warn(`${LOG_PREFIX} breadcrumbmore child index failed`, error);
                        showMessage(this.i18n.childDocIndexFailed);
                    });
                },
            });
            topMenu.addItem({
                id: "fhelper-locate-in-tree",
                icon: "iconFocus",
                label: this.i18n.locateInTreeMenuLabel,
                click: () => {
                    handleLocateDocInTreeForProtyle(this, protyle).catch((error) => {
                        console.warn(`${LOG_PREFIX} breadcrumbmore locate failed`, error);
                        showMessage(this.i18n.locateInTreeFailed);
                    });
                },
            });
            topMenu.addItem({
                id: "fhelper-gather-refs",
                icon: FHELPER_ICON_GATHER_REFS,
                label: this.i18n.gatherRefsMenuLabel,
                click: () => {
                    handleGatherReferencedDocsForProtyle(this, protyle).catch((error) => {
                        console.warn(`${LOG_PREFIX} breadcrumbmore gather failed`, error);
                        showMessage(this.i18n.gatherRefsFailed);
                    });
                },
            });
            topMenu.addItem({
                id: "fhelper-delete-unref-children",
                icon: FHELPER_ICON_DELETE_UNREF,
                label: this.i18n.deleteUnrefMenuLabel,
                click: () => {
                    handleDeleteUnreferencedChildrenForProtyle(this, protyle).catch((error) => {
                        console.warn(`${LOG_PREFIX} breadcrumbmore delete unref failed`, error);
                        showMessage(this.i18n.deleteUnrefFailed);
                    });
                },
            });
        };
        this.eventBus.on("open-menu-breadcrumbmore", this.breadcrumbMoreHandler);

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
        this.childDocIndexProgressDialog?.destroy();
        this.childDocIndexProgressDialog = null;
        this.childDocIndexCancelFlag = null;
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
        if (this.childNavWsTimer) {
            window.clearTimeout(this.childNavWsTimer);
            this.childNavWsTimer = null;
        }
        if (this.childNavMountTimers) {
            this.childNavMountTimers.forEach((timer) => window.clearTimeout(timer));
            this.childNavMountTimers.clear();
            this.childNavMountTimers = null;
        }
        this.childNavCleanupDocs = null;
        removeAllChildNavHosts();
        if (this.breadcrumbMoreHandler) {
            this.eventBus.off("open-menu-breadcrumbmore", this.breadcrumbMoreHandler);
            this.breadcrumbMoreHandler = null;
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
                childDocIndex: {
                    ...createDefaultChildDocIndexConfig(),
                    ...(data.childDocIndex || {}),
                    sortBy: "tree",
                },
                childDocWidget: {
                    ...createDefaultChildDocWidgetConfig(),
                    ...(data.childDocWidget || {}),
                    mode: normalizeChildNavMode(data.childDocWidget?.mode),
                },
            };
            this.data[STORAGE_NAME] = this.config;
            this.applyImageCenterStyle();
            syncPanguSpacingWatchers(this);
            syncDocRefStyleFeature(this);
            if (this.config.imageScale?.enabled) {
                scheduleLayoutRefresh(this);
            }
            syncAllChildNavPanels(this);
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
                    || data.docRefStyle
                    || data.childDocIndex
                    || data.childDocWidget);
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
            childDocIndex: { ...(this.config.childDocIndex || createDefaultChildDocIndexConfig()) },
            childDocWidget: { ...(this.config.childDocWidget || createDefaultChildDocWidgetConfig()) },
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

    confirmAndRunGlobalChildDocIndex() {
        const confirmed = window.confirm(this.i18n.childDocIndexGlobalConfirm);
        if (!confirmed) {
            return;
        }
        this.runGlobalChildDocIndexWithProgress({
            scope: "all",
            notebookIds: [],
        });
    }

    confirmAndRunNotebookChildDocIndex() {
        const notebookId = this.childDocIndexNotebookSelectEl?.value || "";
        if (!notebookId) {
            showMessage(this.i18n.childDocIndexNotebookRequired);
            return;
        }
        const notebookName = this.childDocIndexNotebookSelectEl?.selectedOptions?.[0]?.textContent
            || notebookId;
        const confirmed = window.confirm(formatChildDocIndexMessage(this.i18n, "childDocIndexNotebookConfirm", {
            name: notebookName,
        }));
        if (!confirmed) {
            return;
        }
        this.config.childDocIndex = {
            ...(this.config.childDocIndex || createDefaultChildDocIndexConfig()),
            selectedNotebookId: notebookId,
        };
        this.data[STORAGE_NAME] = this.config;
        this.saveData(STORAGE_NAME, this.config).catch((error) => {
            console.warn(`${LOG_PREFIX} save notebook selection failed`, error);
        });
        this.runGlobalChildDocIndexWithProgress({
            scope: "selectedNotebooks",
            notebookIds: [notebookId],
        });
    }

    runGlobalChildDocIndexWithProgress(overrideConfig = null) {
        if (this.childDocIndexProgressDialog) {
            this.childDocIndexProgressDialog.destroy();
            this.childDocIndexProgressDialog = null;
        }
        this.childDocIndexCancelFlag = { cancelled: false };
        const cancelFlag = this.childDocIndexCancelFlag;
        const statusEl = document.createElement("div");
        statusEl.className = "fn__flex-column";
        statusEl.style.gap = "12px";
        statusEl.style.padding = "8px 4px";
        const progressText = document.createElement("div");
        progressText.textContent = this.i18n.childDocIndexGlobalRunning;
        const detailText = document.createElement("div");
        detailText.className = "b3-label__text";
        detailText.textContent = "";
        statusEl.appendChild(progressText);
        statusEl.appendChild(detailText);
        const footer = document.createElement("div");
        footer.className = "fn__flex";
        footer.style.justifyContent = "flex-end";
        const cancelBtn = document.createElement("button");
        cancelBtn.className = "b3-button b3-button--cancel";
        cancelBtn.textContent = this.i18n.childDocIndexGlobalCancel;
        cancelBtn.addEventListener("click", () => {
            cancelFlag.cancelled = true;
            cancelBtn.disabled = true;
            progressText.textContent = this.i18n.childDocIndexGlobalCancelling;
        });
        footer.appendChild(cancelBtn);
        statusEl.appendChild(footer);
        this.childDocIndexProgressDialog = new Dialog({
            title: this.i18n.childDocIndexGlobalProgressTitle,
            content: "",
            width: "520px",
            height: "220px",
            destroyCallback: () => {
                this.childDocIndexProgressDialog = null;
                this.childDocIndexCancelFlag = null;
            },
        });
        const body = this.childDocIndexProgressDialog.element.querySelector(".b3-dialog__body");
        body?.appendChild(statusEl);
        const runtimeConfig = {
            ...(this.config.childDocIndex || createDefaultChildDocIndexConfig()),
            ...(overrideConfig || {}),
        };
        runGlobalChildDocIndex(this, {
            config: runtimeConfig,
            isCancelled: () => cancelFlag.cancelled,
            onProgress: ({ current, total, added, skipped, failed }) => {
                progressText.textContent = formatChildDocIndexMessage(this.i18n, "childDocIndexGlobalProgress", {
                    current,
                    total,
                });
                detailText.textContent = formatChildDocIndexMessage(this.i18n, "childDocIndexGlobalDetail", {
                    added,
                    skipped,
                    failed,
                });
            },
        }).then((summary) => {
            cancelBtn.remove();
            if (summary.cancelled) {
                progressText.textContent = formatChildDocIndexMessage(this.i18n, "childDocIndexGlobalDoneCancelled", {
                    parents: summary.parents,
                    added: summary.added,
                    skipped: summary.skipped,
                    failed: summary.failed,
                });
            } else {
                progressText.textContent = formatChildDocIndexMessage(this.i18n, "childDocIndexGlobalDone", {
                    parents: summary.parents,
                    added: summary.added,
                    skipped: summary.skipped,
                    failed: summary.failed,
                });
            }
            detailText.textContent = "";
            const closeBtn = document.createElement("button");
            closeBtn.className = "b3-button b3-button--text";
            closeBtn.textContent = this.i18n.confirm;
            closeBtn.addEventListener("click", () => {
                this.childDocIndexProgressDialog?.destroy();
            });
            footer.appendChild(closeBtn);
        }).catch((error) => {
            console.warn(`${LOG_PREFIX} runGlobalChildDocIndex failed`, error);
            progressText.textContent = this.i18n.childDocIndexFailed;
            detailText.textContent = String(error?.message || error || "");
            cancelBtn.remove();
            const closeBtn = document.createElement("button");
            closeBtn.className = "b3-button b3-button--text";
            closeBtn.textContent = this.i18n.confirm;
            closeBtn.addEventListener("click", () => {
                this.childDocIndexProgressDialog?.destroy();
            });
            footer.appendChild(closeBtn);
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
        if (this.childDocWidgetEnableEl) {
            this.config.childDocWidget = {
                ...(this.config.childDocWidget || createDefaultChildDocWidgetConfig()),
                enabled: this.childDocWidgetEnableEl.checked,
            };
        }
        if (this.childDocWidgetModeEl) {
            this.config.childDocWidget = {
                ...(this.config.childDocWidget || createDefaultChildDocWidgetConfig()),
                mode: normalizeChildNavMode(this.childDocWidgetModeEl.value),
            };
        }
        if (this.childDocIndexNotebookSelectEl) {
            this.config.childDocIndex = {
                ...(this.config.childDocIndex || createDefaultChildDocIndexConfig()),
                selectedNotebookId: this.childDocIndexNotebookSelectEl.value || "",
            };
        }
    }

    populateChildDocIndexNotebookSelect(selectEl) {
        if (!selectEl) {
            return;
        }
        selectEl.innerHTML = "";
        const loadingOpt = document.createElement("option");
        loadingOpt.value = "";
        loadingOpt.textContent = this.i18n.childDocIndexNotebookLoading;
        selectEl.appendChild(loadingOpt);
        listOpenNotebooks().then((notebooks) => {
            if (!selectEl.isConnected) {
                return;
            }
            selectEl.innerHTML = "";
            const placeholder = document.createElement("option");
            placeholder.value = "";
            placeholder.textContent = this.i18n.childDocIndexNotebookPlaceholder;
            selectEl.appendChild(placeholder);
            notebooks.forEach((notebook) => {
                const opt = document.createElement("option");
                opt.value = notebook.id;
                opt.textContent = notebook.name || notebook.id;
                selectEl.appendChild(opt);
            });
            const saved = this.config.childDocIndex?.selectedNotebookId;
            if (saved && [...selectEl.options].some((opt) => opt.value === saved)) {
                selectEl.value = saved;
            }
        }).catch((error) => {
            console.warn(`${LOG_PREFIX} populateChildDocIndexNotebookSelect failed`, error);
            if (selectEl.isConnected) {
                selectEl.innerHTML = "";
                const errOpt = document.createElement("option");
                errOpt.value = "";
                errOpt.textContent = this.i18n.childDocIndexNotebookLoadFailed;
                selectEl.appendChild(errOpt);
            }
        });
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
        syncAllChildNavPanels(this);
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

        const childDocWidget = this.config.childDocWidget || createDefaultChildDocWidgetConfig();
        const childNavSection = this.createSettingSection(this.i18n.sectionChildDocWidget);
        this.childDocWidgetEnableEl = this.createSettingSwitch(childDocWidget.enabled === true);
        childNavSection.appendChild(this.createSettingRow({
            title: this.i18n.childDocWidgetEnable,
            description: this.i18n.childDocWidgetEnableDesc,
            control: this.childDocWidgetEnableEl,
        }));
        this.childDocWidgetModeEl = document.createElement("select");
        this.childDocWidgetModeEl.className = "b3-select";
        [
            { value: "direct", label: this.i18n.childDocWidgetModeDirect },
            { value: "nested", label: this.i18n.childDocWidgetModeNested },
        ].forEach(({ value, label }) => {
            const opt = document.createElement("option");
            opt.value = value;
            opt.textContent = label;
            this.childDocWidgetModeEl.appendChild(opt);
        });
        this.childDocWidgetModeEl.value = normalizeChildNavMode(childDocWidget.mode);
        childNavSection.appendChild(this.createSettingRow({
            title: this.i18n.childDocWidgetMode,
            description: this.i18n.childDocWidgetModeDesc,
            control: this.childDocWidgetModeEl,
        }));
        panel.appendChild(childNavSection);

        const childDocIndexSection = this.createSettingSection(this.i18n.sectionChildDocIndex);
        const globalIndexBtn = document.createElement("button");
        globalIndexBtn.type = "button";
        globalIndexBtn.className = "b3-button b3-button--outline";
        globalIndexBtn.textContent = this.i18n.childDocIndexGlobalBtn;
        globalIndexBtn.addEventListener("click", () => {
            this.confirmAndRunGlobalChildDocIndex();
        });
        childDocIndexSection.appendChild(this.createSettingRow({
            title: this.i18n.childDocIndexGlobalTitle,
            description: this.i18n.childDocIndexGlobalDesc,
            control: globalIndexBtn,
        }));

        const notebookControls = document.createElement("div");
        notebookControls.className = "fn__flex";
        notebookControls.style.gap = "8px";
        notebookControls.style.alignItems = "center";
        notebookControls.style.flexWrap = "wrap";
        notebookControls.style.justifyContent = "flex-end";
        const notebookSelect = document.createElement("select");
        notebookSelect.className = "b3-select";
        notebookSelect.style.minWidth = "180px";
        notebookSelect.style.maxWidth = "280px";
        this.childDocIndexNotebookSelectEl = notebookSelect;
        this.populateChildDocIndexNotebookSelect(notebookSelect);
        const notebookIndexBtn = document.createElement("button");
        notebookIndexBtn.type = "button";
        notebookIndexBtn.className = "b3-button b3-button--outline";
        notebookIndexBtn.textContent = this.i18n.childDocIndexNotebookBtn;
        notebookIndexBtn.addEventListener("click", () => {
            this.confirmAndRunNotebookChildDocIndex();
        });
        notebookControls.appendChild(notebookSelect);
        notebookControls.appendChild(notebookIndexBtn);
        childDocIndexSection.appendChild(this.createSettingRow({
            title: this.i18n.childDocIndexNotebookTitle,
            description: this.i18n.childDocIndexNotebookDesc,
            control: notebookControls,
        }));
        panel.appendChild(childDocIndexSection);

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
        let style = document.getElementById(SETTING_STYLE_ID);
        if (!style) {
            style = document.createElement("style");
            style.id = SETTING_STYLE_ID;
            document.head.appendChild(style);
        }
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
.fhelper-child-nav {
    margin: 4px 0 10px;
    user-select: none;
}
.fhelper-child-nav__shell {
    padding: 8px 10px;
    border: 1px solid var(--b3-border-color);
    border-radius: 8px;
    background: var(--b3-theme-background);
    box-shadow: none;
}
.fhelper-child-nav__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 8px;
}
.fhelper-child-nav__title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 650;
}
.fhelper-child-nav__badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 22px;
    height: 20px;
    padding: 0 6px;
    border-radius: 999px;
    background: rgba(15, 118, 110, 0.14);
    color: #0f766e;
    font-size: 11px;
    font-weight: 700;
}
.fhelper-child-nav__meta {
    color: var(--b3-theme-on-surface);
    opacity: 0.75;
    font-size: 12px;
}
.fhelper-child-nav__tree {
    display: flex;
    flex-direction: column;
    gap: 2px;
}
.fhelper-child-nav__row {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 30px;
    padding: 4px 8px;
    border-radius: 10px;
    cursor: pointer;
}
.fhelper-child-nav__row:hover {
    background: var(--b3-list-hover);
}
.fhelper-child-nav__twist {
    width: 18px;
    height: 18px;
    border: 0;
    background: transparent;
    color: var(--b3-theme-on-surface);
    border-radius: 6px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    flex: 0 0 auto;
}
.fhelper-child-nav__twist.is-placeholder {
    visibility: hidden;
}
.fhelper-child-nav__twist svg {
    width: 12px;
    height: 12px;
    transition: transform .15s ease;
}
.fhelper-child-nav__twist.is-open svg {
    transform: rotate(90deg);
}
.fhelper-child-nav__icon {
    width: 18px;
    flex: 0 0 auto;
    text-align: center;
}
.fhelper-child-nav__label {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.fhelper-child-nav__children {
    margin-left: 14px;
    padding-left: 10px;
    border-left: 1px dashed var(--b3-border-color);
    display: flex;
    flex-direction: column;
    gap: 2px;
}
.fhelper-child-nav__empty,
.fhelper-child-nav__error {
    padding: 10px 8px;
    font-size: 12.5px;
    color: var(--b3-theme-on-surface);
    opacity: 0.8;
}
.fhelper-child-nav__error {
    color: var(--b3-theme-error);
    opacity: 1;
}
`;
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
        this.childDocWidgetEnableEl = null;
        this.childDocWidgetModeEl = null;
        this.childDocIndexNotebookSelectEl = null;
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
