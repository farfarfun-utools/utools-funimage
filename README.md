# 图片工坊 FunImage

uTools 本地批量图片处理插件。首版支持 PNG、JPEG、WebP 图片的批量压缩、格式转换和按宽度调整尺寸。

## 使用

在 uTools 开发者工具中导入 `utools/plugin.json`，或者从 GitHub Actions 下载 `utools-funimage-developer-files` 后导入。输入“图片工坊”打开，也可以在 uTools 中选中图片后使用“用图片工坊处理”。插件支持拖放图片；选择操作和输出文件夹后，可以预览单张效果并开始批量处理。

图片在本地逐张处理，不上传、不保存历史。输出文件使用新文件名；已有同名结果会自动加序号，原图不会被覆盖。JPEG 不支持透明背景，转换时透明区域填白。重新编码可能去除 EXIF 等元数据；PNG/JPEG/WebP 动图、其他格式、超过 32 MB 或 3200 万像素的图片暂不支持。PNG 无损重编码不保证缩小；压缩结果不小于原图时保留原始字节。效果预览最多缩至 1100 像素，因此不是原尺寸文件大小预估。

## 开发与验证

界面使用原生 HTML/CSS/JavaScript，不需要前端构建依赖。`utools/preload.js` 处理文件读写，`utools/app.js` 使用 Chromium Canvas 编解码图片。GitHub Actions 执行语法检查、测试并上传可导入的插件目录；本工作区不在本机执行构建、测试或打包。

当前还没有该插件的官方 uTools ID，因此未生成 UPXS 安装包。申请 ID 并取得本插件自己的官方导出身份后，才可接入组织的 `utools-devtools` 打包流程；不能沿用其他插件的 ID 或身份文件。

## 许可

项目代码采用 MIT 许可证。
