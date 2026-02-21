import {
	Plugin,
	PluginSettingTab,
	App,
	Setting,
	MarkdownView,
	MarkdownPostProcessorContext,
} from "obsidian";
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
	// プレビュー改行（小説モード）
	enablePreviewSoftLineBreaks: false,
	previewSoftLineBreaksPathPrefix: "",
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

function isObsidianStrictLineBreaksEnabled(app: App): boolean {
	const vaultUnknown = app.vault as unknown as Record<string, unknown>;
	const getConfigUnknown = vaultUnknown["getConfig"];
	if (typeof getConfigUnknown !== "function") return true;

	const getConfig = getConfigUnknown as (
		this: unknown,
		key: string,
	) => unknown;
	try {
		const v = getConfig.call(app.vault, "strictLineBreaks");
		return v !== false;
	} catch {
		return true;
	}
}

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

	// ===== プレビュー改行（小説モード）=====
	// markdown-it の softbreak は DOM 上では "\\n" になることが多く、通常は空白として折り畳まれる。
	// white-space: pre-line にすることで、原文を汚さずプレビュー表示だけで改行を可視化できる。
	css.push(`
		.markdown-preview-view.novel-tools-softbreaks p {
			white-space: pre-line !important;
		}
	`);

	// ===== 設定画面：無効項目の視認性 =====
	css.push(`
		.novel-tools-setting-disabled { opacity: 0.55; }
		.novel-tools-setting-disabled .setting-item-description { opacity: 0.85; }
		.novel-tools-setting-disabled .setting-item-control { opacity: 0.65; }
	`);

	el.textContent = css.join("\n");
}

// ===== ① プレビューハイライト処理 =====

function processPreviewElement(el: HTMLElement, settings: NovelToolsSettings) {
	if (!settings.enablePreviewHighlight) return;
	if (!el.isConnected) return;

	// 既存の自前ハイライトを一度すべて解除（再実行を安全にする）
	const unwrapOwnSpans = (root: HTMLElement) => {
		root.querySelectorAll(
			"span.novel-tools-kakko1, span.novel-tools-kakko2, span.novel-tools-ruby, span.novel-tools-paren",
		).forEach((span) => {
			span.replaceWith(...Array.from(span.childNodes));
		});

		// ruby要素に付与したクラスを解除（共存相手の class="ruby" 等は残す）
		root.querySelectorAll(
			"ruby.novel-tools-ruby, ruby.novel-tools-kakko1, ruby.novel-tools-kakko2, ruby.novel-tools-paren",
		).forEach((r) => {
			r.classList.remove(
				"novel-tools-ruby",
				"novel-tools-kakko1",
				"novel-tools-kakko2",
				"novel-tools-paren",
			);
		});
	};

	type Match = {
		start: number;
		end: number;
		cls: string;
		priority: number;
	};

	type Unit =
		| {
				kind: "text";
				node: Text;
				start: number;
				end: number;
				text: string;
		  }
		| {
				kind: "ruby";
				node: HTMLElement;
				start: number;
				end: number; // start+1
		  };

	const wrapTextRanges = (
		textNode: Text,
		ranges: { from: number; to: number; cls: string }[],
	) => {
		// 右から左へ split していく（indexがズレない）
		ranges.sort((a, b) => b.from - a.from);

		let node: Text = textNode;
		for (const r of ranges) {
			const len = node.data.length;
			if (r.to > len || r.from < 0 || r.from >= r.to) continue;

			let right: Text | null = null;
			if (r.to < len) right = node.splitText(r.to);

			let mid: Text;
			if (r.from === 0) {
				mid = node;
			} else {
				mid = node.splitText(r.from);
			}

			const span = document.createElement("span");
			span.className = r.cls;
			span.textContent = mid.data;
			mid.replaceWith(span);

			// 次は左側（node）に対して処理を続ける
			if (r.from === 0) break;
			// node は splitText 後も左側Textを指したまま
			// rightはDOMに残るだけで以降触らない
			void right;
		}
	};

	const buildUnits = (
		container: HTMLElement,
	): { units: Unit[]; text: string } => {
		const units: Unit[] = [];
		let linear = "";
		let cursor = 0;

		const walk = (node: Node) => {
			if (node.nodeType === Node.ELEMENT_NODE) {
				const elem = node as HTMLElement;
				const tag = elem.tagName;

				// 触らない領域
				if (tag === "CODE" || tag === "PRE") return;
				if (tag === "RT") return;

				// ruby は「1文字のプレースホルダ」として扱い、子要素へは降りない
				if (tag === "RUBY") {
					units.push({
						kind: "ruby",
						node: elem,
						start: cursor,
						end: cursor + 1,
					});
					linear += "\uFFFC";
					cursor += 1;
					return;
				}

				for (const child of Array.from(elem.childNodes)) walk(child);
				return;
			}

			if (node.nodeType === Node.TEXT_NODE) {
				const t = node.textContent ?? "";
				if (t.length === 0) return;

				// 既に自前spanの中（理論上はunwrap済みだが保険）
				const parent = (node as Text).parentElement;
				if (
					parent?.closest(
						"span.novel-tools-kakko1, span.novel-tools-kakko2, span.novel-tools-ruby, span.novel-tools-paren, code, pre",
					)
				)
					return;

				units.push({
					kind: "text",
					node: node as Text,
					start: cursor,
					end: cursor + t.length,
					text: t,
				});
				linear += t;
				cursor += t.length;
			}
		};

		walk(container);
		return { units, text: linear };
	};

	const resolveOverlaps = (matches: Match[]): Match[] => {
		if (matches.length === 0) return [];

		// 入れ子は「短い（=内側）ほど先に確定」→確定済み領域を避けて分割
		matches.sort(
			(a, b) =>
				a.end - a.start - (b.end - b.start) ||
				b.priority - a.priority ||
				a.start - b.start,
		);

		type Segment = { start: number; end: number };
		const occupied: Segment[] = [];
		const resolved: Match[] = [];

		const subtract = (seg: Segment, occ: Segment[]): Segment[] => {
			let segs: Segment[] = [seg];
			for (const o of occ) {
				const next: Segment[] = [];
				for (const s of segs) {
					if (o.end <= s.start || s.end <= o.start) {
						next.push(s);
						continue;
					}
					if (s.start < o.start)
						next.push({
							start: s.start,
							end: Math.min(o.start, s.end),
						});
					if (o.end < s.end)
						next.push({
							start: Math.max(o.end, s.start),
							end: s.end,
						});
				}
				segs = next;
				if (segs.length === 0) break;
			}
			return segs.filter((s) => s.start < s.end);
		};

		for (const m of matches) {
			for (const s of subtract(
				{ start: m.start, end: m.end },
				occupied,
			)) {
				resolved.push({ ...m, start: s.start, end: s.end });
				occupied.push({ start: s.start, end: s.end });
			}
		}

		resolved.sort((a, b) => a.start - b.start);
		return resolved;
	};

	const processContainer = (container: HTMLElement) => {
		if (container.closest("code, pre")) return;

		unwrapOwnSpans(container);

		const { units, text } = buildUnits(container);
		if (text.length === 0) return;

		// 何も対象文字が無ければスキップ（パフォーマンス）
		if (
			!/[「『《（(]/.test(text) &&
			container.querySelectorAll("ruby").length === 0
		)
			return;

		const matches: Match[] = [];
		const addMatches = (re: RegExp, cls: string, priority: number) => {
			re.lastIndex = 0;
			let m: RegExpExecArray | null;
			while ((m = re.exec(text)) !== null) {
				matches.push({
					start: m.index,
					end: m.index + m[0].length,
					cls,
					priority,
				});
			}
		};

		// ruby（notation / already <ruby>）
		if (settings.enableRuby) {
			// 既にrubyプラグインがDOMを変換している場合：<ruby>要素を優先的に拾う
			for (const u of units) {
				if (u.kind === "ruby") {
					matches.push({
						start: u.start,
						end: u.end,
						cls: "novel-tools-ruby",
						priority: 3,
					});
				}
			}
			// notationが残っている場合（rubyプラグイン無し/未変換）：正規表現で拾う
			addMatches(
				/([一-龠々仝〆〇ヶ]+)《([^》\n]+?)》/g,
				"novel-tools-ruby",
				3,
			);
			addMatches(
				/[|｜]([^|｜《》\n]+?)《([^》\n]+?)》/g,
				"novel-tools-ruby",
				3,
			);
		}

		if (settings.enableParen) {
			addMatches(/（[^（）\n]*）/g, "novel-tools-paren", 2);
			addMatches(/\([^()\n]*\)/g, "novel-tools-paren", 2);
		}
		if (settings.enableKakko1)
			addMatches(/「[^「」\n]*」/g, "novel-tools-kakko1", 1);
		if (settings.enableKakko2)
			addMatches(/『[^『』\n]*』/g, "novel-tools-kakko2", 1);

		if (matches.length === 0) return;

		const resolved = resolveOverlaps(matches);

		// 各Text node / ruby elementへ割り当て
		const textRanges = new Map<
			Text,
			{ from: number; to: number; cls: string }[]
		>();
		const rubyClass = new Map<HTMLElement, string>();

		let mi = 0;
		for (const u of units) {
			// resolved は start 昇順・重なり無しなので、前からなめる
			while (mi < resolved.length) {
				const cur = resolved[mi];
				if (!cur) break;
				if (cur.end <= u.start) mi++;
				else break;
			}

			let mj = mi;
			while (mj < resolved.length) {
				const m = resolved[mj];
				if (!m) {
					mj++;
					continue;
				}
				if (m.start >= u.end) break;

				const from = Math.max(m.start, u.start);
				const to = Math.min(m.end, u.end);
				if (from < to) {
					if (u.kind === "text") {
						const relFrom = from - u.start;
						const relTo = to - u.start;
						const arr = textRanges.get(u.node) ?? [];
						arr.push({ from: relFrom, to: relTo, cls: m.cls });
						textRanges.set(u.node, arr);
					} else {
						// rubyは要素丸ごと装飾（ruby色を有効にしている場合はruby優先になる設計）
						rubyClass.set(u.node, m.cls);
					}
				}
				mj++;
			}
		}

		for (const [node, ranges] of textRanges.entries()) {
			// nodeが既にDOMから外れている（他プラグインの書き換え直後など）はスキップ
			if (!node.isConnected) continue;
			wrapTextRanges(node, ranges);
		}

		for (const [rubyEl, cls] of rubyClass.entries()) {
			if (!rubyEl.isConnected) continue;
			rubyEl.classList.add(cls);
		}
	};

	// ブロック単位で処理（他プラグインによりTEXT_NODEが分割されても跨いで解析できる）
	const containers = Array.from(
		el.querySelectorAll<HTMLElement>(
			"p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th",
		),
	);

	if (containers.length === 0) {
		// fallback（たまに直下がテキストになるケース）
		processContainer(el);
	} else {
		for (const c of containers) processContainer(c);
	}
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

		const strictLineBreaksOn = isObsidianStrictLineBreaksEnabled(this.app);

		// プレビュー改行（小説モード）
		new Setting(containerEl)
			.setName("Obsidian設定「厳密な改行」")
			.setDesc(
				strictLineBreaksOn
					? "現在: ON（Markdown仕様どおり単一改行は無視）。このプラグインで、指定フォルダだけ改行表示にできます。"
					: "現在: OFF（Obsidian標準で単一改行が改行表示）。二重適用を避けるため、このプラグインの改行表示は自動的に適用されません。",
			);
		const previewSoftbreakSetting = new Setting(containerEl)
			.setName("プレビューで1回改行を維持（小説モード）")
			.setDesc(
				// eslint-disable-next-line obsidianmd/ui/sentence-case
				"Obsidian設定「厳密な改行」がONのまま、小説ノートだけEnter1回の改行をプレビューでも維持したい場合に使います。Obsidian側がOFFの場合は不要（重複防止のため自動的に適用されません）。原文は変更しません。",
			)
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.enablePreviewSoftLineBreaks)
					.setDisabled(!strictLineBreaksOn)
					.onChange(async (v) => {
						this.plugin.settings.enablePreviewSoftLineBreaks = v;
						await this.plugin.saveAndRefresh();
					}),
			);

		if (!strictLineBreaksOn) {
			previewSoftbreakSetting.settingEl.classList.add(
				"novel-tools-setting-disabled",
			);
		}

		const previewSoftbreakPathSetting = new Setting(containerEl)
			.setName("小説モード改行の適用対象（パス先頭一致）")
			.setDesc(
				// eslint-disable-next-line obsidianmd/ui/sentence-case
				"空欄なら全ノートに適用。例: Novel/ など。（Obsidianの「厳密な改行」がONのときのみ有効）",
			)
			.addText((t) =>
				t
					.setPlaceholder("Novel/")
					.setValue(
						this.plugin.settings.previewSoftLineBreaksPathPrefix,
					)
					.setDisabled(!strictLineBreaksOn)
					.onChange(async (v) => {
						this.plugin.settings.previewSoftLineBreaksPathPrefix =
							v;
						await this.plugin.saveAndRefresh();
					}),
			);

		if (!strictLineBreaksOn) {
			previewSoftbreakPathSetting.settingEl.classList.add(
				"novel-tools-setting-disabled",
			);
		}

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

		this.registerMarkdownPostProcessor(
			(el, ctx: MarkdownPostProcessorContext) => {
				// 他プラグインのMarkdownPostProcessorがDOMを書き換えた後に実行して共存性を上げる
				window.setTimeout(() => {
					if (!el.isConnected) return;

					// プレビュー改行（小説モード）: CSSクラスを付与して white-space を切替
					const previewView = el.closest(".markdown-preview-view");
					if (previewView instanceof HTMLElement) {
						previewView.classList.toggle(
							"novel-tools-softbreaks",
							this.isSoftBreakTarget(ctx?.sourcePath),
						);
					}

					processPreviewElement(el, this.settings);
				}, 0);
			},
		);
	}

	private isObsidianStrictLineBreaksEnabled(): boolean {
		return isObsidianStrictLineBreaksEnabled(this.app);
	}

	private isSoftBreakTarget(sourcePath: string | undefined): boolean {
		if (!this.settings.enablePreviewSoftLineBreaks) return false;
		// Obsidian標準設定「厳密な改行」がOFFの場合は、プレビュー側で既に1回改行が有効。
		// 競合（改行が二重に見える等）を避けるため、この機能は適用しない。
		if (!this.isObsidianStrictLineBreaksEnabled()) return false;
		const prefixRaw = (
			this.settings.previewSoftLineBreaksPathPrefix ?? ""
		).trim();
		if (!prefixRaw) return true; // 全ノート
		// Obsidian の sourcePath は "/" 区切り。先頭の "/" は許容して正規化。
		const prefix = prefixRaw.replace(/^\/+/, "");
		if (!sourcePath) return false;
		return sourcePath.startsWith(prefix);
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
