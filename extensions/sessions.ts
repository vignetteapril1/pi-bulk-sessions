/**
 * /sessions — pi's resume browser, plus checkboxes for bulk chat deletion.
 *
 * It reuses pi's own `SessionSelectorComponent`, so search, scope (Tab),
 * sort (Ctrl+S), named filter (Ctrl+N), path (Ctrl+P), rename (Ctrl+R) and
 * Enter-to-resume all behave exactly like `/resume`. On top of that it draws a
 * checkbox column and adds multi-select deletion:
 *
 *   alt+s / ctrl+space / alt+space  toggle the focused chat
 *   alt+a / ctrl+a                  toggle every chat in the current filter
 *                                   (ctrl+a only while the search line is empty)
 *   alt+x / ctrl+d / ctrl+backspace delete all checked chats (asks once)
 *   alt+t / alt+m / alt+enter       also toggle
 *   ctrl+- / ctrl+\                 also toggle (Windows-friendly)
 *   enter                         resume focused chat (built-in)
 *   tab                           current folder <-> all projects (built-in)
 *   esc                           close (built-in)
 *
 * Windows Terminal swallows ctrl+space (Windows IME toggle) and alt+space
 * (window system menu), so the alt+letter keys are the ones that work there.
 * Probe a terminal with `test/keyprobe.ts` to see what reaches the app.
 *
 * Usage: `/sessions [all] [named]`
 *   all    start in the all-projects scope
 *   named  start with the named-sessions filter on
 *
 * Deletion matches pi's own single delete: try the `trash` CLI, then unlink.
 * On Windows that means permanent removal, so the confirm step lists the count.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { basename } from "node:path";

import {
	keyText,
	rawKeyHint,
	SessionManager,
	SessionSelectorComponent,
	type ExtensionAPI,
	type SessionInfo,
} from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, visibleWidth, type KeyId } from "@earendil-works/pi-tui";

// ---------------------------------------------------------------------------
// Structural types for pi internals we decorate.
// `sessionList`, `header` and `refreshSessionsAfterMutation` are TS-private on
// SessionSelectorComponent, so they are only reachable through a cast.
// ---------------------------------------------------------------------------

interface SessionRow {
	session?: SessionInfo;
}

interface SessionListInternals {
	filteredSessions: SessionRow[];
	selectedIndex: number;
	maxVisible: number;
	searchInput: { render(width: number): string[]; getValue(): string };
	render(width: number): string[];
}

interface HeaderInternals {
	render(width: number): string[];
	setStatusMessage(msg: { type: "info" | "error"; message: string } | null, autoHideMs?: number): void;
}

interface SelectorInternals {
	mode?: string;
	searchInput?: { getValue(): string };
	sessionList: SessionListInternals;
	header: HeaderInternals;
	handleInput(data: string): void;
	refreshSessionsAfterMutation(): Promise<void>;
	toggleScope?(): void;
	toggleNameFilter?(): void;
}

interface ThemeLike {
	fg(color: string, text: string): string;
	bg(color: string, text: string): string;
	bold(text: string): string;
}

interface KeybindingsLike {
	matches(data: string, keybinding: string): boolean;
}

interface TuiLike {
	requestRender(): void;
}

export interface BulkDeleteOptions {
	theme: ThemeLike;
	tui: TuiLike;
	keybindings: KeybindingsLike;
	currentSessionFile?: string;
}

export interface BulkDeleteController {
	checked: Map<string, string>;
	readonly confirming: boolean;
	toggleFocused(): void;
	toggleAll(): void;
	deleteChecked(): Promise<{ deleted: number; failures: string[] }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Session file names are uuidv7 ids, so the base name is a stable, portable key. */
function keyOf(sessionPath: string): string {
	return basename(sessionPath).toLowerCase();
}

// Terminal-safe key groups. Windows Terminal drops ctrl+space (Windows uses it
// as the IME toggle) and alt+space (window system menu), and every ctrl+letter
// is already taken by pi (app, editor or session selector), so these are the
// keys that survive on Windows. All of them are unbound in pi 1.1.0.
const TOGGLE_KEYS = [
	Key.ctrl("space"),
	Key.alt("space"),
	Key.alt("s"),
	Key.alt("t"),
	Key.alt("m"),
	Key.alt("enter"),
	Key.ctrl(Key.hyphen),
	Key.ctrl(Key.backslash),
];
const TOGGLE_ALL_KEYS = [Key.alt("a")];
const DELETE_CHECKED_KEYS = [Key.alt("x")];

const matchesAny = (data: string, keys: KeyId[]): boolean => keys.some((key) => matchesKey(data, key));

/** Same as pi's own delete: prefer the `trash` CLI, fall back to permanent unlink. */
async function deleteSessionFile(
	sessionPath: string,
): Promise<{ ok: boolean; method: "trash" | "unlink"; error?: string }> {
	const trashArgs = sessionPath.startsWith("-") ? ["--", sessionPath] : [sessionPath];
	const trashResult = spawnSync("trash", trashArgs, { encoding: "utf-8" });
	if (trashResult.status === 0 || !existsSync(sessionPath)) {
		return { ok: true, method: "trash" };
	}
	try {
		await unlink(sessionPath);
		return { ok: true, method: "unlink" };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { ok: false, method: "unlink", error: message };
	}
}

function visibleWindow(total: number, maxVisible: number, selectedIndex: number): { start: number; end: number } {
	const start = Math.max(0, Math.min(selectedIndex - Math.floor(maxVisible / 2), total - maxVisible));
	return { start, end: Math.min(start + maxVisible, total) };
}

const ANSI_TOKEN = /\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

function tokenizeLine(line: string): { esc: boolean; value: string }[] {
	const tokens: { esc: boolean; value: string }[] = [];
	const re = new RegExp(ANSI_TOKEN.source, "g");
	let last = 0;
	let match: RegExpExecArray | null;
	while ((match = re.exec(line))) {
		if (match.index > last) tokens.push({ esc: false, value: line.slice(last, match.index) });
		tokens.push({ esc: true, value: match[0] });
		last = match.index + match[0].length;
	}
	if (last < line.length) tokens.push({ esc: false, value: line.slice(last) });
	return tokens;
}

/**
 * Shrink the row's internal padding (the gap between the message and the
 * right-aligned metadata) by `want` columns, in place. Returns false when the
 * row has no padding left to give.
 */
function takePadding(tokens: { esc: boolean; value: string }[], want: number): boolean {
	let taken = 0;
	for (let i = tokens.length - 1; i >= 0 && taken < want; i--) {
		const token = tokens[i]!;
		if (token.esc) continue;
		const trailing = token.value.length - token.value.replace(/\s+$/, "").length;
		const take = Math.min(trailing, want - taken);
		if (take <= 0) continue;
		token.value = token.value.slice(0, token.value.length - take);
		taken += take;
	}
	return taken >= want;
}

const joinTokens = (tokens: { value: string }[]): string => tokens.map((token) => token.value).join("");

/**
 * Prefix a rendered row with `box` without losing the right-aligned metadata:
 * the box is paid for out of the row's padding, not out of the terminal width.
 */
function prefixRow(line: string, box: string): string | undefined {
	const tokens = tokenizeLine(line);
	if (!takePadding(tokens, visibleWidth(box))) return undefined;
	return box + joinTokens(tokens);
}

/** Append `suffix` to a rendered row, paid for the same way. */
function appendRow(line: string, suffix: string): string | undefined {
	const tokens = tokenizeLine(line);
	if (!takePadding(tokens, visibleWidth(suffix))) return undefined;
	return joinTokens(tokens) + suffix;
}

// ---------------------------------------------------------------------------
// The checkbox layer
// ---------------------------------------------------------------------------

/**
 * Wrap a live `SessionSelectorComponent` with a checkbox column, multi-select
 * keys and bulk delete. The selector's own `handleInput` is wrapped, so the
 * checkbox keys work whether the search box or the list holds focus, and every
 * built-in key keeps working.
 */
export function attachBulkDelete(selector: unknown, options: BulkDeleteOptions): BulkDeleteController {
	const internals = selector as unknown as SelectorInternals;
	const list = internals.sessionList;
	const header = internals.header;
	const { theme, tui, keybindings, currentSessionFile } = options;

	const checked = new Map<string, string>();
	const currentKey = currentSessionFile ? keyOf(currentSessionFile) : undefined;
	const isCurrent = (sessionPath: string) => !!currentKey && keyOf(sessionPath) === currentKey;

	let confirming = false;
	let busy = false;

	const rows = (): SessionRow[] => (Array.isArray(list.filteredSessions) ? list.filteredSessions : []);
	const paths = (): string[] =>
		rows()
			.map((row) => row.session?.path)
			.filter((path): path is string => typeof path === "string" && path.length > 0);

	const setStatus = (message: string, type: "info" | "error" = "info", autoHideMs?: number) => {
		try {
			header.setStatusMessage({ type, message }, autoHideMs);
		} catch {
			/* header shape changed in a future pi; the checkbox column still works */
		}
	};

	const toggle = (sessionPath: string) => {
		if (isCurrent(sessionPath)) {
			setStatus("Cannot delete the currently active session", "error", 3000);
			tui.requestRender();
			return;
		}
		const key = keyOf(sessionPath);
		if (checked.has(key)) checked.delete(key);
		else checked.set(key, sessionPath);
		tui.requestRender();
	};

	const toggleFocused = () => {
		const path = rows()[list.selectedIndex]?.session?.path;
		if (path) toggle(path);
	};

	const toggleAll = () => {
		const targets = paths().filter((path) => !isCurrent(path));
		if (targets.length === 0) return;
		const allOn = targets.every((path) => checked.has(keyOf(path)));
		for (const path of targets) {
			if (allOn) checked.delete(keyOf(path));
			else checked.set(keyOf(path), path);
		}
		tui.requestRender();
	};

	const deleteChecked = async () => {
		const targets = [...checked.values()].filter((path) => !isCurrent(path));
		busy = true;
		let deleted = 0;
		const failures: string[] = [];
		for (const path of targets) {
			const result = await deleteSessionFile(path);
			if (result.ok) {
				deleted++;
				checked.delete(keyOf(path));
			} else {
				failures.push(`${basename(path)}: ${result.error ?? "unknown error"}`);
			}
		}
		confirming = false;
		busy = false;
		try {
			await internals.refreshSessionsAfterMutation();
		} catch {
			/* reload is best effort */
		}
		if (failures.length > 0) {
			setStatus(`Deleted ${deleted}, failed ${failures.length} (${failures[0]})`, "error", 8000);
		} else if (deleted > 0) {
			setStatus(`Deleted ${deleted} chat${deleted === 1 ? "" : "s"}`, "info", 4000);
		} else {
			setStatus("Nothing deleted", "info", 2500);
		}
		tui.requestRender();
		return { deleted, failures };
	};

	// --- render: prefix every visible row with a checkbox -------------------
	const baseRender = list.render.bind(list);
	list.render = (width: number) => {
		const lines = baseRender(width);
		try {
			const all = rows();
			const total = all.length;
			if (total > 0) {
				// base layout: <search input lines>, blank line, rows, optional scroll hint
				const searchLines = list.searchInput?.render(width)?.length ?? 1;
				const offset = searchLines + 1;
				const { start, end } = visibleWindow(total, list.maxVisible ?? 10, list.selectedIndex ?? 0);
				for (let i = start; i < end; i++) {
					const lineIndex = offset + (i - start);
					if (lineIndex >= lines.length) break;
					const path = all[i]?.session?.path;
					if (!path) continue;
					const isChecked = checked.has(keyOf(path));
					const current = isCurrent(path);
					const box = isChecked ? "[x] " : current ? "[•] " : "[  ] ";
					const colored = isChecked ? theme.fg("error", box) : theme.fg(current ? "accent" : "dim", box);
					const line = lines[lineIndex] ?? "";
					const isSelectedRow = i === list.selectedIndex;
					const prefixed = prefixRow(line, colored);
					const decorated = prefixed ?? `${colored}${line}`;
					lines[lineIndex] = truncateToWidth(isSelectedRow ? theme.bg("selectedBg", decorated) : decorated, width);
				}
			}
			if (checked.size > 0) {
				const summary = `${checked.size} selected`;
				const styled = confirming ? theme.fg("error", summary) : theme.fg("warning", summary);
				const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
				// box-drawing borders and the "(9/12)" scroll hint are not rows
				const isChrome = (plain: string) =>
					plain.trim().length === 0 ||
					/^[\s\u2500\u2501\u2550\u250c\u2510\u2514\u2518\u251c\u2524\u252c\u2534\u2560\u2563\u255a\u255d\u2554\u2557]+$/.test(plain) ||
					/^\(\d+\/\d+\)$/.test(plain.trim());
				let target = -1;
				for (let i = lines.length - 1; i >= 0 && target < 0; i--) {
					if (/^\[(x| |\u2022)\]/.test(strip(lines[i] ?? ""))) target = i;
				}
				if (target < 0) {
					for (let i = lines.length - 1; i >= 0 && target < 0; i--) {
						if (!isChrome(strip(lines[i] ?? ""))) target = i;
					}
				}
				if (target >= 0) {
					const row = lines[target] as string;
					const appended = appendRow(row, `  ${styled}`);
					lines[target] =
						appended ??
						truncateToWidth(`${truncateToWidth(row, Math.max(0, width - visibleWidth(styled) - 2), "")}  ${styled}`, width, "");
				}
			}
		} catch {
			return baseRender(width);
		}
		return lines;
	};

	// --- header: one extra hint line ---------------------------------------
	const baseHeaderRender = header.render.bind(header);
	header.render = (width: number) => {
		const lines = baseHeaderRender(width);
		try {
			if (confirming) {
				const hint =
					`Delete ${checked.size} chat${checked.size === 1 ? "" : "s"} permanently? ` +
					`${keyText("tui.select.confirm")} confirm · ${keyText("tui.select.cancel")} cancel`;
				lines.splice(1, 0, truncateToWidth(theme.fg("error", theme.bold(hint)), width, "…"));
			} else {
				const sep = theme.fg("muted", " · ");
				const parts = [
					theme.fg("dim", "alt+s/ctrl+space") + theme.fg("muted", " toggle"),
					rawKeyHint(Key.alt("a"), "all"),
					theme.fg("dim", "alt+x") + theme.fg("muted", "/") + theme.fg("dim", keyText("app.session.delete") || "ctrl+d") + theme.fg("muted", " delete checked"),
				].filter((part) => part.length > 0);
				lines.splice(1, 0, truncateToWidth(` ${parts.join(sep)}`, width, "…"));
			}
		} catch {
			/* ignore hint failures; the list itself is what matters */
		}
		return lines;
	};

	// --- input: checkbox keys in front of the built-in handler -------------
	// The selector owns focus: it routes keys to the search box when the search
	// box is focused (it starts focused) and to the list otherwise. Intercepting
	// here means the checkbox keys work in both states, and typing still filters.
	const baseHandleInput = internals.handleInput.bind(internals);
	const searchValue = (): string => {
		try {
			return internals.searchInput?.getValue?.() ?? list.searchInput?.getValue?.() ?? "";
		} catch {
			return "";
		}
	};
	// The rename editor is created focused, so focus cannot detect rename mode;
	// only the selector's own mode field can.
	const isRenaming = (): boolean => internals.mode === "rename";

	internals.handleInput = (data: string) => {
		if (busy) return;

		if (confirming) {
			if (keybindings.matches(data, "tui.select.confirm")) {
				confirming = false;
				void deleteChecked();
				return;
			}
			if (keybindings.matches(data, "tui.select.cancel")) {
				confirming = false;
				try {
					header.setStatusMessage(null);
				} catch {
					/* ignore */
				}
				tui.requestRender();
				return;
			}
			return; // swallow everything else while confirming
		}

		// Never steal keys from the rename editor (spaces belong in session names).
		if (!isRenaming()) {
			if (matchesAny(data, TOGGLE_KEYS)) {
				toggleFocused();
				return;
			}

			if (matchesAny(data, TOGGLE_ALL_KEYS) || (searchValue().length === 0 && matchesKey(data, Key.ctrl("a")))) {
				toggleAll();
				return;
			}

			const deleteKey =
				matchesAny(data, DELETE_CHECKED_KEYS) ||
				keybindings.matches(data, "app.session.delete") ||
				keybindings.matches(data, "app.session.deleteNoninvasive");
			if (deleteKey && checked.size > 0) {
				confirming = true;
				tui.requestRender();
				return;
			}
		}

		baseHandleInput(data);
	};

	return {
		checked,
		get confirming() {
			return confirming;
		},
		toggleFocused,
		toggleAll,
		deleteChecked,
	};
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
	pi.registerCommand("sessions", {
		description: "Browse chats with checkboxes and delete many at once (usage: /sessions [all] [named])",
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/sessions needs the interactive TUI - start `pi` without -p/--print", "warning");
				return;
			}

			const wantAll = /\ball\b/i.test(args);
			const wantNamed = /\bnamed\b/i.test(args);

			const sessionManager = ctx.sessionManager;
			const cwd = sessionManager.getCwd();
			const sessionDir = sessionManager.getSessionDir();
			const currentSessionFile = sessionManager.getSessionFile();
			const usesDefaultDir =
				typeof (sessionManager as unknown as { usesDefaultSessionDir?: () => boolean }).usesDefaultSessionDir === "function"
					? (sessionManager as unknown as { usesDefaultSessionDir: () => boolean }).usesDefaultSessionDir()
					: true;

			const outcome = await ctx.ui.custom<{ resumePath?: string }>((tui, theme, keybindings, done) => {
				const selector = new SessionSelectorComponent(
					(onProgress, signal) => SessionManager.list(cwd, sessionDir, onProgress, signal),
					(onProgress, signal) =>
						usesDefaultDir
							? SessionManager.listAll(onProgress, signal)
							: SessionManager.listAll(sessionDir, onProgress, signal),
					(sessionPath) => done({ resumePath: sessionPath }),
					() => done({}),
					() => done({}),
					() => tui.requestRender(),
					{
						keybindings,
						showRenameHint: true,
						renameSession: async (sessionFilePath, nextName) => {
							const next = (nextName ?? "").trim();
							if (!next) return;
							SessionManager.open(sessionFilePath).appendSessionInfo(next);
						},
					},
					currentSessionFile,
				);

				attachBulkDelete(selector, { theme, tui, keybindings, currentSessionFile });

				const internals = selector as unknown as SelectorInternals;
				if (wantNamed) internals.toggleNameFilter?.();
				if (wantAll) internals.toggleScope?.();

				return selector;
			});

			if (outcome?.resumePath) {
				await ctx.switchSession(outcome.resumePath);
			}
		},
	});
}
