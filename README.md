# Leyra 官网源码

本仓库包含官网 19 个现有页面的 HTML、CSS、JavaScript、品牌图片、演示截图和 MiSans 字体。首页入口为 `index.html`，文档中心入口为 `docs/index.html`。

## 发布静态页面

1. 把本目录中的文件复制到 GitHub 仓库的根目录，保留隐藏文件 `.nojekyll`。
2. 进入仓库的 **Settings → Pages → Build and deployment**，选择 **Deploy from a branch**。
3. 选择对应分支和 **/(root)**，保存后打开 Pages 提供的地址。

页面和资源使用相对路径，兼容 `用户名.github.io/仓库名/`。首次导入时可以用 `python3 -m http.server 8080` 在本地预览。

## 发布 Mac 安装包

用 GitHub Releases 创建 `v1.1.3`，上传 `Leyra-v1.1.3-macOS-arm64.dmg` 和配套校验文件。安装包约 184 MiB，超出普通 Git 仓库的 100 MiB 单文件限制。官网中的下载按钮默认连接正式官网，已经可以下载该版本。需要改用 GitHub Release 下载时，把页面内的正式官网安装包链接替换为该 Release 的资产链接即可。 [GitHub 大文件文档](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)

官网域名为 `client-api.leyra.xin`。注册、邮件、授权和 API 由现有生产服务提供。此包包含静态官网源码。

原站有 9 个历史文档链接缺少对应页面。此源码包将这些链接导向文档中心。
