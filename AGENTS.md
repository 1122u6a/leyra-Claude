# Leyra Windows 开发说明

开始前阅读 README.md、docs/MAC-PRODUCT.md 和 docs/WINDOWS-IMPLEMENTATION.md。用户要求继续做 Windows 版时先运行 `npm.cmd test`，再开始第一阶段的实现。把能运行的代码、测试和验证结果提交给用户。遇到缺失的 Windows 运行条件时写明具体条件与验证结果。

- 先用模拟线路完成 Windows 桌面入口和接管接口，再接真实内核与系统网络。界面以真实核验状态驱动，只有核验成功才显示「实时守护中」。
- 共用代码在 `src/`。把 Mac 专用的权限、系统代理、虚拟网卡、时区和进程路径放在平台适配边界。Mac 补丁目录用于参考，构建 Windows 版从新的 Windows 入口启动。
- 启动默认拦截受管的 Claude 流量。线路故障时保留其他网站和 Codex 的网络路径。同 IP 可自动恢复，不同 IP 由用户确认后重新核验。
- 测试用保留地址、模拟代理和内存账号。现网、账户授权、手机配置、官网和 GitHub 的 Mac 发布由用户单独授权操作。
- 提交前检查 `npm.cmd test` 和已覆盖的 Windows 验收项，区分离线通过与真机通过。
