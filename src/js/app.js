/**
 * Main application entry point.
 * Initializes state, wires up toolbar buttons, manages import/export lifecycle.
 */

/** @type {string} */
const APP_STATE_KEY = "resume-formatter:app-state-v1";

document.addEventListener("DOMContentLoaded", () => {
  const initialState = loadInitialState();
  setState(initialState);

  if (initialState.sections && initialState.sections.length > 0) {
    renderResume(initialState);
  } else if (typeof DEFAULT_RESUME_MD !== "undefined") {
    // Auto-load the baked-in sample resume on first open
    const parseResult = parseMarkdown(DEFAULT_RESUME_MD);
    const validation  = validateAndBuildState(parseResult, DEFAULT_RESUME_FILENAME || "sample-resume.md");
    if (validation.state) {
      setState(validation.state);
      renderResume(validation.state);
    }
  } else {
    updateStatusInfo(initialState);
  }

  applyLayoutState(getState());

  initOverflowDetection();
  initEditor();
  initPhoto();

  // Wire up toolbar buttons
  wireToolbar();
  initThemeSwitcher();
  initToolbarMenus();
  initResumeListPanel();
  initJsonTools();
  initMarkdownTools();
  requestAnimationFrame(() => updateA4Status());
});

/**
 * Wire up toolbar button event listeners.
 */
function wireToolbar() {
  const btnOpenFile = document.getElementById("btn-open-file");
  const btnExportPdf = document.getElementById("btn-export-pdf");
  const fileInput = document.getElementById("file-input-resume");

  const btnAddSection = document.getElementById("btn-add-section");
  if (btnAddSection) {
    btnAddSection.addEventListener("click", () => {
      showInputDialog({
        title: "新增板块",
        message: "板块名称可以随时在简历中修改。",
        defaultValue: "",
        confirmText: "创建",
        onSubmit: addSection,
      });
    });
  }

  // Open a resume file. File System Access keeps the writable handle so
  // subsequent saves update the same local file.
  if (btnOpenFile && fileInput) {
    btnOpenFile.addEventListener("click", () => openResumeFile(fileInput));

    fileInput.addEventListener("change", (e) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      handleFileInputOpen(files[0], fileInput);
    });
  }

  // Fix overflow button
  const btnFix = document.getElementById("btn-fix-overflow");
  if (btnFix) {
    btnFix.addEventListener("click", () => autoFixOverflow());
  }

  // Font-size slider
  const fsSlider = document.getElementById("font-size-slider");
  const fsValue  = document.getElementById("font-size-value");
  if (fsSlider) {
    fsSlider.addEventListener("input", () => {
      const pt = parseFloat(fsSlider.value);
      if (fsValue) fsValue.textContent = pt + "pt";
      applyFontSize(pt);
      const state = getState();
      if (!state.layout) state.layout = {};
      state.layout.fontSize = pt;
      markDirty();
      requestAnimationFrame(() => updateA4Status());
    });
  }
  const lhSlider = document.getElementById("line-height-slider");
  const lhValue  = document.getElementById("line-height-value");
  if (lhSlider) {
    lhSlider.addEventListener("input", () => {
      const lh = parseFloat(lhSlider.value);
      if (lhValue) lhValue.textContent = lh.toFixed(2);
      applyLineHeight(lh);
      const state = getState();
      if (!state.layout) state.layout = {};
      state.layout.lineHeight = lh;
      markDirty();
      requestAnimationFrame(() => updateA4Status());
    });
  }

  // New resume template
  const btnNew = document.getElementById("btn-new-resume");
  if (btnNew) {
    btnNew.addEventListener("click", handleNewResume);
  }
  const btnSave = document.getElementById("btn-save");
  if (btnSave) btnSave.addEventListener("click", () => handleSave());
  const btnSaveAs = document.getElementById("btn-save-as");
  if (btnSaveAs) btnSaveAs.addEventListener("click", () => handleSaveAs());

  // Export PDF
  if (btnExportPdf) {
    btnExportPdf.addEventListener("click", () => {
      handleExportPdf();
    });
  }
}

/**
 * Handle the fallback file input when File System Access is unavailable.
 * @param {File} file
 * @param {HTMLInputElement} fileInput
 */
function handleFileInputOpen(file, fileInput) {
  const reader = new FileReader();

  reader.onload = async (e) => {
    const raw = e.target.result;
    const isJson = /\.json$/i.test(file.name);
    const validation = isJson
      ? importJsonResume(raw, file.name)
      : validateAndBuildState(parseMarkdown(raw), file.name);

    if (validation.state) {
      // Fallback imports do not expose a writable file handle.
      await hydrateReferencedPhoto(validation.state, { file });
      setState(validation.state);
      renderResume(validation.state);
      updateA4Status();
      detachActiveSource();
      renderResumeFileList([], "当前文件", false);
      clearDirty();
      showToast("已打开文件。当前浏览器无法关联原文件，请使用“另存为”保存。", "warning");
    } else {
      // Import had errors
      const errorMsgs = validation.errors
        .filter((err) => err.level === "error")
        .map((err) => err.message);

      showDialog({
        title: "打开失败",
        message: errorMsgs.join("\n") || `无法解析该 ${isJson ? "JSON" : "Markdown"} 文件。`,
        buttons: [{ text: "好的", primary: true }],
      });
    }

    // Reset file input so same file can be re-imported
    fileInput.value = "";
  };

  reader.onerror = () => {
    showDialog({
      title: "Markdown 读取失败",
      message: `无法读取“${file.name}”。文件可能已被移动、重命名，或浏览器没有访问权限。请重新选择该文件。`,
      buttons: [{ text: "好的", primary: true }],
    });
  };

  reader.readAsText(file);
}

async function openResumeFile(fileInput) {
  if (!("showOpenFilePicker" in window)) {
    fileInput.click();
    return;
  }

  try {
    const [handle] = await window.showOpenFilePicker({
      multiple: false,
      types: [
        {
          description: "Markdown 简历",
          accept: { "text/markdown": [".md", ".markdown"] },
        },
        {
          description: "JSON 简历",
          accept: { "application/json": [".json"] },
        },
      ],
    });
    if (!handle) return;
    const sourceFile = { name: handle.name, entryName: handle.name, handle };
    const loaded = await loadResumeFromHandle(handle.name, handle, `source:${handle.name}`, sourceFile);
    if (!loaded) return;
    _dirHandle = null;
    renderResumeFileList([sourceFile], "当前文件", false);
    setDirectoryImportStatus(`已打开“${handle.name}”，保存将写回此文件。`, "success");
  } catch (error) {
    if (error && error.name === "AbortError") return;
    console.error("Failed to open Markdown file:", error);
    showDialog({
      title: "文件打开失败",
      message: error && error.message ? error.message : "无法读取所选简历文件。",
      buttons: [{ text: "好的", primary: true }],
    });
  }
}

/**
 * Apply a base font size by scaling all font-size CSS variables proportionally.
 * Product 1 baseline is 10pt. All other sizes keep its type hierarchy.
 * @param {number} pt
 */
function applyFontSize(pt) {
  const page = document.getElementById("resume-page");
  if (!page) return;
  page.style.setProperty("--font-size-body",          pt + "pt");
  page.style.setProperty("--font-size-small",          pt.toFixed(2) + "pt");
  page.style.setProperty("--font-size-entry-name",     pt.toFixed(2) + "pt");
  page.style.setProperty("--font-size-section-title",  (pt * 1.2).toFixed(2) + "pt");
  page.style.setProperty("--font-size-contact",        (pt * 1.05).toFixed(2) + "pt");
  page.style.setProperty("--font-size-headline",       (pt * 1.3).toFixed(2) + "pt");
  page.style.setProperty("--font-size-name",           (pt * 1.8).toFixed(2) + "pt");
}

function applyLineHeight(lineHeight) {
  const page = document.getElementById("resume-page");
  if (page) page.style.setProperty("--layout-line-height", String(lineHeight));
}

/** Apply persisted layout values and keep toolbar controls in sync. */
function applyLayoutState(state) {
  if (!state.layout) state.layout = {};
  const fontSize = Number(state.layout.fontSize) || 10;
  const lineHeight = Number(state.layout.lineHeight) || 1.57;
  const theme = ["a", "b", "c", "d"].includes(state.layout.theme) ? state.layout.theme : "a";
  state.layout.fontSize = fontSize;
  state.layout.lineHeight = lineHeight;
  state.layout.theme = theme;
  applyFontSize(fontSize);
  applyLineHeight(lineHeight);
  applyThemeVisual(theme);

  const fontSlider = document.getElementById("font-size-slider");
  const fontOutput = document.getElementById("font-size-value");
  const lineSlider = document.getElementById("line-height-slider");
  const lineOutput = document.getElementById("line-height-value");
  if (fontSlider) fontSlider.value = String(fontSize);
  if (fontOutput) fontOutput.textContent = `${fontSize}pt`;
  if (lineSlider) lineSlider.value = String(lineHeight);
  if (lineOutput) lineOutput.textContent = lineHeight.toFixed(2);
}

function applyThemeVisual(theme) {
  const page = document.getElementById("resume-page");
  if (page) page.dataset.theme = theme;
  const labels = { a: "黑体", b: "宋体", c: "思源", d: "学术" };
  for (const value of ["a", "b", "c", "d"]) {
    document.getElementById(`btn-theme-${value}`)?.classList.toggle("toolbar-btn-active", theme === value);
  }
  const themeLabel = document.getElementById("current-theme-label");
  if (themeLabel) themeLabel.textContent = labels[theme];
}

/**
 * Download a blank Schema v1 MD template.
 */
function handleNewResume() {
  const template = `---
schema_version: 1
resume_name: 公司名-岗位
name: 姓名
headline: 求职方向
phone: 手机号
email: 邮箱
---

## 教育经历

### 学校名称
role: 专业｜学历
date: 2020.09–2024.06

- 描述

## 实习经历

### 公司名称｜部门
role: 岗位
date: 2024.07–2024.09

- 描述

## 项目经历

### 项目名称
role: 角色
date: 2024.01–2024.03

- 描述

## 技能

- 技能类别：具体内容
`;

  const blob = new Blob([template], { type: "text/plain;charset=utf-8" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = "新简历-模板.md";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("已下载模板，用文本编辑器填写后导入即可。", "success");
}

/** Save current edits directly to the active source file. */
async function handleSave() {
  syncFocusedEditor();
  const state = getState();
  if (!state.profile.name && (!state.sections || state.sections.length === 0)) {
    showToast("请先导入简历。", "warning");
    return;
  }
  const sourceFile = getActiveSourceFile();
  if (!sourceFile?.handle || typeof sourceFile.handle.createWritable !== "function") {
    showDialog({
      title: "尚未关联本地文件",
      message: "请先通过“打开文件”或“打开文件夹”打开 Markdown 或 JSON；也可以使用“另存为”创建一个新文件。",
      buttons: [{ text: "好的", primary: true }],
    });
    return;
  }
  await writeResumeToSource(sourceFile);
}

/**
 * Handle "Export PDF" button.
 */
function handleExportPdf() {
  const state = getState();

  if (!state.profile.name) {
    showToast("请先导入 Markdown 简历。", "warning");
    return;
  }

  // Check overflow
  const { overflow } = checkOverflow();
  if (overflow) {
    showDialog({
      title: "内容溢出",
      message: "当前内容超出单页 A4。导出 PDF 可能出现分页或截断。是否仍然打印？",
      buttons: [
        { text: "返回修改" },
        { text: "仍然打印", primary: true, action: () => exportPdf() },
      ],
    });
  } else {
    exportPdf();
  }
}

/**
 * Show a simple confirmation/info dialog.
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} opts.message
 * @param {{ text: string, primary?: boolean, danger?: boolean, disabled?: boolean, title?: string, action?: Function }[]} opts.buttons
 */
function showDialog({ title, message, buttons }) {
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

  const titleEl = document.createElement("h3");
  titleEl.className = "dialog-title";
  titleEl.textContent = title;
  box.appendChild(titleEl);

  const msgEl = document.createElement("p");
  msgEl.className = "dialog-message";
  msgEl.style.whiteSpace = "pre-line";
  msgEl.textContent = message;
  box.appendChild(msgEl);

  const actions = document.createElement("div");
  actions.className = "dialog-actions";

  for (const btn of (buttons || [{ text: "确定", primary: true }])) {
    const btnEl = document.createElement("button");
    btnEl.className = "dialog-btn";
    if (btn.primary) btnEl.classList.add("dialog-btn-primary");
    if (btn.danger || btn.text.includes("删除") || btn.text.includes("恢复")) btnEl.classList.add("dialog-btn-danger");
    btnEl.disabled = Boolean(btn.disabled);
    if (btn.title) btnEl.title = btn.title;
    btnEl.textContent = btn.text;
    btnEl.addEventListener("click", () => {
      closeDialog();
      if (btn.action) btn.action();
    });
    actions.appendChild(btnEl);
  }

  box.appendChild(actions);
  root.appendChild(box);
}

/**
 * Show an input dialog.
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} opts.message
 * @param {string} opts.defaultValue
 * @param {string} opts.confirmText
 * @param {Function} opts.onSubmit
 */
function showInputDialog({ title, message, defaultValue, confirmText, onSubmit }) {
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

  const titleEl = document.createElement("h3");
  titleEl.className = "dialog-title";
  titleEl.textContent = title;
  box.appendChild(titleEl);

  if (message) {
    const msgEl = document.createElement("p");
    msgEl.className = "dialog-message";
    msgEl.textContent = message;
    box.appendChild(msgEl);
  }

  const input = document.createElement("input");
  input.className = "dialog-input";
  input.type = "text";
  input.value = defaultValue || "";
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && input.value.trim()) {
      closeDialog();
      onSubmit(input.value.trim());
    }
  });
  box.appendChild(input);

  const actions = document.createElement("div");
  actions.className = "dialog-actions";

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "dialog-btn";
  cancelBtn.textContent = "取消";
  cancelBtn.addEventListener("click", closeDialog);
  actions.appendChild(cancelBtn);

  const confirmBtn = document.createElement("button");
  confirmBtn.className = "dialog-btn dialog-btn-primary";
  confirmBtn.textContent = confirmText || "确认";
  confirmBtn.addEventListener("click", () => {
    if (!input.value.trim()) return;
    closeDialog();
    onSubmit(input.value.trim());
  });
  actions.appendChild(confirmBtn);

  box.appendChild(actions);
  root.appendChild(box);

  // Focus input
  setTimeout(() => input.focus(), 50);
}

/**
 * Resume list panel — File System Access API based directory browser.
 * Directory handle is persisted in IndexedDB so it survives page reloads.
 */

/** @type {FileSystemDirectoryHandle|null} */
let _dirHandle = null;

/** @type {string|null} — filename of currently active resume */
let _activeFile = null;

/** @type {{name:string, handle:FileSystemFileHandle, parentDirectory?:FileSystemDirectoryHandle, entryName?:string}|null} */
let _activeSourceFile = null;

let _directoryFiles = [];
let _directoryName = "简历版本";
let _directoryCanRefresh = false;
let _directoryImportSequence = 0;
let _directoryStatusTimer = null;

const MD_SNAPSHOTS_KEY = "resume-formatter:md-snapshots-v1";
const PINNED_RESUMES_KEY = "resume-formatter:pinned-resumes-v1";

function loadPinnedResumes() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PINNED_RESUMES_KEY) || "[]");
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch (e) {
    console.error("Failed to load pinned resumes:", e);
    return new Set();
  }
}

function getResumePinKey(type, id) {
  return `${type}:${id}`;
}

function toggleResumePin(pinKey) {
  const pinned = loadPinnedResumes();
  if (pinned.has(pinKey)) pinned.delete(pinKey);
  else pinned.add(pinKey);
  localStorage.setItem(PINNED_RESUMES_KEY, JSON.stringify([...pinned]));
  renderResumeFileList(_directoryFiles, _directoryName, _directoryCanRefresh);
}

function appendPinButton(listItem, pinKey, displayName, isPinned) {
  const button = document.createElement("button");
  button.className = `resume-list-action resume-list-pin${isPinned ? " active" : ""}`;
  button.textContent = isPinned ? "★" : "☆";
  button.title = isPinned ? "取消置顶" : "置顶";
  button.setAttribute("aria-label", `${isPinned ? "取消置顶" : "置顶"} ${displayName}`);
  button.setAttribute("aria-pressed", String(isPinned));
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleResumePin(pinKey);
  });
  listItem.appendChild(button);
}

function syncFocusedEditor() {
  const active = document.activeElement;
  if (active && active.closest && active.closest("#resume-content")) active.blur();
}

function getActiveSourceFile() {
  if (!_activeFile || !_activeFile.startsWith("source:")) return null;
  const sourceName = _activeFile.slice("source:".length);
  if (_activeSourceFile && _activeSourceFile.name === sourceName) return _activeSourceFile;
  return _directoryFiles.find((file) => file.name === sourceName) || null;
}

function detachActiveSource() {
  _activeFile = null;
  _activeSourceFile = null;
  document.querySelectorAll(".resume-list-item.active").forEach((item) => item.classList.remove("active"));
}

async function ensureFileWritePermission(handle) {
  if (!handle || typeof handle.createWritable !== "function") return false;
  if (typeof handle.queryPermission !== "function") return true;
  try {
    let permission = await handle.queryPermission({ mode: "readwrite" });
    if (permission !== "granted" && typeof handle.requestPermission === "function") {
      permission = await handle.requestPermission({ mode: "readwrite" });
    }
    return permission === "granted";
  } catch (error) {
    console.warn("Failed to request file write permission:", error);
    return false;
  }
}

async function writeResumeToSource(file, { showSuccess = true } = {}) {
  if (!file?.handle || typeof file.handle.createWritable !== "function") {
    showToast("当前文件不可写，请使用“另存为”。", "warning");
    return;
  }
  if (!await ensureFileWritePermission(file.handle)) {
    showDialog({
      title: "需要文件写入权限",
      message: `请允许写入“${file.name}”，才能保存当前修改。`,
      buttons: [{ text: "好的", primary: true }],
    });
    return;
  }

  const state = getState();
  const isJson = /\.json$/i.test(file.name);
  const content = isJson ? serializeStateToJson(state) : serializeStateToMarkdown(state);
  const saveButton = document.getElementById("btn-save");
  if (saveButton) saveButton.disabled = true;

  try {
    const writable = await file.handle.createWritable();
    try {
      await writable.write(content);
      await writable.close();
    } catch (e) {
      try {
        await writable.abort();
      } catch {}
      throw e;
    }
    state.source.fileName = file.name;
    state.importSnapshot = createImportSnapshot(state);
    clearDirty();
    updateStatusInfo(state);
    if (showSuccess) showToast(`已保存到“${file.name}”。`, "success");
    return true;
  } catch (e) {
    console.error("Failed to save source file:", e);
    showDialog({
      title: "保存失败",
      message: `无法写入“${file.name}”：${e.message || "未知错误"}`,
      buttons: [{ text: "好的", primary: true }],
    });
  } finally {
    if (saveButton) saveButton.disabled = false;
  }
}

async function handleSaveAs() {
  syncFocusedEditor();
  const state = getState();
  if (!state.profile.name && (!state.sections || state.sections.length === 0)) {
    showToast("请先打开或导入简历。", "warning");
    return;
  }
  if (!("showSaveFilePicker" in window)) {
    showDialog({
      title: "当前浏览器不支持另存为",
      message: "请使用最新版桌面 Chrome 打开排版器，再选择新的简历文件位置。",
      buttons: [{ text: "好的", primary: true }],
    });
    return;
  }

  const currentIsJson = /\.json$/i.test(state.source?.fileName || "");
  const extension = currentIsJson ? ".json" : ".md";
  const sourceBaseName = (state.source?.fileName || "").split("/").pop()?.replace(/\.(?:md|markdown|json)$/i, "");
  const suggestedName = `${sanitizeFileName(sourceBaseName || state.resumeName || "resume")}-副本${extension}`;
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName,
      ...( _dirHandle ? { startIn: _dirHandle } : {}),
      types: [{
        description: currentIsJson ? "JSON 简历" : "Markdown 简历",
        accept: currentIsJson
          ? { "application/json": [".json"] }
          : { "text/markdown": [".md", ".markdown"] },
      }],
    });
    const sourceFile = { name: handle.name, entryName: handle.name, handle };
    const saved = await writeResumeToSource(sourceFile, { showSuccess: false });
    if (!saved) return;

    _activeSourceFile = sourceFile;
    _activeFile = `source:${sourceFile.name}`;
    state.source.fileName = sourceFile.name;
    if (_dirHandle) {
      try {
        await refreshResumeList();
        const match = await findMatchingDirectoryFile(handle);
        if (match) {
          _activeSourceFile = match;
          _activeFile = `source:${match.name}`;
          state.source.fileName = match.name;
        }
        renderResumeFileList(_directoryFiles, _directoryName, _directoryCanRefresh);
      } catch (refreshError) {
        console.warn("Failed to refresh after Save As:", refreshError);
      }
    } else {
      renderResumeFileList([sourceFile], "当前文件", false);
    }
    updateStatusInfo(state);
    showToast(`已另存为“${state.source.fileName}”，后续保存将写入此文件。`, "success");
  } catch (error) {
    if (error && error.name === "AbortError") return;
    console.error("Failed to save resume as Markdown:", error);
    showDialog({
      title: "另存为失败",
      message: error && error.message ? error.message : "无法创建新的简历文件。",
      buttons: [{ text: "好的", primary: true }],
    });
  }
}

async function findMatchingDirectoryFile(handle) {
  if (!handle || typeof handle.isSameEntry !== "function") return null;
  for (const file of _directoryFiles) {
    try {
      if (await file.handle.isSameEntry(handle)) return file;
    } catch {}
  }
  return null;
}

function loadMarkdownSnapshots() {
  try {
    const parsed = JSON.parse(localStorage.getItem(MD_SNAPSHOTS_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error("Failed to load Markdown snapshots:", e);
    return [];
  }
}

function saveMarkdownSnapshot(state, customName) {
  const now = new Date();
  const timestamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "-",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");
  const baseName = sanitizeFileName(
    customName || state.resumeName || (state.source.fileName || "").replace(/\.(?:md|markdown|json)$/i, "") || "resume"
  ).replace(/\.(?:md|markdown|json)$/i, "");
  const snapshot = {
    id: generateId(),
    name: `${baseName}${customName ? "" : `-${timestamp}`}.md`,
    markdown: serializeStateToMarkdown(state),
    createdAt: now.toISOString(),
  };
  const snapshots = loadMarkdownSnapshots();
  snapshots.unshift(snapshot);
  localStorage.setItem(MD_SNAPSHOTS_KEY, JSON.stringify(snapshots));
  _activeFile = `snapshot:${snapshot.id}`;
  renderResumeFileList(_directoryFiles, _directoryName, _directoryCanRefresh);
  return snapshot;
}

function deleteMarkdownSnapshot(snapshotId) {
  const snapshots = loadMarkdownSnapshots().filter((snapshot) => snapshot.id !== snapshotId);
  localStorage.setItem(MD_SNAPSHOTS_KEY, JSON.stringify(snapshots));
  if (_activeFile === `snapshot:${snapshotId}`) _activeFile = null;
  renderResumeFileList(_directoryFiles, _directoryName, _directoryCanRefresh);
}

function renameMarkdownSnapshot(snapshotId) {
  const snapshots = loadMarkdownSnapshots();
  const snapshot = snapshots.find((item) => item.id === snapshotId);
  if (!snapshot) return;

  showInputDialog({
    title: "重命名副本",
    message: "输入新的副本名称：",
    defaultValue: snapshot.name.replace(/\.md$/i, ""),
    confirmText: "重命名",
    onSubmit: (name) => {
      const sanitized = sanitizeFileName(name).replace(/\.md$/i, "");
      if (!sanitized) return;
      snapshot.name = `${sanitized}.md`;
      localStorage.setItem(MD_SNAPSHOTS_KEY, JSON.stringify(snapshots));
      renderResumeFileList(_directoryFiles, _directoryName, _directoryCanRefresh);
    },
  });
}

const IDB_NAME    = "resume-formatter";
const IDB_STORE   = "config";
const IDB_DIR_KEY = "dir-handle";

/**
 * Open (or create) the IndexedDB database.
 * @returns {Promise<IDBDatabase>}
 */
function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = (e) => {
      e.target.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

/**
 * Save directory handle to IndexedDB.
 * @param {FileSystemDirectoryHandle} handle
 */
async function saveDirHandle(handle) {
  try {
    const db = await openIDB();
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(handle, IDB_DIR_KEY);
  } catch (e) {
    console.warn("Failed to save dir handle:", e);
  }
}

/**
 * Load directory handle from IndexedDB.
 * @returns {Promise<FileSystemDirectoryHandle|null>}
 */
async function loadDirHandle() {
  try {
    const db = await openIDB();
    return new Promise((resolve) => {
      const tx  = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(IDB_DIR_KEY);
      req.onsuccess = (e) => resolve(e.target.result || null);
      req.onerror   = ()  => resolve(null);
    });
  } catch {
    return null;
  }
}

function initResumeListPanel() {
  const btnPick    = document.getElementById("btn-pick-dir");
  const btnRefresh = document.getElementById("btn-refresh-dir");
  const directoryInput = document.getElementById("file-input-directory");

  if (directoryInput) {
    directoryInput.addEventListener("change", async () => {
      const selectedFiles = Array.from(directoryInput.files || []);
      if (selectedFiles.length === 0) return;

      const sequence = ++_directoryImportSequence;
      setDirectoryImportBusy(true);
      setDirectoryImportStatus("正在识别文件夹中的简历文件...");
      _dirHandle = null;
      const supportedFiles = selectedFiles.filter((file) => /\.(?:md|markdown|json)$/i.test(file.name));
      const firstPath = supportedFiles[0]?.webkitRelativePath || selectedFiles[0]?.webkitRelativePath || "";
      const rootName = firstPath.includes("/") ? firstPath.split("/")[0] : "导入文件夹";
      const relatedFiles = new Map(selectedFiles.map((file) => [
        stripDirectoryRoot(file.webkitRelativePath || file.name, rootName),
        file,
      ]));
      const candidates = supportedFiles.map((file) => ({
        name: stripDirectoryRoot(file.webkitRelativePath || file.name, rootName),
        handle: { getFile: async () => file },
        relatedFiles,
      }));
      const files = await filterRecognizableResumeFiles(candidates, sequence);
      if (sequence !== _directoryImportSequence) return;
      if (files.length === 0) {
        setDirectoryImportBusy(false);
        setDirectoryImportStatus("未找到可识别的 Markdown 或 JSON 简历。", "error");
        showDialog({
          title: "没有可识别的简历",
          message: "所选文件夹中没有符合当前简历格式的 Markdown 或 JSON 文件。",
          buttons: [{ text: "好的", primary: true }],
        });
        directoryInput.value = "";
        return;
      }
      renderResumeFileList(files, rootName, false);
      setDirectoryImportBusy(false);
      setDirectoryImportStatus(`已识别 ${files.length} 个文件，请在下方选择要打开的简历。`, "success");
      showToast(`已读取“${rootName}”：${files.length} 个简历文件。`, "success");
      directoryInput.value = "";
    });
  }

  if (btnPick) {
    btnPick.addEventListener("click", async () => {
      if (!("showDirectoryPicker" in window)) {
        if (directoryInput) {
          setDirectoryImportStatus("请选择包含 Markdown 或 JSON 简历的文件夹。");
          directoryInput.click();
        } else {
          setDirectoryImportStatus("当前浏览器不支持文件夹导入。", "error");
        }
        return;
      }
      const sequence = ++_directoryImportSequence;
      setDirectoryImportBusy(true);
      setDirectoryImportStatus("等待选择文件夹...");
      try {
        const handle = await window.showDirectoryPicker({ mode: "readwrite" });
        if (sequence !== _directoryImportSequence) return;
        _dirHandle = handle;
        setDirectoryImportStatus("正在扫描文件夹中的简历文件...");
        const files = await refreshResumeList(sequence);
        await saveDirHandle(handle);
        if (sequence !== _directoryImportSequence) return;
        setDirectoryImportBusy(false);
        if (files.length === 0) {
          setDirectoryImportStatus("未找到可识别的 Markdown 或 JSON 简历。", "error");
          showDialog({
            title: "没有可识别的简历",
            message: "所选文件夹中没有符合当前简历格式的 Markdown 或 JSON 文件。",
            buttons: [{ text: "好的", primary: true }],
          });
        } else {
          setDirectoryImportStatus(`已识别 ${files.length} 个文件，请在下方选择要打开的简历。`, "success");
          showToast(`已读取“${handle.name}”：${files.length} 个简历文件。`, "success");
        }
      } catch (e) {
        if (sequence !== _directoryImportSequence) return;
        setDirectoryImportBusy(false);
        if (e.name === "AbortError") {
          setDirectoryImportStatus("已取消选择文件夹。");
          return;
        }
        console.error("Failed to open resume directory:", e);
        const message = e && e.message ? e.message : "浏览器未提供目录读取权限";
        setDirectoryImportStatus(`读取失败：${message}`, "error");
        showDialog({
          title: "文件夹读取失败",
          message: `无法读取所选文件夹。${message}\n\n你仍可使用“打开文件”选择单个 Markdown。`,
          buttons: [{ text: "好的", primary: true }],
        });
      }
    });
  }

  if (btnRefresh) {
    btnRefresh.addEventListener("click", async () => {
      if (!_dirHandle) return;
      const sequence = ++_directoryImportSequence;
      setDirectoryImportBusy(true);
      setDirectoryImportStatus("正在刷新文件列表...");
      try {
        const files = await refreshResumeList(sequence);
        if (sequence !== _directoryImportSequence) return;
        setDirectoryImportBusy(false);
        setDirectoryImportStatus(`已刷新，共 ${files.length} 个文件。`, "success");
      } catch (e) {
        if (sequence !== _directoryImportSequence) return;
        setDirectoryImportBusy(false);
        console.error("Failed to refresh resume directory:", e);
        setDirectoryImportStatus("刷新目录失败：" + e.message, "error");
      }
    });
  }

  // Try to restore saved handle on startup
  restoreDirHandle();
  renderResumeFileList([], "简历版本", false);
}

/**
 * Try to restore directory handle from IndexedDB on page load.
 * If permission needs re-granting, show a notice in the panel.
 */
async function restoreDirHandle() {
  const sequence = _directoryImportSequence;
  const handle = await loadDirHandle();
  if (!handle || sequence !== _directoryImportSequence) return;

  try {
    // Check current permission state
    const perm = await handle.queryPermission({ mode: "read" });

    if (perm === "granted") {
      _dirHandle = handle;
      await refreshResumeList(sequence);
    } else {
      // Needs user gesture to re-grant — show reauth button
      _dirHandle = handle;
      showReauthNotice(handle);
    }
  } catch {
    // Handle stale or inaccessible — silently ignore
  }
}

/**
 * Show "重新授权" notice in the panel when permission needs re-granting.
 * @param {FileSystemDirectoryHandle} handle
 */
function showReauthNotice(handle) {
  const empty = document.getElementById("panel-empty");
  const dirName = document.getElementById("panel-dir-name");

  if (dirName) {
    dirName.textContent = handle.name;
    dirName.title       = handle.name;
  }

  if (empty) {
    empty.classList.remove("hidden");
    empty.innerHTML = `
      <div style="margin-bottom:8px;color:#6b7280">上次目录：<br><strong>${handle.name}</strong></div>
      <button id="btn-reauth" style="
        padding:5px 10px;font-size:12px;
        background:#2563eb;color:#fff;
        border:none;border-radius:4px;cursor:pointer
      ">重新授权访问</button>
    `;
    const btnReauth = document.getElementById("btn-reauth");
    if (btnReauth) {
      btnReauth.addEventListener("click", async () => {
        try {
          const perm = await handle.requestPermission({ mode: "read" });
          if (perm === "granted") {
            _dirHandle = handle;
            await refreshResumeList();
          }
        } catch (e) {
          showToast("授权失败，请重新选择目录。", "error");
        }
      });
    }
  }

  const btnRefresh = document.getElementById("btn-refresh-dir");
  if (btnRefresh) btnRefresh.hidden = false;
}

/**
 * Read directory and populate the resume list.
 */
async function refreshResumeList(sequence = _directoryImportSequence) {
  if (!_dirHandle) return [];

  // Collect supported candidates recursively, then validate with bounded concurrency.
  const candidates = [];
  await collectResumeFiles(_dirHandle, "", candidates);
  const files = await filterRecognizableResumeFiles(candidates, sequence);

  if (sequence !== _directoryImportSequence) return files;
  renderResumeFileList(files, _dirHandle.name, true);
  return files;
}

async function isRecognizableResumeFile(file, fileName) {
  if (!/\.(?:md|markdown|json)$/i.test(fileName)) return false;
  try {
    const raw = await file.text();
    const validation = /\.json$/i.test(fileName)
      ? importJsonResume(raw, fileName)
      : validateAndBuildState(parseMarkdown(raw), fileName);
    return Boolean(validation.state);
  } catch (e) {
    console.warn(`Skipped unrecognized resume file: ${fileName}`, e);
    return false;
  }
}

async function filterRecognizableResumeFiles(candidates, sequence) {
  const recognized = new Array(candidates.length);
  let nextIndex = 0;
  const workerCount = Math.min(8, candidates.length);

  async function validateNext() {
    while (nextIndex < candidates.length && sequence === _directoryImportSequence) {
      const index = nextIndex++;
      const candidate = candidates[index];
      try {
        const file = await candidate.handle.getFile();
        if (await isRecognizableResumeFile(file, candidate.name)) {
          recognized[index] = candidate;
        }
      } catch (e) {
        console.warn(`Skipped unreadable resume file: ${candidate.name}`, e);
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => validateNext()));
  return recognized.filter(Boolean);
}

function stripDirectoryRoot(path, rootName) {
  const prefix = `${rootName}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

async function ensureDirectoryWritePermission() {
  if (!_dirHandle) return false;
  try {
    let permission = await _dirHandle.queryPermission({ mode: "readwrite" });
    if (permission !== "granted") {
      permission = await _dirHandle.requestPermission({ mode: "readwrite" });
    }
    return permission === "granted";
  } catch (e) {
    console.warn("Failed to request directory write permission:", e);
    return false;
  }
}

function showDirectoryWriteRequired() {
  showDialog({
    title: "需要文件夹写入权限",
    message: "请使用“导入文件夹”重新选择该目录并允许读写，才能覆盖、重命名或删除其中的文件。",
    buttons: [{ text: "好的", primary: true }],
  });
}

async function deleteDirectoryResume(file) {
  if (!file.parentDirectory || !file.entryName) {
    showDirectoryWriteRequired();
    return;
  }
  if (!await ensureDirectoryWritePermission()) {
    showDirectoryWriteRequired();
    return;
  }

  try {
    await file.parentDirectory.removeEntry(file.entryName);
    if (_activeFile === `source:${file.name}`) _activeFile = null;
    try {
      await refreshResumeList();
    } catch (refreshError) {
      console.warn("Failed to refresh after deleting resume file:", refreshError);
    }
    showToast(`已删除“${file.name}”。`, "success");
  } catch (e) {
    console.error("Failed to delete resume file:", e);
    showDialog({
      title: "删除失败",
      message: `无法删除“${file.name}”：${e.message || "未知错误"}`,
      buttons: [{ text: "好的", primary: true }],
    });
  }
}

function confirmDeleteDirectoryResume(file) {
  const fileType = /\.json$/i.test(file.name) ? "JSON" : "Markdown";
  showDialog({
    title: `删除 ${fileType} 文件`,
    message: `确定删除“${file.name}”吗？\n\n确认后将从原目录中永久删除该文件，此操作无法在排版器中撤销。`,
    buttons: [
      { text: "取消" },
      { text: "确认删除", action: () => deleteDirectoryResume(file) },
    ],
  });
}

function renameDirectoryResume(file) {
  if (!file.parentDirectory || !file.entryName) {
    showDirectoryWriteRequired();
    return;
  }

  const extensionMatch = file.entryName.match(/(\.(?:md|markdown|json))$/i);
  const extension = extensionMatch ? extensionMatch[1] : "";
  const baseName = extension ? file.entryName.slice(0, -extension.length) : file.entryName;
  showInputDialog({
    title: "重命名简历文件",
    message: `文件位置：${file.name}`,
    defaultValue: baseName,
    confirmText: "重命名",
    onSubmit: async (name) => {
      const sanitized = sanitizeFileName(name).replace(/\.(?:md|markdown|json)$/i, "");
      const nextEntryName = `${sanitized}${extension}`;
      if (!sanitized || nextEntryName === file.entryName) return;
      if (!await ensureDirectoryWritePermission()) {
        showDirectoryWriteRequired();
        return;
      }

      try {
        try {
          await file.parentDirectory.getFileHandle(nextEntryName);
          showDialog({
            title: "无法重命名",
            message: `同一目录中已存在“${nextEntryName}”。`,
            buttons: [{ text: "好的", primary: true }],
          });
          return;
        } catch (e) {
          if (e.name !== "NotFoundError") throw e;
        }

        const source = await file.handle.getFile();
        const nextHandle = await file.parentDirectory.getFileHandle(nextEntryName, { create: true });
        const writable = await nextHandle.createWritable();
        try {
          await writable.write(source);
          await writable.close();
        } catch (e) {
          try {
            await writable.abort();
          } catch {}
          try {
            await file.parentDirectory.removeEntry(nextEntryName);
          } catch {}
          throw e;
        }
        try {
          await file.parentDirectory.removeEntry(file.entryName);
        } catch (e) {
          try {
            await file.parentDirectory.removeEntry(nextEntryName);
          } catch {}
          throw e;
        }

        const parentPath = file.name.includes("/") ? file.name.slice(0, file.name.lastIndexOf("/") + 1) : "";
        const nextName = `${parentPath}${nextEntryName}`;
        if (_activeFile === `source:${file.name}`) _activeFile = `source:${nextName}`;
        try {
          await refreshResumeList();
        } catch (refreshError) {
          console.warn("Failed to refresh after renaming resume file:", refreshError);
        }
        showToast(`已重命名为“${nextName}”。`, "success");
      } catch (e) {
        console.error("Failed to rename resume file:", e);
        showDialog({
          title: "重命名失败",
          message: `无法重命名“${file.name}”：${e.message || "未知错误"}`,
          buttons: [{ text: "好的", primary: true }],
        });
      }
    },
  });
}

function setDirectoryImportBusy(isBusy) {
  const button = document.getElementById("btn-pick-dir");
  if (!button) return;
  button.disabled = isBusy;
  button.textContent = isBusy ? "正在读取..." : "打开文件夹";
}

function setDirectoryImportStatus(message, level = "info") {
  const status = document.getElementById("panel-import-status");
  if (!status) return;
  if (_directoryStatusTimer) {
    clearTimeout(_directoryStatusTimer);
    _directoryStatusTimer = null;
  }
  status.textContent = message;
  status.dataset.level = level;
  status.hidden = !message;
  if (level === "success") {
    _directoryStatusTimer = setTimeout(() => {
      status.hidden = true;
      _directoryStatusTimer = null;
    }, 5000);
  }
}

/**
 * Render collected resume files in the version panel.
 * @param {Array<{name:string, handle:{getFile:Function}}>} files
 * @param {string} directoryName
 * @param {boolean} canRefresh
 */
function renderResumeFileList(files, directoryName, canRefresh) {
  const list = document.getElementById("resume-list");
  const empty = document.getElementById("panel-empty");
  const dirName = document.getElementById("panel-dir-name");
  const btnRefresh = document.getElementById("btn-refresh-dir");

  _directoryFiles = files;
  _directoryName = directoryName;
  _directoryCanRefresh = canRefresh;

  if (dirName) {
    dirName.textContent = directoryName;
    dirName.title = directoryName;
  }
  if (btnRefresh) btnRefresh.hidden = !canRefresh;

  const pinned = loadPinnedResumes();
  const sortPinnedFirst = (getKey, fallback) => (a, b) => {
    const pinDifference = Number(pinned.has(getKey(b))) - Number(pinned.has(getKey(a)));
    return pinDifference || fallback(a, b);
  };
  const sourceFiles = [...files].sort(sortPinnedFirst(
    (file) => getResumePinKey("source", file.name),
    (a, b) => a.name.localeCompare(b.name, "zh-CN")
  ));
  const legacySnapshots = loadMarkdownSnapshots().sort((a, b) => (
    new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
  ));
  if (list) {
    list.innerHTML = "";
    const appendHeading = (text) => {
      const heading = document.createElement("li");
      heading.className = "resume-list-heading";
      heading.textContent = text;
      list.appendChild(heading);
    };

    if (legacySnapshots.length > 0) appendHeading("旧版副本（打开后请另存为）");
    for (const snapshot of legacySnapshots) {
      const versionKey = `snapshot:${snapshot.id}`;
      const li = document.createElement("li");
      li.className = "resume-list-item resume-list-snapshot" + (versionKey === _activeFile ? " active" : "");
      li.title = snapshot.name;
      li.dataset.versionKey = versionKey;

      const label = document.createElement("span");
      label.textContent = snapshot.name.replace(/\.md$/i, "");
      li.appendChild(label);

      const deleteButton = document.createElement("button");
      deleteButton.className = "resume-list-action resume-list-delete";
      deleteButton.textContent = "×";
      deleteButton.title = "删除旧版副本";
      deleteButton.addEventListener("click", (event) => {
        event.stopPropagation();
        showDialog({
          title: "删除旧版副本",
          message: `确定删除“${snapshot.name}”吗？`,
          buttons: [
            { text: "取消" },
            { text: "删除", action: () => deleteMarkdownSnapshot(snapshot.id) },
          ],
        });
      });
      li.appendChild(deleteButton);

      const handle = {
        getFile: async () => new File([snapshot.markdown], snapshot.name, { type: "text/markdown" }),
      };
      li.addEventListener("click", () => loadResumeFromHandle(snapshot.name, handle, versionKey));
      list.appendChild(li);
    }

    if (sourceFiles.length > 0) appendHeading(directoryName === "当前文件" ? "当前文件" : "文件夹内的简历");
    for (const file of sourceFiles) {
      const { name, handle } = file;
      const displayName = file.entryName || name.split("/").pop() || name;
      const versionKey = `source:${name}`;
      const li = document.createElement("li");
      li.className = "resume-list-item resume-list-source" + (versionKey === _activeFile ? " active" : "");
      li.title = displayName;
      li.dataset.versionKey = versionKey;

      const label = document.createElement("span");
      label.textContent = displayName.replace(/\.(?:md|markdown|json)$/i, "");
      li.appendChild(label);

      const pinKey = getResumePinKey("source", name);
      const isPinned = pinned.has(pinKey);
      li.classList.toggle("pinned", isPinned);
      appendPinButton(li, pinKey, displayName, isPinned);

      if (file.parentDirectory && file.entryName) {
        const renameButton = document.createElement("button");
        renameButton.className = "resume-list-action resume-list-rename";
        renameButton.textContent = "✎";
        renameButton.title = "重命名文件";
        renameButton.setAttribute("aria-label", `重命名 ${displayName}`);
        renameButton.addEventListener("click", (event) => {
          event.stopPropagation();
          renameDirectoryResume(file);
        });
        li.appendChild(renameButton);

        const deleteButton = document.createElement("button");
        deleteButton.className = "resume-list-action resume-list-delete";
        deleteButton.textContent = "×";
        deleteButton.title = /\.json$/i.test(name) ? "删除 JSON 文件" : "删除 Markdown 文件";
        deleteButton.setAttribute("aria-label", `删除 ${displayName}`);
        deleteButton.addEventListener("click", (event) => {
          event.stopPropagation();
          confirmDeleteDirectoryResume(file);
        });
        li.appendChild(deleteButton);
      }

      li.addEventListener("click", () => loadResumeFromHandle(name, handle, versionKey, file));
      list.appendChild(li);
    }
  }

  if (empty) {
    const hasVersions = sourceFiles.length > 0 || legacySnapshots.length > 0;
    empty.textContent = hasVersions ? "" : "暂无导入文件";
    empty.classList.toggle("hidden", hasVersions);
  }
}

/**
 * Recursively collect Markdown and JSON candidates for resume validation.
 * @param {FileSystemDirectoryHandle} directory
 * @param {string} prefix
 * @param {Array<{name:string, handle:FileSystemFileHandle, parentDirectory:FileSystemDirectoryHandle, entryName:string}>} files
 */
async function collectResumeFiles(directory, prefix, files) {
  for await (const [name, handle] of directory.entries()) {
    if (name.startsWith(".")) continue;
    const relativeName = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "file" && /\.(?:md|markdown|json)$/i.test(name)) {
      files.push({ name: relativeName, handle, parentDirectory: directory, entryName: name });
    } else if (handle.kind === "directory") {
      await collectResumeFiles(handle, relativeName, files);
    }
  }
}

/**
 * Load a supported resume file from a FileSystemFileHandle.
 * @param {string} name
 * @param {FileSystemFileHandle} handle
 */
async function loadResumeFromHandle(name, handle, versionKey = name, sourceDescriptor = null) {
  // Warn if dirty
  if (isDirty()) {
    const confirmed = await new Promise((resolve) => {
      showDialog({
        title: "有未保存的修改",
        message: "切换简历将丢失当前未保存的修改，是否继续？",
        buttons: [
          { text: "取消",    action: () => resolve(false) },
          { text: "继续切换", primary: true, action: () => resolve(true) },
        ],
      });
    });
    if (!confirmed) return false;
  }

  try {
    const file = await handle.getFile();
    const text = await file.text();

    const isJson = /\.json$/i.test(name);
    const validation = isJson
      ? importJsonResume(text, name)
      : validateAndBuildState(parseMarkdown(text), name);

    if (validation.state) {
      const sourceFile = sourceDescriptor || _directoryFiles.find((item) => item.name === name);
      await hydrateReferencedPhoto(validation.state, sourceFile || { handle });
      setState(validation.state);
      renderResume(validation.state);
      updateA4Status();
      clearDirty();

      // Mark active
      _activeFile = versionKey;
      _activeSourceFile = sourceFile || { name, entryName: name.split("/").pop() || name, handle };
      document.querySelectorAll(".resume-list-item").forEach((li) => {
        li.classList.toggle("active", li.dataset.versionKey === versionKey);
      });
      return true;

    } else {
      const errs = validation.errors
        .filter((e) => e.level === "error")
        .map((e) => e.message)
        .join("\n");
      showDialog({ title: `${isJson ? "JSON" : "Markdown"} 导入失败`, message: errs, buttons: [{ text: "好的", primary: true }] });
      return false;
    }
  } catch (e) {
    console.error(e);
    const missing = e && (e.name === "NotFoundError" || /not found|不存在/i.test(e.message || ""));
    const denied = e && (e.name === "NotAllowedError" || e.name === "SecurityError");

    if (missing && _dirHandle) {
      try {
        await refreshResumeList();
      } catch (refreshError) {
        console.warn("Failed to refresh after missing file:", refreshError);
      }
    }

    showDialog({
      title: missing ? "文件已变化" : denied ? "需要重新授权" : "文件打开失败",
      message: missing
        ? `“${name}”已被移动、重命名或删除，右侧文件列表已刷新，请选择新的文件名。`
        : denied
          ? "浏览器已失去该目录的读取权限，请从顶部“打开”菜单重新选择文件夹。"
          : `无法打开“${name}”：${e.message || "未知错误"}`,
      buttons: [{ text: "好的", primary: true }],
    });
    return false;
  }
}

/** Load a photo declared in Markdown from the same private directory. */
async function hydrateReferencedPhoto(state, sourceFile) {
  const reference = String(state.photo && state.photo.source || "").trim();
  if (!reference) return;

  try {
    let photoFile = null;
    if (sourceFile && sourceFile.parentDirectory && !reference.includes("/")) {
      const photoHandle = await sourceFile.parentDirectory.getFileHandle(reference);
      photoFile = await photoHandle.getFile();
    } else if (sourceFile && sourceFile.relatedFiles) {
      const sourcePath = sourceFile.name || "";
      const basePath = sourcePath.includes("/") ? sourcePath.slice(0, sourcePath.lastIndexOf("/") + 1) : "";
      photoFile = sourceFile.relatedFiles.get(basePath + reference) || null;
    }
    if (!photoFile) throw new Error("请通过“打开文件夹”打开母版，以授权读取同目录照片。");
    const photo = await buildPhotoStateFromFile(photoFile, state.photo);
    photo.source = reference;
    state.photo = photo;
  } catch (error) {
    showToast(`未能自动载入照片“${reference}”：${error.message || "文件不可读"}`, "warning");
  }
}

/**
 * Initialize theme switcher.
 */
function initThemeSwitcher() {
  const btnA = document.getElementById("btn-theme-a");
  const btnB = document.getElementById("btn-theme-b");
  const btnC = document.getElementById("btn-theme-c");
  const btnD = document.getElementById("btn-theme-d");
  const themeLabel = document.getElementById("current-theme-label");
  const themeMenu = document.getElementById("theme-menu");
  const page = document.getElementById("resume-page");
  if (!btnA || !btnB || !page) return;

  function setTheme(theme) {
    applyThemeVisual(theme);
    if (themeMenu) themeMenu.open = false;
    // Re-render header to reflect theme-specific contact format
    const state = getState();
    if (!state.layout) state.layout = {};
    if (state.layout.theme !== theme) {
      state.layout.theme = theme;
      markDirty();
    }
    if (typeof applyPhotoFrameSize === "function") applyPhotoFrameSize(state.photo);
    if (state.sections && state.sections.length > 0) {
      renderResume(state);
    }
  }

  btnA.addEventListener("click", () => setTheme("a"));
  btnB.addEventListener("click", () => setTheme("b"));
  if (btnC) btnC.addEventListener("click", () => setTheme("c"));
  if (btnD) btnD.addEventListener("click", () => setTheme("d"));
}

function initToolbarMenus() {
  const menus = Array.from(document.querySelectorAll(".toolbar-menu"));

  menus.forEach((menu) => {
    menu.addEventListener("toggle", () => {
      if (!menu.open) return;
      menus.forEach((other) => {
        if (other !== menu) other.open = false;
      });
    });
  });

  menus.forEach((menu) => {
    menu.querySelectorAll("button").forEach((button) => {
      button.addEventListener("click", () => { menu.open = false; });
    });
  });

  document.addEventListener("click", (event) => {
    menus.forEach((menu) => {
      if (!menu.contains(event.target)) menu.open = false;
    });
  });
}


function closeDialog() {
  const root = document.getElementById("dialog-root");
  if (!root) return;
  root.innerHTML = "";
  root.classList.remove("active");
}

/**
 * JSON import initialization.
 * Wires up JSON import buttons and file input.
 */
function initJsonTools() {
  const btnShowJsonExample = document.getElementById("btn-show-json-example");

  if (btnShowJsonExample) btnShowJsonExample.addEventListener("click", handleShowJsonExample);

  // 4 conversion prompt buttons
  const btnPdfToMd = document.getElementById("btn-copy-pdf-to-md");
  const btnPdfToJson = document.getElementById("btn-copy-pdf-to-json");
  const btnDocxToMd = document.getElementById("btn-copy-docx-to-md");
  const btnDocxToJson = document.getElementById("btn-copy-docx-to-json");

  if (btnPdfToMd) btnPdfToMd.addEventListener("click", () => handleCopyPrompt(PROMPT_PDF_TO_MD, btnPdfToMd));
  if (btnPdfToJson) btnPdfToJson.addEventListener("click", () => handleCopyPrompt(PROMPT_PDF_TO_JSON, btnPdfToJson));
  if (btnDocxToMd) btnDocxToMd.addEventListener("click", () => handleCopyPrompt(PROMPT_DOCX_TO_MD, btnDocxToMd));
  if (btnDocxToJson) btnDocxToJson.addEventListener("click", () => handleCopyPrompt(PROMPT_DOCX_TO_JSON, btnDocxToJson));

}

function initMarkdownTools() {
  const btnShowMdExample = document.getElementById("btn-show-md-example");

  if (btnShowMdExample) btnShowMdExample.addEventListener("click", handleShowMdExample);
}

function handlePasteMarkdown() {
  _proceedWithDirtyCheck(() => {
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
    box.style.maxWidth = "600px";

    const titleEl = document.createElement("h3");
    titleEl.className = "dialog-title";
    titleEl.textContent = "粘贴 Markdown";
    box.appendChild(titleEl);

    const msgEl = document.createElement("p");
    msgEl.className = "dialog-message";
    msgEl.textContent = "将简历 Markdown 粘贴到下方文本框。";
    box.appendChild(msgEl);

    const textarea = document.createElement("textarea");
    textarea.className = "dialog-input";
    textarea.style.width = "100%";
    textarea.style.minHeight = "300px";
    textarea.style.fontFamily = "monospace";
    textarea.style.fontSize = "12px";
    textarea.placeholder = "在此粘贴 Markdown...";
    box.appendChild(textarea);

    const exampleLink = document.createElement("a");
    exampleLink.textContent = "填入示例 Markdown";
    exampleLink.href = "#";
    exampleLink.style.display = "block";
    exampleLink.style.marginTop = "6px";
    exampleLink.style.fontSize = "12px";
    exampleLink.addEventListener("click", (e) => {
      e.preventDefault();
      textarea.value = MARKDOWN_EXAMPLE;
    });
    box.appendChild(exampleLink);

    const actions = document.createElement("div");
    actions.className = "dialog-actions";

    const clearBtn = document.createElement("button");
    clearBtn.className = "dialog-btn";
    clearBtn.textContent = "清空";
    clearBtn.addEventListener("click", () => { textarea.value = ""; });
    actions.appendChild(clearBtn);

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "dialog-btn";
    cancelBtn.textContent = "取消";
    cancelBtn.addEventListener("click", closeDialog);
    actions.appendChild(cancelBtn);

    const importBtn = document.createElement("button");
    importBtn.className = "dialog-btn dialog-btn-primary";
    importBtn.textContent = "导入";
    importBtn.addEventListener("click", () => {
      const raw = textarea.value.trim();
      if (!raw) {
        showToast("请先粘贴 Markdown 内容。", "warning");
        return;
      }
      const parseResult = parseMarkdown(raw);
      const validation = validateAndBuildState(parseResult, "粘贴的 Markdown");
      closeDialog();
      if (validation.state) {
        setState(validation.state);
        renderResume(validation.state);
        updateA4Status();
        detachActiveSource();
        clearDirty();
      } else {
        const errorMsgs = validation.errors
          .filter((err) => err.level === "error")
          .map((err) => err.message);
        showDialog({
          title: "Markdown 导入失败",
          message: errorMsgs.join("\n") || "无法解析该 Markdown。",
          buttons: [{ text: "关闭", primary: true }],
        });
      }
    });
    actions.appendChild(importBtn);

    box.appendChild(actions);
    root.appendChild(box);
    setTimeout(() => textarea.focus(), 50);
  });
}

function handleShowMdExample() {
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
  box.style.maxWidth = "600px";

  const titleEl = document.createElement("h3");
  titleEl.className = "dialog-title";
  titleEl.textContent = "Markdown 示例（Schema v1）";
  box.appendChild(titleEl);

  const pre = document.createElement("pre");
  pre.style.whiteSpace = "pre-wrap";
  pre.style.wordBreak = "break-all";
  pre.style.fontFamily = "monospace";
  pre.style.fontSize = "12px";
  pre.style.maxHeight = "400px";
  pre.style.overflow = "auto";
  pre.style.background = "var(--bg-secondary, #f5f5f5)";
  pre.style.padding = "8px";
  pre.style.borderRadius = "4px";
  pre.textContent = MARKDOWN_EXAMPLE;
  box.appendChild(pre);

  const actions = document.createElement("div");
  actions.className = "dialog-actions";

  const closeBtn = document.createElement("button");
  closeBtn.className = "dialog-btn";
  closeBtn.textContent = "关闭";
  closeBtn.addEventListener("click", closeDialog);
  actions.appendChild(closeBtn);

  const copyBtn = document.createElement("button");
  copyBtn.className = "dialog-btn dialog-btn-primary";
  copyBtn.textContent = "复制示例";
  copyBtn.addEventListener("click", () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      showToast("当前浏览器不支持自动复制。", "warning");
      return;
    }
    navigator.clipboard.writeText(MARKDOWN_EXAMPLE).then(() => {
      showToast("Markdown 示例已复制。", "success");
      closeDialog();
    }).catch(() => {
      showToast("复制失败，请手动复制。", "error");
    });
  });
  actions.appendChild(copyBtn);

  box.appendChild(actions);
  root.appendChild(box);
}

/**
 * Check if current state is dirty and confirm before proceeding.
 * @param {Function} onProceed
 */
function _proceedWithDirtyCheck(onProceed) {
  if (!isDirty()) {
    onProceed();
    return;
  }
  showDialog({
    title: "有未保存的修改",
    message: "当前简历有未保存的修改，导入新内容将覆盖。是否继续？",
    buttons: [
      { text: "取消" },
      { text: "继续导入", primary: true, action: onProceed },
    ],
  });
}

/**
 * Handle "粘贴 JSON" button — show dialog with textarea.
 */
function handlePasteJson() {
  _proceedWithDirtyCheck(() => {
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
    box.style.maxWidth = "600px";

    const titleEl = document.createElement("h3");
    titleEl.className = "dialog-title";
    titleEl.textContent = "粘贴 JSON";
    box.appendChild(titleEl);

    const msgEl = document.createElement("p");
    msgEl.className = "dialog-message";
    msgEl.textContent = "将简历 JSON 粘贴到下方文本框，支持带 ```json 代码块标记。";
    box.appendChild(msgEl);

    const textarea = document.createElement("textarea");
    textarea.className = "dialog-input";
    textarea.style.width = "100%";
    textarea.style.minHeight = "300px";
    textarea.style.fontFamily = "monospace";
    textarea.style.fontSize = "12px";
    textarea.placeholder = "在此粘贴 JSON...";
    box.appendChild(textarea);

    const exampleLink = document.createElement("a");
    exampleLink.textContent = "填入示例 JSON";
    exampleLink.href = "#";
    exampleLink.style.display = "block";
    exampleLink.style.marginTop = "6px";
    exampleLink.style.fontSize = "12px";
    exampleLink.addEventListener("click", (e) => {
      e.preventDefault();
      textarea.value = JSON_EXAMPLE;
    });
    box.appendChild(exampleLink);

    const actions = document.createElement("div");
    actions.className = "dialog-actions";

    const clearBtn = document.createElement("button");
    clearBtn.className = "dialog-btn";
    clearBtn.textContent = "清空";
    clearBtn.addEventListener("click", () => {
      textarea.value = "";
    });
    actions.appendChild(clearBtn);

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "dialog-btn";
    cancelBtn.textContent = "取消";
    cancelBtn.addEventListener("click", closeDialog);
    actions.appendChild(cancelBtn);

    const importBtn = document.createElement("button");
    importBtn.className = "dialog-btn dialog-btn-primary";
    importBtn.textContent = "导入";
    importBtn.addEventListener("click", () => {
      const raw = textarea.value.trim();
      if (!raw) {
        showToast("请先粘贴 JSON 内容。", "warning");
        return;
      }
      const result = importJsonResume(raw, "粘贴的 JSON");
      closeDialog();
      handleJsonImportResult(result, "粘贴的 JSON", raw);
    });
    actions.appendChild(importBtn);

    box.appendChild(actions);
    root.appendChild(box);
    setTimeout(() => textarea.focus(), 50);
  });
}

/**
 * Handle .json file import.
 * @param {File} file
 * @param {HTMLInputElement} fileInput
 */
function handleImportJsonFile(file, fileInput) {
  _proceedWithDirtyCheck(() => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const raw = e.target.result;
      const result = importJsonResume(raw, file.name);
      handleJsonImportResult(result, file.name, raw);
    };
    reader.onerror = () => {
      showToast("文件读取失败，请重试。", "error");
    };
    reader.readAsText(file);
    if (fileInput) fileInput.value = "";
  });
}

/**
 * Copy AI conversion prompt to clipboard.
 */
function handleCopyAiPrompt() {
  // Deprecated — replaced by handleCopyPrompt
}

function handleCopyPrompt(promptText, sourceButton) {
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    showToast("当前浏览器不支持自动复制，请手动复制。", "warning");
    return;
  }
  navigator.clipboard.writeText(promptText).then(() => {
    const label = document.getElementById("prompt-menu-label");
    const originalButtonText = sourceButton ? sourceButton.textContent : "";
    if (sourceButton) sourceButton.textContent = "已复制";
    if (label) label.textContent = "已复制";
    setTimeout(() => {
      if (sourceButton) sourceButton.textContent = originalButtonText;
      if (label) label.textContent = "转换提示词";
    }, 1200);
  }).catch(() => {
    showToast("复制失败，请手动复制。", "error");
  });
}

/**
 * Show JSON example dialog.
 */
function handleShowJsonExample() {
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
  box.style.maxWidth = "600px";

  const titleEl = document.createElement("h3");
  titleEl.className = "dialog-title";
  titleEl.textContent = "JSON 示例";
  box.appendChild(titleEl);

  const pre = document.createElement("pre");
  pre.style.whiteSpace = "pre-wrap";
  pre.style.wordBreak = "break-all";
  pre.style.fontFamily = "monospace";
  pre.style.fontSize = "12px";
  pre.style.maxHeight = "400px";
  pre.style.overflow = "auto";
  pre.style.background = "var(--bg-secondary, #f5f5f5)";
  pre.style.padding = "8px";
  pre.style.borderRadius = "4px";
  pre.textContent = JSON_EXAMPLE;
  box.appendChild(pre);

  const actions = document.createElement("div");
  actions.className = "dialog-actions";

  const closeBtn = document.createElement("button");
  closeBtn.className = "dialog-btn";
  closeBtn.textContent = "关闭";
  closeBtn.addEventListener("click", closeDialog);
  actions.appendChild(closeBtn);

  const copyBtn = document.createElement("button");
  copyBtn.className = "dialog-btn dialog-btn-primary";
  copyBtn.textContent = "复制示例";
  copyBtn.addEventListener("click", () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      showToast("当前浏览器不支持自动复制。", "warning");
      return;
    }
    navigator.clipboard.writeText(JSON_EXAMPLE).then(() => {
      showToast("JSON 示例已复制。", "success");
      closeDialog();
    }).catch(() => {
      showToast("复制失败，请手动复制。", "error");
    });
  });
  actions.appendChild(copyBtn);

  box.appendChild(actions);
  root.appendChild(box);
}

/**
 * Handle JSON import result — success or failure.
 * @param {{ errors: object[], state: object|null }} result
 * @param {string} fileName
 * @param {string} [rawJson]
 */
function handleJsonImportResult(result, fileName, rawJson) {
  if (result.state) {
    setState(result.state);
    renderResume(result.state);
    updateA4Status();
    detachActiveSource();
    clearDirty();
  } else {
    const errorMsgs = result.errors
      .filter((err) => err.level === "error")
      .map((err) => err.message);

    showDialog({
      title: "JSON 导入失败",
      message: errorMsgs.join("\n") || "无法解析该 JSON 文件。",
      buttons: [
        { text: "关闭" },
        {
          text: "复制修复 Prompt",
          primary: true,
          action: () => {
            const prompt = buildFixPrompt(result.errors, rawJson || "", !!rawJson);
            if (typeof navigator === "undefined" || !navigator.clipboard) {
              showToast("当前浏览器不支持自动复制。", "warning");
              return;
            }
            navigator.clipboard.writeText(prompt).then(() => {
              showToast("修复 Prompt 已复制到剪贴板。", "success");
            }).catch(() => {
              showToast("复制失败，请手动复制。", "error");
            });
          },
        },
      ],
    });
  }
}
