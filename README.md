# 墨水屏桌面 · EPaper Desk

[![License: MIT](https://img.shields.io/badge/License-MIT-1e654c.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Windows-10%20%2F%2011-1e654c.svg)](#兼容性)
[![Electron](https://img.shields.io/badge/Electron-37-1e654c.svg)](package.json)
[![Check](https://github.com/Jackson-Xxc/epaper-desk/actions/workflows/check.yml/badge.svg)](https://github.com/Jackson-Xxc/epaper-desk/actions/workflows/check.yml)

为 4.2 英寸 `AESL0420C / nRF52811` 黑白红电子价签制作的 Windows 桌面控制程序。
它把飞书排班、任务、Codex 周额度和节假日倒数整理成 400 × 300 的三色桌面信息屏，
并通过蓝牙低功耗传送到 `EPD-nRF5` 固件。

![墨水屏桌面主界面](docs/images/app-overview.png)

## 屏幕效果

![400×300 黑白红屏幕预览](docs/images/screen-preview.png)

## 内容模式

“内容”页可以随时切换 5 种主内容，底部七日排班和顶部 Codex 周额度保持显示。

![主内容模式切换菜单](docs/images/content-mode-menu.png)

### 今日日程

![今日日程模式](docs/images/mode-agenda.png)

### 任务清单

按创建时间倒序显示最新的未完成任务。

![任务清单模式](docs/images/mode-tasks.png)

### 休假倒数

显示下一次休息、最近法定假日和下一次长假。

![休假倒数模式](docs/images/mode-countdown.png)

### 自定义便签

![自定义便签模式](docs/images/mode-note.png)

### 图片展示

支持导入 JPG、PNG、WebP，调整缩放与位置后自动转换为黑、白、红三色。

![图片展示模式](docs/images/mode-photo.png)

### 飞书与 Codex 数据源

![飞书日历与任务配置](docs/images/content-feishu.png)

![Codex 周额度配置](docs/images/content-codex.png)

> 文档截图均使用虚构的示例日程、任务和原创几何图片，不包含个人信息或登录凭据。

## 功能

- 400 × 300 黑白红像素预览、PNG 导出与图片三色化。
- Web Bluetooth 设备选择、连接、自动重连、清屏、同步时间、休眠和指示灯控制。
- 针对 Windows GATT 提供自动、快速、均衡、稳定、极稳档；自动档会在失败后
  重新连接，并依次使用均衡、稳定、极稳档从头完整重传。
- 飞书 OAuth 一键登录，访问令牌自动续期；敏感凭据使用 Electron `safeStorage` 加密。
- 自动读取主日历和名称含“排班、班表、值班、轮班”的日历。
- 手填日历 ID 只作为附加来源，不会覆盖自动发现的排班日历。
- 根据飞书事件判断“班 / 休”；尚未排班时使用法定节假日和周末双休兜底。
- 读取指定飞书任务清单，按创建时间倒序显示最新未完成任务。
- 主内容支持今日日程、任务清单、休假倒数、自定义便签和图片。
- 显示 Codex 7 天窗口剩余比例和下次重置时间。
- 每 15～1440 分钟自动检查，仅在内容变化时刷新，发送成功后可自动断开蓝牙。
- 系统托盘驻留和 Windows x64 便携版打包。

## 兼容性

| 项目 | 当前支持 |
| --- | --- |
| 操作系统 | Windows 10 / 11 x64 |
| 屏幕 | AESL0420C，400 × 300，黑 / 白 / 红 |
| 主控 | nRF52811 / nRF52 |
| 固件 | 广播名称以 `NRF_EPD` 开头的 EPD-nRF5 兼容固件 |
| 蓝牙 | Web Bluetooth；另含实验性 WinRT 原生辅助程序 |
| 飞书 | 企业自建应用，OAuth v3 |

> 仓库不包含电子价签固件。不同尺寸、不同 UUID 或不同分包格式的固件需要自行适配。

## 快速开始

### 使用便携版

从仓库的 **Releases** 页面下载最新的
`EPaper-Desk-<版本>-portable.exe`，直接运行，无需安装。

1. 唤醒电子价签并让它进入蓝牙广播状态。
2. 点击“选择并连接设备”，选择名称以 `NRF_EPD` 开头的设备。
3. 在“内容”页选择要显示的内容，点击“重新生成”检查预览。
4. 点击“发送到墨水屏”，等待设备完成整屏刷新。

### 从源码运行

需要 Node.js 20+、pnpm，以及 Windows 10/11。

```powershell
pnpm install
pnpm start
```

运行静态语法检查：

```powershell
pnpm run check
```

构建 Windows 便携版：

```powershell
pnpm run pack
```

构建原生 BLE 辅助程序需要安装 Windows 10/11 SDK。便携版输出到 `release/`，
该目录不会提交到 Git。

## 飞书排班判断

软件会读取主日历，以及名称包含“排班、班表、值班、轮班”的可见日历。
每天按以下优先级判断：

1. 排班日历事件的标题或描述含“休息、休假、放假、假期、节假日、请假、调休” → **休**。
2. 当天存在其他排班事件（例如 `T1_姓名`）→ **班**。
3. 普通日历明确含“上班、值班、白班、夜班、T1”等 → **班**。
4. 没有排班数据 → 使用内置法定节假日、调休工作日和周末规则。

完整配置见 [飞书 OAuth 配置](docs/FEISHU_SETUP.md)。

## Codex 周额度说明

OpenAI 目前没有公开的个人 Codex 周额度 API。自动读取功能会在用户主动启用后读取本机
`.codex/auth.json`，并调用 ChatGPT 的非公开 usage 接口。程序只把剩余比例和重置时间交给
界面，不会把 OAuth token 写入日志或屏幕。

该接口可能随时变化；读取失败时可改用手动数据。此功能与 OpenAI 官方无隶属或背书关系。

## 蓝牙与协议

- GATT Service：`62750001-d828-918d-fb46-b6c11c675aec`
- Characteristic：`62750002-d828-918d-fb46-b6c11c675aec`
- 两个 1 bit 色层：黑白层 15,000 字节，红色层 15,000 字节
- 稳定发送：2 字节协议头 + 最多 198 字节图像数据

协议笔记见 [EPD-nRF5 蓝牙协议](docs/PROTOCOL.md)，常见连接与传图问题见
[故障排查](docs/TROUBLESHOOTING.md)。

## 隐私与安全

- App Secret、飞书访问令牌、刷新令牌和手动 token 使用 Windows 系统加密能力保存。
- 仓库不包含任何真实 App ID、App Secret、访问令牌、日历 ID、任务数据或 Codex 凭据。
- 本地设置保存在 Electron 用户数据目录，不会写入项目目录。
- 自动同步仅在本机执行，不提供云端中转服务。

发现安全问题请参考 [SECURITY.md](SECURITY.md)，不要在公开 Issue 中粘贴 token 或日志中的个人信息。

## 项目结构

```text
src/                 Electron 主进程、预加载脚本和渲染界面
native/              Windows WinRT BLE 辅助程序源码
scripts/             构建、截图与视觉验证脚本
assets/              程序图标
docs/                配置、协议、排障说明与截图
```

## 参与贡献

欢迎提交兼容性测试、协议适配、界面改进和问题修复。开始前请阅读
[CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

源代码以 [MIT License](LICENSE) 发布。`EPD-nRF5`、飞书、Codex 及相关名称归各自权利人所有。
