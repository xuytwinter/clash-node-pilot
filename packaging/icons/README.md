# Application icon

<p align="center">
  <img src="cat-sunglasses.png" alt="Clash Node Pilot sunglasses-cat icon" width="128" height="128">
</p>

The selected icon is the white sunglasses cat on a pink-purple gradient. The approved 1024-pixel transparent master is `cat-sunglasses.png`.

Run `python scripts/generate-icons.py` with Pillow installed to rebuild the Windows ICO, macOS ICNS and browser favicon. The installer, shortcuts and macOS bundle reference these generated files.

The Orbit, Prism and Compass PNGs are archived design candidates, not the selected application icon; labels in the old comparison sheet describe that earlier design stage.

The cat artwork was redrawn from a user-supplied Clash Verge screenshot and modified with sunglasses. This project is unofficial; the design does not indicate affiliation or upstream endorsement.

## 在 GitHub 和 Markdown 中展示

中英文项目首页使用同一个 PNG 原图，显示为 128 × 128 像素。PNG 能直接在 GitHub 文档中显示；ICO 和 ICNS 用于操作系统图标。

仓库根目录的 Markdown 可以这样写：

```html
<p align="center">
  <img src="packaging/icons/cat-sunglasses.png" alt="Clash Node Pilot 墨镜猫图标" width="128" height="128">
</p>
```

普通 Markdown 图片语法也可以使用，但不能指定显示尺寸：

```markdown
![Clash Node Pilot](packaging/icons/cat-sunglasses.png)
```

相对路径以文档所在目录为基准：`docs/` 下的文档使用 `../packaging/icons/cat-sunglasses.png`，当前图标说明使用 `cat-sunglasses.png`。

Release 正文、Issue 或其他仓库引用时，使用完整地址。历史 Release 建议固定到对应标签，避免未来图标变化：

```markdown
![Clash Node Pilot](https://raw.githubusercontent.com/xuytwinter/clash-node-pilot/v0.4.1/packaging/icons/cat-sunglasses.png)
```

| 展示位置 | 设置方法 |
| --- | --- |
| 项目首页、中英文 README | 顶部居中图标、项目名称、下载和文档链接 |
| Release 正文 | 使用上述固定标签的图片地址 |
| 链接分享预览 | 在仓库 Settings → General → Social preview 上传包含图标和项目名的预览图；README 不会自动设置它 |
| GitHub 个人主页 | 在个人 Profile README 引用图标并链接本项目，无需修改个人头像 |
| 仓库列表图标、GitHub 网页标签图标 | 由 GitHub 控制，不能通过项目 README 替换 |

展示布局参考：[Clash Verge Rev](https://github.com/clash-verge-rev/clash-verge-rev) 的居中图标与语言导航，以及 [v2rayN](https://github.com/2dust/v2rayN) 的版本徽章与下载入口。参考的是文档布局，不代表上游背书。
