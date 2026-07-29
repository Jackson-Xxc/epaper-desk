# 参与贡献

感谢你愿意改进墨水屏桌面。这个项目直接操作低功耗蓝牙设备，提交前请优先保证现有设备兼容性。

## 开发环境

- Windows 10 / 11 x64
- Node.js 20+
- pnpm
- 构建原生 BLE 辅助程序时需要 Windows 10/11 SDK

```powershell
pnpm install
pnpm start
```

## 提交前检查

```powershell
pnpm run check
```

涉及 400 × 300 布局时，同时运行：

```powershell
.\node_modules\.bin\electron.cmd .\scripts\capture-countdown-preview.js
.\node_modules\.bin\electron.cmd .\scripts\capture-doc-screenshots.js
```

请检查生成的预览是否存在文字截断、灰色抗锯齿或红黑色层误判。

## 兼容性信息

提交蓝牙问题或改动时，请尽量附上：

- Windows 版本与蓝牙适配器型号
- 屏幕型号、固件来源与广播名称
- 设备上报 MTU
- 失败发生在哪个色层、约第几个数据包
- 是否能执行清屏、同步时间等短命令

不要附上飞书 App Secret、访问令牌、Codex token、个人日历 ID 或完整私人日程。

## 代码约定

- 保持现有原生 JavaScript、CSS 和 Electron 架构，不为小功能引入大型依赖。
- 蓝牙写入必须有明确的包长上限、节流策略和错误日志。
- 与时间相关的逻辑使用本地时区，全天日程按本地自然日处理。
- 新增用户可见文案时同时检查 400 × 300 三色预览。
- 每个 Pull Request 聚焦一个明确问题，并写清验证设备和验证方式。
