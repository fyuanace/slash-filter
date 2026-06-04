const { Plugin, Setting, getAllEditor, showMessage } = require("siyuan");

const STORAGE_NAME = "slash-filter-config.json";
const LEGACY_STORAGE_NAME = "slash-filter-config";
const ZWSP = "\u200b";

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
    return { disabled: {} };
}

function isItemEnabled(item, config) {
    const key = getSlashItemKey(item);
    if (!key) {
        return true;
    }
    return config?.disabled?.[key] !== true;
}

let activeSlashFilterPlugin = null;
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
    activeSlashFilterPlugin = plugin;
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
        proto.genHTML = function slashFilterGenHTML(data, protyleArg, hide, source) {
            const currentPlugin = activeSlashFilterPlugin;
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
        proto.render = function slashFilterRender(protyle) {
            originalHintRender.call(this, protyle);
            if (!activeSlashFilterPlugin || !isSlashHintInstance(this) || !this.element) {
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
    activeSlashFilterPlugin = null;
}

function scheduleSlashHintHook(plugin) {
    installSlashHintHook(plugin);
    window.setTimeout(() => installSlashHintHook(plugin), 300);
    window.setTimeout(() => installSlashHintHook(plugin), 1500);
}

function patchAllEditors(plugin) {
    scheduleSlashHintHook(plugin);
}

module.exports = class SlashFilterPlugin extends Plugin {
    slashHandler = null;
    protyleLoadHandler = null;
    bazaarObserver = null;
    topBarEntry = null;
    config = createDefaultConfig();
    slashCatalog = new Map();
    settingToggleEls = new Map();

    onload() {
        this.data[STORAGE_NAME] = createDefaultConfig();
        this.initSettingPanel();

        this.addCommand({
            langKey: "openSlashFilterSetting",
            hotkey: "",
            callback: () => {
                this.openSetting();
            },
        });

        this.loadSlashConfig();

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

        this.protyleLoadHandler = () => patchAllEditors(this);
        this.eventBus.on("loaded-protyle-dynamic", this.protyleLoadHandler);
        this.eventBus.on("loaded-protyle-static", this.protyleLoadHandler);

        this.registerBazaarSettingWatcher();
        this.scheduleBazaarSettingButtonFix();
    }

    onLayoutReady() {
        this.refreshSlashCatalog();
        patchAllEditors(this);
        this.registerTopBarEntry();
        this.ensureBazaarSettingButton();
        this.scheduleBazaarSettingButtonFix();
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
        if (this.protyleLoadHandler) {
            this.eventBus.off("loaded-protyle-dynamic", this.protyleLoadHandler);
            this.eventBus.off("loaded-protyle-static", this.protyleLoadHandler);
            this.protyleLoadHandler = null;
        }
    }

    uninstall() {
        this.removeData(STORAGE_NAME).catch((error) => {
            console.warn("[slash-filter] removeData failed", error);
        });
        this.removeData(LEGACY_STORAGE_NAME).catch((error) => {
            console.warn("[slash-filter] remove legacy data failed", error);
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
            };
            this.data[STORAGE_NAME] = this.config;
        }
    }

    loadSlashConfig() {
        return this.loadData(STORAGE_NAME).then((data) => {
            const hasNewConfig = data
                && typeof data === "object"
                && Object.keys(data.disabled || {}).length > 0;
            if (hasNewConfig) {
                this.applyConfig(data);
                return;
            }
            return this.loadData(LEGACY_STORAGE_NAME).then((legacyData) => {
                if (legacyData && typeof legacyData === "object") {
                    this.applyConfig(legacyData);
                    if (Object.keys(legacyData.disabled || {}).length > 0) {
                        return this.saveData(STORAGE_NAME, legacyData).then(() => {
                            return this.removeData(LEGACY_STORAGE_NAME);
                        });
                    }
                    return;
                }
                this.applyConfig(data);
            });
        }).catch((error) => {
            console.warn("[slash-filter] loadData failed", error);
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
        this.config = { disabled };
        this.settingToggleEls.forEach((input, key) => {
            input.checked = enabled;
        });
    }

    initSettingPanel() {
        this.setting = new Setting({
            height: "80vh",
            width: "768px",
            confirmCallback: () => {
                this.saveSlashConfig().catch((error) => {
                    console.warn("[slash-filter] saveData failed", error);
                    showMessage(this.i18n.saveFailed);
                });
            },
        });
        this.setting.addItem({
            title: this.i18n.settingHint,
            description: "",
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
                console.warn("[slash-filter] ensureBazaarSettingButton failed", error);
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

    saveSlashConfig() {
        const disabled = {};
        this.settingToggleEls.forEach((input, key) => {
            if (!input.checked) {
                disabled[key] = true;
            }
        });
        this.config = { disabled };
        this.data[STORAGE_NAME] = this.config;
        return this.saveData(STORAGE_NAME, this.config);
    }

    buildSettingItems() {
        this.settingToggleEls.clear();
        this.setting.addItem({
            title: this.i18n.configPathLabel,
            description: this.getStoragePathDisplay(),
        });
        this.setting.addItem({
            title: this.i18n.settingHint,
            description: "",
        });

        const enableAllBtn = document.createElement("button");
        enableAllBtn.className = "b3-button b3-button--outline fn__flex-center fn__size200";
        enableAllBtn.textContent = this.i18n.enableAll;
        enableAllBtn.addEventListener("click", () => this.setAllSlashItemsEnabled(true));

        const disableAllBtn = document.createElement("button");
        disableAllBtn.className = "b3-button b3-button--outline fn__flex-center fn__size200";
        disableAllBtn.textContent = this.i18n.disableAll;
        disableAllBtn.addEventListener("click", () => this.setAllSlashItemsEnabled(false));

        this.setting.addItem({
            title: "",
            direction: "row",
            actionElement: enableAllBtn,
        });
        this.setting.addItem({
            title: "",
            direction: "row",
            actionElement: disableAllBtn,
        });

        const entries = [...this.slashCatalog.values()].sort((a, b) => {
            if (a.order !== b.order) {
                return a.order - b.order;
            }
            return a.label.localeCompare(b.label, "zh-CN");
        });

        if (entries.length === 0) {
            this.setting.addItem({
                title: this.i18n.settingEmpty,
            });
            return;
        }

        let currentGroup = null;
        for (const entry of entries) {
            const displayGroup = entry.group === "内置" ? this.i18n.groupBuiltin : entry.group;
            if (displayGroup !== currentGroup) {
                currentGroup = displayGroup;
                this.setting.addItem({
                    title: currentGroup,
                    description: "",
                });
            }
            const key = entry.key;
            this.setting.addItem({
                title: entry.label,
                direction: "row",
                description: entry.filterText
                    ? `${this.i18n.filterKeywords}: ${entry.filterText}`
                    : "",
                createActionElement: () => {
                    const input = document.createElement("input");
                    input.className = "b3-switch";
                    input.type = "checkbox";
                    input.checked = this.isSlashItemEnabled(key);
                    this.settingToggleEls.set(key, input);
                    return input;
                },
            });
        }
    }

    openSetting() {
        this.refreshSlashCatalog();
        this.initSettingPanel();
        this.buildSettingItems();
        this.setting.open(this.displayName);
    }
};
