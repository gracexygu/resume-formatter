/**
 * Renderer module.
 * Renders Resume State into DOM. Pure rendering — no mutation of state.
 */

/**
 * Render the full resume page from state.
 * @param {object} state
 */
function renderResume(state) {
  if (typeof applyLayoutState === "function") applyLayoutState(state);
  renderHeader(state);
  renderSections(state);
  if (typeof applyLocalFormatting === "function") applyLocalFormatting(state);
  if (typeof applyHeaderPosition === "function") applyHeaderPosition(state);
  updateStatusInfo(state);
}

/**
 * Get current theme from #resume-page data-theme attribute.
 * @returns {"a"|"b"|"c"|"d"}
 */
function getTheme() {
  const page = document.getElementById("resume-page");
  const t = page && page.dataset.theme;
  return (t === "b" || t === "c" || t === "d") ? t : "a";
}

function getPortfolioContact(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const urlMatch = raw.match(/https?:\/\/[^\s|｜]+/i);
  const href = urlMatch ? urlMatch[0] : "";
  let label = href
    ? raw.slice(0, urlMatch.index).replace(/[\s|｜:：-]+$/g, "").trim()
    : raw;
  if (!label || /^AI\s*作品集$/i.test(label)) label = "AI作品集";

  return { label, href };
}

/**
 * Render header — behaviour differs by theme.
 * @param {object} state
 */
function renderHeader(state) {
  const { profile } = state;

  const nameEl = document.getElementById("profile-name");
  if (nameEl) {
    nameEl.textContent = profile.name;
    nameEl.dataset.empty = profile.name ? "false" : "true";
    nameEl.dataset.profileField = "name";
    nameEl.contentEditable = "plaintext-only";
  }

  const contactEl = document.getElementById("contact-info");
  if (contactEl) {
    contactEl.innerHTML = "";
    const portfolio = getPortfolioContact(profile.portfolio);
    const layout = state.layout || {};
    const legacyPreferenceVisible = Boolean(layout.preferenceVisible);
    const headlineVisible = Boolean(
      profile.headline
      || (typeof layout.headlineVisible === "boolean" ? layout.headlineVisible : legacyPreferenceVisible)
    );
    const locationVisible = Boolean(
      profile.location
      || (typeof layout.locationVisible === "boolean" ? layout.locationVisible : legacyPreferenceVisible)
    );
    const items = [
      profile.phone && {
        field: "phone",
        text: profile.phone,
      },
      profile.email && {
        field: "email",
        text: profile.email,
      },
      {
        field: "headline",
        text: profile.headline,
        label: "求职方向：",
        placeholder: "填写方向",
        preferenceVisible: headlineVisible,
      },
      {
        field: "location",
        text: profile.location,
        label: "期望城市：",
        placeholder: "填写城市",
        preferenceVisible: locationVisible,
      },
      portfolio && { field: "portfolio", text: portfolio.label, href: portfolio.href },
    ].filter(Boolean);
    const breakBefore = new Set((state.layout && state.layout.contactBreakBefore) || []);

    items.forEach(({ field, text, href, label, placeholder, preferenceVisible }) => {
      if (label && !preferenceVisible) {
        const addButton = document.createElement("button");
        addButton.className = "contact-action contact-add-preference no-print";
        addButton.type = "button";
        addButton.dataset.preferenceField = field;
        addButton.textContent = `+ ${label.replace(/[：:]$/, "")}`;
        addButton.title = `在联系方式中添加${label.replace(/[：:]$/, "")}`;
        contactEl.appendChild(addButton);
        return;
      }

      if (breakBefore.has(field)) {
        const lineBreak = document.createElement("span");
        lineBreak.className = "contact-line-break";
        lineBreak.dataset.breakBefore = field;
        lineBreak.setAttribute("aria-hidden", "true");
        contactEl.appendChild(lineBreak);
      }

      const item = document.createElement("span");
      item.className = `contact-item${label ? " contact-preference-item" : ""}`;
      item.dataset.contactField = field;
      if (label) {
        const labelEl = document.createElement("span");
        labelEl.className = "contact-label";
        labelEl.textContent = label;
        item.appendChild(labelEl);
      }

      const value = document.createElement(href ? "a" : "span");
      value.className = `contact-value editable-placeholder${href ? " contact-link" : ""}`;
      value.textContent = text;
      value.dataset.profileField = field;
      value.dataset.empty = text ? "false" : "true";
      if (placeholder) value.dataset.placeholder = placeholder;
      value.contentEditable = "plaintext-only";
      if (href) {
        value.href = href;
        value.target = "_blank";
        value.rel = "noopener noreferrer";
      }
      item.appendChild(value);

      if (label) {
        const removeButton = document.createElement("button");
        removeButton.className = "contact-action contact-remove-preference no-print";
        removeButton.type = "button";
        removeButton.dataset.preferenceField = field;
        removeButton.textContent = "×";
        removeButton.title = `删除${label.replace(/[：:]$/, "")}`;
        removeButton.setAttribute("aria-label", removeButton.title);
        item.appendChild(removeButton);
      }
      contactEl.appendChild(item);
    });
  }

  renderPhoto(state);
}

/**
 * Render all sections with spacing handles between them.
 * @param {object} state
 */
function renderSections(state) {
  const container = document.getElementById("resume-sections");
  if (!container) return;
  container.innerHTML = "";

  state.sections.forEach((section) => {
    const handle = document.createElement("div");
    handle.className = "spacing-handle no-print";
    handle.dataset.sectionId = section.id;
    const line = document.createElement("div");
    line.className = "spacing-handle-line";
    const calibration = document.createElement("div");
    calibration.className = "spacing-calibration";
    const tip = document.createElement("span");
    tip.className = "spacing-tooltip";
    const currentMm = (section.spacingBefore !== undefined) ? section.spacingBefore : 0;
    tip.textContent = currentMm.toFixed(1) + " mm";
    handle.style.setProperty("--spacing-size", currentMm + "mm");
    handle.setAttribute("aria-valuenow", String(currentMm));
    handle.setAttribute("aria-valuetext", `${currentMm.toFixed(1)} 毫米`);
    handle.appendChild(line);
    handle.appendChild(calibration);
    handle.appendChild(tip);
    container.appendChild(handle);

    const sectionEl = renderSection(section);
    if (section.spacingBefore !== undefined) {
      sectionEl.style.marginTop = section.spacingBefore + "mm";
    }
    container.appendChild(sectionEl);
  });

  // Update side gutter after layout settles
  requestAnimationFrame(() => updateAddGutter(state));
}

/**
 * Render a single section.
 * @param {object} section
 * @returns {HTMLElement}
 */
function renderSection(section) {
  const sectionEl = document.createElement("section");
  sectionEl.className = "resume-section";
  sectionEl.dataset.sectionId = section.id;
  sectionEl.dataset.sectionType = section.type;

  const reorderHandle = document.createElement("button");
  reorderHandle.className = "section-reorder-handle no-print";
  reorderHandle.type = "button";
  reorderHandle.dataset.sectionId = section.id;
  reorderHandle.textContent = "↕";
  reorderHandle.title = `拖动调整${section.title}的全局顺序`;
  reorderHandle.setAttribute("aria-label", `调整${section.title}的全局顺序`);
  reorderHandle.setAttribute("aria-keyshortcuts", "ArrowUp ArrowDown");
  sectionEl.appendChild(reorderHandle);

  const titleEl = document.createElement("h2");
  titleEl.className = "section-title";
  titleEl.textContent = section.title;
  titleEl.contentEditable = "plaintext-only";
  titleEl.dataset.sectionId = section.id;
  titleEl.dataset.empty = section.title ? "false" : "true";
  titleEl.setAttribute("aria-label", "编辑栏目标题");
  sectionEl.appendChild(titleEl);

  if (section.type === "custom") {
    const deleteSectionButton = document.createElement("button");
    deleteSectionButton.className = "btn-del-section no-print";
    deleteSectionButton.type = "button";
    deleteSectionButton.textContent = "×";
    deleteSectionButton.title = "删除该板块";
    deleteSectionButton.setAttribute("aria-label", `删除${section.title || "该板块"}`);
    deleteSectionButton.dataset.sectionId = section.id;
    sectionEl.appendChild(deleteSectionButton);
  }

  const divider = document.createElement("div");
  divider.className = "section-divider";
  sectionEl.appendChild(divider);

  if (section.type === "custom") {
    for (const block of (section.blocks || [])) {
      sectionEl.appendChild(renderCustomBlock(block));
    }
    sectionEl.appendChild(renderCustomBlockActions(section.id));
    return sectionEl;
  }

  // Skills: bullets directly, no entry header, no inline add
  if (section.type === "skills") {
    const entry = section.entries[0];
    if (entry) {
      const list = document.createElement("ul");
      list.className = "skills-list";
      list.dataset.entryId = entry.id;
      for (const bullet of entry.bullets) {
        list.appendChild(renderBulletRow(bullet));
      }
      sectionEl.appendChild(list);
    }
    return sectionEl;
  }

  // Other sections — no inline add button, gutter handles it
  for (const entry of section.entries) {
    sectionEl.appendChild(renderEntry(entry, section.type === "experience" ? section.id : ""));
  }

  return sectionEl;
}

function renderCustomBlock(block) {
  const wrapper = document.createElement("div");
  wrapper.className = `custom-block custom-block-${block.type}`;
  wrapper.dataset.blockId = block.id;

  if (block.type === "text") {
    const text = document.createElement("p");
    text.className = "custom-text editable-placeholder";
    text.contentEditable = "plaintext-only";
    text.dataset.textBlockId = block.id;
    text.dataset.empty = serializeInlineText(block.content) ? "false" : "true";
    text.dataset.placeholder = "输入内容";
    text.setAttribute("aria-label", "编辑正文");
    text.appendChild(renderInlineContent(block.content || []));
    wrapper.appendChild(text);
  } else if (block.type === "list") {
    const list = document.createElement("ul");
    list.className = "custom-list entry-bullets";
    list.dataset.entryId = block.id;
    for (const bullet of (block.bullets || [])) list.appendChild(renderBulletRow(bullet));
    wrapper.appendChild(list);
  } else {
    wrapper.appendChild(renderEntry(block));
  }

  if (block.type !== "entry") {
    const deleteButton = document.createElement("button");
    deleteButton.className = "btn-del-block no-print";
    deleteButton.type = "button";
    deleteButton.textContent = "×";
    deleteButton.title = "删除该内容";
    deleteButton.setAttribute("aria-label", "删除该内容");
    deleteButton.dataset.blockId = block.id;
    wrapper.appendChild(deleteButton);
  }
  return wrapper;
}

function serializeInlineText(tokens) {
  return (tokens || []).map((token) => token.value || "").join("");
}

function renderCustomBlockActions(sectionId) {
  const actions = document.createElement("div");
  actions.className = "custom-block-actions no-print";
  actions.setAttribute("aria-label", "新增板块内容");
  [
    ["text", "+ 正文"],
    ["list", "+ 列表"],
    ["entry", "+ 条目"],
  ].forEach(([type, label]) => {
    const button = document.createElement("button");
    button.className = "btn-add-block";
    button.type = "button";
    button.dataset.sectionId = sectionId;
    button.dataset.blockType = type;
    button.textContent = label;
    actions.appendChild(button);
  });
  return actions;
}

/**
 * Render a single entry with delete button.
 * @param {object} entry
 * @param {string} [reorderSectionId]
 * @returns {HTMLElement}
 */
function renderEntry(entry, reorderSectionId = "") {
  const entryEl = document.createElement("div");
  entryEl.className = "resume-entry";
  entryEl.dataset.entryId = entry.id;

  if (reorderSectionId) {
    const reorderHandle = document.createElement("button");
    reorderHandle.className = "entry-reorder-handle no-print";
    reorderHandle.type = "button";
    reorderHandle.dataset.entryId = entry.id;
    reorderHandle.dataset.sectionId = reorderSectionId;
    reorderHandle.textContent = "↕";
    reorderHandle.title = `拖动调整${entry.name || "该经历"}的顺序`;
    reorderHandle.setAttribute("aria-label", `调整${entry.name || "该经历"}的顺序`);
    entryEl.appendChild(reorderHandle);
  }

  // Header
  const headerEl = document.createElement("div");
  headerEl.className = "entry-header";

  const leftEl = document.createElement("div");
  leftEl.className = "entry-left";

  const nameSpan = document.createElement("span");
  nameSpan.className = "entry-name";
  nameSpan.textContent = entry.name;
  nameSpan.contentEditable = "plaintext-only";
  nameSpan.dataset.entryField = "name";
  nameSpan.dataset.empty = entry.name ? "false" : "true";
  nameSpan.dataset.placeholder = "名称";
  nameSpan.setAttribute("aria-label", "编辑条目名称");
  leftEl.appendChild(nameSpan);

  const roleSpan = document.createElement("span");
  roleSpan.className = "entry-role";
  roleSpan.textContent = entry.role || "";
  roleSpan.contentEditable = "plaintext-only";
  roleSpan.dataset.entryField = "role";
  roleSpan.dataset.empty = entry.role ? "false" : "true";
  roleSpan.dataset.placeholder = "角色或说明";
  roleSpan.setAttribute("aria-label", "编辑角色或说明");
  leftEl.appendChild(roleSpan);

  headerEl.appendChild(leftEl);

  const dateLocSpan = document.createElement("span");
  dateLocSpan.className = "entry-date-location";

  const dateSpan = document.createElement("span");
  dateSpan.className = "entry-date";
  dateSpan.textContent = entry.date || "";
  dateSpan.contentEditable = "plaintext-only";
  dateSpan.dataset.entryField = "date";
  dateSpan.dataset.empty = entry.date ? "false" : "true";
  dateSpan.dataset.placeholder = "起止日期";
  dateSpan.setAttribute("aria-label", "编辑起止日期");
  dateLocSpan.appendChild(dateSpan);
  headerEl.appendChild(dateLocSpan);

  // Delete entry button
  const delBtn = document.createElement("button");
  delBtn.className = "btn-del-entry no-print";
  delBtn.textContent = "×";
  delBtn.title = "删除该条目";
  delBtn.dataset.entryId = entry.id;
  headerEl.appendChild(delBtn);

  entryEl.appendChild(headerEl);

  // Bullets — no inline add row, gutter handles it
  const bulletsEl = document.createElement("ul");
  bulletsEl.className = "entry-bullets";
  bulletsEl.dataset.entryId = entry.id;
  for (const bullet of entry.bullets) {
    bulletsEl.appendChild(renderBulletRow(bullet));
  }
  entryEl.appendChild(bulletsEl);

  return entryEl;
}

/**
 * Render a single bullet row with delete button.
 * @param {object} bullet
 * @returns {HTMLElement}
 */
function renderBulletRow(bullet) {
  const li = document.createElement("li");
  li.className = "bullet-row";
  li.dataset.bulletId = bullet.id;

  const span = document.createElement("span");
  span.className = "bullet-item";
  updateBulletSemanticClass(span, bullet.content);
  span.contentEditable = "plaintext-only";
  span.dataset.bulletId = bullet.id;
  if (bullet.markerStyle && bullet.markerStyle !== "default") {
    span.dataset.bulletMarker = bullet.markerStyle;
  }
  span.appendChild(renderInlineContent(bullet.content));
  li.appendChild(span);

  const delBtn = document.createElement("button");
  delBtn.className = "btn-del-bullet no-print";
  delBtn.textContent = "×";
  delBtn.title = "删除该 Bullet";
  delBtn.dataset.bulletId = bullet.id;
  li.appendChild(delBtn);

  return li;
}

function updateBulletSemanticClass(element, tokens) {
  const text = (tokens || []).map((token) => token.value || "").join("");
  element.classList.toggle("bullet-okr", /^\s*OKR\s*[：:]/i.test(text));
}

/**
 * Render "+ 新增 Bullet" row.
 * @param {string} entryId
 * @returns {HTMLElement}
 */
function renderAddBulletRow(entryId) {
  const li = document.createElement("li");
  li.className = "bullet-add-row no-print";
  const btn = document.createElement("button");
  btn.className = "btn-add-bullet";
  btn.dataset.entryId = entryId;
  btn.textContent = "+ 新增";
  li.appendChild(btn);
  return li;
}

/**
 * Render inline content tokens (text + bold) into a DocumentFragment.
 * @param {object[]} tokens
 * @returns {DocumentFragment}
 */
function renderInlineContent(tokens) {
  const frag = document.createDocumentFragment();
  for (const token of tokens) {
    let node;
    if (token.type === "text") {
      node = document.createTextNode(token.value);
    } else if (token.type === "strong") {
      const strong = document.createElement("strong");
      strong.textContent = token.value;
      node = strong;
    }
    if (node && token.italic) {
      const emphasis = document.createElement("em");
      emphasis.appendChild(node);
      node = emphasis;
    }
    if (token.fontSizeDelta) {
      const wrapper = node.nodeType === Node.ELEMENT_NODE ? node : document.createElement("span");
      if (wrapper !== node) wrapper.appendChild(node);
      wrapper.dataset.fontSizeDelta = String(token.fontSizeDelta);
      wrapper.style.fontSize = `calc(1em + ${token.fontSizeDelta}pt)`;
      node = wrapper;
    }
    if (node && token.href) {
      const link = document.createElement("a");
      link.className = "inline-link";
      link.href = token.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.appendChild(node);
      node = link;
    }
    if (node) frag.appendChild(node);
  }
  return frag;
}

/**
 * Render photo from state.
 * @param {object} state
 */
function renderPhoto(state) {
  const container = document.getElementById("photo-container");
  if (!container) return;
  const { photo } = state;
  if (typeof applyPhotoFrameSize === "function") applyPhotoFrameSize(photo);
  if (typeof applyPhotoFramePosition === "function") applyPhotoFramePosition(photo);

  const existingImg = container.querySelector("img");
  if (existingImg) existingImg.remove();
  const existingDelete = container.querySelector(".photo-delete-btn");
  if (existingDelete) existingDelete.remove();
  const existingMove = container.querySelector(".photo-frame-handle");
  if (existingMove) existingMove.remove();

  const moveButton = document.createElement("button");
  moveButton.className = "photo-frame-handle no-print";
  moveButton.type = "button";
  moveButton.textContent = "✥";
  moveButton.title = "拖动照片框；双击恢复位置";
  moveButton.setAttribute("aria-label", "移动照片框");
  container.appendChild(moveButton);

  if (!photo.dataUrl) {
    container.dataset.empty = "true";
    container.tabIndex = 0;
    container.setAttribute("role", "button");
    container.setAttribute("aria-label", "上传证件照");
    return;
  }

  container.dataset.empty = "false";
  container.removeAttribute("tabindex");
  container.removeAttribute("role");
  container.removeAttribute("aria-label");
  const img = document.createElement("img");
  img.src = photo.dataUrl;
  img.style.width = "100%";
  img.style.height = "auto";
  img.draggable = false;
  container.appendChild(img);
  if (typeof applyPhotoTransform === "function") applyPhotoTransform(photo);

  const deleteButton = document.createElement("button");
  deleteButton.className = "photo-delete-btn no-print";
  deleteButton.type = "button";
  deleteButton.textContent = "×";
  deleteButton.title = "删除照片";
  deleteButton.setAttribute("aria-label", "删除照片");
  container.appendChild(deleteButton);
}

/**
 * Update toolbar info.
 * @param {object} state
 */
function updateStatusInfo(state) {
  const nameEl = document.getElementById("current-filename");
  if (nameEl) {
    const fileName = state.source.fileName || "";
    nameEl.textContent = fileName ? fileName.split("/").pop() : "未导入文件";
    nameEl.title = fileName;
  }
}

/**
 * Build the LEFT-side gutter with "+" buttons for adding entries and bullets.
 * Each button is aligned vertically with its insertion point in the page.
 * @param {object} state
 */
function updateAddGutter(state) {
  const gutter = document.getElementById("add-gutter");
  const pageEl = document.getElementById("resume-page");
  if (!gutter || !pageEl) return;

  gutter.innerHTML = "";
  const gutterRect = gutter.getBoundingClientRect();

  state.sections.forEach((section) => {
    const sectionEl = document.querySelector(`section[data-section-id="${section.id}"]`);
    if (!sectionEl) return;

    if (section.type === "custom") return;

    if (section.type === "skills") {
      // Skills: bullet add at bottom of list
      const listEl = sectionEl.querySelector(".skills-list");
      if (listEl) {
        const rect = listEl.getBoundingClientRect();
        gutter.appendChild(makeGutterBtn(
          rect.bottom - gutterRect.top,
          "+",
          `在「${section.title}」末尾新增`,
          () => addBullet(section.entries[0]?.id)
        ));
      }
      return;
    }

    // Entry-level add aligns with the section title, away from bullet-level adds.
    const titleEl = sectionEl.querySelector(".section-title");
    const titleRect = titleEl ? titleEl.getBoundingClientRect() : sectionEl.getBoundingClientRect();
    gutter.appendChild(makeGutterBtn(
      titleRect.top + titleRect.height / 2 - gutterRect.top,
      "+",
      `在「${section.title}」末尾新增条目`,
      () => addEntry(section.id)
    ));

    // Bullet add at bottom of each entry's bullets list
    section.entries.forEach((entry) => {
      const bulletsEl = sectionEl.querySelector(`ul[data-entry-id="${entry.id}"]`);
      if (!bulletsEl) return;
      const bRect = bulletsEl.getBoundingClientRect();
      gutter.appendChild(makeGutterBtn(
        bRect.bottom - gutterRect.top,
        "·+",
        `为「${entry.name || "该条目"}」新增 Bullet`,
        () => addBullet(entry.id),
        true
      ));
    });
  });
}

/**
 * Create a single gutter button item.
 * @param {number} topPx - top offset in px relative to gutter
 * @param {string} label - button text
 * @param {string} title - tooltip
 * @param {Function} onClick
 * @param {boolean} [small] - smaller style for bullet-level adds
 * @returns {HTMLElement}
 */
function makeGutterBtn(topPx, label, title, onClick, small) {
  const item = document.createElement("div");
  item.className = "gutter-item" + (small ? " gutter-item-small" : "");
  item.style.top = topPx + "px";

  const guide = document.createElement("div");
  guide.className = "gutter-guide";

  const btn = document.createElement("button");
  btn.className = "gutter-add-btn" + (small ? " gutter-add-btn-small" : "");
  btn.textContent = label;
  btn.title = title;
  btn.addEventListener("click", onClick);

  item.appendChild(guide);
  item.appendChild(btn);
  return item;
}
