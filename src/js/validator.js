/**
 * Validator module.
 * Validates supported Markdown schemas and builds a Resume State.
 */

/** @type {string[]} */
const REQUIRED_FRONTMATTER_FIELDS = [
  "schema_version",
  "resume_name",
  "name",
  "phone",
  "email",
];

/** @type {string[]} */
const OPTIONAL_FRONTMATTER_FIELDS = [
  "headline",
  "location",
  "website",
  "portfolio",
  "github",
  "photo",
  "resume_formatter_state",
];

const FORMATTER_STATE_FIELD = "resume_formatter_state";

/**
 * @typedef {object} ValidationResult
 * @property {object[]} errors - Validation errors/warnings/infos
 * @property {object|null} state - Generated Resume State, null if fatal errors
 */

/**
 * Validate a parsed Markdown result and produce a Resume State.
 * @param {object} parseResult - Output from parseMarkdown()
 * @param {string} fileName - Original Markdown file name
 * @returns {ValidationResult}
 */
function validateAndBuildState(parseResult, fileName) {
  const errors = [...(parseResult.errors || [])];
  const frontmatter = parseResult.frontmatter || {};
  const sections = parseResult.sections || [];

  // 1. Validate schema_version
  const schemaVersion = parseInt(frontmatter.schema_version, 10);
  if (!frontmatter.schema_version || frontmatter.schema_version === "") {
    errors.push({
      level: "error",
      code: "MISSING_SCHEMA_VERSION",
      message: "缺少 schema_version 字段。",
      line: frontmatter._startLine + 1,
      suggestion: "请在 Frontmatter 中添加 schema_version: 1。",
    });
  } else if (![1, 2].includes(schemaVersion)) {
    errors.push({
      level: "error",
      code: "UNSUPPORTED_SCHEMA_VERSION",
      message: `不支持的 schema_version：${frontmatter.schema_version}，当前支持版本 1 和 2。`,
      line: frontmatter._startLine + 1,
      suggestion: "请将 schema_version 修改为 2。",
    });
  }

  // 2. Validate required frontmatter fields
  for (const field of REQUIRED_FRONTMATTER_FIELDS) {
    if (!frontmatter[field] || frontmatter[field] === "") {
      errors.push({
        level: "error",
        code: "MISSING_REQUIRED_FIELD",
        field,
        message: `缺少必填字段：${field}。`,
        line: frontmatter._startLine + 1,
        suggestion: `请在 Frontmatter 中添加 ${field}。`,
      });
    }
  }

  // 3. Validate sections
  let sectionTypesSeen = new Set();
  for (const section of sections) {
    if (section.type !== "custom" && sectionTypesSeen.has(section.type)) {
      errors.push({
        level: "warning",
        code: "DUPLICATE_SECTION",
        section: section.type,
        message: `栏目 "${section.type}" 重复。`,
        line: section.line,
        suggestion: "第一个之外的重复栏目将被保留但可能导致排版问题。",
      });
    }
    if (section.type !== "custom") sectionTypesSeen.add(section.type);

    if (section.type === "custom") {
      if (!section.title) {
        errors.push({
          level: "error",
          code: "MISSING_SECTION_TITLE",
          message: "自定义栏目缺少标题。",
          line: section.line,
          suggestion: "请使用 ## 栏目名称。",
        });
      }
      continue;
    }

    for (const entry of (section.entries || [])) {
      // Validate entry fields
      if (section.type !== "skills" && !entry.name) {
        errors.push({
          level: "error",
          code: "MISSING_ENTRY_NAME",
          section: section.type,
          message: `${section.type} 栏目下存在未命名的条目。`,
          line: entry.line,
          suggestion: "请为条目添加名称（### 名称）。",
        });
      }

      if (["education", "experience"].includes(section.type)) {
        if (!entry.role) {
          errors.push({
            level: "error",
            code: "MISSING_ROLE",
            section: section.type,
            entry: entry.name,
            message: `${section.type} 栏目下"${entry.name}"缺少 role 字段。`,
            line: entry.line,
            suggestion: `请在该条目中增加 role: 信息。`,
          });
        }
        if (!entry.date) {
          errors.push({
            level: "error",
            code: "MISSING_DATE",
            section: section.type,
            entry: entry.name,
            message: `${section.type} 栏目下"${entry.name}"缺少 date 字段。`,
            line: entry.line,
            suggestion: `请在该条目中增加 date: 时间范围。`,
          });
        }
      }

      if (section.type === "projects") {
        if (!entry.role) {
          errors.push({
            level: "warning",
            code: "MISSING_PROJECT_ROLE",
            section: "projects",
            entry: entry.name,
            message: `projects 栏目下"${entry.name}"缺少 role 字段。`,
            line: entry.line,
            suggestion: "建议添加 role 指明项目角色。",
          });
        }
        if (!entry.date) {
          errors.push({
            level: "warning",
            code: "MISSING_PROJECT_DATE",
            section: "projects",
            entry: entry.name,
            message: `projects 栏目下"${entry.name}"缺少 date 字段。`,
            line: entry.line,
            suggestion: "建议添加 date 指明项目时间。",
          });
        }
      }

      if (["experience", "projects"].includes(section.type) && entry.bullets.length === 0) {
        errors.push({
          level: "warning",
          code: "NO_BULLETS",
          section: section.type,
          entry: entry.name,
          message: `${section.type} 栏目下"${entry.name}"没有 Bullet。`,
          line: entry.line,
          suggestion: "建议添加至少一条经历描述。",
        });
      }
    }
  }

  // Check for error-level issues
  const hasErrors = errors.some((e) => e.level === "error");

  // Build state (even with errors — the caller decides whether to use it)
  const state = buildState(frontmatter, sections, fileName);
  const formatterState = parseFormatterFileState(frontmatter[FORMATTER_STATE_FIELD]);
  if (frontmatter[FORMATTER_STATE_FIELD] && !formatterState) {
    errors.push({
      level: "warning",
      code: "INVALID_FORMATTER_STATE",
      message: "文件中的排版设置无法识别，已使用默认排版。",
      line: frontmatter._startLine + 1,
    });
  } else if (formatterState) {
    applyFormatterFileState(state, formatterState);
    state.importSnapshot = createImportSnapshot(state);
  }

  // Generate info summary
  const summaryItems = [];
  const eduCount = sections.find((s) => s.type === "education")?.entries?.length || 0;
  const expCount = sections.find((s) => s.type === "experience")?.entries?.length || 0;
  const projCount = sections.find((s) => s.type === "projects")?.entries?.length || 0;
  const skillCount = sections.find((s) => s.type === "skills")?.entries?.[0]?.bullets?.length || 0;
  const customCount = sections.filter((s) => s.type === "custom").length;

  if (eduCount > 0) summaryItems.push(`${eduCount} 条教育经历`);
  if (expCount > 0) summaryItems.push(`${expCount} 条工作经历`);
  if (projCount > 0) summaryItems.push(`${projCount} 个项目`);
  if (skillCount > 0) summaryItems.push(`${skillCount} 条技能`);
  if (customCount > 0) summaryItems.push(`${customCount} 个自定义栏目`);

  const errorCount = errors.filter((e) => e.level === "error").length;
  const warningCount = errors.filter((e) => e.level === "warning").length;

  errors.push({
    level: "info",
    code: "IMPORT_SUMMARY",
    message: `已导入：${fileName}。识别到：${summaryItems.join("、") || "无内容"}。存在：${errorCount} 个错误、${warningCount} 个警告。`,
  });

  return { errors, state: hasErrors ? null : state };
}

function parseFormatterFileState(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(String(raw)));
    return parsed && parsed.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

function applyFormatterFileState(state, formatterState) {
  const sectionStates = Array.isArray(formatterState.sections) ? formatterState.sections : [];
  (state.sections || []).forEach((section, sectionIndex) => {
    const savedSection = sectionStates[sectionIndex];
    if (!savedSection || typeof savedSection !== "object") return;
    section.id = restoreFormatterId(savedSection.id, section.id);
    if (Number.isFinite(Number(savedSection.spacingBefore))) {
      section.spacingBefore = Math.max(0, Math.min(100, Number(savedSection.spacingBefore)));
    }
    restoreEntryPresentations(section.entries, savedSection.entries);
    (section.blocks || []).forEach((block, blockIndex) => {
      const savedBlock = Array.isArray(savedSection.blocks) ? savedSection.blocks[blockIndex] : null;
      if (!savedBlock || savedBlock.type !== block.type) return;
      block.id = restoreFormatterId(savedBlock.id, block.id);
      restoreBulletPresentations(block.bullets, savedBlock.bullets);
    });
  });

  const savedLayout = formatterState.layout && typeof formatterState.layout === "object"
    ? formatterState.layout
    : {};
  state.layout.fontSize = restoreNumber(savedLayout.fontSize, state.layout.fontSize, 7, 12);
  state.layout.lineHeight = restoreNumber(savedLayout.lineHeight, state.layout.lineHeight, 1.15, 1.8);
  state.layout.headerOffsetY = restoreNumber(savedLayout.headerOffsetY, state.layout.headerOffsetY, -8, 8);
  state.layout.theme = ["a", "b", "c", "d"].includes(savedLayout.theme) ? savedLayout.theme : "a";
  restoreBlockFormatting(state, savedLayout);

  const savedPhoto = formatterState.photo && typeof formatterState.photo === "object"
    ? formatterState.photo
    : {};
  state.photo.scale = restoreNumber(savedPhoto.scale, state.photo.scale, 0.1, 4);
  state.photo.frameScale = restoreNumber(savedPhoto.frameScale, state.photo.frameScale, 0.4, 2);
  state.photo.frameOffsetX = restoreNumber(savedPhoto.frameOffsetX, state.photo.frameOffsetX, -100, 100);
  state.photo.frameOffsetY = restoreNumber(savedPhoto.frameOffsetY, state.photo.frameOffsetY, -100, 100);
  state.photo.offsetX = restoreNumber(savedPhoto.offsetX, state.photo.offsetX, -10000, 10000);
  state.photo.offsetY = restoreNumber(savedPhoto.offsetY, state.photo.offsetY, -10000, 10000);
}

function restoreEntryPresentations(entries, savedEntries) {
  (entries || []).forEach((entry, index) => {
    const savedEntry = Array.isArray(savedEntries) ? savedEntries[index] : null;
    if (!savedEntry) return;
    entry.id = restoreFormatterId(savedEntry.id, entry.id);
    restoreBulletPresentations(entry.bullets, savedEntry.bullets);
  });
}

function restoreBulletPresentations(bullets, savedBullets) {
  const allowedMarkers = new Set(["none", "disc", "circle", "square", "arrow"]);
  (bullets || []).forEach((bullet, index) => {
    const savedBullet = Array.isArray(savedBullets) ? savedBullets[index] : null;
    if (!savedBullet) return;
    bullet.id = restoreFormatterId(savedBullet.id, bullet.id);
    if (allowedMarkers.has(savedBullet.markerStyle)) bullet.markerStyle = savedBullet.markerStyle;
    if (Array.isArray(savedBullet.fontSizeRanges)) {
      bullet.content = applyFontSizeRanges(bullet.content, savedBullet.fontSizeRanges);
    }
  });
}

function applyFontSizeRanges(tokens, rawRanges) {
  const totalLength = (tokens || []).reduce((sum, token) => sum + String(token.value || "").length, 0);
  const ranges = rawRanges.map((range) => {
    if (!Array.isArray(range) || range.length < 3) return null;
    const start = Math.max(0, Math.min(totalLength, Number(range[0])));
    const end = Math.max(start, Math.min(totalLength, Number(range[1])));
    const delta = Math.max(-2, Math.min(3, Number(range[2])));
    return Number.isFinite(start) && Number.isFinite(end) && Number.isFinite(delta) && end > start
      ? [start, end, delta]
      : null;
  }).filter(Boolean);
  if (ranges.length === 0) return tokens;

  const result = [];
  let tokenStart = 0;
  for (const token of (tokens || [])) {
    const value = String(token.value || "");
    const tokenEnd = tokenStart + value.length;
    const cuts = new Set([tokenStart, tokenEnd]);
    for (const [start, end] of ranges) {
      if (start > tokenStart && start < tokenEnd) cuts.add(start);
      if (end > tokenStart && end < tokenEnd) cuts.add(end);
    }
    const points = [...cuts].sort((a, b) => a - b);
    for (let index = 0; index < points.length - 1; index++) {
      const start = points[index];
      const end = points[index + 1];
      if (end <= start) continue;
      const next = { ...token, value: value.slice(start - tokenStart, end - tokenStart) };
      const range = ranges.find(([rangeStart, rangeEnd]) => start >= rangeStart && end <= rangeEnd);
      if (range) next.fontSizeDelta = range[2];
      else delete next.fontSizeDelta;
      result.push(next);
    }
    tokenStart = tokenEnd;
  }
  return result;
}

function restoreBlockFormatting(state, savedLayout) {
  const allowedKeys = new Set();
  Object.keys(state.profile || {}).forEach((field) => allowedKeys.add(`profile:${field}`));
  for (const section of (state.sections || [])) {
    const entries = [
      ...(section.entries || []),
      ...(section.blocks || []).filter((block) => block.type === "entry"),
    ];
    entries.forEach((entry) => ["name", "role", "date", "location"].forEach((field) => {
      allowedKeys.add(`entry:${entry.id}:${field}`);
    }));
    (section.blocks || []).filter((block) => block.type === "text").forEach((block) => {
      allowedKeys.add(`text:${block.id}:content`);
    });
  }

  const textStyles = {};
  for (const [key, value] of Object.entries(savedLayout.blockTextStyle || {})) {
    if (!allowedKeys.has(key) || !value || typeof value !== "object") continue;
    textStyles[key] = { bold: Boolean(value.bold), italic: Boolean(value.italic) };
  }
  if (Object.keys(textStyles).length > 0) state.layout.blockTextStyle = textStyles;

  const fontSizes = {};
  for (const [key, value] of Object.entries(savedLayout.blockFontSizeDelta || {})) {
    const delta = Number(value);
    if (allowedKeys.has(key) && Number.isFinite(delta)) {
      fontSizes[key] = Math.max(-2, Math.min(3, delta));
    }
  }
  if (Object.keys(fontSizes).length > 0) state.layout.blockFontSizeDelta = fontSizes;
}

function restoreFormatterId(value, fallback) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value) ? value : fallback;
}

function restoreNumber(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

/**
 * Build a Resume State from parsed frontmatter and sections.
 * @param {object} frontmatter
 * @param {object[]} sections
 * @param {string} fileName
 * @returns {object}
 */
function buildState(frontmatter, sections, fileName) {
  const now = new Date().toISOString();
  const state = createDefaultState();

  state.documentId = generateId();
  state.resumeName = frontmatter.resume_name || "";
  state.source.fileName = fileName;
  state.source.importedAt = now;

  state.profile.name = frontmatter.name || "";
  state.profile.headline = frontmatter.headline || "";
  state.profile.location = frontmatter.location || "";
  state.profile.phone = frontmatter.phone || "";
  state.profile.email = frontmatter.email || "";
  state.profile.website = frontmatter.website || "";
  state.profile.portfolio = frontmatter.portfolio || "";
  state.profile.github = frontmatter.github || "";
  state.photo.source = frontmatter.photo || "";

  state.schemaVersion = Number.parseInt(frontmatter.schema_version, 10) || 1;
  state.sections = sections.map((section) => ({
    id: generateId(),
    type: section.type,
    title: section.title || getSectionTitle(section.type),
    blocks: (section.blocks || []).map((block) => buildCustomBlock(block)),
    entries: (section.entries || []).map((entry) => ({
      id: generateId(),
      name: entry.name || "",
      role: entry.role || "",
      date: entry.date || "",
      location: entry.location || "",
      bullets: (entry.bullets || []).map((b) => ({
        id: generateId(),
        content: b.content || [{ type: "text", value: b.raw || "" }],
      })),
    })),
  }));

  touchState(state);
  state.importSnapshot = createImportSnapshot(state);

  return state;
}

function buildCustomBlock(block) {
  if (block.type === "text") {
    return {
      id: generateId(),
      type: "text",
      content: block.content || [{ type: "text", value: "" }],
    };
  }
  if (block.type === "list") {
    return {
      id: generateId(),
      type: "list",
      bullets: (block.bullets || []).map((bullet) => ({
        id: generateId(),
        content: bullet.content || [{ type: "text", value: bullet.raw || "" }],
      })),
    };
  }
  return {
    id: generateId(),
    type: "entry",
    name: block.name || "",
    role: block.role || "",
    date: block.date || "",
    location: block.location || "",
    bullets: (block.bullets || []).map((bullet) => ({
      id: generateId(),
      content: bullet.content || [{ type: "text", value: bullet.raw || "" }],
    })),
  };
}
