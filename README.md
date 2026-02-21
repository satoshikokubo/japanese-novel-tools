# Japanese Novel Tools

An [Obsidian](https://obsidian.md) plugin for Japanese novel writers.  
日本語小説執筆者向けのObsidianプラグインです。

---

## Features / 機能

### Control character visualization / 制御文字の可視化
- Full-width spaces (　) are displayed as `□` in the editor
- Line breaks are displayed as `↵` in the editor
- Visible only in editing mode — does not affect the actual text

### Syntax highlighting / シンタックスハイライト
Color-coding in the editor for:

| Syntax | Description | Default color |
|--------|-------------|---------------|
| `「」` | Dialogue (single) | Green |
| `『』` | Dialogue (double) | Yellow-green |
| `漢字《ルビ》` `｜text《ルビ》` | Ruby / furigana | Blue |
| `（）` `()` | Parentheses | Red |

- Ruby notation supports both `漢字《よみ》` (kanji-only auto-detection) and `｜text《よみ》` (pipe prefix)
- When ruby or parentheses appear inside dialogue brackets, they take priority and are colored correctly

### Preview highlighting / プレビューのハイライト（オプション）
Optionally apply the same color-coding to the reading preview.

### Layout settings / レイアウト設定

**Editor:**
- Adjustable line width for horizontal writing (px)

**Preview:**
- Vertical writing (縦書き) mode with adjustable height (vh)
- Adjustable line width for horizontal writing (px)
- Intuitive mouse wheel scrolling in vertical mode (up = scroll right, down = scroll left)

---

## Installation / インストール

### From Community Plugins / コミュニティプラグインから
1. Open Obsidian **Settings → Community plugins**
2. Disable **Safe mode** if prompted
3. Select **Browse** and search for `Japanese Novel Tools`
4. Select **Install**, then **Enable**

### Manual installation / 手動インストール
1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/kokubo/japanese-novel-tools/releases/latest)
2. Copy the files to your vault: `<Vault>/.obsidian/plugins/japanese-novel-tools/`
3. Reload Obsidian and enable the plugin under **Settings → Community plugins**

---

## Settings / 設定

Open **Settings → Japanese Novel Tools** to configure:

- **Highlight features**: Toggle each syntax highlight individually
- **Colors**: Customize colors for each syntax type
- **Editor settings**: Line width for horizontal writing
- **Preview settings**: Toggle vertical writing, adjust height and line width
- **Mouse wheel**: Toggle intuitive wheel scrolling in vertical preview mode
- **Debug**: Show colored borders around layout areas for troubleshooting
- **Reset**: Restore all settings to defaults

---

## Notes / 注意事項

- Syntax highlighting applies to the **editor (Live Preview / Source mode)** only, unless preview highlighting is enabled in settings
- The mouse wheel intercept applies only when vertical preview mode is ON
- If mouse wheel behavior conflicts with other scroll-related plugins, disable it in settings

---

## Compatibility / 動作環境

- Obsidian v0.15.0 or later
- Desktop and mobile

---

## License / ライセンス

[0-BSD](LICENSE)
