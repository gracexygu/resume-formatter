import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const root = new URL("../", import.meta.url);

function createTestContext() {
  const context = vm.createContext({
    console,
    crypto: globalThis.crypto,
    structuredClone,
    Date,
    Math,
    requestAnimationFrame: (callback) => callback(),
    CSS: { escape: (value) => String(value) },
  });
  context.window = context;
  context.document = {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  for (const source of ["src/js/utils.js", "src/js/state.js", "src/js/editor.js"]) {
    vm.runInContext(readFileSync(new URL(source, root), "utf8"), context, { filename: source });
  }
  vm.runInContext(`
    renderHeader = () => {};
    updateA4Status = () => {};
  `, context);
  return context;
}

test("求职方向和期望城市可以分别删除和恢复", () => {
  const context = createTestContext();
  vm.runInContext(`
    const preferenceTestState = createDefaultState();
    preferenceTestState.profile.headline = "产品经理";
    preferenceTestState.profile.location = "上海";
    preferenceTestState.layout = {
      preferenceVisible: true,
      contactBreakBefore: ["headline", "location"],
      blockLinks: {
        "profile:headline": [{ start: 0, end: 4, href: "https://example.com/headline" }],
        "profile:location": [{ start: 0, end: 2, href: "https://example.com/location" }],
      },
    };
    setState(preferenceTestState);
    removePreferenceField("headline");
  `, context);

  let state = JSON.parse(vm.runInContext("JSON.stringify(getState())", context));
  assert.equal(state.profile.headline, "");
  assert.equal(state.layout.headlineVisible, false);
  assert.equal(state.layout.locationVisible, true);
  assert.equal(state.profile.location, "上海");
  assert.deepEqual(state.layout.contactBreakBefore, ["location"]);
  assert.equal(state.layout.blockLinks["profile:headline"], undefined);
  assert.ok(state.layout.blockLinks["profile:location"]);

  vm.runInContext(`
    addPreferenceField("headline");
    getState().profile.headline = "产品经理";
    removePreferenceField("location");
  `, context);
  state = JSON.parse(vm.runInContext("JSON.stringify(getState())", context));
  assert.equal(state.layout.headlineVisible, true);
  assert.equal(state.profile.headline, "产品经理");
  assert.equal(state.profile.location, "");
  assert.equal(state.layout.locationVisible, false);
  assert.equal(state.layout.preferenceVisible, true);
});
