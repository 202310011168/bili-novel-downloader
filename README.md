<div align="center">

# 📖 哔哩轻小说打包下载器

将哔哩轻小说（`linovelib.com` / `bilinovel.com`）打包为 **EPUB 电子书**的 Tampermonkey 用户脚本。

![Tampermonkey](https://img.shields.io/badge/Tampermonkey-≥4.0-brightgreen)
![Version](https://img.shields.io/github/v/release/202310011168/bili-novel-downloader)
![License](https://img.shields.io/github/license/202310011168/bili-novel-downloader)

</div>

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

- [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展（已安装）
## 🌙 深色模式

脚本自动跟随系统主题切换浅色/深色模式。

### 安装步骤

1. **安装脚本** — 点击下方链接，Tampermonkey 会自动打开安装页面

   [![安装脚本](https://img.shields.io/badge/Install-%E2%86%97%EF%B8%8F%20%E7%82%B9%E6%AD%A4%E5%AE%89%E8%A3%85-007AFF)](https://raw.githubusercontent.com/202310011168/bili-novel-downloader/master/bili-novel-downloader.user.js)

2. **点击「安装」** — 在 Tampermonkey 安装页面点击右上角的「安装」按钮

3. **打开小说页** — 访问任意支持的小说详情页或目录页

4. **开始使用** — 页面右下角会出现 **EPUB** 按钮，点击即可打开下载面板

> 脚本会自动检查更新，有新版本时 Tampermonkey 会提示。

---

## 📖 使用指南

### 第一步：打开小说页面

支持以下任意页面：

```
哔哩轻小说 详情页  →  https://www.bilinovel.com/novel/{id}.html
哔哩轻小说 目录页  →  https://www.bilinovel.com/novel/{id}/catalog
哔哩轻小说 章节页  →  https://www.bilinovel.com/novel/{id}/{chapter}.html
```

支持域名：`bilinovel.com` / `linovelib.com` 及其 `m.` / `www.` 子域名。

### 第二步：选择分卷

面板会显示小说信息和分卷列表：

- 每卷左侧有单选按钮，**只能选一卷**
- 点击「展开全部」可查看所有卷（小说页面时默认只显示当前卷）
- 选择完毕，点击底部的「开始下载」

> 📸 *下载面板 - 分卷选择*
> <img width="1110" height="1304" alt="image" src="https://github.com/user-attachments/assets/732bd6d1-281e-4aa5-897e-98fb2c302423" />


### 第三步：等待下载完成

下载过程中：

- 面板会最小化为进度指示器（右下角）
- 进度条显示整体进度
- 日志区域显示详细下载信息
- 下载完成后自动弹出保存文件对话框




## ✨ 功能特性

| 特性 | 说明 |
|------|------|
| **EPUB 3.0 导出** | 含插图、目录、封面、元数据 |
| **分卷选择** | 每次下一卷，避免浏览器拦截多文件下载 |
| **智能封面** | 自动识别竖图作为封面 |
| **反爬调度** | 请求限速 15 次/分钟，触发反爬自动暂停 |
| **段落还原** | 自动还原被打乱的段落顺序 |
| **URL 推导** | 自动推导无链接章节的地址 |
| **毛玻璃 UI** | 原生风格界面，支持拖拽 |
| **日志系统** | 每次下载独立日志，可复制/清空 |

---

