import { Plugin, PluginSettingTab, App, Setting, MarkdownView } from "obsidian";
import {
	Decoration,
	DecorationSet,
	EditorView,
	ViewPlugin,
	ViewUpdate,
	WidgetType,
} from "@codemirror/view";
import { RangeSetBuilder, StateEffect } from "@codemirror/state";

const DEFAULT_SETTINGS = {
	// ハイライト
	enableFullWidthSpace: true,
	enableNewline: true,
	enableKakko1: true,
	enableKakko2: true,
	enableRuby: true,
	enableParen: true,
	colorKakko1: "#7ab87a",
	colorKakko2: "#a8c87a",
	colorRuby: "#7aaec8",
	colorParen: "#c47a7a",
	colorControl: "#888888",
	enablePreviewHighlight: false,
	// 編集画面
	editorLineWidth: 950,
	// プレビュー画面（独立）
	enableVerticalPreview: false,
	previewVerticalHeight: 75,
	previewLineWidth: 950,
	// デバッグ
	enableDebugBorderEditor: false,
	enableDebugBorderPreview: false,
	// 縦書き時ホイール操作のインターセプトON
	enableWheelIntercept: true,
};

type NovelToolsSettings = typeof DEFAULT_SETTINGS;
const settingsChangedEffect = StateEffect.define<null>();

// ===== Widgets =====
class FullWidthSpaceWidget extends WidgetType {
	toDOM(): HTMLElement {
		const span = document.createElement("span");
		span.className = "novel-tools-fullwidth-space";
		span.textContent = "□";
		return span;
	}
}

class NewlineWidget extends WidgetType {
	toDOM(): HTMLElement {
		const span = document.createElement("span");
		span.className = "novel-tools-newline";
		span.textContent = "↵";
		return span;
	}
}

// ===== Types =====
type DecoEntry =
	| { type: "replace"; from: number; to: number; widget: WidgetType }
	| { type: "widget"; pos: number; widget: WidgetType }
	| { type: "mark"; from: number; to: number; cls: string };

// ===== Editor highlight helpers =====
function addKakko(
	text: string,
	from: number,
	re: RegExp,
	cls: string,
	highPriority: { from: number; to: number }[],
	entries: DecoEntry[],
) {
	let m: RegExpExecArray | null;
	while ((m = re.exec(text)) !== null) {
		const kFrom = from + m.index;
		const kTo = from + m.index + m[0].length;
		const inner = highPriority
			.filter((r) => r.from >= kFrom && r.to <= kTo)
			.sort((a, b) => a.from - b.from);
		if (inner.length === 0) {
			entries.push({ type: "mark", from: kFrom, to: kTo, cls });
		} else {
			let cursor = kFrom;
			for (const r of inner) {
				if (cursor < r.from)
					entries.push({
						type: "mark",
						from: cursor,
						to: r.from,
						cls,
					});
				cursor = r.to;
			}
			if (cursor < kTo)
				entries.push({ type: "mark", from: cursor, to: kTo, cls });
		}
	}
}

function buildDecos(
	view: EditorView,
	getSettings: () => NovelToolsSettings,
): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();
	const entries: DecoEntry[] = [];
	const s = getSettings();

	for (const { from, to } of view.visibleRanges) {
		const text = view.state.doc.sliceString(from, to);
		let m: RegExpExecArray | null;

		if (s.enableRuby) {
			const rubyPipe = /[|｜]([^|｜《》\n]+?)《([^》\n]+?)》/g;
			while ((m = rubyPipe.exec(text)) !== null)
				entries.push({
					type: "mark",
					from: from + m.index + 1,
					to: from + m.index + m[0].length,
					cls: "novel-tools-ruby",
				});
			const rubyKanji = /([一-龠々仝〆〇ヶ]+)《([^》\n]+?)》/g;
			while ((m = rubyKanji.exec(text)) !== null)
				entries.push({
					type: "mark",
					from: from + m.index,
					to: from + m.index + m[0].length,
					cls: "novel-tools-ruby",
				});
		}
		if (s.enableParen) {
			const parenFull = /（[^（）\n]*）/g;
			while ((m = parenFull.exec(text)) !== null)
				entries.push({
					type: "mark",
					from: from + m.index,
					to: from + m.index + m[0].length,
					cls: "novel-tools-paren",
				});
			const parenHalf = /\([^()\n]*\)/g;
			while ((m = parenHalf.exec(text)) !== null)
				entries.push({
					type: "mark",
					from: from + m.index,
					to: from + m.index + m[0].length,
					cls: "novel-tools-paren",
				});
		}

		const highPriority = entries
			.filter(
				(e): e is Extract<DecoEntry, { type: "mark" }> =>
					e.type === "mark",
			)
			.map((e) => ({ from: e.from, to: e.to }));

		if (s.enableKakko1)
			addKakko(
				text,
				from,
				/「[^「」\n]*」/g,
				"novel-tools-kakko1",
				highPriority,
				entries,
			);
		if (s.enableKakko2)
			addKakko(
				text,
				from,
				/『[^『』\n]*』/g,
				"novel-tools-kakko2",
				highPriority,
				entries,
			);

		for (let i = 0; i < text.length; i++) {
			const char = text[i];
			const pos = from + i;
			if (char === "\u3000" && s.enableFullWidthSpace)
				entries.push({
					type: "replace",
					from: pos,
					to: pos + 1,
					widget: new FullWidthSpaceWidget(),
				});
			else if (char === "\n" && s.enableNewline)
				entries.push({
					type: "widget",
					pos,
					widget: new NewlineWidget(),
				});
		}
	}

	entries.sort((a, b) => {
		const aPos = a.type === "widget" ? a.pos : a.from;
		const bPos = b.type === "widget" ? b.pos : b.from;
		return aPos - bPos;
	});

	for (const entry of entries) {
		try {
			if (entry.type === "replace")
				builder.add(
					entry.from,
					entry.to,
					Decoration.replace({ widget: entry.widget }),
				);
			else if (entry.type === "widget")
				builder.add(
					entry.pos,
					entry.pos,
					Decoration.widget({ widget: entry.widget, side: 1 }),
				);
			else
				builder.add(
					entry.from,
					entry.to,
					Decoration.mark({ class: entry.cls }),
				);
		} catch {
			/* 重複スキップ */
		}
	}
	return builder.finish();
}

function makeViewPlugin(getSettings: () => NovelToolsSettings) {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			constructor(view: EditorView) {
				this.decorations = buildDecos(view, getSettings);
			}
			update(update: ViewUpdate) {
				const hasSettingsChange = update.transactions.some((tr) =>
					tr.effects.some((e) => e.is(settingsChangedEffect)),
				);
				if (
					update.docChanged ||
					update.viewportChanged ||
					hasSettingsChange
				)
					this.decorations = buildDecos(update.view, getSettings);
			}
		},
		{ decorations: (v) => v.decorations },
	);
}

// ===== Style injection =====
function applyColors(settings: NovelToolsSettings) {
	const id = "novel-tools-dynamic-styles";
	let el = document.getElementById(id) as HTMLStyleElement | null;
	if (!el) {
		// eslint-disable-next-line obsidianmd/no-forbidden-elements
		el = document.createElement("style");
		el.id = id;
		document.head.appendChild(el);
	}
	el.textContent = `
		.novel-tools-kakko1 { color: ${settings.colorKakko1} !important; }
		.novel-tools-kakko2 { color: ${settings.colorKakko2} !important; }
		.novel-tools-ruby   { color: ${settings.colorRuby}   !important; }
		.novel-tools-paren  { color: ${settings.colorParen}  !important; }
		.novel-tools-fullwidth-space { color: ${settings.colorControl} !important; opacity: 0.35; font-size: 0.8em; }
		.novel-tools-newline         { color: ${settings.colorControl} !important; opacity: 0.35; font-size: 0.8em; }
	`;
}

function applyLayout(settings: NovelToolsSettings) {
	const id = "novel-tools-layout-styles";
	let el = document.getElementById(id) as HTMLStyleElement | null;
	if (!el) {
		// eslint-disable-next-line obsidianmd/no-forbidden-elements
		el = document.createElement("style");
		el.id = id;
		document.head.appendChild(el);
	}

	const css: string[] = [];

	// デバッグ枠（編集・プレビュー独立）
	if (settings.enableDebugBorderEditor) {
		css.push(`
			.workspace-leaf-content .cm-editor { outline: 3px solid green !important; }
			.workspace-leaf-content .cm-scroller { outline: 3px solid orange !important; }
		`);
	}
	if (settings.enableDebugBorderPreview) {
		css.push(`
			.workspace-leaf-content[data-type="markdown"] .markdown-preview-view {
				outline: 3px solid red !important;
			}
			.workspace-leaf-content[data-type="markdown"] .markdown-preview-section {
				outline: 3px dashed blue !important;
			}
			.workspace-leaf-content[data-type="markdown"] .markdown-preview-sizer {
				outline: 3px dotted purple !important;
			}
		`);
	}

	// ===== 編集画面（横書き横幅のみ）=====
	// .cm-editorに限定してbodyを汚染しない
	css.push(
		`.cm-editor { --file-line-width: ${settings.editorLineWidth}px; }`,
	);

	// ===== プレビュー画面 =====
	if (settings.enableVerticalPreview) {
		// プレビュー：縦書き
		css.push(`
			.markdown-preview-view {
				writing-mode: vertical-rl !important;
				text-orientation: upright !important;
				height: ${settings.previewVerticalHeight}vh !important;
				overflow-x: auto !important;
				overflow-y: hidden !important;
				padding: 16px !important;
				box-sizing: border-box !important;
				max-width: none !important;
			}
			.markdown-preview-sizer {
				min-height: unset !important;
				padding-bottom: 0 !important;
				height: 100% !important;
			}
			.markdown-preview-section {
				max-width: none !important;
				height: 100% !important;
			}
			.markdown-preview-section > div {
				display: inline-block !important;
				height: 100% !important;
				margin: 0 !important;
				vertical-align: top !important;
			}
		`);
	} else {
		// プレビュー：横書き幅（.markdown-preview-viewに限定）
		css.push(
			`.markdown-preview-view { --file-line-width: ${settings.previewLineWidth}px; }`,
		);
	}

	el.textContent = css.join("\n");
}

// ===== ① プレビューハイライト処理 =====
function processPreviewElement(el: HTMLElement, settings: NovelToolsSettings) {
	if (!settings.enablePreviewHighlight) return;

	const walk = (node: Node) => {
		if (node.nodeType === Node.TEXT_NODE) {
			const parent = node.parentElement;
			if (
				!parent ||
				parent.closest(
					"code, pre, .novel-tools-kakko1, .novel-tools-kakko2, .novel-tools-ruby, .novel-tools-paren",
				)
			)
				return;

			const text = node.textContent || "";
			if (!/[「『《（(]/.test(text)) return;

			type Match = {
				start: number;
				end: number;
				cls: string;
				priority: number;
			};
			const matches: Match[] = [];

			const addMatches = (re: RegExp, cls: string, priority: number) => {
				re.lastIndex = 0;
				let m: RegExpExecArray | null;
				while ((m = re.exec(text)) !== null)
					matches.push({
						start: m.index,
						end: m.index + m[0].length,
						cls,
						priority,
					});
			};

			if (settings.enableRuby) {
				addMatches(
					/([一-龠々仝〆〇ヶ]+)《([^》]+)》/g,
					"novel-tools-ruby",
					3,
				);
				addMatches(
					/[|｜]([^|｜《》]+?)《([^》]+)》/g,
					"novel-tools-ruby",
					3,
				);
			}
			if (settings.enableKakko1)
				addMatches(/「[^「」]*」/g, "novel-tools-kakko1", 1);
			if (settings.enableKakko2)
				addMatches(/『[^『』]*』/g, "novel-tools-kakko2", 1);
			if (settings.enableParen) {
				addMatches(/（[^（）]*）/g, "novel-tools-paren", 2);
				addMatches(/\([^()]*\)/g, "novel-tools-paren", 2);
			}

			if (matches.length === 0) return;

			// 優先度降順でソート、重複除去
			matches.sort(
				(a, b) => b.priority - a.priority || a.start - b.start,
			);
			const resolved: Match[] = [];
			for (const match of matches) {
				if (
					resolved.some(
						(r) => r.start < match.end && r.end > match.start,
					)
				)
					continue;
				resolved.push(match);
			}
			resolved.sort((a, b) => a.start - b.start);

			const fragment = document.createDocumentFragment();
			let cursor = 0;
			for (const { start, end, cls } of resolved) {
				if (cursor < start)
					fragment.appendChild(
						document.createTextNode(text.slice(cursor, start)),
					);
				const span = document.createElement("span");
				span.className = cls;
				span.textContent = text.slice(start, end);
				fragment.appendChild(span);
				cursor = end;
			}
			if (cursor < text.length)
				fragment.appendChild(
					document.createTextNode(text.slice(cursor)),
				);
			parent.replaceChild(fragment, node);
		} else if (node.nodeType === Node.ELEMENT_NODE) {
			const elem = node as Element;
			if (elem.tagName === "CODE" || elem.tagName === "PRE") return;
			Array.from(node.childNodes).forEach(walk);
		}
	};
	Array.from(el.childNodes).forEach(walk);
}

// ===== Setting tab =====
class NovelToolsSettingTab extends PluginSettingTab {
	plugin: JapaneseNovelTools;
	constructor(app: App, plugin: JapaneseNovelTools) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// ハイライト機能
		new Setting(containerEl).setName("ハイライト機能").setHeading();
		const toggles: [keyof NovelToolsSettings, string][] = [
			["enableFullWidthSpace", "全角スペースの可視化"],
			["enableNewline", "改行の可視化"],
			["enableKakko1", "「」のハイライト"],
			["enableKakko2", "『』のハイライト"],
			["enableRuby", "《》ルビのハイライト"],
			["enableParen", "（）カッコのハイライト"],
		];
		for (const [key, name] of toggles) {
			new Setting(containerEl).setName(name).addToggle((t) =>
				t
					.setValue(this.plugin.settings[key] as boolean)
					.onChange(async (v) => {
						(this.plugin.settings[key] as boolean) = v;
						await this.plugin.saveAndRefresh();
					}),
			);
		}
		new Setting(containerEl)
			.setName("プレビューにもハイライトを反映する")
			.setDesc("プレビューモードでもセリフ・ルビ等の色分けを表示します")
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.enablePreviewHighlight)
					.onChange(async (v) => {
						this.plugin.settings.enablePreviewHighlight = v;
						await this.plugin.saveAndRefresh();
					}),
			);

		// 色設定
		new Setting(containerEl).setName("色の設定").setHeading();
		const colorSettings: [keyof NovelToolsSettings, string][] = [
			["colorKakko1", "「」の色"],
			["colorKakko2", "『』の色"],
			["colorRuby", "《》ルビの色"],
			["colorParen", "（）カッコの色"],
			["colorControl", "制御文字（全角スペース/改行）の色"],
		];
		for (const [key, name] of colorSettings) {
			new Setting(containerEl).setName(name).addColorPicker((c) =>
				c
					.setValue(this.plugin.settings[key] as string)
					.onChange(async (v) => {
						(this.plugin.settings[key] as string) = v;
						await this.plugin.saveAndRefresh();
					}),
			);
		}

		// 編集画面の設定
		new Setting(containerEl).setName("編集画面の設定").setHeading();
		new Setting(containerEl)
			.setName("横書き時の表示幅（px）")
			.addSlider((s) =>
				s
					.setLimits(400, 1600, 50)
					.setValue(this.plugin.settings.editorLineWidth)
					.setDynamicTooltip()
					.onChange(async (v) => {
						this.plugin.settings.editorLineWidth = v;
						await this.plugin.saveAndRefresh();
					}),
			);

		// プレビュー画面の設定
		new Setting(containerEl).setName("プレビュー画面の設定").setHeading();
		new Setting(containerEl).setName("縦書きにする").addToggle((t) =>
			t
				.setValue(this.plugin.settings.enableVerticalPreview)
				.onChange(async (v) => {
					this.plugin.settings.enableVerticalPreview = v;
					await this.plugin.saveAndRefresh();
				}),
		);
		new Setting(containerEl)
			.setName("縦書き時の高さ（vh）")
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			.setDesc("縦書きON時のみ使用されます。50〜90推奨。")
			.addSlider((s) =>
				s
					.setLimits(30, 90, 5)
					.setValue(this.plugin.settings.previewVerticalHeight)
					.setDynamicTooltip()
					.onChange(async (v) => {
						this.plugin.settings.previewVerticalHeight = v;
						await this.plugin.saveAndRefresh();
					}),
			);
		new Setting(containerEl)
			.setName("横書き時の表示幅（px）")
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			.setDesc("横書きON時のみ使用されます。")
			.addSlider((s) =>
				s
					.setLimits(400, 1600, 50)
					.setValue(this.plugin.settings.previewLineWidth)
					.setDynamicTooltip()
					.onChange(async (v) => {
						this.plugin.settings.previewLineWidth = v;
						await this.plugin.saveAndRefresh();
					}),
			);

		// ホイール操作
		new Setting(containerEl).setName("ホイール操作").setHeading();
		new Setting(containerEl)
			.setName("縦書き時のホイール操作を変更する")
			.setDesc(
				"縦書きプレビューON時、シフトなしのホイール操作で横スクロールします。" +
					"他のスクロール系プラグインと競合する場合はOFFにしてください。",
			)
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.enableWheelIntercept)
					.onChange(async (v) => {
						this.plugin.settings.enableWheelIntercept = v;
						await this.plugin.saveAndRefresh();
					}),
			);

		// デバッグ
		new Setting(containerEl).setName("デバッグ").setHeading();
		new Setting(containerEl)
			.setName("プレビュー画面にデバッグ用枠線を表示")
			.setDesc("赤：プレビュー全体　青：セクション　紫：サイザー")
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.enableDebugBorderPreview)
					.onChange(async (v) => {
						this.plugin.settings.enableDebugBorderPreview = v;
						await this.plugin.saveAndRefresh();
					}),
			);

		// リセット
		new Setting(containerEl).setName("リセット").setHeading();
		new Setting(containerEl).setName("デフォルトに戻す").addButton((b) =>
			b
				.setButtonText("リセット")
				.setWarning()
				.onClick(async () => {
					this.plugin.settings = { ...DEFAULT_SETTINGS };
					await this.plugin.saveAndRefresh();
					this.display();
				}),
		);
	}
}

// ===== Main plugin =====
export default class JapaneseNovelTools extends Plugin {
	settings: NovelToolsSettings = { ...DEFAULT_SETTINGS };

	async onload() {
		await this.loadData().then((data: unknown) => {
			this.settings = Object.assign(
				{},
				DEFAULT_SETTINGS,
				data as Partial<NovelToolsSettings>,
			);
		});
		applyColors(this.settings);
		applyLayout(this.settings);
		this.registerEditorExtension(makeViewPlugin(() => this.settings));
		this.addSettingTab(new NovelToolsSettingTab(this.app, this));

		// モード切替・ペイン切替時にレイアウトを再適用
		this.registerEvent(
			this.app.workspace.on("layout-change", () => {
				applyLayout(this.settings);
			}),
		);
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => {
				applyLayout(this.settings);
			}),
		);

		// 縦書き時のホイール操作を横スクロールに変換
		this.registerDomEvent(
			document,
			"wheel",
			(e: WheelEvent) => {
				if (!this.settings.enableVerticalPreview) return;
				if (!this.settings.enableWheelIntercept) return;

				// プレビュー要素を探す
				const previewEl = (e.target as HTMLElement).closest(
					".markdown-preview-view",
				);
				if (!(previewEl instanceof HTMLElement)) return;

				// シフトキーが押されている場合はブラウザデフォルトに任せる
				if (e.shiftKey) return;

				e.preventDefault();

				// 縦書きright-to-leftなので、下スクロール=左へ進む（scrollLeft増加）
				// 上スクロール=右に戻る（scrollLeft減少）
				// deltaYをそのまま横スクロール量に使う
				previewEl.scrollLeft += -e.deltaY;
			},
			{ passive: false },
		);

		this.registerMarkdownPostProcessor((el) => {
			processPreviewElement(el, this.settings);
		});
	}

	async saveAndRefresh() {
		await this.saveData(this.settings);
		applyColors(this.settings);
		applyLayout(this.settings);

		// エディタ再描画
		this.app.workspace.iterateAllLeaves((leaf) => {
			const view = leaf.view as unknown as {
				editor?: { cm?: EditorView };
			};
			if (view?.editor?.cm) {
				view.editor.cm.dispatch({
					effects: settingsChangedEffect.of(null),
				});
			}
		});

		// プレビュー再描画
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.view instanceof MarkdownView) {
				leaf.view.previewMode.rerender(true);
			}
		});
	}

	onunload() {
		["novel-tools-dynamic-styles", "novel-tools-layout-styles"].forEach(
			(id) => {
				document.getElementById(id)?.remove();
			},
		);
	}
}
