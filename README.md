# 哔哩轻小说打包下载器

将 [哔哩轻小说](https://m.bilinovel.com) 和 [轻小说文库](https://linovelib.com) 的小说打包为 EPUB 电子书的 Tampermonkey 用户脚本。

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展
2. [点此安装脚本](https://raw.githubusercontent.com/202310011168/bili-novel-downloader/master/bili-novel-downloader.user.js)
3. 打开任意支持的小说页面，右下角出现 **EPUB** 按钮

## 支持站点

- `m.bilinovel.com` / `www.bilinovel.com` / `bilinovel.com`
- `m.linovelib.com` / `www.linovelib.com` / `linovelib.com`

## 功能

- EPUB 3.0 导出，含插图、目录、封面、元数据
- 分卷选择下载
- 智能封面识别（自动选竖图）
- 反爬调度（15次/分钟，触发反爬自动暂停）
- 段落打乱还原
- 无链接章节 URL 自动推导
- 苹果风格 UI，可拖动
- 日志持久化，支持跨会话查看

## Node.js 调试

```bash
npm install
node test/node_test.mjs <URL> --no-down      # 查看信息
node test/node_test.mjs <URL> --volumes 1     # 下载第1卷
```

## License

MIT
