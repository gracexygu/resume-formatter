/**
 * Exporter module.
 * Handles "Save as HTML" and PDF export.
 */

/**
 * Serialize Resume State to Schema v2 Markdown.
 * @param {object} state
 * @returns {string}
 */
function serializeStateToMarkdown(state) {
  const cleanScalar = (value) => String(value || "").replace(/[\r\n]+/g, " ").trim();
  const formatterState = encodeURIComponent(JSON.stringify(createFormatterFileState(state)));
  const lines = ["---", "schema_version: 2"];
  const frontmatter = [
    ["resume_name", state.resumeName],
    ["name", state.profile.name],
    ["headline", state.profile.headline],
    ["location", state.profile.location],
    ["phone", state.profile.phone],
    ["email", state.profile.email],
    ["website", state.profile.website],
    ["portfolio", state.profile.portfolio],
    ["github", state.profile.github],
    ["photo", state.photo && state.photo.source],
    [FORMATTER_STATE_FIELD, formatterState],
  ];

  frontmatter.forEach(([key, value]) => {
    const cleaned = cleanScalar(value);
    if (cleaned) lines.push(`${key}: ${cleaned}`);
  });
  lines.push("---", "");

  (state.sections || []).forEach((section) => {
    if (section.type === "custom") {
      lines.push("## custom", "", `title: ${cleanScalar(section.title) || "未命名板块"}`, "");
      (section.blocks || []).forEach((block) => {
        if (block.type === "text") {
          const value = serializeInlineMarkdown(block.content);
          if (value) lines.push(value, "");
          return;
        }
        if (block.type === "list") {
          (block.bullets || []).forEach((bullet) => {
            lines.push(`- ${serializeInlineMarkdown(bullet.content)}`);
          });
          lines.push("");
          return;
        }
        serializeEntryToMarkdown(lines, block, cleanScalar);
      });
      return;
    }
    const defaultTitle = getSectionTitle(section.type);
    const title = cleanScalar(section.title);
    lines.push(`## ${defaultTitle}`, "");
    if (title && title !== defaultTitle) lines.push(`title: ${title}`, "");
    (section.entries || []).forEach((entry) => {
      if (section.type === "skills") {
        (entry.bullets || []).forEach((bullet) => lines.push(`- ${serializeInlineMarkdown(bullet.content)}`));
        lines.push("");
      } else serializeEntryToMarkdown(lines, entry, cleanScalar);
    });
  });

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

function createFormatterFileState(state) {
  const photo = state.photo || {};
  return {
    version: 1,
    layout: deepClone(state.layout || {}),
    photo: {
      scale: photo.scale,
      frameScale: photo.frameScale,
      frameOffsetX: photo.frameOffsetX,
      frameOffsetY: photo.frameOffsetY,
      offsetX: photo.offsetX,
      offsetY: photo.offsetY,
    },
    sections: (state.sections || []).map((section) => ({
      id: section.id,
      spacingBefore: section.spacingBefore,
      entries: (section.entries || []).map(createEntryPresentation),
      blocks: (section.blocks || []).map((block) => ({
        id: block.id,
        type: block.type,
        bullets: (block.bullets || []).map(createBulletPresentation),
      })),
    })),
  };
}

function createEntryPresentation(entry) {
  return {
    id: entry.id,
    bullets: (entry.bullets || []).map(createBulletPresentation),
  };
}

function createBulletPresentation(bullet) {
  let offset = 0;
  const fontSizeRanges = [];
  for (const token of (bullet.content || [])) {
    const length = String(token.value || "").length;
    const delta = Number(token.fontSizeDelta) || 0;
    if (delta && length > 0) fontSizeRanges.push([offset, offset + length, delta]);
    offset += length;
  }
  return {
    id: bullet.id,
    ...(bullet.markerStyle ? { markerStyle: bullet.markerStyle } : {}),
    ...(fontSizeRanges.length > 0 ? { fontSizeRanges } : {}),
  };
}

function serializeEntryToMarkdown(lines, entry, cleanScalar) {
  lines.push(`### ${cleanScalar(entry.name)}`);
  if (entry.role) lines.push(`role: ${cleanScalar(entry.role)}`);
  if (entry.date) lines.push(`date: ${cleanScalar(entry.date)}`);
  if (entry.location) lines.push(`location: ${cleanScalar(entry.location)}`);
  lines.push("");
  (entry.bullets || []).forEach((bullet) => {
    lines.push(`- ${serializeInlineMarkdown(bullet.content)}`);
  });
  lines.push("");
}

/**
 * @param {Array<{type:string,value:string}>} tokens
 * @returns {string}
 */
function serializeInlineMarkdown(tokens) {
  return (tokens || []).map((token) => {
    const value = String(token.value || "").replace(/[\r\n]+/g, " ");
    let formatted = token.href ? `[${value}](${token.href})` : value;
    if (token.type === "strong" && token.italic) formatted = `***${formatted}***`;
    else if (token.type === "strong") formatted = `**${formatted}**`;
    else if (token.italic) formatted = `*${formatted}*`;
    return formatted;
  }).join("");
}

/** Serialize Resume State to the supported JSON import schema. */
function serializeStateToJson(state) {
  const data = {
    schemaVersion: 2,
    resumeName: state.resumeName || "",
    profile: {
      name: state.profile.name || "",
      headline: state.profile.headline || "",
      location: state.profile.location || "",
      phone: state.profile.phone || "",
      email: state.profile.email || "",
      website: state.profile.website || "",
      portfolio: state.profile.portfolio || "",
      github: state.profile.github || "",
    },
    sections: (state.sections || []).map((section) => ({
      type: section.type,
      title: section.title || getSectionTitle(section.type),
      ...((section.type === "custom") ? {
        blocks: (section.blocks || []).map((block) => serializeCustomBlockToJson(block)),
      } : {}),
      entries: (section.entries || []).map((entry) => ({
        name: entry.name || "",
        role: entry.role || "",
        date: entry.date || "",
        location: entry.location || "",
        bullets: (entry.bullets || []).map((bullet) => serializeInlineMarkdown(bullet.content)),
      })),
    })),
    formatterState: createFormatterFileState(state),
  };
  return JSON.stringify(data, null, 2) + "\n";
}

function serializeCustomBlockToJson(block) {
  if (block.type === "text") {
    return { type: "text", content: serializeInlineMarkdown(block.content) };
  }
  if (block.type === "list") {
    return {
      type: "list",
      items: (block.bullets || []).map((bullet) => serializeInlineMarkdown(bullet.content)),
    };
  }
  return {
    type: "entry",
    name: block.name || "",
    role: block.role || "",
    date: block.date || "",
    location: block.location || "",
    bullets: (block.bullets || []).map((bullet) => serializeInlineMarkdown(bullet.content)),
  };
}

/**
 * Export current resume as a standalone HTML file.
 * @param {object} state
 * @param {string} [customFileName]
 */
function exportAsHtml(state, customFileName) {
  const fileName = customFileName || sanitizeFileName(state.resumeName || "resume");
  const fullName = fileName.endsWith(".html") ? fileName : `${fileName}.html`;

  const clonedDoc = cloneDocumentForExport(state);
  const html = serializeDocument(clonedDoc);

  downloadFile(html, fullName, "text/html");
}

/**
 * Clone the current document for export.
 * Injects fresh state and cleans up temporary UI.
 * @param {object} state
 * @returns {Document}
 */
function cloneDocumentForExport(state) {
  const clone = document.cloneNode(true);

  // Generate new documentId for exported copy
  const exportState = deepClone(state);
  exportState.documentId = generateId();
  exportState.metadata.lastSavedAt = new Date().toISOString();

  // Inject state into clone
  const existingScript = clone.querySelector("#embedded-resume-state");
  if (existingScript) existingScript.remove();

  const scriptEl = clone.createElement("script");
  scriptEl.id = "embedded-resume-state";
  scriptEl.type = "application/json";
  scriptEl.textContent = safeJsonSerialize(exportState);

  // Insert before first script or at end of body
  const firstScript = clone.querySelector("script");
  if (firstScript && firstScript.parentNode) {
    firstScript.parentNode.insertBefore(scriptEl, firstScript);
  } else {
    clone.body.appendChild(scriptEl);
  }

  // Clean up temporary UI
  cleanupExportClone(clone);

  return clone;
}

/**
 * Clean up temporary UI states from the cloned document.
 * @param {Document} clone
 */
function cleanupExportClone(clone) {
  // Remove active focus
  if (clone.activeElement) clone.activeElement.blur();

  // Clear selections
  if (clone.getSelection) {
    const sel = clone.getSelection();
    if (sel) sel.removeAllRanges();
  }

  // Clear contenteditable backgrounds
  clone.querySelectorAll("[contenteditable]").forEach((el) => {
    el.removeAttribute("contenteditable");
  });

  // Clear file input values
  clone.querySelectorAll("input[type=file]").forEach((el) => {
    el.value = "";
  });

  // Clear status region
  const statusRegion = clone.getElementById("status-region");
  if (statusRegion) {
    statusRegion.textContent = "";
  }

  // Remove dialog root content
  const dialogRoot = clone.getElementById("dialog-root");
  if (dialogRoot) {
    dialogRoot.innerHTML = "";
    dialogRoot.classList.remove("active");
  }

  // Remove toast containers
  clone.querySelectorAll(".toast-container").forEach((el) => el.remove());
}

/**
 * Serialize a Document to HTML string.
 * @param {Document} doc
 * @returns {string}
 */
function serializeDocument(doc) {
  return "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
}

/**
 * Trigger a file download.
 * @param {string} content
 * @param {string} fileName
 * @param {string} mimeType
 */
function downloadFile(content, fileName, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Ensure the portfolio contact is a real anchor before Chrome snapshots the
 * page for printing. This also repairs stale DOM created by older app builds.
 */
function preparePortfolioLinkForPrint() {
  if (typeof getState !== "function" || typeof getPortfolioContact !== "function") return;

  const currentState = getState();
  const portfolio = getPortfolioContact(currentState.profile && currentState.profile.portfolio);
  if (!portfolio || !portfolio.href) return;

  const current = document.querySelector('#contact-info [data-profile-field="portfolio"]');
  if (!current) return;

  let link = current;
  if (current.tagName !== "A") {
    link = document.createElement("a");
    link.textContent = portfolio.label;
    link.dataset.profileField = "portfolio";
    current.replaceWith(link);
  }

  link.className = "contact-value editable-placeholder contact-link";
  link.dataset.empty = "false";
  link.setAttribute("href", portfolio.href);
  link.setAttribute("target", "_blank");
  link.setAttribute("rel", "noopener noreferrer");
}

/**
 * Export PDF via browser print.
 */
function exportPdf() {
  if (typeof preparePhotoForPrint === "function") preparePhotoForPrint();
  preparePortfolioLinkForPrint();
  requestAnimationFrame(() => window.print());
}
