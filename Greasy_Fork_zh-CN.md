# Reddit 中文翻译

仿照 YouTube 评论区「翻译」交互设计的 Reddit 中文翻译脚本，专门适配新版 Reddit（`www.reddit.com`）。

可以在帖子标题、正文和评论旁显示「翻译成中文」按钮，只翻译自己想看的内容；再次点击可还原原文。也支持全帖翻译、简体/繁體中文切换和多个翻译接口。

## 效果预览

<table>
  <tr>
    <td valign="top">
      <img src="https://raw.githubusercontent.com/dason-zou/Reddit-CN-Translator/main/assets/translate.png" width="300" alt="Reddit 评论旁的翻译按钮">
    </td>
    <td valign="top">
      <img src="https://raw.githubusercontent.com/dason-zou/Reddit-CN-Translator/main/assets/options.png" width="200" alt="Reddit 中文翻译设置面板">
    </td>
  </tr>
</table>

## 功能

- 按需翻译帖子标题、正文和评论
- 再次点击可切换回原文
- 支持全帖翻译和默认全帖翻译
- 支持简体中文 / 繁體中文
- 支持 Google、Google Mobile、腾讯 AI、DeepL、Bing 等翻译接口
- 已包含中文的内容不会显示翻译按钮
- 跳过代码块，避免破坏代码内容

## 注意

翻译接口均为非官方接口，可能因服务变更、限流或网络环境而失效。脚本会把需要翻译的文本发送到你选择的翻译服务。

不支持 `old.reddit.com`。