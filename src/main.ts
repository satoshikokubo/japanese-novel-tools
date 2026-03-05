import {
	Plugin,
	PluginSettingTab,
	App,
	Setting,
	MarkdownView,
	MarkdownPostProcessorContext,
	TFile,
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
	// 追加ハイライト記号
	enableKakko3: true, // 【】
	enableKakko4: true, // 〔〕
	enableKakko5: true, // 〈〉
	enableKakko6: true, // "" / “”（ダブルクォート）
	enableKakko7: true, // ［］/ []
	enableKakko8: true, // '' / ‘’（シングルクォート）
	colorKakko1: "#7ab87a",
	colorKakko2: "#a8c87a",
	colorRuby: "#7aaec8",
	colorParen: "#c47a7a",
	colorKakko3: "#c8824a",
	colorKakko4: "#9b7ac8",
	colorKakko5: "#7ab8c8",
	colorKakko6: "#c8b87a",
	colorKakko7: "#c8a07a",
	colorKakko8: "#a0c87a",
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
	// 縦書き時の列間
	verticalColumnGap: 1.5,
	// 縦書き時にメタデータ（プロパティ）を非表示
	hideVerticalMetadata: true,
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
		if (s.enableKakko3)
			addKakko(
				text,
				from,
				/【[^【】\n]*】/g,
				"novel-tools-kakko3",
				highPriority,
				entries,
			);
		if (s.enableKakko4)
			addKakko(
				text,
				from,
				/〔[^〔〕\n]*〕/g,
				"novel-tools-kakko4",
				highPriority,
				entries,
			);
		if (s.enableKakko5)
			addKakko(
				text,
				from,
				/〈[^〈〉\n]*〉/g,
				"novel-tools-kakko5",
				highPriority,
				entries,
			);
		if (s.enableKakko6) {
			addKakko(
				text,
				from,
				/“[^“”\n]*”/g,
				"novel-tools-kakko6",
				highPriority,
				entries,
			);
			addKakko(
				text,
				from,
				/"[^"\n]*"/g,
				"novel-tools-kakko6",
				highPriority,
				entries,
			);
		}
		if (s.enableKakko7) {
			addKakko(
				text,
				from,
				/［[^［］\n]*］/g,
				"novel-tools-kakko7",
				highPriority,
				entries,
			);
			addKakko(
				text,
				from,
				/\[[^[\]\n]*\]/g,
				"novel-tools-kakko7",
				highPriority,
				entries,
			);
		}
		if (s.enableKakko8) {
			addKakko(
				text,
				from,
				/‘[^‘’\n]*’/g,
				"novel-tools-kakko8",
				highPriority,
				entries,
			);
			addKakko(
				text,
				from,
				/'[^'\n]*'/g,
				"novel-tools-kakko8",
				highPriority,
				entries,
			);
		}

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
// Dynamic values are applied via CSS custom properties on document.body.
// All CSS rules are defined in styles.css, which Obsidian loads automatically.
function applyColors(settings: NovelToolsSettings) {
	const body = document.body;
	body.style.setProperty("--novel-tools-kakko1", settings.colorKakko1);
	body.style.setProperty("--novel-tools-kakko2", settings.colorKakko2);
	body.style.setProperty("--novel-tools-ruby",   settings.colorRuby);
	body.style.setProperty("--novel-tools-paren",  settings.colorParen);
	body.style.setProperty("--novel-tools-kakko3", settings.colorKakko3);
	body.style.setProperty("--novel-tools-kakko4", settings.colorKakko4);
	body.style.setProperty("--novel-tools-kakko5", settings.colorKakko5);
	body.style.setProperty("--novel-tools-kakko6", settings.colorKakko6);
	body.style.setProperty("--novel-tools-kakko7", settings.colorKakko7);
	body.style.setProperty("--novel-tools-kakko8", settings.colorKakko8);
	body.style.setProperty("--novel-tools-control", settings.colorControl);
}

function applyLayout(settings: NovelToolsSettings) {
	// Dynamic numeric values are passed via CSS custom properties on document.body.
	// Boolean conditions are applied via body class toggles.
	// All CSS rules referencing these properties/classes are defined in styles.css.
	const body = document.body;
	body.style.setProperty("--novel-tools-editor-width",   settings.editorLineWidth + "px");
	body.style.setProperty("--novel-tools-preview-height", settings.previewVerticalHeight + "vh");
	body.style.setProperty("--novel-tools-preview-width",  settings.previewLineWidth + "px");
	body.style.setProperty("--novel-tools-column-gap",     settings.verticalColumnGap + "em");
	body.classList.toggle("novel-tools-debug-editor",  settings.enableDebugBorderEditor);
	body.classList.toggle("novel-tools-debug-preview", settings.enableDebugBorderPreview);
	body.classList.toggle("novel-tools-hide-metadata", settings.hideVerticalMetadata);
}

// ===== ① 連続空行の保持（プレビューのみ / padding方式） =====
// Markdownの仕様では複数の連続空行は1つの段落区切りに握りつぶされる。
// そこでプレビューDOMの各ブロック要素に対して、直前の連続空行数をカウントし、
// 余剰分(空行数-1)を padding-block-start で表現する（DOMへスペーサー要素は挿入しない）。
// ===== ② プレビューハイライト処理 =====

function processPreviewElement(el: HTMLElement, settings: NovelToolsSettings) {
	if (!settings.enablePreviewHighlight) return;
	if (!el.isConnected) return;

	// 既存の自前ハイライトを一度すべて解除（再実行を安全にする）
	const KAKKO_SPAN_SEL =
		"span.novel-tools-kakko1, span.novel-tools-kakko2, " +
		"span.novel-tools-kakko3, span.novel-tools-kakko4, " +
		"span.novel-tools-kakko5, span.novel-tools-kakko6, " +
		"span.novel-tools-kakko7, span.novel-tools-kakko8, " +
		"span.novel-tools-ruby, span.novel-tools-paren";

	const unwrapOwnSpans = (root: HTMLElement) => {
		root.querySelectorAll(KAKKO_SPAN_SEL).forEach((span) => {
			span.replaceWith(...Array.from(span.childNodes));
		});
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
				if (parent?.closest(KAKKO_SPAN_SEL + ", code, pre")) return;

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
			!/[「『《（(【〔〈"'［[]/.test(text) &&
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
		if (settings.enableKakko3)
			addMatches(/【[^【】\n]*】/g, "novel-tools-kakko3", 1);
		if (settings.enableKakko4)
			addMatches(/〔[^〔〕\n]*〕/g, "novel-tools-kakko4", 1);
		if (settings.enableKakko5)
			addMatches(/〈[^〈〉\n]*〉/g, "novel-tools-kakko5", 1);
		if (settings.enableKakko6) {
			addMatches(/“[^“”\n]*”/g, "novel-tools-kakko6", 1);
			addMatches(/"[^"\n]*"/g, "novel-tools-kakko6", 1);
		}
		if (settings.enableKakko7) {
			addMatches(/［[^［］\n]*］/g, "novel-tools-kakko7", 1);
			addMatches(/\[[^[\]\n]*\]/g, "novel-tools-kakko7", 1);
		}
		if (settings.enableKakko8) {
			addMatches(/‘[^‘’\n]*’/g, "novel-tools-kakko8", 1);
			addMatches(/'[^'\n]*'/g, "novel-tools-kakko8", 1);
		}

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
			["enableKakko3", "【】のハイライト"],
			["enableKakko4", "〔〕のハイライト"],
			["enableKakko5", "〈〉のハイライト"],
			["enableKakko6", '"" / “” ダブルクォートのハイライト'],
			["enableKakko7", "［］/ [] 角括弧のハイライト"],
			["enableKakko8", "''  / ‘’ シングルクォートのハイライト"],
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
			["colorKakko3", "【】の色"],
			["colorKakko4", "〔〕の色"],
			["colorKakko5", "〈〉の色"],
			["colorKakko6", '"" / “” ダブルクォートの色'],
			["colorKakko7", "［］/ [] 角括弧の色"],
			["colorKakko8", "''  / ‘’ シングルクォートの色"],
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
		new Setting(containerEl)
			.setName("縦書き時の列間（em）")
			.setDesc(
				"縦書きON時のみ使用されます。段落間（列と列の間）の広さを調整します。テーマによって見え方が異なります。",
			)
			.addSlider((s) =>
				s
					.setLimits(0.0, 5.0, 0.25)
					.setValue(this.plugin.settings.verticalColumnGap)
					.setDynamicTooltip()
					.onChange(async (v) => {
						this.plugin.settings.verticalColumnGap = v;
						await this.plugin.saveAndRefresh();
					}),
			);
		new Setting(containerEl)
			.setName("縦書き時にメタデータ（プロパティ）を非表示")
			.setDesc(
				"縦書きON時、ノート冒頭のプロパティ（tags等）を非表示にします。縦書きではレイアウトが崩れるため、デフォルトONです。",
			)
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.hideVerticalMetadata)
					.onChange(async (v) => {
						this.plugin.settings.hideVerticalMetadata = v;
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
	private updateStatusBar: () => void = () => {};

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

		// ===== ステータスバーボタン（縦書きトグル）=====
		const statusBarItem = this.addStatusBarItem();
		statusBarItem.addClass("novel-tools-vertical-toggle");
		statusBarItem.setAttribute(
			"aria-label",
			"縦書き / 横書きを切り替え（クリック）",
		);
		statusBarItem.setAttribute("data-tooltip-position", "top");

		const updateStatusBar = () => {
			const isVertical = this.settings.enableVerticalPreview;
			statusBarItem.textContent = isVertical ? "⇅ 縦書き" : "⇅ 横書き";
			statusBarItem.toggleClass("is-active", isVertical);
		};
		updateStatusBar();
		this.updateStatusBar = updateStatusBar;

		statusBarItem.addEventListener("click", () => {
			void (async () => {
				this.settings.enableVerticalPreview =
					!this.settings.enableVerticalPreview;
				await this.saveAndRefresh();
			})();
		});

		// ===== コマンドパレット + ホットキー登録 =====
		this.addCommand({
			id: "toggle-vertical-preview",
			name: "縦書き / 横書きを切り替える",
			callback: async () => {
				this.settings.enableVerticalPreview =
					!this.settings.enableVerticalPreview;
				await this.saveAndRefresh();
			},
		});

		// モード切替・ペイン切替時にレイアウトを再適用
		// NOTE:
		// 以前は layout-change で rerender(true) を叩いていましたが、
		// rerender(true) はタイトル/プロパティが消える等の副作用が報告されており、
		// さらに今回の「連続空行」問題の根本原因は
		// 「セクション境界のみを見ていたこと」だったため、ここではレイアウト再適用だけ行います。
		const refreshLayoutOnly = () => {
			applyLayout(this.settings);
		};
		this.registerEvent(
			this.app.workspace.on("layout-change", refreshLayoutOnly),
		);
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", refreshLayoutOnly),
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

		// PostProcessor: sortOrder を大きめにして他プラグインより後に実行
		// 連続空行は「セクション境界」ではなく「セクション内の各ブロック開始行」を基準に
		// padding で表現する（DOMにスペーサー要素を挿入しない）
		this.registerMarkdownPostProcessor(
			(el, ctx: MarkdownPostProcessorContext) => {
				// CSSクラス付与（同期でOK）
				const previewView = el.closest(".markdown-preview-view");
				if (previewView instanceof HTMLElement) {
					previewView.classList.toggle(
						"novel-tools-softbreaks",
						this.isSoftBreakTarget(ctx?.sourcePath),
					);
					previewView.classList.toggle(
						"novel-tools-vertical",
						this.settings.enableVerticalPreview,
					);
				}

				// ===== 連続空行の保持（DOM非挿入 / ギャップ加算方式） =====
				// Obsidianのプレビューはブロック単位で <div data-line="..."> を生成することが多い。
				// 連続空行はMarkdown仕様で潰れるため、次ブロック開始行の直前にある空行数を数え、
				// “余剰分(空行数-1)”を「現在ブロックの後ろギャップ」として追加する。
				//
				// 重要:
				// - DOMにスペーサー要素は挿入しない（差し替えレンダリングで消えやすいため）
				// - 行番号は data-line / data-sourcepos / getSectionInfo のいずれかから取得（環境差吸収）
				// - 実際の空行カウントはファイル全体（cachedRead）をソースにする（座標系の揺れ対策）

				const sourcePath = ctx?.sourcePath;
				if (!sourcePath) {
					// sourcePath が無いケースは極めて稀だが、その場合は諦める
				} else {
					const af = this.app.vault.getAbstractFileByPath(sourcePath);
					if (af instanceof TFile) {
						// ファイル全文を読み、行配列を作る（Obsidianのキャッシュを使うので比較的軽い）
						// NOTE: modifyイベントでinvalidateするほどの仕組みは不要（この用途は軽い）なので都度読む。
						// ただし同一レンダリング内の重複読みを避けたい場合は、将来Mapキャッシュ化してください。
						const fileTextPromise = this.app.vault.cachedRead(af);

						// 対象の「ブロックwrapper」を決める:
						// - el が .markdown-preview-section 直下の div ならそれがwrapper（縦書き列もここ）
						// - el が section 自体なら、その直下divを列挙して処理
						const parentIsPreviewSection =
							el.parentElement?.classList.contains(
								"markdown-preview-section",
							) ?? false;
						const isWrapperDiv =
							parentIsPreviewSection && el.tagName === "DIV";

						const parseStartLine = (
							node: HTMLElement,
							fileLinesLen: number,
						): number | null => {
							// 1) data-line（0-basedが多いが環境差あり）
							const dl = node.getAttribute("data-line");
							if (dl) {
								const raw = Number(dl);
								if (Number.isFinite(raw)) {
									const cand = [raw, raw - 1];
									for (const v of cand)
										if (v >= 0 && v < fileLinesLen)
											return v;
								}
							}
							// 2) data-sourcepos（"12:1-14:10" のように 1-based が多い）
							const dsp = node.getAttribute("data-sourcepos");
							if (dsp) {
								const m = dsp.match(/^(\d+)\s*:/);
								if (m) {
									const raw = Number(m[1]);
									if (Number.isFinite(raw)) {
										const cand = [raw - 1, raw];
										for (const v of cand)
											if (v >= 0 && v < fileLinesLen)
												return v;
									}
								}
							}
							// 3) getSectionInfo の lineStart（0/1-based揺れ吸収）
							const info = ctx.getSectionInfo(node);
							if (info) {
								const raw = info.lineStart;
								const cand = [raw, raw - 1];
								for (const v of cand)
									if (v >= 0 && v < fileLinesLen) return v;
							}
							return null;
						};

						const countBlankLinesAbove = (
							lines: string[],
							startLine: number,
						): number => {
							let c = 0;
							for (let i = startLine - 1; i >= 0; i--) {
								if ((lines[i] ?? "").trim() === "") c++;
								else break;
							}
							return c;
						};

						const applyGap = (node: HTMLElement, extra: number) => {
							// まず解除（安全）
							node.classList.remove("novel-tools-blankpad");
							node.style.removeProperty(
								"--novel-tools-extra-blank-lines",
							);
							node.removeAttribute("data-nt-blank");

							if (extra <= 0) return;
							const maxExtra = 50;
							const e = Math.min(extra, maxExtra);

							node.classList.add("novel-tools-blankpad");
							node.style.setProperty(
								"--novel-tools-extra-blank-lines",
								String(e),
							);

							if (this.settings.enableDebugBorderPreview) {
								node.setAttribute("data-nt-blank", String(e));
							}
						};

						// 実処理（async）
						void fileTextPromise.then((fileText) => {
							const lines = fileText.split(/\r?\n/);

							// ★重要：縦書きは .markdown-preview-section > div を「列」として並べ、
							// 列間隔は margin-right（物理）で表現している。
							// vertical-rl の折返しでは margin-right は「次の列の手前」に効くため、
							// “連続空行”は「次ブロックの手前」に入れるのが正しい。
							// → 各 wrapper(div) 自身の開始行を基準に、直前の空行数を数えて、その wrapper に付与する。

							if (isWrapperDiv) {
								applyGap(el, 0);
								const start = parseStartLine(el, lines.length);
								if (start === null) return;
								const blankCount = countBlankLinesAbove(
									lines,
									start,
								);
								const extra = Math.max(0, blankCount - 1);
								applyGap(el, extra);
								return;
							}

							// section要素: 直下div（列wrapper）を列挙してそれぞれに適用
							const section = el.classList.contains(
								"markdown-preview-section",
							)
								? el
								: el.closest(".markdown-preview-section");

							if (!(section instanceof HTMLElement)) return;

							const children = Array.from(
								section.children,
							).filter(
								(n): n is HTMLElement =>
									n instanceof HTMLElement &&
									n.tagName === "DIV",
							);

							if (children.length === 0) return;

							// まず全解除
							for (const c of children) applyGap(c, 0);

							for (const c of children) {
								const start = parseStartLine(c, lines.length);
								if (start === null) continue;
								const blankCount = countBlankLinesAbove(
									lines,
									start,
								);
								const extra = Math.max(0, blankCount - 1);
								applyGap(c, extra);
							}
						});
					}
				}
				// ハイライト処理は他プラグインのDOM操作後に実行するためsetTimeoutを維持
				window.setTimeout(() => {
					if (!el.isConnected) return;
					processPreviewElement(el, this.settings);
				}, 0);
			},
			10000,
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
		this.updateStatusBar();

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
