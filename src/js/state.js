/**
 * Resume State management module.
 * The Resume State is the single source of truth for all resume data.
 */

/** @type {string} */
const STATE_STORAGE_PREFIX = "resume-formatter:draft:";

/** @type {string} */
const LAST_DOCUMENT_KEY = "resume-formatter:last-document";

/** @type {number} */
const APP_VERSION = "1.1.0";

/** @type {number} */
const SCHEMA_VERSION_1 = 2;

/** @type {string} */
const SECTION_TITLES = {
  education: "教育背景",
  experience: "实习经历",
  projects: "项目经历",
  skills: "技能特长",
};

/**
 * Object.frozen mapping from PRD section keys to display titles.
 * A read‑only lookup.
 */
const SECTION_TITLES_MAP = Object.freeze(Object.assign(
  Object.create(null),
  SECTION_TITLES,
));

/**
 * SECTION_TITLES_MAP 的防御性访问
 * 若 sectionType 未注册则回退到原始英文键
 * @param {string} sectionType
 * @returns {string}
 */
function getSectionTitle(sectionType) {
  return SECTION_TITLES_MAP[sectionType] || sectionType;
}

function applyEntryOrder(section, orderedIds) {
  if (!section || !Array.isArray(section.entries) || !Array.isArray(orderedIds)) return false;
  if (section.entries.length !== orderedIds.length) return false;
  const byId = new Map(section.entries.map((entry) => [entry.id, entry]));
  const reordered = orderedIds.map((id) => byId.get(id));
  if (reordered.some((entry) => !entry)) return false;
  const changed = reordered.some((entry, index) => entry !== section.entries[index]);
  if (changed) section.entries = reordered;
  return changed;
}

function applySectionOrder(state, orderedIds) {
  if (!state || !Array.isArray(state.sections) || !Array.isArray(orderedIds)) return false;
  if (state.sections.length !== orderedIds.length) return false;
  const byId = new Map(state.sections.map((section) => [section.id, section]));
  const reordered = orderedIds.map((id) => byId.get(id));
  if (reordered.some((section) => !section)) return false;
  const changed = reordered.some((section, index) => section !== state.sections[index]);
  if (changed) state.sections = reordered;
  return changed;
}

/**
 * Create a default resume state.
 * @returns {object}
 */
function createDefaultState() {
  return {
    appVersion: APP_VERSION,
    schemaVersion: SCHEMA_VERSION_1,
    documentId: generateId(),
    resumeName: "",
    source: {
      fileName: "",
      importedAt: "",
      rawMarkdownHash: "",
    },
    profile: {
      name: "",
      headline: "",
      location: "",
      phone: "",
      email: "",
      website: "",
      portfolio: "",
      github: "",
    },
    sections: [],
    layout: {
      fontSize: 10,
      lineHeight: 1.57,
      headerOffsetY: 0,
      theme: "a",
    },
    photo: {
      source: "",
      dataUrl: "",
      mimeType: "",
      originalWidth: 0,
      originalHeight: 0,
      scale: 1,
      frameScale: 1,
      frameOffsetX: 0,
      frameOffsetY: 0,
      offsetX: 0,
      offsetY: 0,
    },
    importSnapshot: null,
    metadata: {
      createdAt: "",
      updatedAt: "",
      lastSavedAt: "",
    },
  };
}

/**
 * Get the current Resume State singleton.
 * @returns {object}
 */
function getState() {
  if (!window.__resumeState) {
    window.__resumeState = createDefaultState();
  }
  return window.__resumeState;
}

/**
 * Set a new Resume State (e.g. after import).
 * @param {object} newState
 */
function setState(newState) {
  (newState.sections || []).forEach((section) => {
    if (Number(section.spacingBefore) < 0) section.spacingBefore = 0;
  });
  window.__resumeState = newState;
  if (typeof resetUndoHistory === "function") resetUndoHistory();
}

/**
 * Update the metadata timestamps.
 * @param {object} state
 */
function touchState(state) {
  const now = new Date().toISOString();
  if (!state.metadata.createdAt) {
    state.metadata.createdAt = now;
  }
  state.metadata.updatedAt = now;
}

/**
 * Create an import snapshot from the current state's content-relevant data.
 * @param {object} state
 * @returns {object}
 */
function createImportSnapshot(state) {
  return {
    resumeName: state.resumeName,
    profile: deepClone(state.profile),
    sections: deepClone(state.sections),
  };
}

/**
 * Restore content from an import snapshot (preserves photo).
 * @param {object} state
 * @param {object} snapshot
 */
function restoreImportSnapshot(state, snapshot) {
  if (!snapshot) return;
  state.resumeName = snapshot.resumeName;
  state.profile = deepClone(snapshot.profile);
  state.sections = deepClone(snapshot.sections);
  state.metadata.updatedAt = new Date().toISOString();
}

/**
 * Get the localStorage key for a given draft.
 * @param {string} documentId
 * @returns {string}
 */
function getDraftKey(documentId) {
  return STATE_STORAGE_PREFIX + documentId;
}

/**
 * Save current state to localStorage draft.
 * @param {object} state
 */
function saveDraft(state) {
  try {
    const key = getDraftKey(state.documentId);
    localStorage.setItem(key, JSON.stringify(state));
    localStorage.setItem(LAST_DOCUMENT_KEY, state.documentId);
    return true;
  } catch (e) {
    console.error("Failed to save draft:", e);
    return false;
  }
}

/**
 * Load draft from localStorage.
 * @param {string} documentId
 * @returns {object|null}
 */
function loadDraft(documentId) {
  try {
    const key = getDraftKey(documentId);
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.error("Failed to load draft:", e);
    return null;
  }
}

/**
 * Load embedded state from HTML's <script id="embedded-resume-state">.
 * @returns {object|null}
 */
function loadEmbeddedState() {
  const el = document.getElementById("embedded-resume-state");
  if (!el) return null;
  return safeJsonParse(el.textContent);
}
