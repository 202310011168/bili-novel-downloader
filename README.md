<div align="center">

# 📖 哔哩轻小说打包下载器

将哔哩轻小说（`linovelib.com` / `bilinovel.com` / `bilinovel.net`）打包为 **EPUB 电子书**的 Tampermonkey 用户脚本。

![Tampermonkey](https://img.shields.io/badge/Tampermonkey-%E2%89%A54.0-brightgreen)
![License](https://img.shields.io/github/license/202310011168/bili-novel-downloader)
![Last commit](https://img.shields.io/github/last-commit/202310011168/bili-novel-downloader)

**当前脚本版本：`v4.1.9`**（同步上游 bili_novel_packer v0.2.49 逻辑 + 实际站点修正）

</div>

---

## 🧭 简介

在小说页面右下角点一下，即可把整本（或某一卷）哔哩轻小说打包成 **EPUB 3.0** 电子书：

- 自动抓取目录、章节正文与插图；
- 自动识别/下载封面；
- 支持「📁 保存到指定目录」——在所选父目录下**自动创建「编号+书名」文件夹**（如 `1恶魔高校DxD`）；
- 纯浏览器内打包，不上传任何数据。

> 脚本元数据已配置自动更新源（指向本仓库 master），有新版本时 Tampermonkey 会自动提示更新。

---

## 📖 关于上游项目

本用户脚本是 **JavaScript / Tampermonkey 移植版**，核心抓取与 EPUB 打包逻辑参考自：

- 原作者：**Spark（Sparks）**
- 原项目：**bili_novel_packer / 轻小说打包器**
- GitHub：<https://github.com/Montaro2017/bili_novel_packer>
- Gitee：<https://gitee.com/Montaro2017/bili_novel_packer>
- 协议：MIT License，Copyright (c) 2023 Sparks

使用方案说明：

1. 本仓库保留上游 Dart 项目作为参考，不声明为完全独立原创；
2. 上游更新时，本脚本会尽量同步抓取/打包逻辑；
3. 浏览器端 UI、保存目录、脚本安装方式等为 JS 移植版附加功能；
4. 使用与分发请遵守上游 MIT License，并保留原作者版权信息。

---

## 📥 安装

### 前提条件

- [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展（推荐 Chrome / Edge）

### 安装步骤

1. **安装脚本** —— 点击下方按钮，Tampermonkey 会自动打开安装页面

   [![安装脚本](https://img.shields.io/badge/Install-%E2%86%97%EF%B8%8F%20%E7%82%B9%E6%AD%A4%E5%AE%89%E8%A3%85-007AFF)](https://raw.githubusercontent.com/202310011168/bili-novel-downloader/master/bili-novel-downloader.user.js)

2. **确认安装** —— 在 Tampermonkey 安装页面点击右上角「安装」按钮

3. **打开小说页** —— 访问任意支持的小说详情页或目录页

4. **开始使用** —— 页面右下角出现 **EPUB** 按钮，点击即可打开下载面板

---

## 🚀 使用指南

### 第一步：打开小说页面

支持以下任意页面：

```text
哔哩轻小说 详情页  →  https://www.bilinovel.net/novel/{id}.html
哔哩轻小说 目录页  →  https://www.bilinovel.net/novel/{id}/catalog
哔哩轻小说 章节页  →  https://www.bilinovel.net/novel/{id}/{chapter}.html
```

支持域名：`bilinovel.net`（当前主域）/ `bilinovel.com` / `linovelib.com`，均含 `www.` / `m.` 子域。

### 第二步（推荐）：选择保存目录

点击面板底部的「📁 保存位置」，选择一个父目录（如 `D:\novels`）。之后下载会自动存入该目录：

- 浏览器会**自动创建「编号+书名」文件夹**，编号取小说详情页网址中的 `<id>`；
- 目录记忆保存在 IndexedDB（按域名隔离），下次打开自动恢复；
- 仅 **Chrome / Edge** 支持；Firefox / Safari 会自动回退到浏览器默认下载目录（文件名仍含书名）。

**示例**（《恶魔高校DxD》的详情页是 `/novel/1.html`）：

```text
D:\novels\
└── 1恶魔高校DxD\
    └── 恶魔高校DxD 25 暑期讲习的世界树.epub
```

### 第三步：选择分卷并下载

面板会显示小说信息和分卷列表：

- 每卷左侧有单选按钮，**一次只下载一卷**（避免浏览器拦截多文件下载）；
- 点击「展开全部」可查看所有卷（小说页面时默认只显示当前卷）；
- 选择完毕，点击底部的「开始下载」。

> 📸 *下载面板 - 分卷选择*
> <img width="820" alt="下载面板 - 分卷选择" src="https://github.com/user-attachments/assets/732bd6d1-281e-4aa5-897e-98fb2c302423" />

### 第四步：等待下载完成

下载过程中：

- 面板会最小化为右下角的进度指示器；
- 进度条与日志区域实时显示整体进度与详细信息；
- 完成后日志显示 `已保存到 {编号}{书名}/{文件名}`，即保存成功。

---

## ✨ 功能特性

| 特性 | 说明 |
|------|------|
| **EPUB 3.0 导出** | 含插图、目录、封面、元数据 |
| **保存到指定目录** | File System Access API 选择目录，自动建「编号+书名」文件夹，IndexedDB 记忆上次目录 |
| **分卷下载** | 每次下载一卷，避免浏览器拦截多文件下载 |
| **智能封面** | 自动识别竖图作为封面，支持卷封面优先 |
| **反爬调度** | 请求限速 15 次/分钟，触发反爬自动暂停 |
| **段落还原** | 自动还原被打乱的段落顺序 |
| **URL 推导** | 自动推导无链接章节的地址 |
| **深色模式** | 自动跟随系统主题切换浅色/深色 |
| **毛玻璃 UI** | 原生风格界面，支持拖拽 |
| **日志系统** | 每次下载独立日志，可复制/清空 |

---

## 📦 更新历史

- **v4.1.9** 修复长章节翻页超时导致失败的问题；优化「停止 / 取消」流程（取消后干净退出、不误产空文件）；插图按 URL 去重；日志本地存储与 DOM 均设上限，避免长时间下载写爆配额。
- **v4.1.8** 同步上游 bili_novel_packer v0.2.49 封面逻辑。
- **v4.1.7** 同步上游 bili_novel_packer v0.2.49 抓取逻辑，并适配站点反爬更新。

---

## 📌 注意事项

- 保存目录功能基于浏览器 File System Access API，**仅 Chrome / Edge 支持**；其余浏览器自动回退默认下载；
- 浏览器安全限制下无法直接写任意磁盘路径，需先手动「选择一次父目录」；
- 为触发浏览器下载，每次仅下载一卷；
- 若站点改版导致异常，可参考上游 [bili_novel_packer](https://github.com/Montaro2017/bili_novel_packer) 的更新再调整。

---

## 🙏 致谢与许可

感谢上游作者 **Spark** 的 [bili_novel_packer](https://github.com/Montaro2017/bili_novel_packer)（轻小说打包器）。本脚本为 JS 移植版，遵循上游 **MIT License**，使用与分发请保留原作者版权信息。
