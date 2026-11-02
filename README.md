<p align="center"><img src="utools/logo.png" width="88" alt="图片工坊"></p>

# 图片工坊 FunImage

![图片工坊界面](docs/screenshots/home.png)

uTools 本地批量图片处理插件。支持压缩、格式转换、调整尺寸、文字与图片水印、圆角、边框、阴影、补边、坐标与手动裁剪、旋转、翻转，以及图片、PDF 和 GIF 合并。额外提供目标 KB 压缩、剪贴板粘贴与单张效果预览。

从 [v0.3.1 Release](https://github.com/farfarfun-utools/utools-funimage/releases/tag/v0.3.1) 下载 `utools-funimage-0.3.1.upxs`，导入 uTools 安装。也可在 CI 中下载开发版插件目录。

本版包含图片阴影处理与 AI/MCP 图片入队工具。

## AI / MCP 工具

`queue_images` 校验 1 至 100 个本机图片绝对路径并加入待处理队列。工具只返回文件名、大小和格式，不读取图片内容，也不自动处理或写文件；用户仍需在插件中选择操作。需 uTools 8 的工具能力，第三方 Agent 还需由用户开启 uTools MCP 服务。

## 使用

从 GitHub Actions 下载 `utools-funimage-developer-files`，再在 uTools 开发者工具中导入其中的 `plugin.json`。输入“图片工坊”打开，也可以在 uTools 中选中图片后使用“用图片工坊处理”。插件支持拖放图片；选择操作，通过右上角设置选择输出文件夹后，可以预览单张效果并开始批量处理。

图片在本地处理，不上传、不保存历史。输出文件使用新文件名；已有同名结果自动加序号，原图不会被覆盖。输入支持 PNG、JPEG、WebP、GIF、BMP、AVIF、ICO；格式转换可输出 PNG、JPEG、WebP、AVIF、GIF、BMP、TIFF、ICO。普通编辑会把动图输入按首帧处理；合并 GIF 会把队列里的图片逐张制成帧。TIFF 暂不支持输入；ICO 输出最大 256 × 256。AVIF 编码依赖当前 uTools Chromium 内核。JPEG/BMP/TIFF/GIF 透明区域填白，重新编码可能移除 EXIF。单张输入上限 32 MB，输出上限 64 MB，画布上限 3200 万像素。PDF 页面的长边最多 3000 像素。目标 KB 不能保证所有图片都能达到；预览会缩至最多 1100 像素。

## 功能对照与后续复查

资料检索于 2026-11-02：[uTools 图片插件搜索](https://www.u-tools.cn/plugins/search/?t=%E5%9B%BE%E7%89%87)及各插件详情页。每行只列一项功能；☑ 表示已有入口和处理逻辑，☐ 表示尚未实现。下次整理时重新核对官方描述和状态。

| 原始插件 | 小功能 | 已实现 | 说明 |
| --- | --- | :---: | --- |
| [图片批量处理](https://www.u-tools.cn/plugins/detail/%E5%9B%BE%E7%89%87%E6%89%B9%E9%87%8F%E5%A4%84%E7%90%86/) | 压缩 | ☑ | 支持质量与目标 KB |
| | 格式转换 | ☑ | TIFF 仅输出；AVIF 取决于内核 |
| | 修改尺寸 | ☑ | 宽度或指定宽高 |
| | 添加文字水印 | ☑ | 文本、位置、颜色、透明度 |
| | 添加图片水印 | ☑ | 宽度、位置、透明度 |
| | 添加圆角 | ☑ | 半径可调 |
| | 添加边框 | ☑ | 宽度与颜色可调 |
| | 补边留白 | ☑ | 画布尺寸与背景色可调 |
| | 按坐标裁剪 | ☑ | 裁剪框数字输入 |
| | 旋转 | ☑ | 90°、180°、270° |
| | 翻转 | ☑ | 水平或垂直 |
| | 合并为图片 | ☑ | 横向或纵向，间距可调 |
| | 合并为 PDF | ☑ | 一图一页 |
| | 合并为 GIF | ☑ | 图片队列逐帧输出 |
| | 手动裁剪 | ☑ | 逐张调整裁剪框 |
| [图片压缩](https://www.u-tools.cn/plugins/detail/%E5%9B%BE%E7%89%87%E5%8E%8B%E7%BC%A9/) | Squoosh 级高压缩编码 | ☐ | 需评估 WASM 体积 |
| [图片拼接](https://www.u-tools.cn/plugins/detail/%E5%9B%BE%E7%89%87%E6%8B%BC%E6%8E%A5/) | 横向拼接 | ☑ | |
| [长图拼接](https://www.u-tools.cn/plugins/detail/%E9%95%BF%E5%9B%BE%E6%8B%BC%E6%8E%A5/) | 纵向拼接 | ☑ | |
| [图片转PDF](https://www.u-tools.cn/plugins/detail/%E5%9B%BE%E7%89%87%E8%BD%ACPDF/) | 多图合并 PDF | ☑ | |
| [WaterMark](https://www.u-tools.cn/plugins/detail/WaterMark/) | 图片水印 | ☑ | |
| [Better Img](https://www.u-tools.cn/plugins/detail/Better%20Img/) | 添加阴影 | ☑ | 模糊、偏移、颜色与不透明度 |
| [GIF动画帧提取](https://www.u-tools.cn/plugins/detail/GIF%E5%8A%A8%E7%94%BB%E5%B8%A7%E6%8F%90%E5%8F%96/) | GIF 逐帧导出 | ☐ | 需保留帧时序 |
| [EasyGIF](https://www.u-tools.cn/plugins/detail/EasyGIF/) | GIF 逐帧编辑 | ☐ | 当前只支持静图合并 GIF |
| | GIF 调速 | ☐ | |
| [图片转换](https://www.u-tools.cn/plugins/detail/%E5%9B%BE%E7%89%87%E8%BD%AC%E6%8D%A2/) | HEIC 解码 | ☐ | 需额外解码器 |
| | 微信 DAT 解码 | ☐ | 需确定格式边界 |

新增功能优先复用 Canvas 和浏览器能力；第三方库打包后仍以插件目录小于 5 MB 为目标。目前 `utools/` 约 700 KB。HEIC、Squoosh、完整 GIF 编辑先评估体积和跨平台兼容性。

## 开发与验证

前端源码在 `src/`，由 Vite 构建到 `utools/dist/`；未构建的仓库不能直接导入 uTools。图标源于 [farfarfun 品牌仓库](https://github.com/farfarfun/.github/tree/master/brand)的统一生成器。`utools/preload.js` 处理文件读写，`src/app.js` 使用 Chromium Canvas 编解码图片。PDF、GIF 和手动裁剪分别使用随包附带的 `pdf-lib`、`gifenc`、`cropperjs`。`sh build.sh` 是统一入口，安装锁定依赖、运行检查和测试、构建前端并核对打包资源；GitHub Actions 调用它，上传可导入的插件目录，并通过组织的 `utools-devtools` 打包 UPXS。本工作区不在本机执行构建、测试或打包。

`identity.json` 记录图片工坊自己的官方 ID `zmsqjclu`。组织 Secrets `UTOOLS_MID`、`UTOOLS_UID`、`UTOOLS_CELLPHONE` 仅供 Actions 打包使用；不要提交包含敏感字段的完整身份文件。

## 许可

项目代码采用 MIT 许可证。
