/**
 * Editor module.
 * Handles inline contenteditable editing, state sync, bullet/entry add/delete.
 */

let _dirty = false;
let _formatTarget = null;
let _formatRange = null;
let _formatOffsets = null;
let _formatBulletIds = [];
const _undoStack = [];
const UNDO_LIMIT = 100;
let _lastInputHistory = null;
let _focusedHistoryTarget = null;
let _focusWithoutHistoryTarget = null;

function isDirty() { return _dirty; }

function markDirty() {
  _dirty = true;
  const btn = document.getElementById("btn-save");
  if (btn) btn.classList.add("toolbar-btn-dirty");
}

function clearDirty() {
  _dirty = false;
  const btn = document.getElementById("btn-save");
  if (btn) btn.classList.remove("toolbar-btn-dirty");
}

function getSectionEntries(section) {
  return [
    ...(section.entries || []),
    ...(section.blocks || []).filter((block) => block.type === "entry"),
  ];
}

function getSectionBulletContainers(section) {
  return [
    ...getSectionEntries(section),
    ...(section.blocks || []).filter((block) => block.type === "list"),
  ];
}

/**
 * Initialize editor: event delegation on #resume-content.
 */
function initEditor() {
  const content = document.getElementById("resume-content");
  if (!content) return;

  const undoButton = document.getElementById("btn-undo");
  if (undoButton) undoButton.addEventListener("click", undoEditorChange);

  // Keep one pre-edit snapshot even on browsers that do not emit beforeinput
  // consistently for contenteditable fields.
  content.addEventListener("focusin", (e) => {
    const editable = e.target.closest("[contenteditable]");
    if (!editable || _focusedHistoryTarget === editable) return;
    if (editable === _focusWithoutHistoryTarget) {
      _focusWithoutHistoryTarget = null;
      return;
    }
    pushUndoState();
    _focusedHistoryTarget = editable;
  });

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "z" && !e.shiftKey) {
      if (e.target.matches("input, textarea, select") && !e.target.closest("#resume-content")) return;
      e.preventDefault();
      undoEditorChange();
    }
  }, true);

  content.addEventListener("beforeinput", (e) => {
    if (!e.target.closest("[contenteditable]") || e.inputType === "historyUndo") return;
    if (e.target === _focusedHistoryTarget) {
      _focusedHistoryTarget = null;
      _lastInputHistory = {
        key: e.target.dataset.bulletId || e.target.dataset.textBlockId || e.target.dataset.profileField || e.target.dataset.entryField || e.target.dataset.sectionId || "editor",
        type: e.inputType,
        time: Date.now(),
      };
      return;
    }
    const now = Date.now();
    const key = e.target.dataset.bulletId || e.target.dataset.textBlockId || e.target.dataset.profileField || e.target.dataset.entryField || e.target.dataset.sectionId || "editor";
    const canMerge = _lastInputHistory && _lastInputHistory.key === key
      && _lastInputHistory.type === e.inputType && now - _lastInputHistory.time < 800;
    if (!canMerge) pushUndoState();
    _lastInputHistory = { key, type: e.inputType, time: now };
  });

  // Enter in contact information creates a user-controlled line break.
  // Other single-line fields blur; bullet Enter creates a new bullet below.
  content.addEventListener("keydown", (e) => {
    const el = e.target;
    if (e.key === "Backspace" && el.classList.contains("contact-value")) {
      const selection = window.getSelection();
      const range = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
      const offsets = range ? getSelectionOffsets(el, range) : null;
      if (offsets && offsets.start === 0 && offsets.end === 0
        && removeContactLineBreakBefore(el.dataset.profileField)) {
        e.preventDefault();
      }
      return;
    }
    if (e.key !== "Enter") return;
    if (el.classList.contains("contact-value")) {
      e.preventDefault();
      addContactLineBreakAfter(el.dataset.profileField);
      return;
    }
    if (el.classList.contains("bullet-item")) {
      e.preventDefault();
      addBulletAfter(el);
      return;
    }
    if (el.classList.contains("custom-text")) return;
    e.preventDefault();
    el.blur();
  });

  // Paste: plain text only
  content.addEventListener("paste", (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData("text/plain");
    document.execCommand("insertText", false, text);
  });

  // Sync on blur
  content.addEventListener("blur", (e) => {
    if (!e.target.matches("[contenteditable]")) return;
    syncElementToState(e.target);
    if (e.target === _focusedHistoryTarget) _focusedHistoryTarget = null;
  }, true);

  // Keep state current while typing so selection formatting never uses stale text.
  content.addEventListener("input", (e) => {
    syncElementToState(e.target);
    markDirty();
  });

  content.addEventListener("click", (e) => {
    const link = e.target.closest("a.inline-link, a.contact-link");
    if (link && !e.metaKey && !e.ctrlKey) e.preventDefault();
    const btn = e.target.closest("button");
    if (!btn) return;
    if (btn.classList.contains("btn-del-bullet"))  { e.stopPropagation(); deleteBullet(btn.dataset.bulletId); }
    else if (btn.classList.contains("btn-add-bullet"))  { e.stopPropagation(); addBullet(btn.dataset.entryId); }
    else if (btn.classList.contains("btn-del-entry"))   { e.stopPropagation(); deleteEntry(btn.dataset.entryId); }
    else if (btn.classList.contains("btn-add-entry"))   { e.stopPropagation(); addEntry(btn.dataset.sectionId); }
    else if (btn.classList.contains("btn-add-block"))   { e.stopPropagation(); addCustomBlock(btn.dataset.sectionId, btn.dataset.blockType); }
    else if (btn.classList.contains("btn-del-block"))   { e.stopPropagation(); deleteCustomBlock(btn.dataset.blockId); }
    else if (btn.classList.contains("btn-del-section")) { e.stopPropagation(); deleteSection(btn.dataset.sectionId); }
    else if (btn.classList.contains("contact-add-preference")) { e.stopPropagation(); addPreferenceFields(); }
    else if (btn.classList.contains("contact-remove-preference")) { e.stopPropagation(); removePreferenceFields(); }
  });

  initSectionReordering();
  initEntryReordering();
  initHeaderPositionDrag();
  initSelectionFormatting();
}

function initSelectionFormatting() {
  const buttons = {
    bold: document.getElementById("btn-selection-bold"),
    italic: document.getElementById("btn-selection-italic"),
    link: document.getElementById("btn-selection-link"),
    smaller: document.getElementById("btn-selection-smaller"),
    larger: document.getElementById("btn-selection-larger"),
    reset: document.getElementById("btn-selection-reset"),
  };
  const bulletStyle = document.getElementById("selection-bullet-style");

  document.addEventListener("selectionchange", () => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    const node = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
    const target = node && node.closest && node.closest("#resume-content [contenteditable]");
    const resume = document.getElementById("resume-content");
    if (!resume || !resume.contains(range.commonAncestorContainer)) return;
    const selectedBullets = Array.from(resume.querySelectorAll(".bullet-item[data-bullet-id]"))
      .filter((item) => range.intersectsNode(item));
    _formatBulletIds = selectedBullets.map((item) => item.dataset.bulletId);
    if (bulletStyle) {
      bulletStyle.disabled = _formatBulletIds.length === 0;
      updateBulletStyleControl(bulletStyle);
    }
    if (!target || !target.contains(range.startContainer) || !target.contains(range.endContainer)) return;
    _formatTarget = target;
    _formatRange = range.cloneRange();
    _formatOffsets = getSelectionOffsets(target, range);
    Object.values(buttons).forEach((button) => { if (button) button.disabled = false; });
    if (buttons.link) {
      buttons.link.disabled = !canEditSelectionLink(target, _formatOffsets);
    }
    updateBoldButtonState(buttons.bold);
    updateItalicButtonState(buttons.italic);
    updateLinkButtonState(buttons.link);
  });

  Object.values(buttons).forEach((button) => {
    if (button) button.addEventListener("mousedown", (event) => event.preventDefault());
  });
  if (buttons.bold) buttons.bold.addEventListener("click", () => applySelectionFormat("bold"));
  if (buttons.italic) buttons.italic.addEventListener("click", () => applySelectionFormat("italic"));
  if (buttons.link) buttons.link.addEventListener("click", openSelectionLinkDialog);
  if (buttons.smaller) buttons.smaller.addEventListener("click", () => applySelectionFormat("size", -0.5));
  if (buttons.larger) buttons.larger.addEventListener("click", () => applySelectionFormat("size", 0.5));
  if (buttons.reset) buttons.reset.addEventListener("click", () => applySelectionFormat("reset"));
  if (bulletStyle) bulletStyle.addEventListener("change", () => applyBulletStyle(bulletStyle.value));
}

function applyBulletStyle(markerStyle) {
  if (_formatBulletIds.length === 0) return;
  pushUndoState();
  _formatBulletIds.forEach((id) => {
    const bullet = findBulletById(id);
    const element = document.querySelector(`.bullet-item[data-bullet-id="${CSS.escape(id)}"]`);
    if (!bullet || !element) return;
    if (markerStyle === "default") delete bullet.markerStyle;
    else bullet.markerStyle = markerStyle;
    if (markerStyle === "default") delete element.dataset.bulletMarker;
    else element.dataset.bulletMarker = markerStyle;
  });
  markDirty();
  requestAnimationFrame(() => updateA4Status());
}

function updateBulletStyleControl(control) {
  const styles = _formatBulletIds.map((id) => findBulletById(id)?.markerStyle || "default");
  control.value = styles.length > 0 && styles.every((style) => style === styles[0]) ? styles[0] : "default";
}

function pushUndoState() {
  _undoStack.push(deepClone(getState()));
  if (_undoStack.length > UNDO_LIMIT) _undoStack.shift();
  updateUndoButton();
}

function undoEditorChange() {
  const previous = _undoStack.pop();
  updateUndoButton();
  if (!previous) {
    showToast("没有可撤回的操作。", "info");
    return;
  }
  window.__resumeState = previous;
  renderResume(previous);
  markDirty();
  _formatTarget = null;
  _formatRange = null;
  _formatOffsets = null;
  _formatBulletIds = [];
  _lastInputHistory = null;
  _focusedHistoryTarget = null;
  _focusWithoutHistoryTarget = null;
  requestAnimationFrame(() => updateA4Status());
}

function updateUndoButton() {
  const button = document.getElementById("btn-undo");
  if (button) button.disabled = _undoStack.length === 0;
}

function resetUndoHistory() {
  _undoStack.length = 0;
  _lastInputHistory = null;
  _focusedHistoryTarget = null;
  _focusWithoutHistoryTarget = null;
  updateUndoButton();
}

function focusWithoutUndoSnapshot(element) {
  if (!element) return;
  _focusWithoutHistoryTarget = element;
  element.focus();
}

function applySelectionFormat(action, amount = 0) {
  const target = _formatTarget;
  if (!target || !document.contains(target)) return;
  syncElementToState(target);
  pushUndoState();

  if (target.dataset.bulletId) {
    const bullet = findBulletById(target.dataset.bulletId);
    if (!bullet) return;
    const offsets = _formatOffsets || getSelectionOffsets(target, _formatRange);
    const start = offsets && offsets.start !== offsets.end ? offsets.start : 0;
    const end = offsets && offsets.start !== offsets.end ? offsets.end : target.textContent.length;
    const selected = splitTokensForRange(bullet.content, start, end);

    if (action === "bold") {
      const shouldUnbold = selected.some((part) => part.selected)
        && selected.filter((part) => part.selected).every((part) => part.token.type === "strong");
      selected.forEach((part) => {
        if (part.selected) part.token.type = shouldUnbold ? "text" : "strong";
      });
    } else if (action === "italic") {
      const shouldUnitalic = selected.some((part) => part.selected)
        && selected.filter((part) => part.selected).every((part) => part.token.italic);
      selected.forEach((part) => {
        if (part.selected) part.token.italic = !shouldUnitalic;
      });
    } else if (action === "size") {
      selected.forEach((part) => {
        if (part.selected) part.token.fontSizeDelta = clampFontDelta((part.token.fontSizeDelta || 0) + amount);
      });
    } else if (action === "reset") {
      selected.forEach((part) => {
        if (part.selected) delete part.token.fontSizeDelta;
      });
    }

    bullet.content = mergeInlineTokens(selected.map((part) => part.token));
    target.replaceChildren(renderInlineContent(bullet.content));
  } else {
    const key = getBlockFormatKey(target);
    if (!key) return;
    const state = getState();
    if (!state.layout) state.layout = {};
    if (action === "bold" || action === "italic") {
      if (!state.layout.blockTextStyle) state.layout.blockTextStyle = {};
      const style = state.layout.blockTextStyle[key] || {};
      style[action] = action === "bold" ? !isElementBold(target) : !isElementItalic(target);
      state.layout.blockTextStyle[key] = style;
    } else {
      if (!state.layout.blockFontSizeDelta) state.layout.blockFontSizeDelta = {};
      if (action === "reset") {
        delete state.layout.blockFontSizeDelta[key];
      } else {
        state.layout.blockFontSizeDelta[key] = clampFontDelta((state.layout.blockFontSizeDelta[key] || 0) + amount);
      }
    }
    applyLocalFormatting(state);
  }

  markDirty();
  updateBoldButtonState(document.getElementById("btn-selection-bold"));
  updateItalicButtonState(document.getElementById("btn-selection-italic"));
  requestAnimationFrame(() => updateA4Status());
}

function getSelectionOffsets(target, range) {
  if (!range || !target.contains(range.startContainer) || !target.contains(range.endContainer)) return null;
  const beforeStart = document.createRange();
  beforeStart.selectNodeContents(target);
  beforeStart.setEnd(range.startContainer, range.startOffset);
  const beforeEnd = document.createRange();
  beforeEnd.selectNodeContents(target);
  beforeEnd.setEnd(range.endContainer, range.endOffset);
  return { start: beforeStart.toString().length, end: beforeEnd.toString().length };
}

function splitTokensForRange(tokens, start, end) {
  const result = [];
  let offset = 0;
  (tokens || []).forEach((token) => {
    const value = token.value || "";
    const tokenStart = offset;
    const tokenEnd = offset + value.length;
    const cuts = [0, Math.max(0, start - tokenStart), Math.min(value.length, end - tokenStart), value.length]
      .filter((cut, index, values) => cut >= 0 && cut <= value.length && values.indexOf(cut) === index)
      .sort((a, b) => a - b);
    for (let i = 0; i < cuts.length - 1; i++) {
      const from = cuts[i];
      const to = cuts[i + 1];
      if (from === to) continue;
      result.push({
        token: { ...token, value: value.slice(from, to) },
        selected: tokenStart + from < end && tokenStart + to > start,
      });
    }
    offset = tokenEnd;
  });
  return result;
}

function mergeInlineTokens(tokens) {
  return tokens.reduce((merged, token) => {
    if (!token.value) return merged;
    const previous = merged[merged.length - 1];
    if (previous && previous.type === token.type && !!previous.italic === !!token.italic
      && (previous.href || "") === (token.href || "")
      && (previous.fontSizeDelta || 0) === (token.fontSizeDelta || 0)) {
      previous.value += token.value;
    } else {
      merged.push({ ...token });
    }
    return merged;
  }, []);
}

function findLinkTokenRange(tokens, offset) {
  let cursor = 0;
  for (const token of (tokens || [])) {
    const end = cursor + (token.value || "").length;
    if (token.href && offset >= cursor && offset <= end) {
      return { start: cursor, end, token };
    }
    cursor = end;
  }
  return null;
}

function replaceInlineRange(tokens, start, end, replacement) {
  if (start === end) {
    const result = [];
    let cursor = 0;
    let inserted = false;
    for (const token of (tokens || [])) {
      const value = token.value || "";
      const tokenEnd = cursor + value.length;
      if (!inserted && start >= cursor && start <= tokenEnd) {
        const localOffset = start - cursor;
        if (localOffset > 0) result.push({ ...token, value: value.slice(0, localOffset) });
        result.push(replacement);
        if (localOffset < value.length) result.push({ ...token, value: value.slice(localOffset) });
        inserted = true;
      } else {
        result.push({ ...token });
      }
      cursor = tokenEnd;
    }
    if (!inserted) result.push(replacement);
    return mergeInlineTokens(result);
  }

  const parts = splitTokensForRange(tokens, start, end);
  const result = [];
  let inserted = false;
  for (const part of parts) {
    if (part.selected) {
      if (!inserted) {
        result.push(replacement);
        inserted = true;
      }
    } else {
      result.push(part.token);
    }
  }
  return mergeInlineTokens(result);
}

function normalizeLinkTarget(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const candidate = /^(?:https?:\/\/|mailto:)/i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? candidate : "";
  } catch {
    return "";
  }
}

function openSelectionLinkDialog() {
  const target = _formatTarget;
  if (!target) return;

  if (target.dataset.profileField === "portfolio") {
    openPortfolioLinkDialog(target);
    return;
  }

  const inlineTarget = findInlineContentTarget(target);
  if (!inlineTarget) {
    openBlockLinkDialog(target);
    return;
  }
  syncElementToState(target);
  const offsets = _formatOffsets || getSelectionOffsets(target, _formatRange);
  if (!offsets) return;

  const existing = findLinkTokenRange(inlineTarget.content, offsets.start);
  const isEditingExisting = Boolean(existing && offsets.end <= existing.end);
  if (!isEditingExisting && offsets.start === offsets.end) return;
  const start = isEditingExisting ? existing.start : offsets.start;
  const end = isEditingExisting ? existing.end : offsets.end;
  const existingStyle = isEditingExisting
    ? Object.fromEntries(Object.entries(existing.token).filter(([key]) => !["value", "href"].includes(key)))
    : { type: "text" };
  const selectedName = isEditingExisting
    ? existing.token.value
    : splitTokensForRange(inlineTarget.content, offsets.start, offsets.end)
      .filter((part) => part.selected)
      .map((part) => part.token.value)
      .join("");

  showLinkDialog({
    name: selectedName,
    url: isEditingExisting ? existing.token.href : "",
    canRemove: isEditingExisting,
    onSubmit: (name, href) => {
      pushUndoState();
      inlineTarget.content = replaceInlineRange(inlineTarget.content, start, end, { ...existingStyle, value: name, href });
      target.replaceChildren(renderInlineContent(inlineTarget.content));
      markDirty();
      requestAnimationFrame(() => updateA4Status());
    },
    onRemove: isEditingExisting ? () => {
      pushUndoState();
      inlineTarget.content = replaceInlineRange(inlineTarget.content, start, end, { ...existingStyle, value: existing.token.value });
      target.replaceChildren(renderInlineContent(inlineTarget.content));
      markDirty();
      requestAnimationFrame(() => updateA4Status());
    } : null,
  });
}

function findInlineContentTarget(target) {
  if (target.dataset.bulletId) return findBulletById(target.dataset.bulletId);
  if (!target.dataset.textBlockId) return null;
  for (const section of getState().sections) {
    const block = (section.blocks || []).find((item) => item.id === target.dataset.textBlockId);
    if (block) return block;
  }
  return null;
}

function findBlockLinkRange(ranges, start, end) {
  return ranges.find((range) => start >= range.start
    && start <= range.end
    && end >= range.start
    && end <= range.end) || null;
}

function replaceBlockLinkRange(ranges, start, end, replacementLength, href = "") {
  const delta = replacementLength - (end - start);
  const next = [];
  ranges.forEach((range) => {
    if (range.end <= start) next.push({ ...range });
    else if (range.start >= end) next.push({ ...range, start: range.start + delta, end: range.end + delta });
  });
  if (href && replacementLength > 0) next.push({ start, end: start + replacementLength, href });
  return next;
}

function openBlockLinkDialog(target) {
  const key = getBlockFormatKey(target);
  const offsets = _formatOffsets || getSelectionOffsets(target, _formatRange);
  if (!key || !offsets) return;
  syncElementToState(target);
  const state = getState();
  const text = target.textContent || "";
  const ranges = getBlockLinkRanges(state, key, text.length);
  const existing = findBlockLinkRange(ranges, offsets.start, offsets.end);
  if (!existing && offsets.start === offsets.end) return;
  const start = existing ? existing.start : offsets.start;
  const end = existing ? existing.end : offsets.end;

  showLinkDialog({
    name: text.slice(start, end),
    url: existing ? existing.href : "",
    canRemove: Boolean(existing),
    onSubmit: (name, href) => {
      pushUndoState();
      const nextText = text.slice(0, start) + name + text.slice(end);
      target.textContent = nextText;
      syncElementToState(target);
      setBlockLinkRanges(state, key, replaceBlockLinkRange(ranges, start, end, name.length, href));
      renderResume(state);
      markDirty();
      requestAnimationFrame(() => updateA4Status());
    },
    onRemove: existing ? () => {
      pushUndoState();
      setBlockLinkRanges(state, key, ranges.filter((range) => range !== existing));
      renderResume(state);
      markDirty();
      requestAnimationFrame(() => updateA4Status());
    } : null,
  });
}

function openPortfolioLinkDialog(target) {
  const state = getState();
  const portfolio = getPortfolioContact(state.profile.portfolio) || {
    label: target.textContent.trim(),
    href: "",
  };

  showLinkDialog({
    name: portfolio.label || target.textContent.trim(),
    url: portfolio.href || "",
    canRemove: Boolean(portfolio.href),
    onSubmit: (name, href) => {
      pushUndoState();
      state.profile.portfolio = `${name} | ${href}`;
      renderHeader(state);
      applyLocalFormatting(state);
      markDirty();
      requestAnimationFrame(() => updateA4Status());
    },
    onRemove: portfolio.href ? () => {
      pushUndoState();
      state.profile.portfolio = portfolio.label;
      renderHeader(state);
      applyLocalFormatting(state);
      markDirty();
      requestAnimationFrame(() => updateA4Status());
    } : null,
  });
}

function showLinkDialog({ name, url, canRemove, onSubmit, onRemove }) {
  const root = document.getElementById("dialog-root");
  if (!root) return;
  root.innerHTML = "";
  root.classList.add("active");

  const backdrop = document.createElement("div");
  backdrop.className = "dialog-backdrop";
  backdrop.addEventListener("click", closeDialog);
  root.appendChild(backdrop);

  const box = document.createElement("div");
  box.className = "dialog-box";
  const title = document.createElement("h3");
  title.className = "dialog-title";
  title.textContent = canRemove ? "编辑链接" : "添加链接";
  box.appendChild(title);

  const createField = (labelText, value, placeholder) => {
    const label = document.createElement("label");
    label.className = "dialog-field";
    const caption = document.createElement("span");
    caption.className = "dialog-field-label";
    caption.textContent = labelText;
    const input = document.createElement("input");
    input.className = "dialog-input";
    input.type = "text";
    input.value = value || "";
    input.placeholder = placeholder;
    label.appendChild(caption);
    label.appendChild(input);
    box.appendChild(label);
    return input;
  };

  const nameInput = createField("链接名称", name, "例如：AI作品集");
  const urlInput = createField("目标网址", url, "https://example.com");
  const error = document.createElement("p");
  error.className = "dialog-field-error";
  error.hidden = true;
  box.appendChild(error);

  const submit = () => {
    const nextName = nameInput.value.trim();
    const href = normalizeLinkTarget(urlInput.value);
    if (!nextName) {
      error.textContent = "请输入链接名称。";
      error.hidden = false;
      nameInput.focus();
      return;
    }
    if (!href) {
      error.textContent = "请输入有效的 http、https 或 mailto 链接。";
      error.hidden = false;
      urlInput.focus();
      return;
    }
    closeDialog();
    onSubmit(nextName, href);
  };

  [nameInput, urlInput].forEach((input) => input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") submit();
  }));

  const actions = document.createElement("div");
  actions.className = "dialog-actions";
  if (canRemove && onRemove) {
    const removeButton = document.createElement("button");
    removeButton.className = "dialog-btn dialog-btn-danger dialog-btn-leading";
    removeButton.textContent = "移除链接";
    removeButton.addEventListener("click", () => {
      closeDialog();
      onRemove();
    });
    actions.appendChild(removeButton);
  }
  const cancelButton = document.createElement("button");
  cancelButton.className = "dialog-btn";
  cancelButton.textContent = "取消";
  cancelButton.addEventListener("click", closeDialog);
  actions.appendChild(cancelButton);
  const confirmButton = document.createElement("button");
  confirmButton.className = "dialog-btn dialog-btn-primary";
  confirmButton.textContent = canRemove ? "保存" : "添加";
  confirmButton.addEventListener("click", submit);
  actions.appendChild(confirmButton);
  box.appendChild(actions);
  root.appendChild(box);
  setTimeout(() => (nameInput.value ? urlInput : nameInput).focus(), 50);
}

function clampFontDelta(value) {
  return Math.max(-2, Math.min(3, Math.round(value * 2) / 2));
}

function findBulletById(bulletId) {
  for (const section of getState().sections) {
    for (const entry of getSectionBulletContainers(section)) {
      const bullet = entry.bullets.find((item) => item.id === bulletId);
      if (bullet) return bullet;
    }
  }
  return null;
}

function getBlockFormatKey(target) {
  if (target.dataset.profileField) return `profile:${target.dataset.profileField}`;
  if (target.classList.contains("section-title") && target.dataset.sectionId) {
    return `section:${target.dataset.sectionId}:title`;
  }
  if (target.dataset.entryField) {
    const entry = target.closest("[data-entry-id]");
    return entry ? `entry:${entry.dataset.entryId}:${target.dataset.entryField}` : null;
  }
  if (target.dataset.textBlockId) return `text:${target.dataset.textBlockId}:content`;
  return null;
}

function getBlockFormatSelector(key) {
  const [kind, id, field] = key.split(":");
  return kind === "profile"
    ? `[data-profile-field="${CSS.escape(id)}"]`
    : kind === "section"
      ? `.section-title[data-section-id="${CSS.escape(id)}"]`
    : kind === "text"
      ? `[data-text-block-id="${CSS.escape(id)}"]`
      : `[data-entry-id="${CSS.escape(id)}"] [data-entry-field="${CSS.escape(field)}"]`;
}

function isElementBold(element) {
  const weight = getComputedStyle(element).fontWeight;
  return weight === "bold" || Number.parseInt(weight, 10) >= 600;
}

function isElementItalic(element) {
  return ["italic", "oblique"].includes(getComputedStyle(element).fontStyle);
}

function applyLocalFormatting(state) {
  document.querySelectorAll("#resume-content [data-profile-field], #resume-content [data-entry-field], #resume-content .section-title").forEach((element) => {
    element.style.removeProperty("font-size");
    element.style.removeProperty("font-weight");
    element.style.removeProperty("font-style");
  });

  const fontSizeOverrides = state.layout && state.layout.blockFontSizeDelta;
  Object.entries(fontSizeOverrides || {}).forEach(([key, delta]) => {
    document.querySelectorAll(`#resume-content ${getBlockFormatSelector(key)}`).forEach((element) => {
      element.style.fontSize = `calc(1em + ${delta}pt)`;
    });
  });

  const textStyleOverrides = state.layout && state.layout.blockTextStyle;
  Object.entries(textStyleOverrides || {}).forEach(([key, style]) => {
    if (!style || typeof style !== "object") return;
    document.querySelectorAll(`#resume-content ${getBlockFormatSelector(key)}`).forEach((element) => {
      if (typeof style.bold === "boolean") element.style.fontWeight = style.bold ? "bold" : "normal";
      if (typeof style.italic === "boolean") element.style.fontStyle = style.italic ? "italic" : "normal";
    });
  });

  applyBlockLinks(state);
}

function normalizeBlockLinkRanges(rawRanges, textLength = Infinity) {
  const sorted = (Array.isArray(rawRanges) ? rawRanges : [])
    .map((range) => {
      if (!range || typeof range !== "object") return null;
      const start = Math.max(0, Math.min(textLength, Number(range.start)));
      const end = Math.max(start, Math.min(textLength, Number(range.end)));
      const href = normalizeLinkTarget(range.href);
      return Number.isFinite(start) && Number.isFinite(end) && end > start && href
        ? { start, end, href }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  return sorted.reduce((accepted, range) => {
    const previous = accepted[accepted.length - 1];
    if (!previous || range.start >= previous.end) accepted.push(range);
    return accepted;
  }, []);
}

function getBlockLinkRanges(state, key, textLength = Infinity) {
  const ranges = state.layout && state.layout.blockLinks && state.layout.blockLinks[key];
  return normalizeBlockLinkRanges(ranges, textLength);
}

function setBlockLinkRanges(state, key, ranges) {
  if (!state.layout) state.layout = {};
  if (!state.layout.blockLinks) state.layout.blockLinks = {};
  const normalized = normalizeBlockLinkRanges(ranges);
  if (normalized.length > 0) state.layout.blockLinks[key] = normalized;
  else delete state.layout.blockLinks[key];
}

function applyBlockLinks(state) {
  const blockLinks = state.layout && state.layout.blockLinks;
  Object.entries(blockLinks || {}).forEach(([key, rawRanges]) => {
    document.querySelectorAll(`#resume-content ${getBlockFormatSelector(key)}`).forEach((element) => {
      if (element.dataset.profileField === "portfolio") return;
      const text = element.textContent || "";
      const ranges = getBlockLinkRanges(state, key, text.length);
      if (ranges.length === 0) return;
      const fragment = document.createDocumentFragment();
      let offset = 0;
      ranges.forEach((range) => {
        if (range.start > offset) fragment.appendChild(document.createTextNode(text.slice(offset, range.start)));
        const link = document.createElement("a");
        link.className = "inline-link";
        link.href = range.href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = text.slice(range.start, range.end);
        fragment.appendChild(link);
        offset = range.end;
      });
      if (offset < text.length) fragment.appendChild(document.createTextNode(text.slice(offset)));
      element.replaceChildren(fragment);
    });
  });
}

function extractBlockLinkRanges(element, canonicalText) {
  const rawText = element.textContent || "";
  const leadingTrim = rawText.length - rawText.trimStart().length;
  const ranges = [];
  let offset = 0;
  const walk = (node, inheritedHref = "") => {
    if (node.nodeType === Node.TEXT_NODE) {
      const length = (node.nodeValue || "").length;
      if (length > 0 && inheritedHref) {
        const start = Math.max(0, offset - leadingTrim);
        const end = Math.min(canonicalText.length, offset + length - leadingTrim);
        if (end > start) ranges.push({ start, end, href: inheritedHref });
      }
      offset += length;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const href = node.tagName === "A" ? node.getAttribute("href") || inheritedHref : inheritedHref;
    node.childNodes.forEach((child) => walk(child, href));
  };
  element.childNodes.forEach((node) => walk(node));
  return normalizeBlockLinkRanges(ranges, canonicalText.length).reduce((merged, range) => {
    const previous = merged[merged.length - 1];
    if (previous && previous.end === range.start && previous.href === range.href) previous.end = range.end;
    else merged.push({ ...range });
    return merged;
  }, []);
}

function syncBlockLinksFromElement(state, element, canonicalText) {
  if (element.dataset.profileField === "portfolio"
    || element.dataset.bulletId
    || element.dataset.textBlockId) return;
  const key = getBlockFormatKey(element);
  if (!key) return;
  setBlockLinkRanges(state, key, extractBlockLinkRanges(element, canonicalText));
}

function addPreferenceFields() {
  const state = getState();
  pushUndoState();
  if (!state.layout) state.layout = {};
  state.layout.preferenceVisible = true;
  renderHeader(state);
  applyLocalFormatting(state);
  markDirty();
  requestAnimationFrame(() => {
    focusWithoutUndoSnapshot(document.querySelector('[data-profile-field="headline"]'));
    updateA4Status();
  });
}

function removePreferenceFields() {
  const state = getState();
  pushUndoState();
  state.profile.headline = "";
  state.profile.location = "";
  if (!state.layout) state.layout = {};
  state.layout.preferenceVisible = false;
  state.layout.contactBreakBefore = (state.layout.contactBreakBefore || [])
    .filter((field) => !["headline", "location"].includes(field));
  if (state.layout.blockLinks) {
    delete state.layout.blockLinks["profile:headline"];
    delete state.layout.blockLinks["profile:location"];
  }
  renderHeader(state);
  applyLocalFormatting(state);
  markDirty();
  requestAnimationFrame(() => updateA4Status());
}

function updateContactLineBreaks(nextBreaks, focusField) {
  const state = getState();
  if (!state.layout) state.layout = {};
  state.layout.contactBreakBefore = [...new Set(nextBreaks)];
  renderHeader(state);
  applyLocalFormatting(state);
  markDirty();
  requestAnimationFrame(() => {
    const target = document.querySelector(`[data-profile-field="${CSS.escape(focusField)}"]`);
    focusWithoutUndoSnapshot(target);
    updateA4Status();
  });
}

function addContactLineBreakAfter(field) {
  const fields = Array.from(document.querySelectorAll("#contact-info .contact-value"))
    .map((element) => element.dataset.profileField);
  const nextField = fields[fields.indexOf(field) + 1];
  if (!nextField) return false;
  const state = getState();
  const current = (state.layout && state.layout.contactBreakBefore) || [];
  if (current.includes(nextField)) return false;
  pushUndoState();
  updateContactLineBreaks([...current, nextField], nextField);
  return true;
}

function removeContactLineBreakBefore(field) {
  const state = getState();
  const current = (state.layout && state.layout.contactBreakBefore) || [];
  if (!current.includes(field)) return false;
  pushUndoState();
  updateContactLineBreaks(current.filter((item) => item !== field), field);
  return true;
}

/** ========================
 *  Header position handle
 *  ======================== */

const HEADER_OFFSET_MIN_MM = -8;
const HEADER_OFFSET_MAX_MM = 8;
const HEADER_OFFSET_STEP_MM = 0.5;

function normalizeHeaderOffset(value) {
  const numeric = Number(value) || 0;
  const snapped = Math.round(numeric / HEADER_OFFSET_STEP_MM) * HEADER_OFFSET_STEP_MM;
  return Math.max(HEADER_OFFSET_MIN_MM, Math.min(HEADER_OFFSET_MAX_MM, snapped));
}

function setHeaderOffsetPreview(offsetMm) {
  const header = document.getElementById("header-info");
  const handle = document.getElementById("header-position-handle");
  const value = handle && handle.querySelector(".header-position-value");
  if (header) header.style.setProperty("--header-offset-y", `${offsetMm}mm`);
  if (value) value.textContent = `${offsetMm.toFixed(1)} mm`;
  if (handle) {
    handle.setAttribute("aria-valuenow", String(offsetMm));
    handle.setAttribute("aria-valuetext", offsetMm === 0 ? "居中" : `${Math.abs(offsetMm).toFixed(1)} 毫米${offsetMm < 0 ? "向上" : "向下"}`);
  }
}

function applyHeaderPosition(state) {
  const offset = normalizeHeaderOffset(state.layout && state.layout.headerOffsetY);
  setHeaderOffsetPreview(offset);
}

function commitHeaderOffset(offsetMm) {
  const state = getState();
  if (!state.layout) state.layout = {};
  state.layout.headerOffsetY = normalizeHeaderOffset(offsetMm);
  setHeaderOffsetPreview(state.layout.headerOffsetY);
  markDirty();
}

function initHeaderPositionDrag() {
  const handle = document.getElementById("header-position-handle");
  if (!handle) return;

  handle.setAttribute("role", "slider");
  handle.setAttribute("aria-valuemin", String(HEADER_OFFSET_MIN_MM));
  handle.setAttribute("aria-valuemax", String(HEADER_OFFSET_MAX_MM));
  handle.setAttribute("aria-orientation", "vertical");
  applyHeaderPosition(getState());

  let dragging = false;
  let changed = false;
  let startY = 0;
  let startOffset = 0;
  let pxPerMm = getPxPerMm();

  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    dragging = true;
    changed = false;
    startY = event.clientY;
    startOffset = normalizeHeaderOffset(getState().layout && getState().layout.headerOffsetY);
    pxPerMm = getPxPerMm();
    handle.classList.add("dragging");
    const header = document.getElementById("header-info");
    if (header) header.classList.add("header-dragging");
    handle.setPointerCapture(event.pointerId);
  });

  handle.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const nextOffset = normalizeHeaderOffset(startOffset + (event.clientY - startY) / pxPerMm);
    if (!changed && nextOffset !== startOffset) {
      pushUndoState();
      changed = true;
    }
    setHeaderOffsetPreview(nextOffset);
  });

  handle.addEventListener("pointerup", (event) => {
    if (!dragging) return;
    const nextOffset = normalizeHeaderOffset(startOffset + (event.clientY - startY) / pxPerMm);
    if (changed) commitHeaderOffset(nextOffset);
    else setHeaderOffsetPreview(startOffset);
    dragging = false;
    handle.classList.remove("dragging");
    const header = document.getElementById("header-info");
    if (header) header.classList.remove("header-dragging");
  });

  handle.addEventListener("pointercancel", () => {
    if (!dragging) return;
    setHeaderOffsetPreview(startOffset);
    dragging = false;
    handle.classList.remove("dragging");
    const header = document.getElementById("header-info");
    if (header) header.classList.remove("header-dragging");
  });

  handle.addEventListener("dblclick", (event) => {
    event.preventDefault();
    const current = normalizeHeaderOffset(getState().layout && getState().layout.headerOffsetY);
    if (current === 0) return;
    pushUndoState();
    commitHeaderOffset(0);
  });

  handle.addEventListener("keydown", (event) => {
    if (!["ArrowUp", "ArrowDown", "Home"].includes(event.key)) return;
    event.preventDefault();
    const current = normalizeHeaderOffset(getState().layout && getState().layout.headerOffsetY);
    const amount = event.shiftKey ? 1 : HEADER_OFFSET_STEP_MM;
    const next = event.key === "Home" ? 0 : current + (event.key === "ArrowUp" ? -amount : amount);
    if (normalizeHeaderOffset(next) === current) return;
    pushUndoState();
    commitHeaderOffset(next);
  });
}

function updateBoldButtonState(button) {
  if (!button || !_formatTarget) {
    if (button) button.classList.remove("toolbar-btn-active");
    return;
  }
  if (!_formatTarget.dataset.bulletId) {
    button.classList.toggle("toolbar-btn-active", isElementBold(_formatTarget));
    return;
  }
  const bullet = findBulletById(_formatTarget.dataset.bulletId);
  const offsets = _formatOffsets || getSelectionOffsets(_formatTarget, _formatRange);
  if (!bullet || !offsets || offsets.start === offsets.end) {
    button.classList.remove("toolbar-btn-active");
    return;
  }
  const parts = splitTokensForRange(bullet.content, offsets.start, offsets.end).filter((part) => part.selected);
  button.classList.toggle("toolbar-btn-active", parts.length > 0 && parts.every((part) => part.token.type === "strong"));
}

function updateItalicButtonState(button) {
  if (!button || !_formatTarget) {
    if (button) button.classList.remove("toolbar-btn-active");
    return;
  }
  if (!_formatTarget.dataset.bulletId) {
    button.classList.toggle("toolbar-btn-active", isElementItalic(_formatTarget));
    return;
  }
  const bullet = findBulletById(_formatTarget.dataset.bulletId);
  const offsets = _formatOffsets || getSelectionOffsets(_formatTarget, _formatRange);
  if (!bullet || !offsets || offsets.start === offsets.end) {
    button.classList.remove("toolbar-btn-active");
    return;
  }
  const parts = splitTokensForRange(bullet.content, offsets.start, offsets.end).filter((part) => part.selected);
  button.classList.toggle("toolbar-btn-active", parts.length > 0 && parts.every((part) => part.token.italic));
}

function updateLinkButtonState(button) {
  if (!button || !_formatTarget) {
    if (button) button.classList.remove("toolbar-btn-active");
    return;
  }
  if (_formatTarget.dataset.profileField === "portfolio") {
    const portfolio = getPortfolioContact(getState().profile.portfolio);
    button.classList.toggle("toolbar-btn-active", Boolean(portfolio && portfolio.href));
    return;
  }
  const offsets = _formatOffsets || getSelectionOffsets(_formatTarget, _formatRange);
  const inlineTarget = findInlineContentTarget(_formatTarget);
  if (inlineTarget && offsets) {
    const existing = findLinkTokenRange(inlineTarget.content, offsets.start);
    button.classList.toggle("toolbar-btn-active", Boolean(existing && offsets.end <= existing.end));
    return;
  }
  const key = getBlockFormatKey(_formatTarget);
  const ranges = key && offsets ? getBlockLinkRanges(getState(), key, _formatTarget.textContent.length) : [];
  button.classList.toggle("toolbar-btn-active", Boolean(offsets && findBlockLinkRange(ranges, offsets.start, offsets.end)));
}

function canEditSelectionLink(target, offsets) {
  if (!target || !offsets) return false;
  if (target.dataset.profileField === "portfolio") return true;
  const inlineTarget = findInlineContentTarget(target);
  if (inlineTarget) {
    const existing = findLinkTokenRange(inlineTarget.content, offsets.start);
    return offsets.start !== offsets.end || Boolean(existing && offsets.end <= existing.end);
  }
  const key = getBlockFormatKey(target);
  if (!key) return false;
  const ranges = getBlockLinkRanges(getState(), key, target.textContent.length);
  return offsets.start !== offsets.end || Boolean(findBlockLinkRange(ranges, offsets.start, offsets.end));
}

/** ========================
 *  Bullet operations
 *  ======================== */

/**
 * Add a new empty bullet after the currently focused bullet-item span.
 * @param {HTMLElement} bulletSpan
 */
function addBulletAfter(bulletSpan) {
  const bulletId = bulletSpan.dataset.bulletId;
  const state = getState();

  for (const section of state.sections) {
    for (const entry of getSectionBulletContainers(section)) {
      const idx = entry.bullets.findIndex(b => b.id === bulletId);
      if (idx === -1) continue;

      const newBullet = { id: generateId(), content: [{ type: "text", value: "" }] };
      pushUndoState();
      entry.bullets.splice(idx + 1, 0, newBullet);

      // Re-render the bullets list
      const listEl = document.querySelector(
        `[data-entry-id="${entry.id}"].entry-bullets, [data-entry-id="${entry.id}"].skills-list`
      );
      if (listEl) {
        listEl.innerHTML = "";
        for (const b of entry.bullets) listEl.appendChild(renderBulletRow(b));
        // Focus new bullet
        const newSpan = listEl.querySelector(`[data-bullet-id="${newBullet.id}"]`);
        focusWithoutUndoSnapshot(newSpan);
      }

      markDirty();
      requestAnimationFrame(() => updateAddGutter(state));
      return;
    }
  }
}

/**
 * Add a new empty bullet at the end of an entry.
 * @param {string} entryId
 */
function addBullet(entryId) {
  const state = getState();
  for (const section of state.sections) {
    for (const entry of getSectionBulletContainers(section)) {
      if (entry.id !== entryId) continue;

      const newBullet = { id: generateId(), content: [{ type: "text", value: "" }] };
      pushUndoState();
      entry.bullets.push(newBullet);

      const listEl = document.querySelector(
        `ul[data-entry-id="${entryId}"]`
      );
      if (listEl) {
        // Insert before the add-row
        const addRow = listEl.querySelector(".bullet-add-row");
        const newLi = renderBulletRow(newBullet);
        listEl.insertBefore(newLi, addRow);
        const newSpan = newLi.querySelector(`[data-bullet-id="${newBullet.id}"]`);
        focusWithoutUndoSnapshot(newSpan);
      }

      markDirty();
      requestAnimationFrame(() => updateAddGutter(state));
      return;
    }
  }
}

/**
 * Delete a bullet by ID.
 * @param {string} bulletId
 */
function deleteBullet(bulletId) {
  const state = getState();
  for (const section of state.sections) {
    for (const entry of getSectionBulletContainers(section)) {
      const idx = entry.bullets.findIndex(b => b.id === bulletId);
      if (idx === -1) continue;
      pushUndoState();
      entry.bullets.splice(idx, 1);
      const li = document.querySelector(`li[data-bullet-id="${bulletId}"]`);
      if (li) li.remove();
      markDirty();
      requestAnimationFrame(() => updateAddGutter(state));
      return;
    }
  }
}

/** ========================
 *  Entry operations
 *  ======================== */

function addSection(title) {
  const state = getState();
  const section = {
    id: generateId(),
    type: "custom",
    title: title || "未命名板块",
    entries: [],
    blocks: [],
  };
  pushUndoState();
  state.schemaVersion = 2;
  state.sections.push(section);
  addCustomBlock(section.id, "text", false);
  renderResume(state);
  markDirty();
  requestAnimationFrame(() => {
    document.querySelector(`[data-section-id="${CSS.escape(section.id)}"]`)?.scrollIntoView({ block: "center" });
    focusWithoutUndoSnapshot(document.querySelector(`[data-section-id="${CSS.escape(section.id)}"] .custom-text`));
    updateA4Status();
  });
}

function addCustomBlock(sectionId, blockType, recordHistory = true) {
  const state = getState();
  const section = state.sections.find((item) => item.id === sectionId && item.type === "custom");
  if (!section) return;
  if (recordHistory) pushUndoState();
  if (!Array.isArray(section.blocks)) section.blocks = [];

  let block;
  if (blockType === "list") {
    block = {
      id: generateId(),
      type: "list",
      bullets: [{ id: generateId(), content: [{ type: "text", value: "" }] }],
    };
  } else if (blockType === "entry") {
    block = {
      id: generateId(),
      type: "entry",
      name: "",
      role: "",
      date: "",
      location: "",
      bullets: [{ id: generateId(), content: [{ type: "text", value: "" }] }],
    };
  } else {
    block = { id: generateId(), type: "text", content: [{ type: "text", value: "" }] };
  }
  section.blocks.push(block);
  renderResume(state);
  markDirty();
  requestAnimationFrame(() => {
    const wrapper = document.querySelector(`[data-block-id="${CSS.escape(block.id)}"]`);
    const target = wrapper?.querySelector("[contenteditable]");
    focusWithoutUndoSnapshot(target);
    updateA4Status();
  });
}

function deleteCustomBlock(blockId) {
  const state = getState();
  for (const section of state.sections) {
    const index = (section.blocks || []).findIndex((block) => block.id === blockId);
    if (index === -1) continue;
    pushUndoState();
    section.blocks.splice(index, 1);
    renderResume(state);
    markDirty();
    requestAnimationFrame(() => updateA4Status());
    return;
  }
}

function deleteSection(sectionId) {
  const state = getState();
  const index = state.sections.findIndex((section) => section.id === sectionId);
  if (index === -1) return;
  const title = state.sections[index].title || "该板块";
  showDialog({
    title: "删除板块",
    message: `确定要删除“${title}”及其中的所有内容吗？`,
    buttons: [
      { text: "取消" },
      {
        text: "删除",
        danger: true,
        action: () => {
          pushUndoState();
          state.sections.splice(index, 1);
          renderResume(state);
          markDirty();
          requestAnimationFrame(() => updateA4Status());
        },
      },
    ],
  });
}

/**
 * Add a new empty entry to a section.
 * @param {string} sectionId
 */
function addEntry(sectionId) {
  const state = getState();
  const section = state.sections.find(s => s.id === sectionId);
  if (!section) return;
  pushUndoState();

  const newEntry = {
    id: generateId(),
    name: "",
    role: "",
    date: "",
    location: "",
    bullets: [{ id: generateId(), content: [{ type: "text", value: "" }] }],
  };
  section.entries.push(newEntry);

  const sectionEl = document.querySelector(`section[data-section-id="${sectionId}"]`);
  if (sectionEl) {
    const addRow = sectionEl.querySelector(".entry-add-row");
    sectionEl.insertBefore(renderEntry(newEntry, section.type === "experience" ? section.id : ""), addRow);
    // Focus name field
    const nameSpan = sectionEl.querySelector(`[data-entry-id="${newEntry.id}"] .entry-name`);
    focusWithoutUndoSnapshot(nameSpan);
  }

  markDirty();
  requestAnimationFrame(() => updateAddGutter(state));
}

/**
 * Delete an entry by ID (with confirmation).
 * @param {string} entryId
 */
function deleteEntry(entryId) {
  const state = getState();
  for (const section of state.sections) {
    const collection = (section.entries || []).some((entry) => entry.id === entryId)
      ? section.entries
      : section.blocks || [];
    const idx = collection.findIndex(e => e.id === entryId && (!e.type || e.type === "entry"));
    if (idx === -1) continue;
    const entryName = collection[idx].name || "该条目";

    showDialog({
      title: "删除条目",
      message: `确定要删除"${entryName}"吗？`,
      buttons: [
        { text: "取消" },
        {
          text: "删除",
          primary: false,
          action: () => {
            pushUndoState();
            collection.splice(idx, 1);
            const el = document.querySelector(`[data-entry-id="${entryId}"].resume-entry`);
            if (el) (el.closest(".custom-block") || el).remove();
            markDirty();
            requestAnimationFrame(() => updateAddGutter(state));
          },
        },
      ],
    });
    return;
  }
}

function reorderEntry(sectionId, entryId, direction) {
  const state = getState();
  const section = state.sections.find((item) => item.id === sectionId && item.type === "experience");
  if (!section) return false;
  const index = section.entries.findIndex((entry) => entry.id === entryId);
  const nextIndex = Math.max(0, Math.min(section.entries.length - 1, index + direction));
  if (index < 0 || nextIndex === index) return false;
  pushUndoState();
  const [entry] = section.entries.splice(index, 1);
  section.entries.splice(nextIndex, 0, entry);
  renderResume(state);
  markDirty();
  requestAnimationFrame(() => {
    document.querySelector(`.entry-reorder-handle[data-entry-id="${CSS.escape(entryId)}"]`)?.focus();
    updateA4Status();
  });
  return true;
}

function initEntryReordering() {
  const container = document.getElementById("resume-sections");
  if (!container) return;

  let activeHandle = null;
  let activeEntry = null;
  let activeSection = null;
  let startOrder = [];

  const resetDrag = () => {
    activeHandle?.classList.remove("dragging");
    activeEntry?.classList.remove("entry-reordering");
    activeSection?.classList.remove("entry-reorder-active");
    activeHandle = null;
    activeEntry = null;
    activeSection = null;
    startOrder = [];
  };

  container.addEventListener("pointerdown", (event) => {
    const handle = event.target.closest(".entry-reorder-handle");
    if (!handle || event.button !== 0) return;
    const entry = handle.closest(".resume-entry");
    const section = handle.closest('.resume-section[data-section-type="experience"]');
    if (!entry || !section) return;
    event.preventDefault();
    event.stopPropagation();
    activeHandle = handle;
    activeEntry = entry;
    activeSection = section;
    startOrder = Array.from(section.querySelectorAll(":scope > .resume-entry"), (item) => item.dataset.entryId);
    handle.classList.add("dragging");
    entry.classList.add("entry-reordering");
    section.classList.add("entry-reorder-active");
  });

  window.addEventListener("pointermove", (event) => {
    if (!activeEntry || !activeSection) return;
    event.preventDefault();
    const siblings = Array.from(activeSection.querySelectorAll(":scope > .resume-entry"))
      .filter((item) => item !== activeEntry);
    const before = siblings.find((item) => {
      const rect = item.getBoundingClientRect();
      return event.clientY < rect.top + rect.height / 2;
    });
    if (before) activeSection.insertBefore(activeEntry, before);
    else activeSection.appendChild(activeEntry);
  });

  window.addEventListener("pointerup", () => {
    if (!activeEntry || !activeSection) return;
    const finalOrder = Array.from(activeSection.querySelectorAll(":scope > .resume-entry"), (item) => item.dataset.entryId);
    const changed = finalOrder.some((id, index) => id !== startOrder[index]);
    if (changed) {
      const state = getState();
      const sectionId = activeSection.dataset.sectionId;
      const section = state.sections.find((item) => item.id === sectionId && item.type === "experience");
      if (section) {
        pushUndoState();
        if (applyEntryOrder(section, finalOrder)) markDirty();
      }
    }
    resetDrag();
    requestAnimationFrame(() => {
      updateAddGutter(getState());
      updateA4Status();
    });
  });

  window.addEventListener("pointercancel", () => {
    if (!activeEntry) return;
    resetDrag();
    renderResume(getState());
  });

  container.addEventListener("keydown", (event) => {
    const handle = event.target.closest(".entry-reorder-handle");
    if (!handle || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    reorderEntry(handle.dataset.sectionId, handle.dataset.entryId, event.key === "ArrowUp" ? -1 : 1);
  });
}

function reorderSection(sectionId, direction) {
  const state = getState();
  const index = state.sections.findIndex((section) => section.id === sectionId);
  const nextIndex = Math.max(0, Math.min(state.sections.length - 1, index + direction));
  if (index < 0 || nextIndex === index) return false;
  pushUndoState();
  const [section] = state.sections.splice(index, 1);
  section.spacingBefore = Math.max(0, Number(section.spacingBefore) || 0);
  state.sections.splice(nextIndex, 0, section);
  renderResume(state);
  markDirty();
  requestAnimationFrame(() => {
    document.querySelector(`.section-reorder-handle[data-section-id="${CSS.escape(sectionId)}"]`)?.focus();
    updateA4Status();
  });
  return true;
}

function initSectionReordering() {
  const container = document.getElementById("resume-sections");
  if (!container) return;

  let activeHandle = null;
  let activeSection = null;
  let activeSpacing = null;
  let startOrder = [];
  let lastPointerY = 0;
  let scrollFrame = 0;

  const getScrollContext = () => {
    const workspace = document.getElementById("workspace");
    if (workspace && workspace.scrollHeight > workspace.clientHeight + 1) {
      return { element: workspace, top: workspace.getBoundingClientRect().top, bottom: workspace.getBoundingClientRect().bottom };
    }
    return { element: document.scrollingElement, top: 0, bottom: window.innerHeight };
  };

  const placeSectionAtPointer = (clientY) => {
    if (!activeSection || !activeSpacing) return;
    const siblings = Array.from(container.querySelectorAll(":scope > .resume-section"))
      .filter((section) => section !== activeSection);
    const before = siblings.find((section) => {
      const rect = section.getBoundingClientRect();
      return clientY < rect.top + rect.height / 2;
    });
    if (before) {
      const beforeSpacing = container.querySelector(`:scope > .spacing-handle[data-section-id="${CSS.escape(before.dataset.sectionId)}"]`);
      if (!beforeSpacing) return;
      container.insertBefore(activeSpacing, beforeSpacing);
      container.insertBefore(activeSection, beforeSpacing);
    } else {
      container.appendChild(activeSpacing);
      container.appendChild(activeSection);
    }
  };

  const stopAutoScroll = () => {
    if (scrollFrame) cancelAnimationFrame(scrollFrame);
    scrollFrame = 0;
  };

  const autoScroll = () => {
    if (!activeSection) return;
    const { element, top, bottom } = getScrollContext();
    const threshold = Math.min(80, Math.max(44, (bottom - top) * 0.14));
    let delta = 0;
    if (lastPointerY < top + threshold) {
      delta = -Math.ceil(4 + 18 * (top + threshold - lastPointerY) / threshold);
    } else if (lastPointerY > bottom - threshold) {
      delta = Math.ceil(4 + 18 * (lastPointerY - (bottom - threshold)) / threshold);
    }
    if (delta) {
      if (element === document.scrollingElement) window.scrollBy(0, delta);
      else element.scrollTop += delta;
      placeSectionAtPointer(lastPointerY);
    }
    scrollFrame = requestAnimationFrame(autoScroll);
  };

  const resetDrag = () => {
    stopAutoScroll();
    activeHandle?.classList.remove("dragging");
    activeSection?.classList.remove("section-reordering");
    activeHandle = null;
    activeSection = null;
    activeSpacing = null;
    startOrder = [];
  };

  container.addEventListener("pointerdown", (event) => {
    const handle = event.target.closest(".section-reorder-handle");
    if (!handle || event.button !== 0) return;
    const section = handle.closest(".resume-section");
    const spacing = container.querySelector(`:scope > .spacing-handle[data-section-id="${CSS.escape(handle.dataset.sectionId)}"]`);
    if (!section || !spacing) return;
    event.preventDefault();
    event.stopPropagation();
    activeHandle = handle;
    activeSection = section;
    activeSpacing = spacing;
    startOrder = Array.from(container.querySelectorAll(":scope > .resume-section"), (item) => item.dataset.sectionId);
    lastPointerY = event.clientY;
    handle.classList.add("dragging");
    section.classList.add("section-reordering");
    scrollFrame = requestAnimationFrame(autoScroll);
  });

  window.addEventListener("pointermove", (event) => {
    if (!activeSection) return;
    event.preventDefault();
    lastPointerY = event.clientY;
    placeSectionAtPointer(lastPointerY);
  });

  window.addEventListener("pointerup", () => {
    if (!activeSection) return;
    const sectionId = activeSection.dataset.sectionId;
    const finalOrder = Array.from(container.querySelectorAll(":scope > .resume-section"), (item) => item.dataset.sectionId);
    const changed = finalOrder.some((id, index) => id !== startOrder[index]);
    if (changed) {
      const state = getState();
      pushUndoState();
      if (applySectionOrder(state, finalOrder)) {
        const movedSection = state.sections.find((section) => section.id === sectionId);
        if (movedSection) movedSection.spacingBefore = Math.max(0, Number(movedSection.spacingBefore) || 0);
        markDirty();
      }
    }
    resetDrag();
    if (changed) renderResume(getState());
    requestAnimationFrame(() => {
      updateAddGutter(getState());
      updateA4Status();
    });
  });

  window.addEventListener("pointercancel", () => {
    if (!activeSection) return;
    resetDrag();
    renderResume(getState());
  });

  container.addEventListener("keydown", (event) => {
    const handle = event.target.closest(".section-reorder-handle");
    if (!handle || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    reorderSection(handle.dataset.sectionId, event.key === "ArrowUp" ? -1 : 1);
  });
}

/** ========================
 *  State sync
 *  ======================== */

/**
 * Sync a single edited DOM element back to Resume State.
 * @param {HTMLElement} el
 */
function syncElementToState(el) {
  const state = getState();
  if (!state) return;

  const raw = el.textContent.trim();

  // Profile field
  if (el.dataset.profileField) {
    const field = el.dataset.profileField;
    if (field === "headline") {
      state.profile.headline = raw;
    } else if (field === "phone") {
      state.profile.phone = raw.replace(/^联系电话：/, "").trim();
    } else if (field === "email") {
      state.profile.email = raw.replace(/^电子邮箱：/, "").trim();
    } else if (field === "portfolio") {
      const current = getPortfolioContact(state.profile.portfolio);
      state.profile.portfolio = raw && current && current.href
        ? `${raw} | ${current.href}`
        : raw;
    } else if (field in state.profile) {
      state.profile[field] = raw;
    }
    el.dataset.empty = raw ? "false" : "true";
    syncBlockLinksFromElement(state, el, raw);
    return;
  }

  // Entry field
  if (el.dataset.entryField) {
    const field = el.dataset.entryField;
    const entryEl = el.closest("[data-entry-id]");
    if (!entryEl) return;
    const entryId = entryEl.dataset.entryId;
    for (const section of state.sections) {
      for (const entry of getSectionEntries(section)) {
        if (entry.id === entryId) {
          entry[field === "date" ? "date" : field] = raw;
          el.dataset.empty = raw ? "false" : "true";
          syncBlockLinksFromElement(state, el, raw);
          return;
        }
      }
    }
    return;
  }

  // Section title
  if (el.classList.contains("section-title") && el.dataset.sectionId) {
    const section = state.sections.find((item) => item.id === el.dataset.sectionId);
    if (section) {
      section.title = raw || (section.type === "custom" ? "未命名板块" : getSectionTitle(section.type));
      el.dataset.empty = raw ? "false" : "true";
      syncBlockLinksFromElement(state, el, section.title);
    }
    return;
  }

  // Free-form text block
  if (el.dataset.textBlockId) {
    for (const section of state.sections) {
      const block = (section.blocks || []).find((item) => item.id === el.dataset.textBlockId);
      if (!block) continue;
      block.content = tokensFromEditableElement(el);
      el.dataset.empty = raw ? "false" : "true";
      return;
    }
  }

  // Bullet content
  if (el.dataset.bulletId) {
    const bulletId = el.dataset.bulletId;
    for (const section of state.sections) {
      for (const entry of getSectionBulletContainers(section)) {
        for (const bullet of entry.bullets) {
          if (bullet.id === bulletId) {
            bullet.content = tokensFromEditableElement(el);
            if (typeof updateBulletSemanticClass === "function") {
              updateBulletSemanticClass(el, bullet.content);
            }
            return;
          }
        }
      }
    }
  }
}

function tokensFromEditableElement(element) {
  const tokens = [];
  const walk = (node, strong = false, italic = false, inheritedDelta = 0, inheritedHref = "") => {
    if (node.nodeType === Node.TEXT_NODE) {
      if (!node.nodeValue) return;
      tokens.push({
        type: strong ? "strong" : "text",
        value: node.nodeValue,
        ...(italic ? { italic: true } : {}),
        ...(inheritedDelta ? { fontSizeDelta: inheritedDelta } : {}),
        ...(inheritedHref ? { href: inheritedHref } : {}),
      });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const nextStrong = strong || node.tagName === "STRONG" || node.tagName === "B";
    const nextItalic = italic || node.tagName === "EM" || node.tagName === "I";
    const nextDelta = Number(node.dataset.fontSizeDelta || inheritedDelta || 0);
    const nextHref = node.tagName === "A" ? node.getAttribute("href") || inheritedHref : inheritedHref;
    node.childNodes.forEach((child) => walk(child, nextStrong, nextItalic, nextDelta, nextHref));
  };
  element.childNodes.forEach((node) => walk(node));
  return mergeInlineTokens(tokens);
}

/** ========================
 *  Section spacing handles
 *  ======================== */

const SNAP_GRID_MM   = 0.5;
const SNAP_RADIUS_PX = 6;
const SPACING_MIN_MM = -100;
const SPACING_MAX_MM = 100;
const SPACING_DEFAULT_MM = 0;

function getPxPerMm() {
  const ruler = document.createElement("div");
  ruler.style.cssText = "position:fixed;top:0;left:-999px;width:10mm;height:1px;visibility:hidden;pointer-events:none;";
  document.body.appendChild(ruler);
  const px = ruler.offsetWidth / 10;
  ruler.remove();
  return px;
}

function collectSnapTargets() {
  const state = getState();
  const values = state.sections.map(s => s.spacingBefore !== undefined ? s.spacingBefore : SPACING_DEFAULT_MM);
  const grid = [0, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5];
  return [...new Set([...values, ...grid])].sort((a, b) => a - b);
}

function snapMm(rawMm, targets, pxPerMm) {
  let snapped = Math.round(rawMm / SNAP_GRID_MM) * SNAP_GRID_MM;
  snapped = Math.max(SPACING_MIN_MM, Math.min(SPACING_MAX_MM, snapped));
  const snapRadiusMm = SNAP_RADIUS_PX / pxPerMm;
  let nearestTarget = null;
  let nearestDistance = Infinity;
  for (const target of targets) {
    const distance = Math.abs(rawMm - target);
    if (distance < nearestDistance) {
      nearestTarget = target;
      nearestDistance = distance;
    }
  }
  return nearestDistance <= snapRadiusMm ? nearestTarget : snapped;
}

function updateSpacingHandleVisual(handle, spacingMm) {
  if (!handle) return;
  handle.style.setProperty("--spacing-size", `${spacingMm}mm`);
  handle.setAttribute("aria-valuenow", String(spacingMm));
  handle.setAttribute("aria-valuetext", `${spacingMm.toFixed(1)} 毫米`);
  const tip = handle.querySelector(".spacing-tooltip");
  if (tip) tip.textContent = `${spacingMm.toFixed(1)} mm`;
  const dragHandle = document.querySelector(`.section-drag-handle[data-section-id="${CSS.escape(handle.dataset.sectionId)}"]`);
  if (dragHandle) {
    dragHandle.setAttribute("aria-valuenow", String(spacingMm));
    dragHandle.setAttribute("aria-valuetext", `${spacingMm.toFixed(1)} 毫米`);
  }
}

function setSectionSpacing(sectionId, spacingMm, markAsDirty = true) {
  const state = getState();
  const section = state.sections.find((item) => item.id === sectionId);
  const sectionEl = document.querySelector(`section[data-section-id="${CSS.escape(sectionId)}"]`);
  const handle = document.querySelector(`.spacing-handle[data-section-id="${CSS.escape(sectionId)}"]`);
  if (!section) return;
  section.spacingBefore = spacingMm;
  if (sectionEl) sectionEl.style.marginTop = `${spacingMm}mm`;
  updateSpacingHandleVisual(handle, spacingMm);
  if (markAsDirty) {
    markDirty();
    updateA4Status();
  }
}

function initSpacingHandles() {
  const container = document.getElementById("resume-sections");
  if (!container) return;

  let dragging = false, changed = false, startY = 0, startMm = SPACING_DEFAULT_MM;
  let activeSectionId = null, activeHandle = null, activeSectionEl = null;
  let pxPerMm = getPxPerMm();

  container.addEventListener("pointerdown", (e) => {
    const dragHandle = e.target.closest(".section-drag-handle");
    if (!dragHandle || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    changed = false;
    startY = e.clientY;
    activeSectionId = dragHandle.dataset.sectionId;
    activeHandle = container.querySelector(`.spacing-handle[data-section-id="${CSS.escape(activeSectionId)}"]`);
    activeSectionEl = container.querySelector(`section[data-section-id="${CSS.escape(activeSectionId)}"]`);
    pxPerMm = getPxPerMm();
    const state = getState();
    const section = state.sections.find(s => s.id === activeSectionId);
    startMm = (section && section.spacingBefore !== undefined) ? section.spacingBefore : SPACING_DEFAULT_MM;
    if (activeHandle) activeHandle.classList.add("dragging");
    if (activeSectionEl) activeSectionEl.classList.add("section-dragging");
    dragHandle.setPointerCapture(e.pointerId);
  });

  container.addEventListener("pointermove", (e) => {
    if (!dragging || !activeSectionId) return;
    const rawMm = startMm + (e.clientY - startY) / pxPerMm;
    const snapped = snapMm(rawMm, collectSnapTargets(), pxPerMm);
    if (!changed && snapped !== startMm) {
      pushUndoState();
      changed = true;
    }
    const sectionEl = container.querySelector(`section[data-section-id="${activeSectionId}"]`);
    if (sectionEl) sectionEl.style.marginTop = snapped + "mm";
    updateSpacingHandleVisual(activeHandle, snapped);
    if (activeHandle) {
      const isSnapped = collectSnapTargets().some(t => t !== startMm && Math.abs(snapped - t) < 0.01);
      activeHandle.classList.toggle("snapped", isSnapped);
    }
  });

  container.addEventListener("pointerup", (e) => {
    if (!dragging || !activeSectionId) return;
    const rawMm = startMm + (e.clientY - startY) / pxPerMm;
    const snapped = snapMm(rawMm, collectSnapTargets(), pxPerMm);
    if (changed) setSectionSpacing(activeSectionId, snapped, false);
    else updateSpacingHandleVisual(activeHandle, startMm);
    if (activeHandle) activeHandle.classList.remove("dragging", "snapped");
    if (activeSectionEl) activeSectionEl.classList.remove("section-dragging");
    dragging = false; activeSectionId = null; activeHandle = null; activeSectionEl = null;
    if (changed) {
      markDirty();
      updateA4Status();
    }
  });

  container.addEventListener("pointercancel", () => {
    if (!dragging || !activeSectionId) return;
    const sectionEl = container.querySelector(`section[data-section-id="${activeSectionId}"]`);
    if (sectionEl) sectionEl.style.marginTop = startMm + "mm";
    updateSpacingHandleVisual(activeHandle, startMm);
    if (activeHandle) activeHandle.classList.remove("dragging", "snapped");
    if (activeSectionEl) activeSectionEl.classList.remove("section-dragging");
    dragging = false; activeSectionId = null; activeHandle = null; activeSectionEl = null;
  });

  container.addEventListener("dblclick", (e) => {
    const dragHandle = e.target.closest(".section-drag-handle");
    if (!dragHandle) return;
    e.preventDefault();
    const section = getState().sections.find((item) => item.id === dragHandle.dataset.sectionId);
    const current = section && section.spacingBefore !== undefined ? section.spacingBefore : SPACING_DEFAULT_MM;
    if (current === SPACING_DEFAULT_MM) return;
    pushUndoState();
    setSectionSpacing(dragHandle.dataset.sectionId, SPACING_DEFAULT_MM);
  });

  container.addEventListener("keydown", (e) => {
    const dragHandle = e.target.closest(".section-drag-handle");
    if (!dragHandle || !["ArrowUp", "ArrowDown", "Home"].includes(e.key)) return;
    e.preventDefault();
    const section = getState().sections.find((item) => item.id === dragHandle.dataset.sectionId);
    const current = section && section.spacingBefore !== undefined ? section.spacingBefore : SPACING_DEFAULT_MM;
    const amount = e.shiftKey ? 1 : SNAP_GRID_MM;
    const raw = e.key === "Home" ? SPACING_DEFAULT_MM : current + (e.key === "ArrowUp" ? -amount : amount);
    const next = snapMm(raw, [], getPxPerMm());
    if (next === current) return;
    pushUndoState();
    setSectionSpacing(dragHandle.dataset.sectionId, next);
  });
}
