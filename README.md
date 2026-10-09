# 简历排版器

一个浏览器本地运行的 Markdown / JSON 简历排版工具。它将结构化简历转换为可编辑的单页 A4 页面，并支持直接保存 Markdown、另存为新版本和通过浏览器导出 PDF。

**[在线使用](https://gracexygu.github.io/resume-formatter/)**

## 适用场景

你已经写好简历内容，希望减少 Word 中反复调整字号、间距、分页和证件照的时间，并稳定得到一份单页 A4 PDF。

```text
结构化简历.md / .json
          ↓
浏览器内预览与微调
          ↓
更新后的 Markdown / A4 PDF
```

## 当前能力

- 打开单个 Markdown / JSON 文件或本地简历文件夹
- 支持旧版中英文栏目与 Schema v2 通用板块
- 可在页面中新增任意名称的板块，混合使用正文、列表和条目
- 提供四种排版风格与字号、行高、局部格式调整
- 直接编辑正文，增删经历、项目和 Bullet
- 拖动调整实习经历中各公司条目的顺序
- 拖动调整教育、实习、项目、技能和自定义板块的全局顺序；拖到工作区上下边缘时会自动滚动
- 本地上传、拖动和缩放证件照
- 实时检测 A4 溢出高度，并提供排版修复入口
- 保存直接写回当前 Markdown，“另存为”创建并切换到新的 Markdown
- Markdown 会保留模板、字号、行高、间距、逐行符号和局部格式
- 通过桌面 Chrome 打印为 PDF
- 使用转换提示词辅助将现有 PDF / Word 简历整理为结构化输入

## 使用环境

当前版本面向桌面端 Chrome。推荐使用最新稳定版 Chrome，并保持浏览器缩放为 100%。移动端布局尚未支持；Safari 和 Firefox 无法使用本地文件夹管理能力。

## 快速开始

### 在线使用

打开 [GitHub Pages](https://gracexygu.github.io/resume-formatter/)，在右侧“打开”菜单选择：

1. `打开文件`：选择单个 Markdown 或 JSON，后续“保存”会按原格式写回这个文件；
2. `打开文件夹`：授权一个本地目录，在侧栏切换多份简历，保存会写回当前文件；
3. 菜单底部可查看 Markdown / JSON 格式示例。

完成微调后：

1. 确认顶部显示 `A4 排版正常`；
2. 点击“保存”覆盖当前 Markdown，或点击“另存为”创建一个新版本；
3. 点击“导出 PDF”，在 Chrome 中选择 A4、100% 缩放、关闭页眉页脚并开启背景图形。

### 本地使用

下载 [`dist/resume-formatter.html`](dist/resume-formatter.html)，双击后使用桌面 Chrome 打开。该文件不依赖服务器和外部资源，可以离线运行。

## Markdown Schema v2

下方以及页面初始加载的“谷雨”简历均为虚构演示数据，仅用于展示高密度单页排版效果，不代表任何人的真实教育或工作经历。

```markdown
---
schema_version: 2
resume_name: 示例科技-产品经理
name: 示例用户
headline: 产品经理
location: 海州市
phone: 1xx-xxxx-xxxx
email: example@example.com
photo: profile.png
---

## 教育经历

### 晨星大学
role: 信息管理｜本科
date: 2022.09-2026.06
location: 海州市

- 主修产品设计与数据分析

## 实习经历

### 星河科技｜产品部
role: 产品实习生
date: 2025.04-2025.08
location: 海州市

- 负责**核心流程**迭代与上线验收

## 项目经历

### 实验管理工具
role: 产品负责人
date: 2025.02-2025.05

- 完成需求分析、原型设计与可用性测试

## 技能

- 产品：用户研究、策略设计、PRD
- 数据：SQL、Excel、看板搭建
```

Bullet 支持 `**加粗**`、`*斜体*` 和 `[链接名称](https://example.com)`。`photo` 为可选字段；从文件夹导入时，照片需与 Markdown 位于同一目录。

排版器保存 Markdown 时会在 Frontmatter 中加入 `resume_formatter_state`，保存 JSON 时会加入 `formatterState`。这些字段只记录恢复排版所需的本地元数据，不影响简历内容；删除后，文件会在下次打开时使用默认排版。

下列栏目是预置模板：

| 中文 | 英文 |
| --- | --- |
| 教育经历 | education |
| 实习经历 / 工作经历 | experience |
| 项目经历 | projects |
| 技能 | skills |

除预置模板外，任意 `## 标题` 都会作为自定义板块导入。自定义板块可以混合使用普通正文、一级列表和 `###` 条目：

```markdown
## 获奖与其他

这是一段可自由编辑的文字。

- 列表内容一
- 列表内容二

### 自定义条目
role: 角色或说明
date: 2025.01-2025.06

- 条目描述
```

Schema v1 文件仍可继续导入；页面中新建自定义板块后，导出为 Schema v2。

## 隐私说明

- 简历内容、照片和文件句柄不会上传到服务器。
- 页面不包含统计脚本、广告脚本或第三方运行时资源。
- 旧版副本、置顶记录和已授权目录句柄可能保存在当前浏览器的 `localStorage` / `IndexedDB` 中。
- 清除该网站的浏览器数据可以移除本地草稿和目录授权记录。
- 保存的 Markdown 与 PDF 由浏览器直接写入用户选择的本地位置。

## 与其他系统集成

本工具可以独立使用，也可以作为求职工作流的排版环节。上游系统负责事实、内容与审核，本工具接收冻结的结构化简历，返回 HTML / PDF 产物与 A4 版面诊断。集成方应通过版本化 Schema 或适配层调用，避免复制源码和私人数据。

## 本地开发

要求 Node.js 18 或更高版本，无 npm 依赖。

```bash
node scripts/build.mjs
node --test tests/*.test.mjs
node scripts/check-release.mjs
```

构建输出：

```text
dist/resume-formatter.html
```

源码结构：

```text
src/        HTML 模板、样式与 JavaScript
fixtures/   公开匿名测试数据
tests/      Parser / Validator 自动化测试
scripts/    构建与发布检查
dist/       单文件发布产物
```

## 已知边界

- 当前面向单页中文 A4 简历；超长内容需要用户删改或调整排版。
- PDF 由 Chrome 打印功能生成，结果受纸张、缩放、页眉页脚和背景图形设置影响。
- 移动端暂未支持。
- 工具只处理排版，不提供 JD 分析、事实审核、AI 改写或自动投递。

## 开源许可证

[MIT License](LICENSE)
