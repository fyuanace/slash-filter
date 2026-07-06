const { Plugin, Setting, getAllEditor, showMessage } = require("siyuan");

const STORAGE_NAME = "slash-filter-config.json";
const LEGACY_STORAGE_NAME = "slash-filter-config";
const ZWSP = "\u200b";
const SCREEN_DPI = 96;
const SIYUAN_LOCAL_ZOOM_KEY = "local-zoom";
const IMAGE_CENTER_STYLE_ID = "slash-filter-img-center-css";
const IMAGE_CENTER_CSS = `.p:has(span.img) {
    margin-left: auto;
    margin-right: auto;
}`;
const IMAGE_SCALE_RETRY_DELAYS = [100, 400, 1000, 2500];
const IMAGE_AUTO_WIDTH = "calc(100% - 8px)";

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
        dpiMode: "auto",
        manualDpi: 144,
    };
}

function createDefaultPanguSpacingConfig() {
    return {
        enabled: false,
    };
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
            console.debug("[slash-filter] walker anchor failed", error);
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
            console.debug("[slash-filter] walker anchor failed", error);
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
        console.debug("[slash-filter] webFrame zoom unavailable", error);
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

function getEffectiveDpi(imageScale) {
    if (imageScale?.dpiMode === "manual") {
        const dpi = Math.round(Number(imageScale.manualDpi));
        return dpi > 0 ? dpi : null;
    }
    return getAutoDpi();
}

function canUseImageScale(imageScale) {
    return getEffectiveDpi(imageScale) !== null;
}

function getDpiModeDescription(i18n, imageScale) {
    if (imageScale?.dpiMode === "manual") {
        const dpi = Math.round(Number(imageScale.manualDpi)) || 0;
        return i18n.manualDpiActiveLabel.replace("${dpi}", String(dpi > 0 ? dpi : "—"));
    }
    return getAutoDpiDescription(i18n);
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
    const dpi = getEffectiveDpi(plugin.config.imageScale);
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
    };
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
    watchAllEditorLayouts(plugin);
    syncPanguSpacingWatchers(plugin);
}

module.exports = class SlashFilterPlugin extends Plugin {
    slashHandler = null;
    pasteHandler = null;
    pastePanguHandler = null;
    protyleLoadHandler = null;
    bazaarObserver = null;
    topBarEntry = null;
    config = createDefaultConfig();
    slashCatalog = new Map();
    settingToggleEls = new Map();
    imageScaleEnableEl = null;
    imageDpiManualModeEl = null;
    imageManualDpiEl = null;
    imageScaleCenterEl = null;
    panguSpacingEnableEl = null;
    protyleLayoutWatchers = new Map();
    panguSpacingWatchers = new Map();
    layoutRefreshTimer = null;
    windowResizeHandler = null;

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

        this.protyleLoadHandler = () => patchAllEditors(this);
        this.eventBus.on("loaded-protyle-dynamic", this.protyleLoadHandler);
        this.eventBus.on("loaded-protyle-static", this.protyleLoadHandler);

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
        if (this.protyleLoadHandler) {
            this.eventBus.off("loaded-protyle-dynamic", this.protyleLoadHandler);
            this.eventBus.off("loaded-protyle-static", this.protyleLoadHandler);
            this.protyleLoadHandler = null;
        }
        if (this.windowResizeHandler) {
            window.removeEventListener("resize", this.windowResizeHandler);
            this.windowResizeHandler = null;
        }
        unwatchAllProtyleLayouts(this);
        unwatchAllPanguSpacing(this);
        setImageCenterCssEnabled(false);
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
                imageScale: {
                    ...createDefaultImageScaleConfig(),
                    ...(data.imageScale || {}),
                },
                panguSpacing: {
                    ...createDefaultPanguSpacingConfig(),
                    ...(data.panguSpacing || {}),
                },
            };
            this.data[STORAGE_NAME] = this.config;
            this.applyImageCenterStyle();
            syncPanguSpacingWatchers(this);
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
                && (Object.keys(data.disabled || {}).length > 0 || data.imageScale || data.panguSpacing);
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
        this.config = {
            disabled,
            imageScale: { ...(this.config.imageScale || createDefaultImageScaleConfig()) },
            panguSpacing: { ...(this.config.panguSpacing || createDefaultPanguSpacingConfig()) },
        };
        this.settingToggleEls.forEach((input, key) => {
            input.checked = enabled;
        });
    }

    initSettingPanel() {
        this.setting = new Setting({
            height: "80vh",
            width: "768px",
            confirmCallback: () => {
                this.saveConfig().catch((error) => {
                    console.warn("[slash-filter] saveData failed", error);
                    showMessage(this.i18n.saveFailed);
                });
            },
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
        if (this.imageDpiManualModeEl) {
            this.config.imageScale.dpiMode = this.imageDpiManualModeEl.checked ? "manual" : "auto";
        }
        if (this.imageManualDpiEl) {
            this.config.imageScale.manualDpi = Math.max(1, Number(this.imageManualDpiEl.value) || SCREEN_DPI);
        }
        if (this.panguSpacingEnableEl) {
            this.config.panguSpacing.enabled = this.panguSpacingEnableEl.checked;
        }
    }

    updateImageScaleControlState() {
        const imageScale = this.config.imageScale || createDefaultImageScaleConfig();
        if (this.imageDpiManualModeEl) {
            imageScale.dpiMode = this.imageDpiManualModeEl.checked ? "manual" : "auto";
        }
        if (this.imageManualDpiEl) {
            imageScale.manualDpi = Math.max(1, Number(this.imageManualDpiEl.value) || SCREEN_DPI);
        }
        const available = canUseImageScale(imageScale);
        if (this.imageScaleEnableEl) {
            this.imageScaleEnableEl.disabled = !available;
        }
        if (this.imageManualDpiEl) {
            this.imageManualDpiEl.disabled = imageScale.dpiMode !== "manual";
        }
    }

    saveConfig() {
        this.syncSettingFormToConfig();
        this.applyImageCenterStyle();
        syncPanguSpacingWatchers(this);
        this.data[STORAGE_NAME] = this.config;
        scheduleLayoutRefresh(this);
        return this.saveData(STORAGE_NAME, this.config);
    }

    buildSettingItems() {
        this.settingToggleEls.clear();
        this.imageScaleEnableEl = null;
        this.imageDpiManualModeEl = null;
        this.imageManualDpiEl = null;
        this.imageScaleCenterEl = null;
        this.panguSpacingEnableEl = null;
        const imageScale = this.config.imageScale || createDefaultImageScaleConfig();
        const panguSpacing = this.config.panguSpacing || createDefaultPanguSpacingConfig();
        const dpiAvailable = canUseImageScale(imageScale);

        this.setting.addItem({
            title: this.i18n.configPathLabel,
            description: this.getStoragePathDisplay(),
        });
        this.setting.addItem({
            title: this.i18n.imageScaleEnable,
            direction: "row",
            description: this.i18n.imageScaleEnableDesc,
            createActionElement: () => {
                const input = document.createElement("input");
                input.className = "b3-switch";
                input.type = "checkbox";
                input.checked = imageScale.enabled === true;
                input.disabled = !dpiAvailable;
                this.imageScaleEnableEl = input;
                return input;
            },
        });
        this.setting.addItem({
            title: this.i18n.dpiManualMode,
            direction: "row",
            description: getDpiModeDescription(this.i18n, imageScale),
            createActionElement: () => {
                const input = document.createElement("input");
                input.className = "b3-switch";
                input.type = "checkbox";
                input.checked = imageScale.dpiMode === "manual";
                input.disabled = imageScale.dpiMode !== "manual" && getAutoDpi() === null;
                input.addEventListener("change", () => this.updateImageScaleControlState());
                this.imageDpiManualModeEl = input;
                return input;
            },
        });
        this.setting.addItem({
            title: this.i18n.manualDpi,
            direction: "row",
            description: this.i18n.manualDpiDesc,
            createActionElement: () => {
                const input = document.createElement("input");
                input.className = "b3-text-field fn__flex-center fn__size200";
                input.type = "number";
                input.min = "1";
                input.max = "1200";
                input.step = "1";
                input.value = String(imageScale.manualDpi || 144);
                input.disabled = imageScale.dpiMode !== "manual";
                input.addEventListener("input", () => this.updateImageScaleControlState());
                this.imageManualDpiEl = input;
                return input;
            },
        });
        this.setting.addItem({
            title: this.i18n.imageScaleCenter,
            direction: "row",
            description: this.i18n.imageScaleCenterDesc,
            createActionElement: () => {
                const input = document.createElement("input");
                input.className = "b3-switch";
                input.type = "checkbox";
                input.checked = imageScale.center === true;
                this.imageScaleCenterEl = input;
                return input;
            },
        });
        this.setting.addItem({
            title: this.i18n.panguSpacingEnable,
            direction: "row",
            description: this.i18n.panguSpacingEnableDesc,
            createActionElement: () => {
                const input = document.createElement("input");
                input.className = "b3-switch";
                input.type = "checkbox";
                input.checked = panguSpacing.enabled === true;
                this.panguSpacingEnableEl = input;
                return input;
            },
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
