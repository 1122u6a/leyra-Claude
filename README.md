# Leyra Windows 开发项目

这是 Leyra 的 Windows 开发基线，产品和行为以实际发布的 Mac **1.1.8** 为准。仓库里有可复用的业务代码、测试、Mac 界面规格和 Windows 实现任务。完整的原始 Electron 工程未找回，Windows 桌面壳和系统接管层是接下来的开发工作。

## 在 Windows 拉取

```powershell
git clone --branch codex/windows-dev --single-branch https://github.com/1122u6a/leyra-Claude.git Leyra-Windows
Set-Location Leyra-Windows
npm.cmd test
```

测试需要 Node.js 24，使用模拟线路、内存数据库和本机回环。仓库当前的测试无需安装额外依赖。也可用 PowerShell 执行 `scripts/check.ps1` 检查 Node 版本再跑测试。

在 Windows Codex 打开克隆后的 `Leyra-Windows` 文件夹，发这句就能开始：

> 读根目录 AGENTS.md 和 docs/MAC-PRODUCT.md，先跑 npm.cmd test。直接实现 docs/WINDOWS-IMPLEMENTATION.md 里第一阶段的 Windows 桌面壳和安全接管验证，用实际代码和测试交付。按 Mac 页面规格做，先在隔离环境用模拟线路联调。

## 从哪里读起

| 文件或目录 | 内容 |
| --- | --- |
| [Mac 界面与功能规格](docs/MAC-PRODUCT.md) | 页面结构、按钮含义、状态和文案、用户操作流程 |
| [Windows 实现任务与验收](docs/WINDOWS-IMPLEMENTATION.md) | 第一阶段的具体交付、小步实现顺序、适配范围、真机测试清单 |
| [AGENTS.md](AGENTS.md) | Codex 打开项目时读取的工作说明 |
| [src](src/) | 出口自动检测、保护状态机、备用选择、规则、时区参考、诊断名称 |
| [design](design/) | 橙底 Leyra 字标、橙色界面片段、状态列表和时间条代码 |
| [api-reference](api-reference/) | 现有账号、试用、授权、设备 API 的实现快照和测试 |
| [mac-overlay](mac-overlay/) | Mac 主进程接线与发布补丁参考，有助于对照入口和生命周期 |

Mac 安装包和版本基线见 [Mac 1.1.8 Release](https://github.com/1122u6a/leyra-Claude/releases/tag/v1.1.8)。
