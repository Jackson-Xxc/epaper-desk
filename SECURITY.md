# 安全策略

## 支持范围

安全修复优先覆盖最新发布版本。旧版本可能不会单独回补。

## 报告安全问题

请通过 GitHub 仓库的 Security Advisory 私密报告，不要创建公开 Issue。

报告中可以包含复现步骤和脱敏日志，但不要提交：

- 飞书 App Secret、访问令牌或刷新令牌
- `.codex/auth.json` 内容
- 个人日历 ID、任务内容或私人日程
- Windows 用户数据目录中的 `settings.json`

## 本地凭据

应用通过 Electron `safeStorage` 使用 Windows 系统能力加密飞书敏感字段。
如果系统不提供加密能力，应用会退回明文保存；请不要在不受信任或多人共用的 Windows
账户中录入敏感凭据。

Codex 周额度自动读取属于实验功能，依赖本机已有登录状态和非公开接口，可随时在设置中关闭。
