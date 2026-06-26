# 微信文章抓取器 · Chrome 浏览器插件 v0.2.2

一键抓取微信公众号文章，保存为 Markdown + 图片到本地，支持同步至飞书云文档。

---

## ✨ 功能

- **📥 一键抓取**：自动提取文章标题、作者、正文和所有配图
- **📝 Markdown 转换**：自研 HTML→Markdown 引擎，零依赖
- **🖼️ 图片下载**：自动下载所有配图
- **📦 ZIP 打包**：文章 + 图片 + 元数据打包下载
- **☁️ 飞书同步双通道**：
  - 🖥️ **通道 1**：自动检测本地 `lark-cli` 服务，有就用（零配置）
  - 🔑 **通道 2**：飞书 API 直连，配置 App ID/Secret 即可（无需安装任何东西）

## 🚀 安装

1. 打开 `chrome://extensions/` → 开启「开发者模式」
2. 点击「加载已解压的扩展程序」→ 选择 `wechat-capture-extension/` 文件夹
3. 工具栏出现绿色图标，安装完成

## 📖 使用

1. 打开任意微信公众号文章
2. 点击插件图标 →「📥 抓取文章」
3. ZIP 自动下载到本地
4. [可选] 点击「☁️ 同步到飞书」

## ☁️ 飞书同步 — 双通道说明

插件会**自动选择**可用通道：

| 通道 | 条件 | 需要什么 |
|------|------|---------|
| **lark-cli** | 本地运行了 `companion/feishu_sync_server.py` | 已安装 `lark-cli` + 已登录飞书 |
| **API 直连** | 未检测到 lark-cli 服务 | 在设置中填入飞书 App ID + App Secret |

### 通道 1：lark-cli（自用推荐）

```bash
cd companion
python3 feishu_sync_server.py
```

### 通道 2：API 直连（给别人用）

1. 前往 [飞书开放平台](https://open.feishu.cn/app) 创建企业自建应用
2. 获取 App ID 和 App Secret
3. 在插件设置页面填入，点击「测试连接」
4. 配置完成，无需任何本地服务

## 📄 许可

MIT

---

Made with ❤️ by WorkBuddy
