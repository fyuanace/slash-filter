const {
    Plugin,
    Dialog,
    Menu,
    getAllEditor,
    showMessage,
    fetchSyncPost,
    getModelByDockType,
    expandDocTree,
    openTab,
    Constants,
    getFrontend,
    confirm,
    exitSiYuan,
    openEmoji,
} = require("siyuan");

const STORAGE_NAME = "fhelper-config.json";
const LEGACY_STORAGE_NAMES = ["slash-filter-config.json", "slash-filter-config"];
const CONFIG_SYNC_DIR_NAME = "config-sync";
const CONFIG_SYNC_BUILTIN_THEMES = new Set(["daylight", "midnight"]);
const CONFIG_SYNC_WAIT_MS = 180000;
const CONFIG_SYNC_QUIET_MS = 12000;
const CONFIG_SYNC_AFTER_SYNC_MS = 400;
const ZWSP = "\u200b";
const SCREEN_DPI = 96;
const SIYUAN_LOCAL_ZOOM_KEY = "local-zoom";
const IMAGE_CENTER_STYLE_ID = "fhelper-img-center-css";
const SETTING_STYLE_ID = "fhelper-setting-css";
const FHELPER_TOOLTIP_STYLE_ID = "fhelper-tooltip-css";
const DOC_REF_STYLE_ID = "fhelper-doc-ref-css";
const LEGACY_FILE_TREE_STYLE_ID = "fhelper-file-tree-css";
const CHILD_NAV_FLAG_ATTR = "custom-fhelper-child-nav";
const CHILD_NAV_TARGET_ATTR = "custom-fhelper-child-nav-target";
const CHILD_NAV_END_ATTR = "custom-fhelper-child-nav-end";
const CHILD_NAV_STYLE_ID = "fhelper-child-nav-css";
const CHILD_NAV_ICON_STYLE_ID = "fhelper-child-nav-icon-css";
const CHILD_NAV_HTML_CLASS = "fhelper-child-nav-style";
const CHILD_NAV_SQL_LIMIT = 4096;
const NEW_CHILD_DOC_NAV_REF_SLASH_ID = "newChildDocNavRef";
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

function removeLegacyFileTreeHideCss() {
    document.getElementById(LEGACY_FILE_TREE_STYLE_ID)?.remove();
}

const LOCAL_IMAGES_STORAGE_KEY = (typeof Constants !== "undefined" && Constants.LOCAL_IMAGES) || "local-images";
const DEFAULT_LOCAL_IMAGES = {
    file: "1f4c4",
    folder: "1f4d1",
    note: "1f5c3",
};

function getSiyuanAppId() {
    return (typeof Constants !== "undefined" && Constants.SIYUAN_APPID) || "";
}

function getLocalImages() {
    const stored = window.siyuan?.storage?.[LOCAL_IMAGES_STORAGE_KEY] || {};
    return {
        file: stored.file || DEFAULT_LOCAL_IMAGES.file,
        folder: stored.folder || DEFAULT_LOCAL_IMAGES.folder,
        note: stored.note || DEFAULT_LOCAL_IMAGES.note,
    };
}

function localImageToHtml(unicode) {
    const raw = String(unicode || "").trim();
    if (!raw) {
        return "";
    }
    if (raw.startsWith("api/icon/getDynamicIcon")) {
        return `<img src="${raw}">`;
    }
    if (raw.includes(".")) {
        return `<img src="/emojis/${raw}">`;
    }
    return unicodeHexToEmoji(raw) || raw;
}

function refreshFileTreeDefaultIcons(prev, next) {
    const selectors = [
        ".sy__file .b3-list-item__icon",
        ".file-tree .b3-list-item__icon",
        '[data-type="sidebar-file"] .b3-list-item__icon',
    ].join(",");
    ["file", "folder", "note"].forEach((key) => {
        if (!prev?.[key] || prev[key] === next[key]) {
            return;
        }
        const oldHtml = localImageToHtml(prev[key]);
        const newHtml = localImageToHtml(next[key]);
        document.querySelectorAll(selectors).forEach((el) => {
            if (el.innerHTML === oldHtml) {
                el.innerHTML = newHtml;
            }
        });
    });
    scheduleRefreshChildNavRefIcons();
}

async function persistLocalImages(partial) {
    const prev = getLocalImages();
    const next = {
        ...prev,
        ...partial,
    };
    Object.keys(DEFAULT_LOCAL_IMAGES).forEach((key) => {
        if (!next[key]) {
            next[key] = DEFAULT_LOCAL_IMAGES[key];
        }
    });
    if (!window.siyuan.storage) {
        window.siyuan.storage = {};
    }
    window.siyuan.storage[LOCAL_IMAGES_STORAGE_KEY] = next;
    const payload = {
        key: LOCAL_IMAGES_STORAGE_KEY,
        val: next,
    };
    const appId = getSiyuanAppId();
    if (appId) {
        payload.app = appId;
    }
    await fetchSyncPost("/api/storage/setLocalStorageVal", payload);
    refreshFileTreeDefaultIcons(prev, next);
    return next;
}

function paintDefaultIconButton(btn, unicode) {
    btn.innerHTML = localImageToHtml(unicode) || localImageToHtml(DEFAULT_LOCAL_IMAGES.file);
    btn.dataset.unicode = unicode || "";
}

function openDefaultIconPicker(anchor, currentUnicode, onPick) {
    if (typeof openEmoji !== "function") {
        showMessage(activeFhelperPlugin?.i18n?.defaultIconPickerUnavailable || "当前思源版本不支持图标选择器");
        return;
    }
    const rect = anchor.getBoundingClientRect();
    const options = {
        position: {
            x: rect.left,
            y: rect.bottom,
            h: rect.height,
            w: rect.width,
        },
        selectedCB: (unicode) => {
            onPick(String(unicode || "").trim());
        },
    };
    if (String(currentUnicode || "").startsWith("api/icon/getDynamicIcon")) {
        options.dynamicIconURL = currentUnicode;
    }
    openEmoji(options);
}

function createDefaultIconRow(plugin, key, title, description) {
    const row = plugin.createSettingRow({ title, description });
    const actions = document.createElement("div");
    actions.className = "fhelper-setting__icon-actions";
    const pickBtn = document.createElement("button");
    pickBtn.type = "button";
    pickBtn.className = "fhelper-setting__icon-pick";
    pickBtn.setAttribute("aria-label", title);
    paintDefaultIconButton(pickBtn, getLocalImages()[key]);
    pickBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openDefaultIconPicker(pickBtn, pickBtn.dataset.unicode, (unicode) => {
            const value = unicode || DEFAULT_LOCAL_IMAGES[key];
            persistLocalImages({ [key]: value }).then((images) => {
                paintDefaultIconButton(pickBtn, images[key]);
            }).catch((error) => {
                console.warn(`${LOG_PREFIX} persistLocalImages failed`, key, error);
            });
        });
    });
    const restoreBtn = document.createElement("button");
    restoreBtn.type = "button";
    restoreBtn.className = "b3-button b3-button--outline";
    restoreBtn.textContent = plugin.i18n.defaultIconRestore;
    restoreBtn.addEventListener("click", (event) => {
        event.preventDefault();
        persistLocalImages({ [key]: DEFAULT_LOCAL_IMAGES[key] }).then((images) => {
            paintDefaultIconButton(pickBtn, images[key]);
        }).catch((error) => {
            console.warn(`${LOG_PREFIX} restore local image failed`, key, error);
        });
    });
    actions.appendChild(pickBtn);
    actions.appendChild(restoreBtn);
    const actionWrap = document.createElement("div");
    actionWrap.className = "fhelper-setting__action";
    actionWrap.appendChild(actions);
    row.appendChild(actionWrap);
    return row;
}

function createDefaultConfigSyncConfig() {
    // Always on: themes + conf are both cached; no user toggles.
    return {
        enabled: true,
        syncThemes: true,
        syncConf: true,
    };
}

function isMobileFrontend() {
    try {
        const front = typeof getFrontend === "function" ? String(getFrontend() || "") : "";
        return front === "mobile" || front === "browser-mobile" || /mobile$/i.test(front);
    } catch (error) {
        return false;
    }
}

/** Cache lives under data/storage/petal, so desktop and mobile both use kernel APIs. */
function isConfigSyncActive() {
    return true;
}

function isSiyuanCloudSyncEnabled() {
    return window.siyuan?.config?.sync?.enabled === true;
}

function parseConfigSyncWsEvent(event) {
    const detail = event?.detail ?? event;
    const nested = detail?.data && typeof detail.data === "object" ? detail.data : null;
    const code = typeof detail?.code === "number"
        ? detail.code
        : (typeof nested?.code === "number" ? nested.code : undefined);
    return {
        cmd: String(detail?.cmd || nested?.cmd || "").toLowerCase(),
        code,
        msg: String(detail?.msg || nested?.msg || ""),
    };
}

/**
 * Trigger SiYuan cloud sync and wait until it succeeds.
 * Pull must not import petal cache until the workspace has the latest files.
 */
async function triggerAndWaitSiyuanSync(plugin, timeoutMs = CONFIG_SYNC_WAIT_MS) {
    if (!isSiyuanCloudSyncEnabled()) {
        return { ok: false, reason: "disabled" };
    }
    return new Promise((resolve) => {
        let settled = false;
        let sawStart = false;
        const cleanups = [];
        const done = (result) => {
            if (settled) {
                return;
            }
            settled = true;
            cleanups.forEach((fn) => {
                try {
                    fn();
                } catch (error) {
                    // ignore
                }
            });
            resolve(result);
        };

        const onEnd = () => done({ ok: true });
        const onFail = (event) => {
            const msg = parseConfigSyncWsEvent(event).msg;
            done({ ok: false, reason: "error", msg });
        };
        const onWs = (event) => {
            const { cmd, code, msg } = parseConfigSyncWsEvent(event);
            if (cmd !== "syncing") {
                return;
            }
            if (code === 0) {
                sawStart = true;
                return;
            }
            if (code === 1) {
                done({ ok: true });
                return;
            }
            if (code === 2) {
                done({ ok: false, reason: "error", msg });
            }
        };
        const onWindowSuccess = () => done({ ok: true });

        if (plugin?.eventBus) {
            plugin.eventBus.on("sync-end", onEnd);
            plugin.eventBus.on("sync-fail", onFail);
            plugin.eventBus.on("ws-main", onWs);
            cleanups.push(() => {
                plugin.eventBus.off("sync-end", onEnd);
                plugin.eventBus.off("sync-fail", onFail);
                plugin.eventBus.off("ws-main", onWs);
            });
        }
        window.addEventListener("siyuan-sync-success", onWindowSuccess);
        cleanups.push(() => window.removeEventListener("siyuan-sync-success", onWindowSuccess));

        const timeoutId = window.setTimeout(() => done({ ok: false, reason: "timeout" }), timeoutMs);
        cleanups.push(() => window.clearTimeout(timeoutId));

        const mode = Number(window.siyuan?.config?.sync?.mode);
        const body = mode === 3 ? { upload: false } : {};
        fetchSyncPost("/api/sync/performSync", body).then((res) => {
            if (res && typeof res.code === "number" && res.code !== 0) {
                done({ ok: false, reason: "start-failed", msg: res.msg || "" });
                return;
            }
            if (settled || sawStart) {
                return;
            }
            const quietId = window.setTimeout(() => {
                if (!sawStart) {
                    done({ ok: true, reason: "quiet" });
                }
            }, CONFIG_SYNC_QUIET_MS);
            cleanups.push(() => window.clearTimeout(quietId));
        }).catch((error) => {
            done({ ok: false, reason: "start-failed", msg: String(error?.message || error) });
        });
    });
}

function notifyConfigSyncSyncResult(plugin, syncResult) {
    const i18n = plugin?.i18n || {};
    if (syncResult?.reason === "disabled") {
        showMessage(i18n.configSyncSyncDisabled || "未开启云端同步，无法拉取缓存");
        return;
    }
    if (syncResult?.reason === "timeout") {
        showMessage(i18n.configSyncSyncTimeout || "同步超时，已取消写入配置");
        return;
    }
    showMessage(i18n.configSyncSyncFailed || "同步失败，已取消写入配置");
}

function getConfigSyncRoot(plugin) {
    const name = plugin?.name || "fhelper";
    return `/data/storage/petal/${name}/${CONFIG_SYNC_DIR_NAME}`;
}

function getPluginPetalRoot(plugin) {
    const name = plugin?.name || "fhelper";
    return `/data/storage/petal/${name}`;
}

function getSiyuanDataDir() {
    return String(window.siyuan?.config?.system?.dataDir || "").replace(/[/\\]+$/, "");
}

function joinLocalPath(...segments) {
    const isWin = String(window.siyuan?.config?.system?.os || "").toLowerCase() === "windows";
    const sep = isWin ? "\\" : "/";
    return segments
        .map((part) => String(part || "").trim())
        .filter(Boolean)
        .map((part, index) => {
            const normalized = part.replace(/[/\\]+/g, sep);
            if (index === 0) {
                return normalized.replace(/[/\\]+$/, "");
            }
            return normalized.replace(/^[/\\]+|[/\\]+$/g, "");
        })
        .join(sep);
}

function getConfigFileAbsDir(plugin) {
    return joinLocalPath(getSiyuanDataDir(), "storage", "petal", plugin?.name || "fhelper");
}

function getConfigSyncAbsDir(plugin) {
    return joinLocalPath(getSiyuanDataDir(), "storage", "petal", plugin?.name || "fhelper", CONFIG_SYNC_DIR_NAME);
}

function getConfigSyncPathDisplay(plugin) {
    return `data/storage/petal/${plugin?.name || "fhelper"}/${CONFIG_SYNC_DIR_NAME}`;
}

async function openLocalFolder(absPath, plugin) {
    if (!absPath || !(/^[a-zA-Z]:[\\/]/.test(absPath) || absPath.startsWith("/") || absPath.startsWith("\\\\"))) {
        showMessage(plugin?.i18n?.openFolderFailed || "无法打开文件夹");
        return;
    }
    try {
        const { ipcRenderer } = require("electron");
        ipcRenderer.send((Constants && Constants.SIYUAN_CMD) || "siyuan-cmd", {
            cmd: "openPath",
            filePath: absPath,
        });
        return;
    } catch (error) {
        // Browser / mobile: no Electron IPC.
    }
    try {
        const { shell } = require("electron");
        if (shell && typeof shell.openPath === "function") {
            const err = await shell.openPath(absPath);
            if (err) {
                throw new Error(err);
            }
            return;
        }
    } catch (error) {
        console.warn(`${LOG_PREFIX} openLocalFolder failed`, error);
    }
    showMessage(plugin?.i18n?.openFolderFailed || "无法打开文件夹");
}

async function apiReadDir(path) {
    try {
        const response = await fetchSyncPost("/api/file/readDir", { path });
        if (response?.code !== 0) {
            return [];
        }
        return Array.isArray(response.data) ? response.data : [];
    } catch (error) {
        return [];
    }
}

async function apiRemovePath(path) {
    try {
        await fetchSyncPost("/api/file/removeFile", { path });
    } catch (error) {
        // ignore missing
    }
}

async function apiEnsureDir(path) {
    const formData = new FormData();
    formData.append("path", path);
    formData.append("isDir", "true");
    const response = await fetch("/api/file/putFile", { method: "POST", body: formData });
    const data = await response.json().catch(() => ({}));
    if (data?.code && data.code !== 0) {
        throw new Error(data.msg || `putFile dir failed: ${path}`);
    }
}

async function apiPutBytes(path, bytes, fileName) {
    const formData = new FormData();
    formData.append("path", path);
    formData.append("isDir", "false");
    formData.append("file", new File([bytes], fileName || path.split("/").pop() || "file"));
    const response = await fetch("/api/file/putFile", { method: "POST", body: formData });
    const data = await response.json().catch(() => ({}));
    if (data?.code && data.code !== 0) {
        throw new Error(data.msg || `putFile failed: ${path}`);
    }
}

async function apiPutText(path, text) {
    await apiPutBytes(path, new Blob([text], { type: "application/json" }), path.split("/").pop());
}

async function apiGetFileResponse(path) {
    return fetch("/api/file/getFile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
    });
}

async function apiGetText(path) {
    const response = await apiGetFileResponse(path);
    if (!response.ok) {
        return null;
    }
    const text = await response.text();
    try {
        const maybe = JSON.parse(text);
        if (maybe && typeof maybe === "object" && typeof maybe.code === "number" && maybe.code !== 0 && Object.keys(maybe).length <= 4) {
            return null;
        }
    } catch (error) {
        // raw text content
    }
    return text;
}

async function apiGetBlob(path) {
    const response = await apiGetFileResponse(path);
    if (!response.ok) {
        return null;
    }
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
        try {
            const maybe = await response.clone().json();
            if (maybe && typeof maybe.code === "number" && maybe.code !== 0) {
                return null;
            }
        } catch (error) {
            // continue
        }
    }
    return response.blob();
}

async function hashText(text) {
    const data = new TextEncoder().encode(String(text || ""));
    if (globalThis.crypto?.subtle) {
        const digest = await crypto.subtle.digest("SHA-256", data);
        return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    let h = 2166136261;
    for (let i = 0; i < data.length; i++) {
        h ^= data[i];
        h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
}

async function hashBlob(blob) {
    const buf = await blob.arrayBuffer();
    if (globalThis.crypto?.subtle) {
        const digest = await crypto.subtle.digest("SHA-256", buf);
        return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    return hashText(String(buf.byteLength));
}

function sanitizeConfForSync(raw) {
    if (!raw || typeof raw !== "object") {
        return {};
    }
    const conf = JSON.parse(JSON.stringify(raw));
    if (conf.appearance) {
        conf.appearance.darkThemes = null;
        conf.appearance.lightThemes = null;
        conf.appearance.icons = null;
    }
    if (conf.editor) {
        conf.editor.emoji = [];
    }
    if (conf.export) {
        conf.export.pandocBin = "";
    }
    conf.userData = "";
    conf.account = null;
    conf.accessAuthCode = "";
    if (conf.system) {
        conf.system.id = "";
        conf.system.name = "";
        conf.system.osPlatform = "";
        conf.system.container = "";
        conf.system.isMicrosoftStore = false;
        conf.system.isInsider = false;
        conf.system.microsoftDefenderExcluded = false;
    }
    conf.sync = null;
    conf.stat = null;
    conf.api = null;
    conf.repo = null;
    conf.secrets = null;
    conf.notebookCrypto = null;
    conf.onboarding = null;
    conf.publish = null;
    conf.cookieKey = "";
    conf.mcpOAuth = "";
    conf.cloudRegion = 0;
    if (conf.ai) {
        (conf.ai.providers || []).forEach((provider) => {
            if (provider) {
                provider.apiKey = "";
            }
        });
        if (conf.ai.embedding) {
            conf.ai.embedding.apiKey = "";
        }
        if (conf.ai.rerank) {
            conf.ai.rerank.apiKey = "";
        }
        conf.ai.mcp = null;
    }
    return conf;
}

async function loadConfigSyncManifest(plugin) {
    const text = await apiGetText(`${getConfigSyncRoot(plugin)}/manifest.json`);
    if (!text) {
        return null;
    }
    try {
        return JSON.parse(text);
    } catch (error) {
        return null;
    }
}

async function saveConfigSyncManifest(plugin, manifest) {
    const root = getConfigSyncRoot(plugin);
    await apiEnsureDir(root);
    await apiPutText(`${root}/manifest.json`, JSON.stringify(manifest, null, 2));
}

async function listCustomThemeNames() {
    const entries = await apiReadDir("/conf/appearance/themes");
    return entries
        .filter((item) => item?.isDir && item.name && !CONFIG_SYNC_BUILTIN_THEMES.has(item.name))
        .map((item) => item.name)
        .sort();
}

async function copyDirRecursive(srcDir, destDir) {
    await apiEnsureDir(destDir);
    const entries = await apiReadDir(srcDir);
    for (const entry of entries) {
        if (!entry?.name) {
            continue;
        }
        const srcPath = `${srcDir}/${entry.name}`;
        const destPath = `${destDir}/${entry.name}`;
        if (entry.isDir) {
            await copyDirRecursive(srcPath, destPath);
            continue;
        }
        const blob = await apiGetBlob(srcPath);
        if (!blob) {
            continue;
        }
        await apiPutBytes(destPath, blob, entry.name);
    }
}

async function removeDirContents(path) {
    const entries = await apiReadDir(path);
    for (const entry of entries) {
        if (!entry?.name) {
            continue;
        }
        await apiRemovePath(`${path}/${entry.name}`);
    }
}

async function buildLocalThemesFingerprint() {
    const names = await listCustomThemeNames();
    const parts = [];
    for (const name of names) {
        const themeJson = await apiGetText(`/conf/appearance/themes/${name}/theme.json`);
        parts.push(`${name}:${themeJson || ""}`);
        const entries = await apiReadDir(`/conf/appearance/themes/${name}`);
        entries.forEach((entry) => {
            parts.push(`${name}/${entry.name}:${entry.updated || 0}:${entry.isDir ? "d" : "f"}`);
        });
    }
    return hashText(parts.join("|"));
}

async function buildLocalConfFingerprint() {
    const response = await fetchSyncPost("/api/system/getConf", {});
    const conf = sanitizeConfForSync(response?.data || response);
    return hashText(JSON.stringify(conf));
}

async function exportConfToPetal(plugin) {
    const root = getConfigSyncRoot(plugin);
    await apiEnsureDir(`${root}/conf`);
    // Same API as UI: 设置 → 关于 → 导出设置 → /api/system/exportConf
    const exported = await fetchSyncPost("/api/system/exportConf", {});
    if (exported?.code && exported.code !== 0) {
        throw new Error(exported.msg || "exportConf failed");
    }
    const name = exported?.data?.name; // e.g. siyuan-conf-20260805015051.json
    if (!name) {
        throw new Error("exportConf returned empty name");
    }
    let zipBlob = await apiGetBlob(`/temp/export/${name}.zip`);
    if (!zipBlob && exported?.data?.zip) {
        // Fallback: same download URL the UI opens
        const zipUrl = String(exported.data.zip).startsWith("http")
            ? exported.data.zip
            : `${window.location.origin}${exported.data.zip}`;
        const res = await fetch(zipUrl);
        if (res.ok) {
            zipBlob = await res.blob();
        }
    }
    if (!zipBlob) {
        throw new Error(`exportConf zip not found: /temp/export/${name}.zip`);
    }
    // Stable names inside petal so S3 sync path stays constant.
    await apiPutBytes(`${root}/conf/siyuan-conf.json.zip`, zipBlob, "siyuan-conf.json.zip");
    // Keep extracted JSON sidecar for fingerprint / appearance apply on import.
    const jsonText = await apiGetText(`/temp/export/${name}`);
    if (jsonText) {
        await apiPutText(`${root}/conf/siyuan-conf.json`, jsonText);
    }
    return {
        file: "conf/siyuan-conf.json.zip",
        jsonFile: jsonText ? "conf/siyuan-conf.json" : "",
        name,
        hash: jsonText ? await hashText(jsonText) : await hashBlob(zipBlob),
    };
}

async function exportThemesToPetal(plugin) {
    const root = getConfigSyncRoot(plugin);
    const themesDir = `${root}/themes`;
    await apiEnsureDir(themesDir);
    await removeDirContents(themesDir);
    const names = await listCustomThemeNames();
    for (const name of names) {
        await copyDirRecursive(`/conf/appearance/themes/${name}`, `${themesDir}/${name}`);
    }
    return { names, hash: await buildLocalThemesFingerprint() };
}

async function importConfFromPetal(plugin, manifest) {
    const root = getConfigSyncRoot(plugin);
    // Prefer official zip (same format as UI export); fallback to json sidecar.
    const zipRel = manifest?.conf?.file?.endsWith(".zip")
        ? manifest.conf.file
        : "conf/siyuan-conf.json.zip";
    const jsonRel = manifest?.conf?.jsonFile || "conf/siyuan-conf.json";
    let fileRel = zipRel;
    let blob = await apiGetBlob(`${root}/${zipRel}`);
    let fileName = zipRel.split("/").pop() || "siyuan-conf.json.zip";
    let mime = "application/zip";
    if (!blob) {
        const text = await apiGetText(`${root}/${jsonRel}`);
        if (!text) {
            throw new Error(`missing conf pack under ${root}/conf`);
        }
        fileRel = jsonRel;
        fileName = jsonRel.split("/").pop() || "siyuan-conf.json";
        mime = "application/json";
        blob = new Blob([text], { type: mime });
    }
    const formData = new FormData();
    formData.append("file", new File([blob], fileName, { type: mime }));
    const response = await fetch("/api/system/importConf", { method: "POST", body: formData });
    const data = await response.json().catch(() => ({}));
    if (data?.code && data.code !== 0) {
        throw new Error(data.msg || "importConf failed");
    }
    // importConf does not apply Appearance; restore theme selection from JSON sidecar.
    try {
        const jsonText = await apiGetText(`${root}/${jsonRel}`);
        if (jsonText) {
            const confObj = JSON.parse(jsonText);
            if (confObj?.appearance) {
                await fetchSyncPost("/api/setting/setAppearance", confObj.appearance);
            }
        }
    } catch (error) {
        console.warn(`${LOG_PREFIX} apply appearance after importConf failed`, error);
    }
}

async function importThemesFromPetal(plugin) {
    const root = getConfigSyncRoot(plugin);
    const themesDir = `${root}/themes`;
    const entries = await apiReadDir(themesDir);
    for (const entry of entries) {
        if (!entry?.isDir || !entry.name || CONFIG_SYNC_BUILTIN_THEMES.has(entry.name)) {
            continue;
        }
        await copyDirRecursive(`${themesDir}/${entry.name}`, `/conf/appearance/themes/${entry.name}`);
    }
}

async function pushConfigSync(plugin, options = {}) {
    if (plugin.configSyncBusy) {
        return { skipped: true, reason: "busy" };
    }
    plugin.configSyncBusy = true;
    try {
        const root = getConfigSyncRoot(plugin);
        await apiEnsureDir(root);
        const prev = await loadConfigSyncManifest(plugin);
        const localConfHash = await buildLocalConfFingerprint();
        const localThemesHash = await buildLocalThemesFingerprint();
        const needConf = !prev?.conf?.hash || prev.conf.hash !== localConfHash || options.force;
        const needThemes = !prev?.themes?.hash || prev.themes.hash !== localThemesHash || options.force;
        if (!needConf && !needThemes) {
            return { skipped: true, reason: "up-to-date" };
        }
        const manifest = {
            version: 1,
            updatedAt: Date.now(),
            conf: prev?.conf || null,
            themes: prev?.themes || null,
        };
        if (needConf) {
            const packed = await exportConfToPetal(plugin);
            manifest.conf = {
                file: packed.file,
                jsonFile: packed.jsonFile || "",
                exportName: packed.name || "",
                hash: localConfHash || packed.hash,
            };
        }
        if (needThemes) {
            const themePack = await exportThemesToPetal(plugin);
            manifest.themes = {
                hash: localThemesHash || themePack.hash,
                names: themePack.names,
            };
        }
        await saveConfigSyncManifest(plugin, manifest);
        if (options.notify) {
            showMessage(plugin.i18n.configSyncPushed || "配置已写入缓存（需思源同步后才会到其他设备）");
        }
        return { ok: true, manifest };
    } finally {
        plugin.configSyncBusy = false;
    }
}

async function pullConfigSync(plugin, options = {}) {
    if (plugin.configSyncBusy) {
        return { skipped: true, reason: "busy" };
    }
    plugin.configSyncBusy = true;
    try {
        if (options.notify) {
            showMessage(plugin.i18n.configSyncSyncing || "正在同步…", 0);
        }
        const syncResult = await triggerAndWaitSiyuanSync(plugin);
        if (!syncResult.ok) {
            if (options.notify) {
                notifyConfigSyncSyncResult(plugin, syncResult);
            }
            return { skipped: true, reason: `sync-${syncResult.reason}` };
        }
        await sleepMs(CONFIG_SYNC_AFTER_SYNC_MS);
        const manifest = await loadConfigSyncManifest(plugin);
        if (!manifest) {
            if (options.notify) {
                showMessage(plugin.i18n.configSyncNoPack || "缓存中还没有配置数据");
            }
            return { skipped: true, reason: "no-pack" };
        }
        const localConfHash = await buildLocalConfFingerprint();
        const localThemesHash = await buildLocalThemesFingerprint();
        const needConf = manifest.conf?.hash && (options.force || manifest.conf.hash !== localConfHash);
        const needThemes = manifest.themes?.hash && (options.force || manifest.themes.hash !== localThemesHash);
        if (!needConf && !needThemes) {
            if (options.notify) {
                showMessage(plugin.i18n.configSyncUpToDate || "缓存已是最新，无需更新");
            }
            return { skipped: true, reason: "up-to-date" };
        }
        if (needConf) {
            await importConfFromPetal(plugin, manifest);
        }
        if (needThemes) {
            await importThemesFromPetal(plugin);
        }
        if (options.notify !== false) {
            promptConfigSyncRestart(plugin);
        }
        return { ok: true, needConf, needThemes };
    } finally {
        plugin.configSyncBusy = false;
    }
}

function promptConfigSyncRestart(plugin) {
    const title = plugin?.i18n?.configSyncRestartTitle || "缓存已写入配置";
    const text = isMobileFrontend()
        ? (plugin?.i18n?.configSyncRestartDescMobile
            || "配置与主题已从缓存写入。点击确定后将刷新界面。若部分设置未生效，请完全退出后重新打开思源。请在设置中手动选择主题。")
        : (plugin?.i18n?.configSyncRestartDesc
            || "配置与主题已从缓存写入。点击确定后将自动重启思源以生效。重启后请在设置中手动选择主题。");
    if (typeof confirm === "function") {
        confirm(title, text, () => {
            restartSiYuanApp();
        });
        return;
    }
    const ok = window.confirm(`${title}\n\n${text}`);
    if (ok) {
        restartSiYuanApp();
    }
}

/**
 * Desktop: schedule Electron relaunch, then official exitSiYuan() so kernel
 * flush / sync / layout save still run. Do NOT call app.exit() directly.
 * Mobile has no relaunch; exitSiYuan would quit without reopening, so reload UI.
 */
async function restartSiYuanApp() {
    if (isMobileFrontend()) {
        try {
            await fetchSyncPost("/api/ui/reloadUI", {});
        } catch (error) {
            console.warn(`${LOG_PREFIX} mobile reloadUI failed`, error);
            window.location.reload();
        }
        return;
    }

    let relaunchScheduled = false;
    try {
        // Schedule relaunch first; it does not quit by itself.
        // eslint-disable-next-line global-require
        const { app } = require("@electron/remote");
        if (app && typeof app.relaunch === "function") {
            app.relaunch();
            relaunchScheduled = true;
        }
    } catch (error) {
        console.warn(`${LOG_PREFIX} electron relaunch unavailable`, error);
    }

    try {
        if (typeof exitSiYuan === "function") {
            // Official path: save layout / kernel exit / then host quit.
            await Promise.resolve(exitSiYuan());
            return;
        }
    } catch (error) {
        console.warn(`${LOG_PREFIX} exitSiYuan failed`, error);
    }

    // Fallbacks only if exitSiYuan is missing.
    try {
        await fetchSyncPost("/api/system/exit", { force: false, execInstallPkg: 1 });
    } catch (error) {
        console.warn(`${LOG_PREFIX} kernel exit failed`, error);
    }
    try {
        // eslint-disable-next-line global-require
        const { ipcRenderer } = require("electron");
        ipcRenderer.send((Constants && Constants.SIYUAN_QUIT) || "siyuan-quit", location.port);
        return;
    } catch (error) {
        // ignore
    }
    if (!relaunchScheduled) {
        try {
            await fetchSyncPost("/api/ui/reloadUI", {});
        } catch (error) {
            window.location.reload();
        }
    }
}

function scheduleConfigSyncPush() {
    // Auto push disabled — cache write is manual only.
}

function installConfigSyncWatchers(plugin) {
    // Auto write-to-cache on settings/theme change removed; manual buttons only.
    uninstallConfigSyncWatchers(plugin);
}

function uninstallConfigSyncWatchers(plugin) {
    if (!plugin?.configSyncWatchersInstalled) {
        return;
    }
    plugin.configSyncObserver?.disconnect();
    plugin.configSyncObserver = null;
    if (plugin.configSyncWsHandler) {
        plugin.eventBus.off("ws-main", plugin.configSyncWsHandler);
        plugin.configSyncWsHandler = null;
    }
    if (plugin.configSyncPushTimer) {
        window.clearTimeout(plugin.configSyncPushTimer);
        plugin.configSyncPushTimer = null;
    }
    plugin.configSyncDomHandler = null;
    plugin.configSyncWatchersInstalled = false;
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
    const raw = String(hex || "").trim();
    if (!raw) {
        return null;
    }
    const parts = /^[0-9a-f]+(?:-[0-9a-f]+)+$/i.test(raw)
        ? raw.split("-")
        : /^[0-9a-f]+$/i.test(raw)
            ? (raw.match(/.{1,8}/g) || [raw])
            : null;
    if (!parts) {
        return null;
    }
    try {
        return parts.map((part) => String.fromCodePoint(parseInt(part, 16))).join("");
    } catch (error) {
        console.debug(`${LOG_PREFIX} unicodeHexToEmoji failed`, error);
        return null;
    }
}

function defaultDocFileGlyph() {
    const raw = window.siyuan?.storage?.["local-images"]?.file;
    return unicodeHexToEmoji(raw) || DOC_REF_DEFAULT_ICON;
}

function resolveDocIconDisplay(icon) {
    const raw = String(icon || "").trim();
    if (!raw) {
        return { kind: "emoji", value: defaultDocFileGlyph() };
    }
    if (raw.includes("/") || raw.includes(".") || raw.startsWith("http") || raw.startsWith("data:")) {
        const src = raw.startsWith("http") || raw.startsWith("data:") || raw.startsWith("/")
            ? raw
            : `/emojis/${raw}`;
        return { kind: "img", value: src };
    }
    const emoji = unicodeHexToEmoji(raw);
    if (emoji) {
        return { kind: "emoji", value: emoji };
    }
    if (!/[./]/.test(raw)) {
        return { kind: "emoji", value: raw };
    }
    return { kind: "emoji", value: defaultDocFileGlyph() };
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
        const stmt = `SELECT id, type, ial FROM blocks WHERE id IN (${inList}) LIMIT ${chunk.length}`;
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

function isChildNavAutoRefSpan(el) {
    return !!(el && typeof el.closest === "function" && el.closest(`[${CHILD_NAV_FLAG_ATTR}="1"]`));
}

function applyDocRefDecoration(el, meta) {
    if (!el || !meta) {
        return;
    }
    if (isChildNavAutoRefSpan(el)) {
        clearDocRefDecoration(el);
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
}

function handleProtyleDocRefStaticLoad(plugin, event) {
    handleProtyleChildNavStaticLoad(plugin, event);
}

function handleProtyleDocRefDynamicLoad(plugin, event) {
    scheduleRefreshChildNavRefIcons();
}

function handleProtyleDocRefSwitch(plugin, event) {
    const protyle = getProtyleFromEvent(event);
    if (protyle) {
        ensureDocActionBreadcrumbButtons(plugin, protyle);
    }
    handleProtyleChildNavSwitch(plugin, event);
}

function handleProtyleDocRefDestroy(plugin, event) {
    const protyle = getProtyleFromEvent(event);
    const wysiwyg = protyle?.wysiwyg?.element;
    if (wysiwyg) {
        unwatchDocRefMutations(plugin, wysiwyg);
    }
    clearDocRefCacheForDoc(plugin, getProtyleRootId(protyle));
}

const LIST_DOCS_SORT_UNASSIGNED = 256;

function createDefaultChildDocWidgetConfig() {
    return {
        enabled: true,
        mode: "direct",
    };
}

function normalizeChildNavMode(_mode) {
    return "direct";
}

function getNotebookById(id) {
    if (!id) {
        return null;
    }
    const notebooks = window.siyuan?.notebooks;
    if (!Array.isArray(notebooks)) {
        return null;
    }
    return notebooks.find((nb) => nb?.id === id) || null;
}

function isNotebookBoxDoc(docId, notebook) {
    return !!(docId && notebook && docId === notebook);
}

function isNotebookBoxDocPath(path, notebook) {
    if (!notebook) {
        return false;
    }
    const p = String(path || "").replace(/\\/g, "/");
    return p === "/"
        || p === `/${notebook}`
        || p.toLowerCase() === `/${notebook}.sy`.toLowerCase();
}

function notebookBoxDocPath(notebook) {
    return notebook ? `/${notebook}.sy` : "";
}

function normalizeBoxDocPath(path, notebook) {
    if (!notebook) {
        return path;
    }
    if (isNotebookBoxDocPath(path, notebook)) {
        return notebookBoxDocPath(notebook);
    }
    return path;
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
        if (row?.box) {
            return {
                notebook: row.box,
                path: normalizeBoxDocPath(row.path, row.box),
            };
        }
    } catch (error) {
        console.warn(`${LOG_PREFIX} getDocPathBySql failed`, docId, error);
    }
    if (getNotebookById(docId)) {
        return { notebook: docId, path: notebookBoxDocPath(docId) };
    }
    return null;
}

/** Parent doc storage path: `/a/b/c.sy` -> `/a/b.sy`; `/a.sy` -> null */
function getParentDocStoragePath(docPath) {
    const normalized = String(docPath || "").replace(/\\/g, "/");
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

/**
 * Logical parent in the file tree. Root-level ordinary docs sit under the
 * notebook box document even though files stay at the notebook root.
 */
function getLogicalParentDocPath(docPath, notebook) {
    const physical = getParentDocStoragePath(docPath);
    if (physical) {
        return physical;
    }
    if (!notebook || isNotebookBoxDocPath(docPath, notebook)) {
        return null;
    }
    const normalized = String(docPath || "").replace(/\\/g, "/");
    if (!/^\/[^/]+\.sy$/i.test(normalized)) {
        return null;
    }
    return notebookBoxDocPath(notebook);
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
async function queryChildNavDescendants(notebook, parentDocPath, parentDocId) {
    const isBox = isNotebookBoxDoc(parentDocId, notebook)
        || isNotebookBoxDocPath(parentDocPath, notebook);
    const folder = isBox ? "/" : toListDocsFolderPath(parentDocPath);
    const prefix = folder === "/" ? "/" : `${folder}/`;
    const pathClause = isBox
        ? ""
        : ` AND path LIKE '${escapeSqlId(prefix)}%'`;
    const excludeSelf = parentDocId
        ? ` AND id != '${escapeSqlId(parentDocId)}'`
        : "";
    try {
        const rows = await runSqlQuery(
            `SELECT id, content, path FROM blocks WHERE type = 'd' AND box = '${escapeSqlId(notebook)}'${pathClause}${excludeSelf} ORDER BY path ASC LIMIT ${CHILD_NAV_SQL_LIMIT}`,
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
    const parentPath = normalizeBoxDocPath(pathInfo.path, pathInfo.notebook);
    const rows = await queryChildNavDescendants(pathInfo.notebook, parentPath, docId);
    const isDirectChild = (row) => (
        getLogicalParentDocPath(row.path, pathInfo.notebook) === parentPath
    );
    return rows.filter(isDirectChild).map(toChildNavNode);
}

const CHILD_NAV_SYNC_DEBOUNCE_MS = 200;
const childNavSyncingDocs = new Set();
let childNavIconRefreshTimer = 0;
let childNavIconRefreshSeq = 0;

function cssQuotedContent(value) {
    return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
}

function escCssIdent(id) {
    return window.CSS?.escape ? CSS.escape(String(id)) : String(id).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function childNavRefScope(inner) {
    return [
        `html.${CHILD_NAV_HTML_CLASS} .b3-typography [${CHILD_NAV_FLAG_ATTR}="1"] ${inner}`,
        `html.${CHILD_NAV_HTML_CLASS} .protyle-wysiwyg [data-node-id][${CHILD_NAV_FLAG_ATTR}="1"] ${inner}`,
    ].join(",\n");
}

function childNavRefIdSels(ids, pseudo = "") {
    return (ids || []).flatMap((id) => {
        const escaped = escCssIdent(id);
        return [
            `html.${CHILD_NAV_HTML_CLASS} .b3-typography [${CHILD_NAV_FLAG_ATTR}="1"] span[data-type~="block-ref"][data-id="${escaped}"]${pseudo}`,
            `html.${CHILD_NAV_HTML_CLASS} .protyle-wysiwyg [data-node-id][${CHILD_NAV_FLAG_ATTR}="1"] span[data-type~="block-ref"][data-id="${escaped}"]${pseudo}`,
        ];
    }).join(",\n");
}

function buildChildNavBaseCss() {
    const glyph = cssQuotedContent(defaultDocFileGlyph());
    const span = "span[data-type~=\"block-ref\"][data-id]";
    return `
${childNavRefScope(span)} {
    position: relative;
    padding-left: 1.28em;
    padding-bottom: 0.14em;
    font-weight: 700;
    color: var(--b3-theme-on-background);
    text-decoration: none;
    border-bottom: none;
    background-image: linear-gradient(var(--b3-border-color), var(--b3-border-color));
    background-repeat: no-repeat;
    background-size: 100% 1px;
    background-position: 0 100%;
    background-origin: content-box;
    background-clip: content-box;
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
    transition: none;
}
${childNavRefScope(`${span}::before`)} {
    content: ${glyph};
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    display: block;
    width: 1.05em;
    margin: 0;
    pointer-events: none;
    background-image: none;
    font-weight: 400;
    font-family: var(--b3-font-family-emoji);
    line-height: 1;
    text-align: center;
    speak: never;
}
`;
}

function setChildNavIconCss(cssText) {
    let styleEl = document.getElementById(CHILD_NAV_ICON_STYLE_ID);
    if (!cssText) {
        styleEl?.remove();
        return;
    }
    if (!styleEl) {
        styleEl = document.createElement("style");
        styleEl.id = CHILD_NAV_ICON_STYLE_ID;
        document.head.appendChild(styleEl);
    }
    styleEl.textContent = cssText;
}

function collectChildNavRefTargetIds() {
    const ids = [];
    document.querySelectorAll(`[${CHILD_NAV_FLAG_ATTR}="1"] span[data-type~="block-ref"][data-id]`).forEach((span) => {
        const id = span.getAttribute("data-id");
        if (id) {
            ids.push(id);
        }
    });
    return [...new Set(ids)];
}

function renderChildNavIconSheet(metasById) {
    const icons = new Map();
    const imgs = new Map();
    (metasById || new Map()).forEach((meta, id) => {
        if (!id || !meta?.exists || !meta.isDoc) {
            return;
        }
        const display = resolveDocIconDisplay(meta.icon);
        if (display.kind === "img") {
            const list = imgs.get(display.value) || [];
            list.push(id);
            imgs.set(display.value, list);
            return;
        }
        const glyph = display.value || defaultDocFileGlyph();
        const list = icons.get(glyph) || [];
        list.push(id);
        icons.set(glyph, list);
    });
    const parts = [];
    for (const [glyph, ids] of icons) {
        if (glyph === defaultDocFileGlyph()) {
            continue;
        }
        parts.push(`${childNavRefIdSels(ids, "::before")} {
    content: ${cssQuotedContent(glyph)};
}`);
    }
    for (const [src, ids] of imgs) {
        const url = String(src).replace(/\\/g, "/").replace(/"/g, "%22");
        parts.push(`${childNavRefIdSels(ids, "::before")} {
    content: "";
    width: 1.05em;
    height: 1.05em;
    background: url("${url}") center / contain no-repeat;
}`);
    }
    setChildNavIconCss(parts.join("\n"));
}

async function refreshChildNavRefIcons() {
    if (!document.documentElement.classList.contains(CHILD_NAV_HTML_CLASS)) {
        setChildNavIconCss("");
        return;
    }
    const seq = childNavIconRefreshSeq + 1;
    childNavIconRefreshSeq = seq;
    const ids = collectChildNavRefTargetIds();
    if (!ids.length) {
        setChildNavIconCss("");
        return;
    }
    const metas = await queryBlockMetaByIds(ids);
    if (seq !== childNavIconRefreshSeq) {
        return;
    }
    renderChildNavIconSheet(metas);
}

function scheduleRefreshChildNavRefIcons() {
    if (!document.documentElement.classList.contains(CHILD_NAV_HTML_CLASS)) {
        return;
    }
    window.clearTimeout(childNavIconRefreshTimer);
    childNavIconRefreshTimer = window.setTimeout(() => {
        refreshChildNavRefIcons().catch((error) => {
            console.warn(`${LOG_PREFIX} refreshChildNavRefIcons failed`, error);
        });
    }, 80);
}

function setChildNavRefStyleEnabled(enabled) {
    document.documentElement.classList.toggle(CHILD_NAV_HTML_CLASS, !!enabled);
    window.clearTimeout(childNavIconRefreshTimer);
    if (!enabled) {
        document.getElementById(CHILD_NAV_STYLE_ID)?.remove();
        setChildNavIconCss("");
        return;
    }
    let styleEl = document.getElementById(CHILD_NAV_STYLE_ID);
    if (!styleEl) {
        styleEl = document.createElement("style");
        styleEl.id = CHILD_NAV_STYLE_ID;
        document.head.appendChild(styleEl);
    }
    styleEl.textContent = buildChildNavBaseCss();
    scheduleRefreshChildNavRefIcons();
}

function escapeChildNavTitle(title) {
    return String(title || "").replace(/'/g, "’").replace(/\r?\n/g, " ");
}

function childNavRefMarkdown(childId, title) {
    // H5 heading wrapping a document block-ref; appears natively in outline.
    return `##### ((${childId} '${escapeChildNavTitle(title)}'))`;
}

function insertedBlockIdFromResponse(response) {
    const ops = response?.data?.[0]?.doOperations;
    if (Array.isArray(ops)) {
        const hit = ops.find((op) => op?.id && (op.action === "insert" || op.action === "update" || !op.action));
        if (hit?.id) {
            return hit.id;
        }
        if (ops[0]?.id) {
            return ops[0].id;
        }
    }
    return null;
}

async function appendMarkdownBlock({ parentID, markdown, attrs }) {
    const response = await fetchSyncPost("/api/block/appendBlock", {
        dataType: "markdown",
        data: markdown,
        parentID,
    });
    const newId = insertedBlockIdFromResponse(response);
    if (!newId) {
        console.warn(`${LOG_PREFIX} appendMarkdownBlock: no new id`, response);
        return null;
    }
    if (attrs) {
        await fetchSyncPost("/api/attr/setBlockAttrs", {
            id: newId,
            attrs,
        });
    }
    return newId;
}

function titleFromChildNavContent(content, fallback) {
    const text = String(content || "").replace(/[\u200b\ufeff]/g, "").trim();
    const quoted = text.match(/\(\([^)]*'([^']*)'\)\)/);
    if (quoted?.[1]) {
        return quoted[1];
    }
    const wiki = text.match(/\[\[([^\]]+)\]\]/);
    if (wiki?.[1]) {
        return wiki[1].split("|").pop().trim();
    }
    return text || fallback || "";
}

async function queryChildNavEndFenceIds(docId) {
    if (!docId) {
        return [];
    }
    try {
        const rows = await runSqlQuery(
            `SELECT b.id AS id FROM attributes a JOIN blocks b ON b.id = a.block_id WHERE a.name = '${CHILD_NAV_END_ATTR}' AND a.value = '1' AND b.root_id = '${escapeSqlId(docId)}' ORDER BY b.sort ASC LIMIT ${CHILD_NAV_SQL_LIMIT}`,
        );
        return (Array.isArray(rows) ? rows : []).map((row) => row?.id).filter(Boolean);
    } catch (error) {
        console.warn(`${LOG_PREFIX} queryChildNavEndFenceIds failed`, docId, error);
        return [];
    }
}

async function deleteLegacyChildNavFences(docId) {
    const ids = await queryChildNavEndFenceIds(docId);
    for (const id of ids) {
        try {
            await deleteAutoChildNavBlock(id);
        } catch (error) {
            console.warn(`${LOG_PREFIX} deleteLegacyChildNavFences failed`, id, error);
        }
    }
}

async function queryAutoChildNavBlocks(docId) {
    if (!docId) {
        return [];
    }
    try {
        const rows = await runSqlQuery(
            `SELECT b.id AS id, b.sort AS sort, b.content AS content, b.type AS type, b.subtype AS subtype, t.value AS target FROM attributes f JOIN blocks b ON b.id = f.block_id LEFT JOIN attributes t ON t.block_id = f.block_id AND t.name = '${CHILD_NAV_TARGET_ATTR}' WHERE f.name = '${CHILD_NAV_FLAG_ATTR}' AND f.value = '1' AND b.root_id = '${escapeSqlId(docId)}' ORDER BY b.sort ASC, b.created ASC LIMIT ${CHILD_NAV_SQL_LIMIT}`,
        );
        const list = Array.isArray(rows) ? rows : [];
        const missing = list.filter((row) => row?.id && !row.target);
        if (missing.length) {
            const inList = missing.map((row) => `'${escapeSqlId(row.id)}'`).join(",");
            const refs = await runSqlQuery(
                `SELECT block_id, def_block_id FROM refs WHERE block_id IN (${inList}) LIMIT ${CHILD_NAV_SQL_LIMIT}`,
            );
            const byBlock = new Map((Array.isArray(refs) ? refs : []).map((row) => [row.block_id, row.def_block_id]));
            list.forEach((row) => {
                if (!row.target) {
                    row.target = byBlock.get(row.id) || "";
                }
            });
        }
        return list.filter((row) => row?.id);
    } catch (error) {
        console.warn(`${LOG_PREFIX} queryAutoChildNavBlocks failed`, docId, error);
        return [];
    }
}

async function updateAutoChildNavBlockMarkdown(blockId, markdown) {
    if (!blockId || !markdown) {
        return;
    }
    await fetchSyncPost("/api/block/updateBlock", {
        dataType: "markdown",
        data: markdown,
        id: blockId,
    });
}

function isChildNavH5Block(block) {
    return block?.type === "h" && String(block?.subtype || "").toLowerCase() === "h5";
}

async function insertAutoChildNavBlock({ parentID, childId, title }) {
    return appendMarkdownBlock({
        parentID,
        markdown: childNavRefMarkdown(childId, title),
        attrs: childNavBlockAttrs(childId),
    });
}

function newSiYuanNodeId() {
    if (typeof window.Lute?.NewNodeID === "function") {
        return window.Lute.NewNodeID();
    }
    const now = new Date();
    const pad = (n, width = 2) => String(n).padStart(width, "0");
    const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const rand = Math.random().toString(36).slice(2, 9);
    return `${ts}-${rand}`;
}

function buildChildDocCreatePath(parentDocPath, newDocId) {
    const base = String(parentDocPath || "").replace(/\.sy$/i, "");
    if (!base) {
        return `/${newDocId}.sy`;
    }
    return `${base}/${newDocId}.sy`;
}

function getCurrentBlockIdFromProtyle(protyle) {
    const p = unwrapProtyle(protyle);
    try {
        const sel = window.getSelection?.();
        const range = sel?.rangeCount ? sel.getRangeAt(0) : null;
        const node = range?.startContainer;
        const el = node?.nodeType === 1 ? node : node?.parentElement;
        const block = el?.closest?.("[data-node-id]");
        if (block && !block.classList?.contains("protyle-title")) {
            return block.getAttribute("data-node-id");
        }
    } catch (error) {
        // ignore
    }
    const focus = p?.wysiwyg?.element?.querySelector?.(".protyle-wysiwyg--select[data-node-id], [data-node-id].protyle-wysiwyg--select");
    return focus?.getAttribute?.("data-node-id") || null;
}

function childNavBlockAttrs(childId) {
    return {
        [CHILD_NAV_FLAG_ATTR]: "1",
        [CHILD_NAV_TARGET_ATTR]: childId,
    };
}

async function applyChildNavAttrs(blockId, childId) {
    if (!blockId || !childId) {
        return;
    }
    await fetchSyncPost("/api/attr/setBlockAttrs", {
        id: blockId,
        attrs: childNavBlockAttrs(childId),
    });
}

function clearSlashInput(protyle) {
    const p = unwrapProtyle(protyle);
    if (!p || typeof p.insert !== "function") {
        return;
    }
    try {
        const caret = window.Lute?.Caret || "\ufeff";
        p.insert(caret, false, true);
    } catch (error) {
        console.warn(`${LOG_PREFIX} clearSlashInput failed`, error);
    }
}

async function insertMarkdownBlockAtCursor({ previousID, parentID, markdown, attrs }) {
    const payload = {
        dataType: "markdown",
        data: markdown,
    };
    if (previousID) {
        payload.previousID = previousID;
    } else if (parentID) {
        payload.parentID = parentID;
    } else {
        throw new Error("insertMarkdownBlockAtCursor: missing previousID/parentID");
    }
    const response = await fetchSyncPost("/api/block/insertBlock", payload);
    const newId = insertedBlockIdFromResponse(response);
    if (!newId) {
        console.warn(`${LOG_PREFIX} insertMarkdownBlockAtCursor: no new id`, response);
        return null;
    }
    if (attrs) {
        await fetchSyncPost("/api/attr/setBlockAttrs", {
            id: newId,
            attrs,
        });
    }
    return newId;
}

async function replaceSlashLineWithChildNavRef({ blockId, parentID, childId, title }) {
    const markdown = childNavRefMarkdown(childId, title);
    if (blockId) {
        await updateAutoChildNavBlockMarkdown(blockId, markdown);
        await applyChildNavAttrs(blockId, childId);
        return blockId;
    }
    return insertMarkdownBlockAtCursor({
        parentID,
        markdown,
        attrs: childNavBlockAttrs(childId),
    });
}

/** Mimic built-in「新建子文档并引用」, but mark the ref as auto child-nav. */
async function createChildDocNavRefFromSlash(plugin, protyle) {
    const p = unwrapProtyle(protyle);
    const notebookId = p?.notebookId;
    const docPath = p?.path;
    const rootId = getProtyleDocId(p);
    if (!notebookId || !docPath || !rootId) {
        showMessage(plugin.i18n.cannotResolveDoc || "无法识别当前文档");
        return;
    }

    const slashBlockId = getCurrentBlockIdFromProtyle(p);
    clearSlashInput(p);
    const newSubDocId = newSiYuanNodeId();
    const createPath = buildChildDocCreatePath(docPath, newSubDocId);
    const title = window.siyuan?.languages?.untitled
        || plugin.i18n.newChildDocNavRefUntitled
        || "未命名";

    const created = await fetchSyncPost("/api/filetree/createDoc", {
        notebook: notebookId,
        path: createPath,
        title: "",
        md: "",
    });
    if (created?.code && created.code !== 0) {
        throw new Error(created.msg || "createDoc failed");
    }

    await replaceSlashLineWithChildNavRef({
        blockId: slashBlockId,
        parentID: rootId,
        childId: newSubDocId,
        title,
    });

    scheduleRefreshChildNavRefIcons();

    openTab({
        app: plugin.app,
        doc: {
            id: newSubDocId,
            action: [
                Constants.CB_GET_CONTEXT || "cb-get-context",
                Constants.CB_GET_OPENNEW || "cb-get-opennew",
            ],
        },
    });
}

function registerNewChildDocNavRefSlash(plugin) {
    const label = plugin.i18n.newChildDocNavRef
        || "新建子文档块";
    plugin.protyleSlash = [
        {
            id: NEW_CHILD_DOC_NAV_REF_SLASH_ID,
            filter: [
                label,
                "新建子文档块",
                "xinjianziwendangkuai",
                "xjzwdk",
                "create child doc block",
                "new child doc block",
                "child doc nav ref",
            ],
            html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconFile"></use></svg><span class="b3-list-item__text">${label}</span></div>`,
            callback: (protyle) => {
                createChildDocNavRefFromSlash(plugin, protyle).catch((error) => {
                    console.warn(`${LOG_PREFIX} createChildDocNavRefFromSlash failed`, error);
                    showMessage(plugin.i18n.newChildDocNavRefFailed || "新建子文档块失败");
                });
            },
        },
        ...(Array.isArray(plugin.protyleSlash)
            ? plugin.protyleSlash.filter((item) => item?.id !== NEW_CHILD_DOC_NAV_REF_SLASH_ID)
            : []),
    ];
}

async function deleteAutoChildNavBlock(blockId) {
    if (!blockId) {
        return;
    }
    await fetchSyncPost("/api/block/deleteBlock", { id: blockId });
}

async function syncChildNavRefBlocks(plugin, docId) {
    if (!docId || childNavSyncingDocs.has(docId)) {
        return;
    }
    childNavSyncingDocs.add(docId);
    try {
        await syncChildNavRefBlocksUnlocked(plugin, docId);
    } finally {
        childNavSyncingDocs.delete(docId);
    }
}

async function notifyChildNavAutoSync(plugin, docId, created, deleted) {
    const i18n = plugin?.i18n;
    if (!i18n || (created <= 0 && deleted <= 0)) {
        return;
    }
    const doc = await getDocDisplayTitle(docId);
    if (created > 0 && deleted > 0) {
        showMessage(formatTemplateMessage(i18n, "childNavAutoCreatedAndDeleted", { doc, created, deleted }));
        return;
    }
    if (created > 0) {
        showMessage(formatTemplateMessage(i18n, "childNavAutoCreated", { doc, count: created }));
        return;
    }
    showMessage(formatTemplateMessage(i18n, "childNavAutoDeleted", { doc, count: deleted }));
}

async function syncChildNavRefBlocksUnlocked(plugin, docId) {
    if (!docId) {
        return;
    }
    await deleteLegacyChildNavFences(docId);
    const children = await buildChildNavTree(docId);
    const childById = new Map(children.map((node) => [node.id, node]));
    const childIds = new Set(childById.keys());
    const autoBlocks = await queryAutoChildNavBlocks(docId);
    let deleted = 0;
    let created = 0;
    for (const block of autoBlocks) {
        if (!block.target || !childIds.has(block.target)) {
            try {
                await deleteAutoChildNavBlock(block.id);
                deleted += 1;
            } catch (error) {
                console.warn(`${LOG_PREFIX} deleteAutoChildNavBlock failed`, block.id, error);
            }
        }
    }
    const remaining = await queryAutoChildNavBlocks(docId);
    for (const block of remaining) {
        if (isChildNavH5Block(block) || !block.target) {
            continue;
        }
        const child = childById.get(block.target);
        const title = child?.title || titleFromChildNavContent(block.content, block.target);
        try {
            await updateAutoChildNavBlockMarkdown(block.id, childNavRefMarkdown(block.target, title));
        } catch (error) {
            console.warn(`${LOG_PREFIX} upgrade child-nav block to H5 failed`, block.id, error);
        }
    }
    const afterUpgrade = await queryAutoChildNavBlocks(docId);
    const have = new Set(afterUpgrade.map((block) => block.target).filter(Boolean));
    const missing = children.filter((node) => !have.has(node.id));
    if (missing.length) {
        for (const child of missing) {
            try {
                const newId = await insertAutoChildNavBlock({
                    parentID: docId,
                    childId: child.id,
                    title: child.title,
                });
                if (newId) {
                    created += 1;
                }
            } catch (error) {
                console.warn(`${LOG_PREFIX} insertAutoChildNavBlock failed`, child.id, error);
            }
        }
    }
    scheduleRefreshChildNavRefIcons();
    await notifyChildNavAutoSync(plugin, docId, created, deleted);
}

function removeLegacyChildNavHosts(root = document) {
    root.querySelectorAll?.(".fhelper-child-nav")?.forEach((el) => el.remove());
}

function scheduleSyncChildNavRefs(plugin, protyleOrDocId) {
    if (!plugin?.config?.childDocWidget?.enabled) {
        return;
    }
    const docId = typeof protyleOrDocId === "string"
        ? protyleOrDocId
        : getProtyleDocId(protyleOrDocId);
    if (!docId) {
        return;
    }
    if (!plugin.childNavMountTimers) {
        plugin.childNavMountTimers = new Map();
    }
    const prev = plugin.childNavMountTimers.get(docId);
    if (prev) {
        window.clearTimeout(prev);
    }
    const timer = window.setTimeout(() => {
        plugin.childNavMountTimers.delete(docId);
        syncChildNavRefBlocks(plugin, docId).catch((error) => {
            console.warn(`${LOG_PREFIX} syncChildNavRefBlocks failed`, docId, error);
        });
    }, CHILD_NAV_SYNC_DEBOUNCE_MS);
    plugin.childNavMountTimers.set(docId, timer);
}

function scheduleMountChildNav(plugin, protyle) {
    scheduleSyncChildNavRefs(plugin, protyle);
}

function syncAllChildNavPanels(plugin) {
    removeLegacyChildNavHosts();
    setChildNavRefStyleEnabled(plugin?.config?.docRefStyle?.enabled === true);
    const enabled = plugin?.config?.childDocWidget?.enabled === true;
    if (!enabled) {
        return;
    }
    getAllEditor().forEach(({ protyle }) => scheduleSyncChildNavRefs(plugin, protyle));
}

function refreshOpenChildNavWidgets(plugin) {
    syncAllChildNavPanels(plugin);
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
    removeLegacyChildNavHosts();
    scheduleSyncChildNavRefs(plugin, getProtyleFromEvent(event));
    scheduleRefreshChildNavRefIcons();
}

function handleProtyleChildNavSwitch(plugin, event) {
    scheduleSyncChildNavRefs(plugin, getProtyleFromEvent(event));
    scheduleRefreshChildNavRefIcons();
}

function scheduleEnsureChildNavWidget(plugin, protyle) {
    scheduleSyncChildNavRefs(plugin, protyle);
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

function clipToastDocTitle(title) {
    const text = String(title || "").replace(/[\u200b\ufeff]/g, "").replace(/\s+/g, " ").trim();
    if (!text) {
        return "";
    }
    if (text.length <= 40) {
        return text;
    }
    return `${text.slice(0, 38)}…`;
}

function getDocTitleFromOpenEditor(docId, protyle) {
    const seen = new Set();
    const queue = [];
    const push = (item) => {
        const p = unwrapProtyle(item);
        if (p && !seen.has(p)) {
            seen.add(p);
            queue.push(p);
        }
    };
    push(protyle);
    getAllEditor()?.forEach((editor) => push(editor?.protyle || editor));
    for (const p of queue) {
        if (getProtyleDocId(p) !== docId) {
            continue;
        }
        const raw = p.title?.editElement?.textContent
            || p.title?.element?.querySelector?.('[contenteditable="true"]')?.textContent
            || p.title?.element?.textContent;
        const clipped = clipToastDocTitle(raw);
        if (clipped) {
            return clipped;
        }
    }
    return "";
}

async function getDocDisplayTitle(docId, protyle) {
    const fromEditor = getDocTitleFromOpenEditor(docId, protyle);
    if (fromEditor) {
        return fromEditor;
    }
    if (!docId) {
        return "";
    }
    try {
        const rows = await runSqlQuery(
            `SELECT content FROM blocks WHERE id = '${escapeSqlId(docId)}' AND type = 'd' LIMIT 1`,
        );
        const fromSql = clipToastDocTitle(rows?.[0]?.content);
        if (fromSql) {
            return fromSql;
        }
    } catch (error) {
        console.warn(`${LOG_PREFIX} getDocDisplayTitle failed`, docId, error);
    }
    const notebook = getNotebookById(docId);
    return clipToastDocTitle(notebook?.name) || docId;
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

async function getDocPathById(docId) {
    if (!docId) {
        return null;
    }
    try {
        const response = await fetchSyncPost("/api/filetree/getPathByID", { id: docId });
        const data = response?.data ?? response;
        const notebook = data?.notebook || data?.box;
        const path = data?.path;
        if (notebook) {
            return { notebook, path: normalizeBoxDocPath(path, notebook) };
        }
    } catch (error) {
        console.warn(`${LOG_PREFIX} getPathByID failed`, docId, error);
    }
    if (getNotebookById(docId)) {
        return { notebook: docId, path: notebookBoxDocPath(docId) };
    }
    return null;
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
            showMessage(plugin.i18n.cannotResolveDoc);
            return;
        }
        await locateDocInFileTree(docId, editor);
        showMessage(plugin.i18n.locateInTreeDone);
    } catch (error) {
        console.warn(`${LOG_PREFIX} locateDocInFileTree failed`, error);
        showMessage(plugin.i18n.locateInTreeFailed);
    }
}

function formatTemplateMessage(i18n, key, params = {}) {
    let text = i18n[key] || key;
    Object.entries(params).forEach(([name, value]) => {
        text = text.replace(new RegExp(`\\$\\{${name}\\}`, "g"), String(value));
    });
    return text;
}

function sleepMs(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function flushChildNavSqlite(reason) {
    try {
        await fetchSyncPost("/api/sqlite/flushTransaction", {});
    } catch (error) {
        console.warn(`${LOG_PREFIX} flushTransaction ${reason} failed`, error);
    }
}

function collectNavBlockTargetsFromDom(protyle) {
    const root = unwrapProtyle(protyle)?.wysiwyg?.element;
    if (!root?.querySelectorAll) {
        return [];
    }
    const targets = [];
    root.querySelectorAll(`[${CHILD_NAV_FLAG_ATTR}="1"]`).forEach((el) => {
        const fromAttr = el.getAttribute(CHILD_NAV_TARGET_ATTR);
        const fromRef = el.querySelector?.('span[data-type~="block-ref"][data-id]')?.getAttribute("data-id");
        const id = fromAttr || fromRef;
        if (id) {
            targets.push(id);
        }
    });
    return targets;
}

function toDocDirPath(path) {
    if (!path || path === "/") {
        return "/";
    }
    return String(path).replace(/\.sy$/i, "");
}

function isDocPathUnderParent(childPath, parentPath, notebook, childBox) {
    if (!childPath || !parentPath) {
        return false;
    }
    if (childPath === parentPath) {
        return true;
    }
    if (notebook && isNotebookBoxDocPath(parentPath, notebook)) {
        return childBox === notebook && !isNotebookBoxDocPath(childPath, notebook);
    }
    const parentDir = toDocDirPath(parentPath);
    if (parentDir === "/") {
        return childPath !== "/";
    }
    return childPath === parentDir || childPath.startsWith(`${parentDir}/`);
}

async function queryDocPathsByIds(ids) {
    const unique = [...new Set((ids || []).filter(Boolean))];
    const result = new Map();
    if (!unique.length) {
        return result;
    }
    const inList = unique.map((id) => `'${escapeSqlId(id)}'`).join(",");
    try {
        const rows = await runSqlQuery(
            `SELECT id, path, box FROM blocks WHERE type = 'd' AND id IN (${inList}) LIMIT ${CHILD_NAV_SQL_LIMIT}`,
        );
        (rows || []).forEach((row) => {
            if (row?.id) {
                result.set(row.id, { path: row.path || "", box: row.box || "" });
            }
        });
    } catch (error) {
        console.warn(`${LOG_PREFIX} queryDocPathsByIds failed`, error);
    }
    return result;
}

async function collectNavBlockDocsToMove(parentId, protyle) {
    if (!parentId) {
        return [];
    }
    const [autoBlocks, children, parentPathInfo] = await Promise.all([
        queryAutoChildNavBlocks(parentId),
        buildChildNavTree(parentId),
        getDocPathById(parentId),
    ]);
    const childIds = new Set(children.map((node) => node.id));
    const targets = [...new Set([
        ...(autoBlocks || []).map((block) => block.target),
        ...collectNavBlockTargetsFromDom(protyle),
    ].filter((id) => id && id !== parentId && !childIds.has(id)))];
    if (!targets.length) {
        return [];
    }
    const meta = await queryDocPathsByIds(targets);
    return targets.filter((id) => {
        const info = meta.get(id);
        if (!info) {
            return false;
        }
        if (parentPathInfo && isDocPathUnderParent(parentPathInfo.path, info.path, info.box, parentPathInfo.notebook)) {
            return false;
        }
        return true;
    });
}

async function collectNavBlockDocsToMoveReady(parentId, protyle) {
    let toMove = await collectNavBlockDocsToMove(parentId, protyle);
    if (toMove.length) {
        return toMove;
    }
    await flushChildNavSqlite("before move-by-nav");
    for (const delay of [350, 700, 1200]) {
        await sleepMs(delay);
        toMove = await collectNavBlockDocsToMove(parentId, protyle);
        if (toMove.length) {
            return toMove;
        }
    }
    return [];
}

async function moveDocsAsChildren(parentId, docIds) {
    if (!parentId || !docIds?.length) {
        return 0;
    }
    const response = await fetchSyncPost("/api/filetree/moveDocsByID", {
        fromIDs: docIds,
        toID: parentId,
    });
    if (response && typeof response.code === "number" && response.code !== 0) {
        throw new Error(response.msg || "moveDocsByID failed");
    }
    await flushChildNavSqlite("after moveDocsByID");
    return docIds.length;
}

async function handleMoveDocsByNavBlocksForProtyle(plugin, protyle) {
    if (plugin.moveDocsByNavBusy) {
        return;
    }
    plugin.moveDocsByNavBusy = true;
    try {
        const editor = unwrapProtyle(protyle) || findProtyleByElement(protyle?.element);
        const { docId } = resolveProtyleDocId(editor);
        if (!docId) {
            showMessage(plugin.i18n.cannotResolveDoc);
            return;
        }
        const doc = await getDocDisplayTitle(docId, editor);
        const toMove = await collectNavBlockDocsToMoveReady(docId, editor);
        if (!toMove.length) {
            showMessage(formatTemplateMessage(plugin.i18n, "moveDocsByNavBlocksNone", { doc }));
            return;
        }
        const moved = await moveDocsAsChildren(docId, toMove);
        scheduleSyncChildNavRefs(plugin, editor);
        showMessage(formatTemplateMessage(plugin.i18n, "moveDocsByNavBlocksDone", { doc, count: moved }));
    } catch (error) {
        console.warn(`${LOG_PREFIX} moveDocsByNavBlocks failed`, error);
        showMessage(plugin.i18n.moveDocsByNavBlocksFailed);
    } finally {
        plugin.moveDocsByNavBusy = false;
    }
}

function collectPresentChildNavTargets(autoBlocks, protyle) {
    return new Set([
        ...(autoBlocks || []).map((block) => block.target),
        ...collectNavBlockTargetsFromDom(protyle),
    ].filter(Boolean));
}

function shouldTrustDomNavTargets(children, autoBlocks, protyle) {
    if (!unwrapProtyle(protyle)?.wysiwyg?.element) {
        return false;
    }
    const childIds = new Set((children || []).map((node) => node.id));
    const sql = new Set((autoBlocks || []).map((block) => block.target).filter((id) => childIds.has(id)));
    const dom = new Set(collectNavBlockTargetsFromDom(protyle).filter((id) => childIds.has(id)));
    if (!sql.size) {
        return true;
    }
    const missing = [...sql].filter((id) => !dom.has(id)).length;
    return missing <= Math.max(3, Math.ceil(sql.size * 0.15));
}

async function collectChildrenWithoutNavBlocksReady(parentId, protyle) {
    if (!parentId) {
        return [];
    }
    await flushChildNavSqlite("before delete-children-without-nav");
    await sleepMs(350);
    const [children, autoBlocks] = await Promise.all([
        buildChildNavTree(parentId),
        queryAutoChildNavBlocks(parentId),
    ]);
    const have = shouldTrustDomNavTargets(children, autoBlocks, protyle)
        ? new Set(collectNavBlockTargetsFromDom(protyle).filter(Boolean))
        : collectPresentChildNavTargets(autoBlocks, protyle);
    return children.filter((node) => node?.id && !have.has(node.id));
}

async function removeDocsById(ids) {
    let removed = 0;
    for (const id of ids || []) {
        if (!id) {
            continue;
        }
        const response = await fetchSyncPost("/api/filetree/removeDocByID", { id });
        if (response && typeof response.code === "number" && response.code !== 0) {
            throw new Error(response.msg || "removeDocByID failed");
        }
        removed += 1;
    }
    await flushChildNavSqlite("after removeDocByID");
    return removed;
}

async function handleDeleteChildrenWithoutNavForProtyle(plugin, protyle) {
    if (plugin.deleteChildrenWithoutNavBusy) {
        return;
    }
    plugin.deleteChildrenWithoutNavBusy = true;
    try {
        const editor = unwrapProtyle(protyle) || findProtyleByElement(protyle?.element);
        const { docId } = resolveProtyleDocId(editor);
        if (!docId) {
            showMessage(plugin.i18n.cannotResolveDoc);
            return;
        }
        const doc = await getDocDisplayTitle(docId, editor);
        const toDelete = await collectChildrenWithoutNavBlocksReady(docId, editor);
        if (!toDelete.length) {
            showMessage(formatTemplateMessage(plugin.i18n, "deleteChildrenWithoutNavNone", { doc }));
            return;
        }
        const deleted = await removeDocsById(toDelete.map((node) => node.id));
        scheduleSyncChildNavRefs(plugin, editor);
        showMessage(formatTemplateMessage(plugin.i18n, "deleteChildrenWithoutNavDone", { doc, count: deleted }));
    } catch (error) {
        console.warn(`${LOG_PREFIX} deleteChildrenWithoutNav failed`, error);
        showMessage(plugin.i18n.deleteChildrenWithoutNavFailed);
    } finally {
        plugin.deleteChildrenWithoutNavBusy = false;
    }
}

const BREADCRUMB_BTN_LOCATE = "fhelper-locate-in-tree";
const BREADCRUMB_BTN_MOVE_BY_NAV = "fhelper-move-docs-by-nav";
const BREADCRUMB_BTN_DELETE_WITHOUT_NAV = "fhelper-delete-children-without-nav";
const LEGACY_BREADCRUMB_CHILD_INDEX = "fhelper-child-doc-index";
const RETIRED_BREADCRUMB_BTN_TYPES = [
    LEGACY_BREADCRUMB_CHILD_INDEX,
    "fhelper-gather-refs",
    "fhelper-delete-unref-children",
];

const BREADCRUMB_DOC_ACTIONS = [
    {
        type: BREADCRUMB_BTN_LOCATE,
        iconHref: "#iconFocus",
        tipKey: "locateInTreeBreadcrumbTip",
        run: (plugin, editor) => handleLocateDocInTreeForProtyle(plugin, editor),
        failKey: "locateInTreeFailed",
    },
    {
        type: BREADCRUMB_BTN_MOVE_BY_NAV,
        iconHref: "#iconMove",
        tipKey: "moveDocsByNavBlocksBreadcrumbTip",
        run: (plugin, editor) => handleMoveDocsByNavBlocksForProtyle(plugin, editor),
        failKey: "moveDocsByNavBlocksFailed",
    },
    {
        type: BREADCRUMB_BTN_DELETE_WITHOUT_NAV,
        iconHref: "#iconTrashcan",
        tipKey: "deleteChildrenWithoutNavBreadcrumbTip",
        run: (plugin, editor) => handleDeleteChildrenWithoutNavForProtyle(plugin, editor),
        failKey: "deleteChildrenWithoutNavFailed",
    },
];

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

function ensureFhelperTooltipCss() {
    let style = document.getElementById(FHELPER_TOOLTIP_STYLE_ID);
    if (!style) {
        style = document.createElement("style");
        style.id = FHELPER_TOOLTIP_STYLE_ID;
        document.head.appendChild(style);
    }
    style.textContent = "#tooltip { white-space: pre-wrap; max-width: min(22rem, 72vw); }";
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
            showMessage(plugin.i18n[action.failKey] || plugin.i18n.cannotResolveDoc);
        });
    }, true);
    return fresh;
}

function removeRetiredBreadcrumbButtons(root = document) {
    const selector = RETIRED_BREADCRUMB_BTN_TYPES
        .flatMap((type) => [
            `.protyle-breadcrumb [data-type="${type}"]`,
            `button[data-type="${type}"]`,
        ])
        .join(", ");
    root.querySelectorAll?.(selector)?.forEach((el) => el.remove());
}

function ensureDocActionBreadcrumbButtons(plugin, protyle) {
    ensureFhelperTooltipCss();
    const root = getBreadcrumbRoot(protyle);
    if (!root) {
        return;
    }
    removeRetiredBreadcrumbButtons(root);
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

function patchDocActionBreadcrumbButtons(plugin) {
    removeRetiredBreadcrumbButtons(document);
    getAllEditor().forEach((editor) => {
        const protyle = unwrapProtyle(editor?.protyle || editor);
        if (protyle) {
            ensureDocActionBreadcrumbButtons(plugin, protyle);
        }
    });
}

function syncDocRefStyleFeature(plugin) {
    setDocRefStyleCssEnabled(false);
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
    setChildNavRefStyleEnabled(plugin.config.docRefStyle?.enabled === true);
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

function isNewChildDocNavRefSlashItem(item) {
    if (!item || isSeparatorItem(item)) {
        return false;
    }
    if (item.id === NEW_CHILD_DOC_NAV_REF_SLASH_ID) {
        return true;
    }
    const key = getSlashItemKey(item);
    return typeof key === "string" && key.endsWith(`:${NEW_CHILD_DOC_NAV_REF_SLASH_ID}`);
}

function pinNewChildDocNavRefSlash(items) {
    if (!Array.isArray(items) || items.length < 2) {
        return items;
    }
    const idx = items.findIndex(isNewChildDocNavRefSlashItem);
    if (idx <= 0) {
        return items;
    }
    const next = items.slice();
    const [pinned] = next.splice(idx, 1);
    next.unshift(pinned);
    return next;
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
    return pinNewChildDocNavRefSlash(items);
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
    return pinNewChildDocNavRefSlash(stripOrphanSeparators(result, isEnabled));
}

function createDefaultConfig() {
    return {
        disabled: {},
        imageScale: createDefaultImageScaleConfig(),
        panguSpacing: createDefaultPanguSpacingConfig(),
        docRefStyle: createDefaultDocRefStyleConfig(),
        childDocWidget: createDefaultChildDocWidgetConfig(),
        configSync: createDefaultConfigSyncConfig(),
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
    patchDocActionBreadcrumbButtons(plugin);
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
    layoutRefreshTimer = null;
    windowResizeHandler = null;
    moveDocsByNavBusy = false;
    deleteChildrenWithoutNavBusy = false;
    breadcrumbMoreHandler = null;

    updateProtyleToolbar(toolbar) {
        toolbar.push("|");
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
        return toolbar;
    }

    onload() {
        this.data[STORAGE_NAME] = createDefaultConfig();
        this.config = this.data[STORAGE_NAME];
        activeFhelperPlugin = this;
        removeLegacyFileTreeHideCss();
        registerNewChildDocNavRefSlash(this);
        this.addIcons(`
<symbol id="iconFhelper" viewBox="0 0 24 24">
  <path fill="currentColor" d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path>
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
            langKey: "locateInTreeCurrentDoc",
            hotkey: "",
            editorCallback: (protyle) => {
                handleLocateDocInTreeForProtyle(this, protyle).catch((error) => {
                    console.warn(`${LOG_PREFIX} handleLocateDocInTreeForProtyle failed`, error);
                    showMessage(this.i18n.locateInTreeFailed);
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
        patchDocActionBreadcrumbButtons(this);
        removeLegacyFileTreeHideCss();
        syncAllChildNavPanels(this);
        // Import is manual only; watchers only push on theme change / settings close.
        if (isConfigSyncActive()) {
            installConfigSyncWatchers(this);
        }
    }

    onunload() {
        uninstallConfigSyncWatchers(this);
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
        removeLegacyFileTreeHideCss();
        if (this.childNavWsTimer) {
            window.clearTimeout(this.childNavWsTimer);
            this.childNavWsTimer = null;
        }
        if (this.childNavMountTimers) {
            this.childNavMountTimers.forEach((timer) => window.clearTimeout(timer));
            this.childNavMountTimers.clear();
            this.childNavMountTimers = null;
        }
        removeLegacyChildNavHosts();
        setChildNavRefStyleEnabled(false);
        if (this.breadcrumbMoreHandler) {
            this.eventBus.off("open-menu-breadcrumbmore", this.breadcrumbMoreHandler);
            this.breadcrumbMoreHandler = null;
        }
        removeRetiredBreadcrumbButtons(document);
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
                childDocWidget: {
                    ...createDefaultChildDocWidgetConfig(),
                    ...(data.childDocWidget || {}),
                    mode: normalizeChildNavMode(data.childDocWidget?.mode),
                },
                configSync: createDefaultConfigSyncConfig(),
            };
            this.data[STORAGE_NAME] = this.config;
            this.applyImageCenterStyle();
            syncPanguSpacingWatchers(this);
            syncDocRefStyleFeature(this);
            if (this.config.imageScale?.enabled) {
                scheduleLayoutRefresh(this);
            }
            syncAllChildNavPanels(this);
            patchDocActionBreadcrumbButtons(this);
            removeLegacyFileTreeHideCss();
            if (isConfigSyncActive()) {
                installConfigSyncWatchers(this);
            } else {
                uninstallConfigSyncWatchers(this);
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
                    || data.docRefStyle
                    || data.childDocWidget
                    || data.configSync);
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

    createOpenFolderButton(resolveAbsPath, ensureKernelDir) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "b3-button b3-button--outline";
        btn.textContent = this.i18n.openFolder || "打开文件夹";
        btn.addEventListener("click", () => {
            const run = async () => {
                if (ensureKernelDir) {
                    await apiEnsureDir(ensureKernelDir);
                }
                const absPath = typeof resolveAbsPath === "function" ? resolveAbsPath() : resolveAbsPath;
                await openLocalFolder(absPath, this);
            };
            run().catch((error) => {
                console.warn(`${LOG_PREFIX} open folder failed`, error);
                showMessage(this.i18n.openFolderFailed || "无法打开文件夹");
            });
        });
        return btn;
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
            childDocWidget: { ...(this.config.childDocWidget || createDefaultChildDocWidgetConfig()) },
            configSync: { ...(this.config.configSync || createDefaultConfigSyncConfig()) },
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
            icon: "iconFhelper",
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
        if (this.childDocWidgetEnableEl) {
            this.config.childDocWidget = {
                ...(this.config.childDocWidget || createDefaultChildDocWidgetConfig()),
                enabled: this.childDocWidgetEnableEl.checked,
                mode: "direct",
            };
        }
        delete this.config.fileTree;
        // Config/theme cache is always on (desktop); persist defaults for older configs.
        this.config.configSync = createDefaultConfigSyncConfig();
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
        patchDocActionBreadcrumbButtons(this);
        removeLegacyFileTreeHideCss();
        if (isConfigSyncActive()) {
            installConfigSyncWatchers(this);
        } else {
            uninstallConfigSyncWatchers(this);
        }
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

    createSettingSection(title, description) {
        const section = document.createElement("div");
        section.className = "fhelper-setting__section";
        const heading = document.createElement("div");
        heading.className = "fhelper-setting__section-title";
        heading.textContent = title;
        section.appendChild(heading);
        if (description) {
            const desc = document.createElement("div");
            desc.className = "fhelper-setting__section-desc";
            desc.textContent = description;
            section.appendChild(desc);
        }
        return section;
    }

    buildGeneralTab() {
        const panel = document.createElement("div");
        panel.className = "fhelper-setting__panel";
        panel.dataset.tab = "general";

        const imageScale = this.config.imageScale || createDefaultImageScaleConfig();
        const panguSpacing = this.config.panguSpacing || createDefaultPanguSpacingConfig();
        const docRefStyle = this.config.docRefStyle || createDefaultDocRefStyleConfig();
        const childDocWidget = this.config.childDocWidget || createDefaultChildDocWidgetConfig();
        const dpiAvailable = canUseImageScale();

        const childNavSection = this.createSettingSection(this.i18n.sectionChildDocWidget);
        this.childDocWidgetEnableEl = this.createSettingSwitch(childDocWidget.enabled === true);
        childNavSection.appendChild(this.createSettingRow({
            title: this.i18n.childDocWidgetEnable,
            description: this.i18n.childDocWidgetEnableDesc,
            control: this.childDocWidgetEnableEl,
        }));
        this.docRefStyleEnableEl = this.createSettingSwitch(docRefStyle.enabled === true);
        childNavSection.appendChild(this.createSettingRow({
            title: this.i18n.docRefStyleEnable,
            description: this.i18n.docRefStyleEnableDesc,
            control: this.docRefStyleEnableEl,
        }));
        panel.appendChild(childNavSection);

        const defaultIconSection = this.createSettingSection(
            this.i18n.sectionDefaultIcons,
            this.i18n.sectionDefaultIconsDesc,
        );
        defaultIconSection.appendChild(createDefaultIconRow(
            this,
            "note",
            this.i18n.defaultIconNotebook,
            this.i18n.defaultIconNotebookDesc,
        ));
        defaultIconSection.appendChild(createDefaultIconRow(
            this,
            "folder",
            this.i18n.defaultIconFolder,
            this.i18n.defaultIconFolderDesc,
        ));
        defaultIconSection.appendChild(createDefaultIconRow(
            this,
            "file",
            this.i18n.defaultIconFile,
            this.i18n.defaultIconFileDesc,
        ));
        panel.appendChild(defaultIconSection);

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
        panel.appendChild(panguSection);

        const configSyncSection = this.createSettingSection(
            this.i18n.sectionConfigSync,
            this.i18n.sectionConfigSyncDesc,
        );
        const syncActions = document.createElement("div");
        syncActions.className = "fhelper-setting__toolbar";
        const pushBtn = document.createElement("button");
        pushBtn.type = "button";
        pushBtn.className = "b3-button b3-button--outline";
        pushBtn.textContent = this.i18n.configSyncPushNow;
        const pullBtn = document.createElement("button");
        pullBtn.type = "button";
        pullBtn.className = "b3-button b3-button--outline";
        pullBtn.textContent = this.i18n.configSyncPullNow;
        const setSyncButtonsBusy = (busy) => {
            pushBtn.disabled = busy;
            pullBtn.disabled = busy;
        };
        pushBtn.addEventListener("click", () => {
            this.syncSettingFormToConfig();
            setSyncButtonsBusy(true);
            pushConfigSync(this, { force: true, notify: true }).catch((error) => {
                console.warn(`${LOG_PREFIX} manual pushConfigSync failed`, error);
                showMessage(this.i18n.configSyncFailed);
            }).finally(() => {
                setSyncButtonsBusy(false);
            });
        });
        pullBtn.addEventListener("click", () => {
            this.syncSettingFormToConfig();
            setSyncButtonsBusy(true);
            pullConfigSync(this, { force: true, notify: true }).catch((error) => {
                console.warn(`${LOG_PREFIX} manual pullConfigSync failed`, error);
                showMessage(this.i18n.configSyncFailed);
            }).finally(() => {
                setSyncButtonsBusy(false);
            });
        });
        syncActions.appendChild(pushBtn);
        syncActions.appendChild(pullBtn);
        configSyncSection.appendChild(this.createSettingRow({
            title: this.i18n.configSyncActions,
            control: syncActions,
        }));
        panel.appendChild(configSyncSection);

        const aboutSection = this.createSettingSection(this.i18n.sectionAbout);
        aboutSection.appendChild(this.createSettingRow({
            title: this.i18n.configPathLabel,
            description: this.getStoragePathDisplay(),
            control: this.createOpenFolderButton(
                () => getConfigFileAbsDir(this),
                getPluginPetalRoot(this),
            ),
        }));
        aboutSection.appendChild(this.createSettingRow({
            title: this.i18n.cachePathLabel,
            description: getConfigSyncPathDisplay(this),
            control: this.createOpenFolderButton(
                () => getConfigSyncAbsDir(this),
                getConfigSyncRoot(this),
            ),
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
    padding: 16px 16px 12px;
}
.fhelper-setting__panel {
    display: flex;
    flex-direction: column;
    gap: 28px;
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
.fhelper-setting__section-desc {
    padding: 10px 14px;
    font-size: 12px;
    line-height: 1.55;
    color: var(--b3-theme-on-surface-light);
    background: var(--b3-theme-background);
    border-bottom: 1px solid var(--b3-border-color);
    white-space: pre-wrap;
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
.fhelper-setting__icon-actions {
    display: flex;
    align-items: center;
    gap: 8px;
}
.fhelper-setting__icon-pick {
    width: 32px;
    height: 32px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    line-height: 1;
    border: 1px solid var(--b3-border-color);
    border-radius: 6px;
    background: var(--b3-theme-background);
    color: var(--b3-theme-on-background);
    cursor: pointer;
}
.fhelper-setting__icon-pick img {
    width: 20px;
    height: 20px;
    object-fit: contain;
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
    gap: 20px;
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
