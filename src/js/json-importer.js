/**
 * JSON Importer module.
 * Imports a JSON-format resume into a Resume State.
 * Output state is identical to Markdown importer output.
 */

/** @type {string[]} */
const ALLOWED_SECTION_TYPES = ["education", "experience", "projects", "skills", "custom"];

/**
 * Strip code fences (```json ... ```) from raw input.
 * @param {string} raw
 * @returns {string}
 */
function stripCodeFences(raw) {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }
  return raw;
}

/**
 * Convert JSON.parse error to human-readable message with line number.
 * @param {string} raw
 * @param {SyntaxError} err
 * @returns {string}
 */
function describeJsonError(raw, err) {
  const message = err && err.message ? err.message : "未知错误";

  // V8 format: "... at position N"
  const posMatch = message.match(/position\s+(\d+)/i);
  if (posMatch) {
    const pos = parseInt(posMatch[1], 10);
    const before = raw.slice(0, pos);
    const line = before.split("\n").length;
    const lastNl = before.lastIndexOf("\n");
    const col = lastNl === -1 ? pos + 1 : pos - lastNl;
    return `JSON 语法错误（第 ${line} 行，第 ${col} 列）：${message}。请检查该位置的括号、引号和逗号是否正确。`;
  }

  // SpiderMonkey format: "... at line X column Y"
  const lineMatch = message.match(/line\s+(\d+)\s+column\s+(\d+)/i);
  if (lineMatch) {
    const line = parseInt(lineMatch[1], 10);
    const col = parseInt(lineMatch[2], 10);
    return `JSON 语法错误（第 ${line} 行，第 ${col} 列）：${message}。请检查该位置的括号、引号和逗号是否正确。`;
  }

  return `JSON 语法错误：${message}。`;
}

/** @type {string} */
const JSON_EXAMPLE = `{
  "schemaVersion": 2,
  "resumeName": "谷雨-用户增长产品经理（虚构演示）",
  "profile": {
    "name": "谷雨",
    "headline": "用户增长产品经理｜虚构演示数据",
    "location": "北京",
    "phone": "1xx-xxxx-xxxx",
    "email": "example@example.com",
    "website": "",
    "portfolio": "",
    "github": ""
  },
  "sections": [
    {
      "type": "education",
      "entries": [
        {
          "name": "北京大学",
          "role": "信息管理与信息系统｜本科",
          "date": "2020.09–2024.06",
          "location": "北京",
          "bullets": ["GPA 3.85/4.00，专业前 5%", "主修课程：数据挖掘、用户行为分析、产品策略、互联网营销"]
        }
      ]
    },
    {
      "type": "experience",
      "entries": [
        {
          "name": "星月岛｜成长事业群",
          "role": "用户增长产品经理实习生",
          "date": "2023.09–2024.03",
          "location": "北京",
          "bullets": ["负责**新用户激活漏斗**优化，拆解注册→首单全链路，识别核心流失节点，推动首单补贴策略迭代，30 日新用户首单转化率提升 **12%**", "设计用户分层召回体系，根据沉默时长与历史消费频次划分 4 类标签，分别匹配差异化触达策略，召回成本下降 **18%**，ROI 提升至 **1.4**", "搭建增长看板，梳理 DAU、新增、留存、付费转化等核心指标，支持业务方每日自助取数，减少分析同学人工取数需求约 **60%**"]
        },
        {
          "name": "幻彩岛｜内容电商",
          "role": "增长产品实习生",
          "date": "2023.03–2023.08",
          "location": "北京",
          "bullets": ["参与**直播间冷启动**策略设计，针对新主播设定流量扶持规则与毕业条件，协助产品经理完成需求文档、竞品分析与上线后数据复盘", "协助设计 A/B 实验方案，覆盖落地页文案、CTA 样式与激励权益三个变量，主导数据收集与显著性验证，产出可直接执行的优化建议", "输出《新主播冷启动竞品报告》，覆盖同类平台 6 项核心机制对比，被团队采纳作为策略参考"]
        },
        {
          "name": "珊瑚岛｜出行业务",
          "role": "产品运营实习生",
          "date": "2022.07–2022.09",
          "location": "北京",
          "bullets": ["梳理司机端拉新裂变链路，整理现有激励结构中的规则漏洞与用户反馈，提出 3 项优化建议，其中 1 项进入下季度规划", "参与**司机留存专项**数据分析，清洗 3 万条问卷数据，识别影响 30 日留存的关键因素，输出分析报告并完成内部宣讲"]
        }
      ]
    },
    {
      "type": "projects",
      "entries": [
        {
          "name": "用户增长实验平台设计",
          "role": "独立项目",
          "date": "2023.10–2024.01",
          "bullets": ["基于实习经历中对 A/B 实验管理痛点的观察，设计一套轻量级实验平台原型，覆盖实验创建、流量分配、指标配置与结果可视化四个模块", "完成 40+ 页 PRD，使用 Figma 输出高保真原型，通过 5 次用户访谈验证核心功能优先级"]
        }
      ]
    },
    {
      "type": "skills",
      "entries": [
        {
          "name": "",
          "bullets": ["**产品**：需求分析、用户分层、漏斗拆解、A/B 实验设计、增量归因、PRD 撰写", "**数据**：SQL、Excel、神策/Sensors Data、看板搭建", "**工具**：Figma、Axure、飞书文档", "**语言**：英语 CET-6 578，具备英文资料阅读及业务沟通能力"]
        }
      ]
    }
  ]
}`;

const SCHEMA_VERSION = 1;

const MARKDOWN_EXAMPLE = `---
schema_version: 2
resume_name: 谷雨-用户增长产品经理（虚构演示）
name: 谷雨
headline: 用户增长产品经理｜虚构演示数据
location: 北京
phone: 1xx-xxxx-xxxx
email: example@example.com
website:
portfolio:
github:
---

## education

### 北京大学
role: 信息管理与信息系统｜本科
date: 2020.09–2024.06
location: 北京

- GPA 3.85/4.00，专业前 5%
- 主修课程：数据挖掘、用户行为分析、产品策略、互联网营销

## experience

### 星月岛｜成长事业群
role: 用户增长产品经理实习生
date: 2023.09–2024.03
location: 北京

- 负责**新用户激活漏斗**优化，拆解注册→首单全链路，识别核心流失节点，推动首单补贴策略迭代，30 日新用户首单转化率提升 **12%**
- 设计用户分层召回体系，根据沉默时长与历史消费频次划分 4 类标签，分别匹配差异化触达策略，召回成本下降 **18%**，ROI 提升至 **1.4**
- 搭建增长看板，梳理 DAU、新增、留存、付费转化等核心指标，支持业务方每日自助取数，减少分析同学人工取数需求约 **60%**

### 幻彩岛｜内容电商
role: 增长产品实习生
date: 2023.03–2023.08
location: 北京

- 参与**直播间冷启动**策略设计，针对新主播设定流量扶持规则与毕业条件，协助产品经理完成需求文档、竞品分析与上线后数据复盘
- 协助设计 A/B 实验方案，覆盖落地页文案、CTA 样式与激励权益三个变量，主导数据收集与显著性验证，产出可直接执行的优化建议
- 输出《新主播冷启动竞品报告》，覆盖同类平台 6 项核心机制对比，被团队采纳作为策略参考

### 珊瑚岛｜出行业务
role: 产品运营实习生
date: 2022.07–2022.09
location: 北京

- 梳理司机端拉新裂变链路，整理现有激励结构中的规则漏洞与用户反馈，提出 3 项优化建议，其中 1 项进入下季度规划
- 参与**司机留存专项**数据分析，清洗 3 万条问卷数据，识别影响 30 日留存的关键因素，输出分析报告并完成内部宣讲

## projects

### 用户增长实验平台设计
role: 独立项目
date: 2023.10–2024.01

- 基于实习经历中对 A/B 实验管理痛点的观察，设计一套轻量级实验平台原型，覆盖实验创建、流量分配、指标配置与结果可视化四个模块
- 完成 40+ 页 PRD，使用 Figma 输出高保真原型，通过 5 次用户访谈验证核心功能优先级

## skills

- **产品**：需求分析、用户分层、漏斗拆解、A/B 实验设计、增量归因、PRD 撰写
- **数据**：SQL、Excel、神策/Sensors Data、看板搭建
- **工具**：Figma、Axure、飞书文档
- **语言**：英语 CET-6 578，具备英文资料阅读及业务沟通能力`;

const PROMPT_PDF_TO_MD = `请完整读取我上传的 PDF 简历，并将其转换为 Resume Formatter 可以直接导入的 Markdown Schema v2。

你的任务仅限于提取和结构化原简历，不负责评价、润色、优化或改写内容。

内容提取要求：

1. 完整读取 PDF 中所有可识别的简历内容，包括姓名、联系方式、教育经历、工作或实习经历、项目经历、技能、证书和荣誉。
2. 按人类实际阅读顺序处理内容，不要机械按照 PDF 内部文字对象的存储顺序输出。
3. 如果简历为双栏或多栏，请先判断各栏的阅读顺序。
4. 不要重复写入页码、装饰文字和重复出现的页眉页脚。
5. 保留原文中的学校、公司、岗位、项目、时间、地点、数字、专有名词和每条 Bullet。
6. 不得编造、润色、概括、扩写、压缩或删除原始事实。
7. 不要擅自合并不同 Bullet，也不要随意拆分一条完整 Bullet。
8. 无法确认的内容保留能够确认的原文，不要猜测。
9. 如果 PDF 是扫描图片，且你无法可靠读取文字，请停止转换并明确告知，不要输出残缺或猜测生成的 Markdown。
10. 保持原简历中各段经历和 Bullet 的顺序。

输出要求：

1. 只输出最终 Markdown。
2. 不要使用 Markdown 代码块包裹。
3. 不要输出说明、前言、注释、总结或转换报告。
4. 必须严格符合 Resume Formatter Schema v2。
5. 不得创建原简历不存在的经历和数据。
6. 原简历没有的栏目可以省略。
7. 缺失的选填字段填写为空。
8. 不得使用表格、引用块、图片、脚注、HTML 标签或嵌套列表。
9. 每条经历内容使用一级 Bullet，以"- "开头。
10. 优先使用 education、experience、projects、skills 预置栏目；原简历中的其他栏目保留原标题，不要强行归类。

字段映射规则：

- resume_name：根据姓名和求职方向生成；无法确认求职方向时使用"姓名-个人简历"。
- name：姓名。
- headline：求职方向或简历标题；无法确认时留空。
- location：当前城市或求职城市。
- phone：联系电话。
- email：邮箱。
- website、portfolio、github：原文存在时填写，不存在时留空。
- "###"后填写学校、公司或项目名称。
- role 填写学历专业、岗位名称或项目角色。
- date 填写原文时间。
- location 填写原文地点。
- 证书、荣誉、语言和其他信息放入 skills，并保留类别前缀。

请严格使用以下格式：

---
schema_version: 2
resume_name: 姓名-求职方向
name: 姓名
headline: 求职方向
location: 城市
phone: 电话
email: 邮箱
website:
portfolio:
github:
---

## education

### 学校名称
role: 专业｜学历
date: 开始时间–结束时间
location: 城市

- 教育经历补充信息

## experience

### 公司名称
role: 岗位名称
date: 开始时间–结束时间
location: 城市

- 经历 Bullet 1
- 经历 Bullet 2

## projects

### 项目名称
role: 项目角色
date: 开始时间–结束时间
location:

- 项目 Bullet 1
- 项目 Bullet 2

## skills

- 产品：原文技能
- AI：原文技能
- 语言：原文语言能力
- 证书：原文证书
- 荣誉：原文荣誉

开始前，请先完整读取我上传的 PDF，然后直接输出最终 Markdown。`;

const PROMPT_DOCX_TO_MD = `请完整读取我上传的 Word / DOCX 简历，并将其转换为 Resume Formatter 可以直接导入的 Markdown Schema v2。

你的任务仅限于提取和结构化原简历，不负责评价、润色、优化或改写内容。

内容提取要求：

1. 完整读取 DOCX 中与简历有关的内容，包括正文、表格、文本框、页眉、页脚、项目符号和超链接文字。
2. 按文档视觉阅读顺序整理内容，不要只按照底层 XML 或段落存储顺序机械输出。
3. 重点检查姓名和联系方式是否位于页眉、表格或文本框。
4. 表格只作为排版容器处理，提取其中真实文字，不要把行列结构写入 Markdown。
5. 不要导入批注、修订记录、隐藏文字、模板提示语或未删除的占位内容。
6. 保留原文中的学校、公司、岗位、项目、时间、地点、数字、专有名词和每条 Bullet。
7. 不得编造、润色、概括、扩写、压缩或删除原始事实。
8. 不要擅自合并不同 Bullet，也不要随意拆分一条完整 Bullet。
9. 无法确认的内容保持原文，确实缺失的字段留空，不要猜测。
10. 保持原简历各段经历和 Bullet 的顺序。

输出要求：

1. 只输出最终 Markdown。
2. 不要使用 Markdown 代码块包裹。
3. 不要输出说明、前言、注释、总结或转换报告。
4. 必须严格符合 Resume Formatter Schema v2。
5. 不得创建原简历不存在的经历和数据。
6. 原简历没有的栏目可以省略。
7. 缺失的选填字段填写为空。
8. 不得使用表格、引用块、图片、脚注、HTML 标签或嵌套列表。
9. 每条经历内容使用一级 Bullet，以"- "开头。
10. 优先使用 education、experience、projects、skills 预置栏目；原简历中的其他栏目保留原标题，不要强行归类。

字段映射和标准格式与 Resume Formatter Schema v2 一致：

---
schema_version: 2
resume_name: 姓名-求职方向
name: 姓名
headline: 求职方向
location: 城市
phone: 电话
email: 邮箱
website:
portfolio:
github:
---

## education

### 学校名称
role: 专业｜学历
date: 开始时间–结束时间
location: 城市

- 教育经历补充信息

## experience

### 公司名称
role: 岗位名称
date: 开始时间–结束时间
location: 城市

- 经历 Bullet 1
- 经历 Bullet 2

## projects

### 项目名称
role: 项目角色
date: 开始时间–结束时间
location:

- 项目 Bullet 1
- 项目 Bullet 2

## skills

- 产品：原文技能
- AI：原文技能
- 语言：原文语言能力
- 证书：原文证书
- 荣誉：原文荣誉

开始前，请先完整读取我上传的 Word / DOCX 文件，然后直接输出最终 Markdown。`;

const PROMPT_PDF_TO_JSON = `请完整读取我上传的 PDF 简历，并将其中的简历内容转换为 Resume Formatter 可以直接导入的标准 JSON。

你的任务仅限于完整提取和结构化，不负责评价、润色、优化或改写内容。

提取要求：

1. 完整读取 PDF 中所有可识别的简历文字。
2. 按人类实际阅读顺序处理，不要机械遵循 PDF 内部对象顺序。
3. 双栏或多栏简历需要先判断阅读顺序。
4. 不要重复写入页码、装饰文字和重复页眉页脚。
5. 保留公司、学校、岗位、项目、时间、地点、数字、专有名词和 Bullet 原文。
6. 不得编造、润色、概括、扩写或删除内容。
7. 无法可靠识别的内容不要猜测。
8. 如果是扫描版 PDF 且无法准确读取，请停止转换并明确告知。
9. 保持经历和 Bullet 原有顺序。

输出要求：

1. 只输出合法 JSON。
2. 不要使用 Markdown 代码块。
3. 不要输出说明、前言、注释或结尾。
4. 输出必须能够被 JSON.parse() 直接解析。
5. 双引号、换行和特殊字符必须正确转义。
6. 缺失的选填字段填写空字符串。
7. 原简历没有的栏目可以省略。
8. 不要输出 ID、时间戳、照片位置或排版状态。

请严格使用以下结构：

{
  "schemaVersion": 2,
  "resumeName": "姓名-求职方向",
  "profile": {
    "name": "",
    "headline": "",
    "location": "",
    "phone": "",
    "email": "",
    "website": "",
    "portfolio": "",
    "github": ""
  },
  "sections": [
    {
      "type": "education",
      "entries": [
        {
          "name": "",
          "role": "",
          "date": "",
          "location": "",
          "bullets": []
        }
      ]
    },
    {
      "type": "experience",
      "entries": [
        {
          "name": "",
          "role": "",
          "date": "",
          "location": "",
          "bullets": []
        }
      ]
    },
    {
      "type": "projects",
      "entries": [
        {
          "name": "",
          "role": "",
          "date": "",
          "location": "",
          "bullets": []
        }
      ]
    },
    {
      "type": "skills",
      "entries": [
        {
          "name": "",
          "role": "",
          "date": "",
          "location": "",
          "bullets": []
        }
      ]
    }
  ]
}

开始前，请先完整读取我上传的 PDF，然后直接输出最终 JSON。`;

const PROMPT_DOCX_TO_JSON = `请完整读取我上传的 Word / DOCX 简历，并将其中的简历内容转换为 Resume Formatter 可以直接导入的标准 JSON。

你的任务仅限于完整提取和结构化，不负责评价、润色、优化或改写内容。

提取要求：

1. 完整读取 DOCX 中的正文、表格、文本框、页眉、页脚、项目符号和超链接文字。
2. 按文档视觉阅读顺序整理，不要机械按照 XML 或段落存储顺序输出。
3. 检查联系方式是否位于页眉、表格或文本框。
4. 表格只作为排版容器，提取其中的真实内容。
5. 不要导入批注、修订记录、隐藏文字、模板提示语和无关占位内容。
6. 保留公司、学校、岗位、项目、时间、地点、数字、专有名词和 Bullet 原文。
7. 不得编造、润色、概括、扩写或删除内容。
8. 缺失内容留空，不要猜测。
9. 保持经历和 Bullet 原有顺序。

输出要求：

1. 只输出合法 JSON。
2. 不要使用 Markdown 代码块。
3. 不要输出说明、前言、注释或结尾。
4. 输出必须能够被 JSON.parse() 直接解析。
5. 双引号、换行和特殊字符必须正确转义。
6. 缺失的选填字段填写空字符串。
7. 原简历没有的栏目可以省略。
8. 不要输出 ID、时间戳、照片位置或排版状态。

JSON 结构严格使用 Resume Formatter Schema v2：

{
  "schemaVersion": 2,
  "resumeName": "姓名-求职方向",
  "profile": {
    "name": "",
    "headline": "",
    "location": "",
    "phone": "",
    "email": "",
    "website": "",
    "portfolio": "",
    "github": ""
  },
  "sections": [
    {
      "type": "education",
      "entries": [
        {
          "name": "",
          "role": "",
          "date": "",
          "location": "",
          "bullets": []
        }
      ]
    },
    {
      "type": "experience",
      "entries": [
        {
          "name": "",
          "role": "",
          "date": "",
          "location": "",
          "bullets": []
        }
      ]
    },
    {
      "type": "projects",
      "entries": [
        {
          "name": "",
          "role": "",
          "date": "",
          "location": "",
          "bullets": []
        }
      ]
    },
    {
      "type": "skills",
      "entries": [
        {
          "name": "",
          "role": "",
          "date": "",
          "location": "",
          "bullets": []
        }
      ]
    }
  ]
}

开始前，请先完整读取我上传的 Word / DOCX 文件，然后直接输出最终 JSON。`;


/**
 * Build a fix prompt for AI based on errors.
 * @param {object[]} errors
 * @param {string} rawJson
 * @param {boolean} includeJson
 * @returns {string}
 */
function buildFixPrompt(errors, rawJson, includeJson) {
  const errorList = errors
    .filter((e) => e.level === "error" || e.level === "warning")
    .map((e, i) => `${i + 1}. [${e.level === "error" ? "错误" : "警告"}] ${e.message}`)
    .join("\n");

  let prompt = `以下 JSON 简历在导入时出现了错误，请修复并返回完整的修正后 JSON。

错误列表：
${errorList}`;

  if (includeJson && rawJson) {
    prompt += `\n\n原始 JSON：\n\`\`\`json\n${rawJson}\n\`\`\``;
  }

  prompt += `\n\n修复要求：
1. 返回修正后的完整 JSON，不要包含 \`\`\`json 代码块标记或额外文本。
2. 修复所有错误和警告。
3. 保持原有数据不变，只修正格式和缺失字段。
4. schemaVersion 必须为 2。
5. sections 可以使用预置类型，也可以使用带 title 和 blocks 的 custom 类型。
6. bullets 必须是字符串数组，可以包含 **加粗** 标记。
7. profile 必须包含 name、headline、phone、email。`;

  return prompt;
}

/**
 * Import a JSON-format resume.
 * @param {string} rawJson - Raw JSON string (may include code fences)
 * @param {string} fileName - Original file name or label
 * @returns {{ errors: object[], state: object|null }}
 */
function importJsonResume(rawJson, fileName) {
  const errors = [];
  const cleaned = stripCodeFences(rawJson);

  // 1. Syntax validation
  let data;
  try {
    data = JSON.parse(cleaned);
  } catch (err) {
    errors.push({
      level: "error",
      code: "JSON_SYNTAX_ERROR",
      message: describeJsonError(cleaned, err),
      suggestion: "请使用 JSON 校验工具检查格式。",
    });
    return { errors, state: null };
  }

  // Root must be an object
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    errors.push({
      level: "error",
      code: "INVALID_ROOT",
      message: "JSON 根节点必须为对象。",
      suggestion: "请确保 JSON 顶层为 { ... } 对象格式。",
    });
    return { errors, state: null };
  }

  // 2. Schema validation
  // 2a. schemaVersion
  if (data.schemaVersion === undefined || data.schemaVersion === null) {
    errors.push({
      level: "error",
      code: "MISSING_SCHEMA_VERSION",
      field: "schemaVersion",
      message: "缺少必填字段：schemaVersion。",
      suggestion: "请添加 \"schemaVersion\": 2。",
    });
  } else if (![1, 2].includes(data.schemaVersion)) {
    errors.push({
      level: "error",
      code: "UNSUPPORTED_SCHEMA_VERSION",
      field: "schemaVersion",
      message: `不支持的 schemaVersion：${data.schemaVersion}，当前支持版本 1 和 2。`,
      suggestion: "请将 schemaVersion 修改为 2。",
    });
  }

  // 2b. resumeName
  if (!data.resumeName || typeof data.resumeName !== "string") {
    errors.push({
      level: "error",
      code: "MISSING_REQUIRED_FIELD",
      field: "resumeName",
      message: "缺少必填字段：resumeName。",
      suggestion: "请添加 \"resumeName\": \"简历名称\"。",
    });
  }

  // 2c. profile
  if (!data.profile || typeof data.profile !== "object" || Array.isArray(data.profile)) {
    errors.push({
      level: "error",
      code: "MISSING_REQUIRED_FIELD",
      field: "profile",
      message: "缺少必填字段：profile（必须为对象）。",
      suggestion: "请添加 \"profile\": { ... }。",
    });
  } else {
    const requiredProfileFields = ["name", "headline", "phone", "email"];
    for (const field of requiredProfileFields) {
      if (!data.profile[field] || typeof data.profile[field] !== "string") {
        errors.push({
          level: "error",
          code: "MISSING_PROFILE_FIELD",
          field: "profile." + field,
          message: `profile 缺少必填字段：${field}。`,
          suggestion: `请添加 \"${field}\": \"值\"。`,
        });
      }
    }
  }

  // 2d. sections
  if (!Array.isArray(data.sections)) {
    errors.push({
      level: "error",
      code: "MISSING_REQUIRED_FIELD",
      field: "sections",
      message: "缺少必填字段：sections（必须为数组）。",
      suggestion: "请添加 \"sections\": [ ... ]。",
    });
  } else {
    const sectionTypesSeen = new Set();

    for (let i = 0; i < data.sections.length; i++) {
      const section = data.sections[i];
      const sectionLabel = "sections[" + i + "]";

      if (!section || typeof section !== "object" || Array.isArray(section)) {
        errors.push({
          level: "error",
          code: "INVALID_SECTION",
          message: sectionLabel + " 必须为对象。",
          suggestion: "请确保每个 section 是一个对象。",
        });
        continue;
      }

      if (!section.type || typeof section.type !== "string") {
        errors.push({
          level: "error",
          code: "MISSING_SECTION_TYPE",
          message: sectionLabel + " 缺少 type 字段。",
          suggestion: "请添加 \"type\": \"education\" 等字段。",
        });
        continue;
      }

      if (!ALLOWED_SECTION_TYPES.includes(section.type)) {
        errors.push({
          level: "error",
          code: "UNKNOWN_SECTION",
          section: section.type,
          message: `未知栏目类型：${section.type}。支持：${ALLOWED_SECTION_TYPES.join("、")}。`,
          suggestion: "请使用已支持的栏目类型。",
        });
        continue;
      }

      if (section.type !== "custom" && sectionTypesSeen.has(section.type)) {
        errors.push({
          level: "warning",
          code: "DUPLICATE_SECTION",
          section: section.type,
          message: `栏目 "${section.type}" 重复。`,
          suggestion: "第一个之外的重复栏目将被保留但可能导致排版问题。",
        });
      }
      if (section.type !== "custom") sectionTypesSeen.add(section.type);

      if (section.type === "custom") {
        if (!section.title || typeof section.title !== "string") {
          errors.push({
            level: "error",
            code: "MISSING_SECTION_TITLE",
            section: "custom",
            message: `${sectionLabel} 缺少 title 字段。`,
            suggestion: "请添加 \"title\": \"板块名称\"。",
          });
        }
        if (!Array.isArray(section.blocks)) {
          errors.push({
            level: "error",
            code: "INVALID_BLOCKS",
            section: "custom",
            message: `${sectionLabel} 的 blocks 必须为数组。`,
            suggestion: "请添加 \"blocks\": [ ... ]。",
          });
        } else {
          validateJsonCustomBlocks(section.blocks, sectionLabel, errors);
        }
        continue;
      }

      // Validate entries
      if (!Array.isArray(section.entries)) {
        errors.push({
          level: "error",
          code: "INVALID_ENTRIES",
          section: section.type,
          message: `${sectionLabel}（类型 ${section.type}）的 entries 必须为数组。`,
          suggestion: "请添加 \"entries\": [ ... ]。",
        });
        continue;
      }

      for (let j = 0; j < section.entries.length; j++) {
        const entry = section.entries[j];
        const entryLabel = sectionLabel + ".entries[" + j + "]";
        const entryName = (entry && entry.name) ? entry.name : `第 ${j + 1} 个条目`;

        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          errors.push({
            level: "error",
            code: "INVALID_ENTRY",
            section: section.type,
            message: entryLabel + " 必须为对象。",
            suggestion: "请确保每个 entry 是一个对象。",
          });
          continue;
        }

        // Non-skills entries need name
        if (section.type !== "skills" && (!entry.name || typeof entry.name !== "string")) {
          errors.push({
            level: "error",
            code: "MISSING_ENTRY_NAME",
            section: section.type,
            message: `${section.type} 栏目下存在未命名的条目（${entryLabel}）。`,
            suggestion: "请添加 \"name\": \"名称\"。",
          });
        }

        // education/experience need role and date
        if (section.type === "education" || section.type === "experience") {
          if (!entry.role || typeof entry.role !== "string") {
            errors.push({
              level: "error",
              code: "MISSING_ROLE",
              section: section.type,
              entry: entryName,
              message: `${section.type} 栏目下"${entryName}"缺少 role 字段。`,
              suggestion: "请添加 \"role\": \"角色\"。",
            });
          }
          if (!entry.date || typeof entry.date !== "string") {
            errors.push({
              level: "error",
              code: "MISSING_DATE",
              section: section.type,
              entry: entryName,
              message: `${section.type} 栏目下"${entryName}"缺少 date 字段。`,
              suggestion: "请添加 \"date\": \"时间范围\"。",
            });
          }
        }

        // projects: warn for missing role/date
        if (section.type === "projects") {
          if (!entry.role || typeof entry.role !== "string") {
            errors.push({
              level: "warning",
              code: "MISSING_PROJECT_ROLE",
              section: "projects",
              entry: entryName,
              message: `projects 栏目下"${entryName}"缺少 role 字段。`,
              suggestion: "建议添加 role 指明项目角色。",
            });
          }
          if (!entry.date || typeof entry.date !== "string") {
            errors.push({
              level: "warning",
              code: "MISSING_PROJECT_DATE",
              section: "projects",
              entry: entryName,
              message: `projects 栏目下"${entryName}"缺少 date 字段。`,
              suggestion: "建议添加 date 指明项目时间。",
            });
          }
        }

        // Validate bullets
        if (entry.bullets !== undefined && entry.bullets !== null) {
          if (!Array.isArray(entry.bullets)) {
            errors.push({
              level: "error",
              code: "INVALID_BULLETS",
              section: section.type,
              entry: entryName,
              message: `${section.type} 栏目下"${entryName}"的 bullets 必须为字符串数组。`,
              suggestion: "请使用 \"bullets\": [\"描述1\", \"描述2\"] 格式。",
            });
          } else {
            for (let k = 0; k < entry.bullets.length; k++) {
              if (typeof entry.bullets[k] !== "string") {
                errors.push({
                  level: "error",
                  code: "INVALID_BULLET",
                  section: section.type,
                  entry: entryName,
                  message: `${section.type} 栏目下"${entryName}"的 bullets[${k}] 必须为字符串。`,
                  suggestion: "请确保每个 bullet 是字符串。",
                });
              }
            }
          }
        }
      }
    }
  }

  // Check for error-level issues
  const hasErrors = errors.some((e) => e.level === "error");
  if (hasErrors) {
    return { errors, state: null };
  }

  // Build state
  const state = buildStateFromJson(data, fileName);
  if (data.formatterState !== undefined) {
    if (data.formatterState && data.formatterState.version === 1
      && typeof applyFormatterFileState === "function") {
      applyFormatterFileState(state, data.formatterState);
      state.importSnapshot = createImportSnapshot(state);
    } else {
      errors.push({
        level: "warning",
        code: "INVALID_FORMATTER_STATE",
        message: "JSON 中的排版设置无法识别，已使用默认排版。",
      });
    }
  }

  // Generate info summary
  const summaryItems = [];
  const eduCount = data.sections.find((s) => s.type === "education")?.entries?.length || 0;
  const expCount = data.sections.find((s) => s.type === "experience")?.entries?.length || 0;
  const projCount = data.sections.find((s) => s.type === "projects")?.entries?.length || 0;
  const skillSection = data.sections.find((s) => s.type === "skills");
  const skillCount = skillSection?.entries?.[0]?.bullets?.length || 0;
  const customCount = data.sections.filter((section) => section.type === "custom").length;

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
    message: `已导入（JSON）：${fileName}。识别到：${summaryItems.join("、") || "无内容"}。存在：${errorCount} 个错误、${warningCount} 个警告。`,
  });

  return { errors, state };
}

/**
 * Build a Resume State from parsed JSON data.
 * Output structure is identical to validator.js buildState().
 * @param {object} data - Parsed JSON data
 * @param {string} fileName
 * @returns {object}
 */
function buildStateFromJson(data, fileName) {
  const now = new Date().toISOString();
  const state = createDefaultState();

  state.documentId = generateId();
  state.resumeName = data.resumeName || "";
  state.source.fileName = fileName;
  state.source.importedAt = now;
  state.source.sourceType = "json";
  state.schemaVersion = data.schemaVersion || 1;

  const profile = data.profile || {};
  state.profile.name = profile.name || "";
  state.profile.headline = profile.headline || "";
  state.profile.location = profile.location || "";
  state.profile.phone = profile.phone || "";
  state.profile.email = profile.email || "";
  state.profile.website = profile.website || "";
  state.profile.portfolio = profile.portfolio || "";
  state.profile.github = profile.github || "";

  state.sections = (data.sections || []).map((section) => ({
    id: generateId(),
    type: section.type,
    title: section.title || getSectionTitle(section.type),
    blocks: (section.blocks || []).map((block) => buildJsonCustomBlock(block)),
    entries: (section.entries || []).map((entry) => ({
      id: generateId(),
      name: entry.name || "",
      role: entry.role || "",
      date: entry.date || "",
      location: entry.location || "",
      bullets: (entry.bullets || []).map((b) => ({
        id: generateId(),
        content: parseBoldTokens(typeof b === "string" ? b : "", 0, []),
      })),
    })),
  }));

  touchState(state);
  state.importSnapshot = createImportSnapshot(state);

  return state;
}

function validateJsonCustomBlocks(blocks, sectionLabel, errors) {
  blocks.forEach((block, index) => {
    const label = `${sectionLabel}.blocks[${index}]`;
    if (!block || typeof block !== "object" || !["text", "list", "entry"].includes(block.type)) {
      errors.push({
        level: "error",
        code: "INVALID_BLOCK",
        section: "custom",
        message: `${label} 必须是 text、list 或 entry 内容块。`,
      });
      return;
    }
    if (block.type === "text" && typeof block.content !== "string") {
      errors.push({ level: "error", code: "INVALID_BLOCK_CONTENT", section: "custom", message: `${label}.content 必须是字符串。` });
    }
    if (block.type === "list" && (!Array.isArray(block.items) || block.items.some((item) => typeof item !== "string"))) {
      errors.push({ level: "error", code: "INVALID_BLOCK_ITEMS", section: "custom", message: `${label}.items 必须是字符串数组。` });
    }
    if (block.type === "entry" && typeof block.name !== "string") {
      errors.push({ level: "error", code: "INVALID_BLOCK_ENTRY", section: "custom", message: `${label}.name 必须是字符串。` });
    }
    if (block.type === "entry" && block.bullets !== undefined
      && (!Array.isArray(block.bullets) || block.bullets.some((item) => typeof item !== "string"))) {
      errors.push({ level: "error", code: "INVALID_BLOCK_BULLETS", section: "custom", message: `${label}.bullets 必须是字符串数组。` });
    }
  });
}

function buildJsonCustomBlock(block) {
  if (block.type === "text") {
    return { id: generateId(), type: "text", content: parseBoldTokens(block.content || "", 0, []) };
  }
  if (block.type === "list") {
    return {
      id: generateId(),
      type: "list",
      bullets: (block.items || []).map((item) => ({
        id: generateId(),
        content: parseBoldTokens(item, 0, []),
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
    bullets: (block.bullets || []).map((item) => ({
      id: generateId(),
      content: parseBoldTokens(item, 0, []),
    })),
  };
}
