import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const sourceFiles = [
  "src/js/utils.js",
  "src/js/state.js",
  "src/js/parser.js",
  "src/js/json-importer.js",
  "src/js/validator.js",
  "src/js/exporter.js",
  "src/js/app.js",
];

function createTestContext() {
  const context = vm.createContext({
    console,
    crypto: globalThis.crypto,
    structuredClone,
    Date,
    Math,
    setTimeout,
    clearTimeout,
    localStorage: { getItem: () => null, setItem() {} },
  });
  context.window = context;
  context.document = {
    activeElement: null,
    addEventListener() {},
    getElementById: () => null,
    querySelectorAll: () => [],
  };
  for (const source of sourceFiles) {
    vm.runInContext(readFileSync(new URL(source, root), "utf8"), context, { filename: source });
  }
  vm.runInContext(`
    isDirty = () => false;
    clearDirty = () => {};
    renderResume = () => {};
    updateA4Status = () => {};
    updateStatusInfo = () => {};
    renderResumeFileList = (files, name) => {
      _directoryFiles = files;
      _directoryName = name;
      _directoryCanRefresh = false;
    };
    setDirectoryImportStatus = () => {};
    showToast = () => {};
    showDialog = (value) => { window.lastDialog = value; };
  `, context);
  return context;
}

function createWritableHandle(name, initialText = "") {
  let text = initialText;
  let writes = 0;
  return {
    name,
    get writes() { return writes; },
    get text() { return text; },
    queryPermission: async () => "granted",
    requestPermission: async () => "granted",
    getFile: async () => ({ text: async () => text }),
    createWritable: async () => ({
      write: async (next) => { text = String(next); writes += 1; },
      close: async () => {},
      abort: async () => {},
    }),
  };
}

test("打开单个 Markdown 后保存覆盖原文件，另存为后切换到新文件", async () => {
  const context = createTestContext();
  const originalMarkdown = readFileSync(new URL("fixtures/valid/sample-resume.md", root), "utf8");
  const originalHandle = createWritableHandle("sample-resume.md", originalMarkdown);
  const copyHandle = createWritableHandle("sample-resume-副本.md");
  context.originalHandle = originalHandle;
  context.copyHandle = copyHandle;
  context.showOpenFilePicker = async () => [originalHandle];
  context.showSaveFilePicker = async () => copyHandle;

  await vm.runInContext("openMarkdownFile({ click() {} })", context);
  assert.equal(vm.runInContext("getActiveSourceFile().handle === originalHandle", context), true);

  vm.runInContext("getState().profile.headline = '保存覆盖验证'", context);
  await vm.runInContext("handleSave()", context);
  assert.equal(originalHandle.writes, 1);
  assert.match(originalHandle.text, /headline: 保存覆盖验证/);

  await vm.runInContext("handleSaveAs()", context);
  assert.equal(copyHandle.writes, 1);
  assert.equal(vm.runInContext("getActiveSourceFile().handle === copyHandle", context), true);

  vm.runInContext("getState().profile.headline = '副本后续保存验证'", context);
  await vm.runInContext("handleSave()", context);
  assert.equal(originalHandle.writes, 1);
  assert.equal(copyHandle.writes, 2);
  assert.match(copyHandle.text, /headline: 副本后续保存验证/);
});
