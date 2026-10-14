/**
 * Headless render + key-handling test for the /sessions bulk-delete extension.
 *
 * Drives pi's real SessionSelectorComponent through a real TuiMainScreen with a
 * fake terminal, so the checkbox column, the multi-select keys and the bulk
 * delete run exactly as they do inside pi.
 *
 * Run:  node --experimental-strip-types .harness/test.ts
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initTheme, SessionSelectorComponent, type SessionInfo } from "@earendil-works/pi-coding-agent";
import {
	KeybindingsManager as TuiKeybindingsManager,
	setKeybindings,
	TUI_KEYBINDINGS,
	TuiMainScreen,
	type ProgramStatus,
} from "@earendil-works/pi-tui";

import { attachBulkDelete } from "../extensions/sessions.ts";

// ---------------------------------------------------------------------------
// fake terminal
// ---------------------------------------------------------------------------
class FakeTerminal {
	out = "";
	columns = 96;
	rows = 40;
	kittyProtocolActive = false;
	private onInput?: (data: string) => void;

	start(onInput: (data: string) => void): void {
		this.onInput = onInput;
	}
	stop(): void {}
	async drainInput(): Promise<void> {}
	write(data: string): void {
		this.out += data;
	}
	moveBy(): void {}
	hideCursor(): void {}
	showCursor(): void {}
	clearLine(): void {}
	clearFromCursor(): void {}
	clearScreen(): void {}
	setTitle(): void {}
	setProgress(): void {}
	setProgramStatus(_status: ProgramStatus): void {}

	send(data: string): void {
		this.onInput?.(data);
	}
	beginFrame(): void {
		this.out = "";
	}
	frame(): string {
		return stripAnsi(this.out).replace(/\r\n/g, "\n");
	}
}

/** Last `n` visible characters of a rendered line (ANSI stripped). */
function tailOf(line: string, n = 6): string {
	return stripAnsi(line).replace(/\s+$/, "").slice(-n);
}

function stripAnsi(text: string): string {
	return text
		.replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, "")
		.replace(/\x1b\[[0-9;?]*[ -\/]*[0-9;?]*[@-~]/g, "")
		.replace(/\x1b[@-Z\\-_]/g, "");
}

let failures = 0;
function check(name: string, ok: boolean, extra = ""): void {
	if (ok) {
		console.log(`  ok   ${name}`);
	} else {
		failures++;
		console.log(`  FAIL ${name}${extra ? ` -> ${extra}` : ""}`);
	}
}

// ---------------------------------------------------------------------------
// fixtures: three real session files on disk
// ---------------------------------------------------------------------------
// Digits-only directory name: pi's fuzzy search also matches the cwd, so a random
// mkdtemp suffix containing "l" before "u" would make the "lu" query match everything.
const dir = join(tmpdir(), `pi-sessions-test-${process.pid}`);
mkdirSync(dir, { recursive: true });
const baseTime = Date.now() - 3600_000;

/** `modified` is explicit so list order is deterministic (newest first); the current chat is oldest. */
function makeSession(id: string, firstMessage: string, modifiedMinutesAgo: number): SessionInfo {
	const path = join(dir, `${id}.jsonl`);
	writeFileSync(path, `${JSON.stringify({ type: "session", id, cwd: dir, timestamp: Date.now() })}\n`);
	return {
		path,
		id,
		cwd: dir,
		name: undefined,
		created: new Date(baseTime),
		modified: new Date(baseTime - modifiedMinutesAgo * 60_000),
		messageCount: 4,
		firstMessage,
		allMessagesText: firstMessage,
	};
}

const sessions = [
	makeSession("aaa111", "Fix the resume menu checkboxes", 1),
	makeSession("bbb222", "Add a tool to pi", 2),
	makeSession("ccc333", "Current chat about lunch", 3),
];
const currentSessionFile = sessions[2]!.path;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
	initTheme();
	const theme = (globalThis as Record<symbol, any>)[Symbol.for("@earendil-works/pi-coding-agent:theme")];
	if (!theme || typeof theme.fg !== "function") throw new Error("theme not initialized");

	// pi's app KeybindingsManager is not exported as a value, so rebuild the same
	// session keymap (pi's dist/core/keybindings.ts) on the pi-tui base class.
	const keybindings = new TuiKeybindingsManager({
		...TUI_KEYBINDINGS,
		"app.session.delete": { defaultKeys: "ctrl+d" },
		"app.session.deleteNoninvasive": { defaultKeys: "ctrl+backspace" },
		"app.session.toggleSort": { defaultKeys: "ctrl+s" },
		"app.session.toggleNamedFilter": { defaultKeys: "ctrl+n" },
		"app.session.togglePath": { defaultKeys: "ctrl+p" },
		"app.session.rename": { defaultKeys: "ctrl+r" },
	});
	setKeybindings(keybindings as never);

	const terminal = new FakeTerminal();
	const tui = new TuiMainScreen(terminal);

	// loaders read the disk, so the refresh-after-delete path is exercised
	const load = async (onProgress?: (n: number, m: number, list: SessionInfo[]) => void) => {
		const list = sessions.filter((session) => existsSync(session.path));
		onProgress?.(list.length, list.length, list);
		return list;
	};

	let resumed: string | undefined;
	const selector = new SessionSelectorComponent(
		load,
		load,
		(sessionPath) => {
			resumed = sessionPath;
		},
		() => {},
		() => {},
		() => tui.requestRender(),
		{ keybindings: keybindings as never, showRenameHint: true, renameSession: async () => {} },
		currentSessionFile,
	);

	const controller = attachBulkDelete(selector, { theme, tui, keybindings, currentSessionFile });

	tui.addChild(selector);
	tui.setFocus(selector);
	tui.start();
	await sleep(150);

	const render = () => {
		terminal.beginFrame();
		tui.renderNow(true);
	};
	const frame = () => terminal.frame();
	const press = async (data: string, ms = 40) => {
		terminal.send(data);
		await sleep(ms);
		render();
	};
	render();

	console.log("\n[1] initial render (search box focused, like /resume)");
	let f = frame();
	check("checkbox column rendered", f.includes("[  ]"));
	check("current session marked with bullet", f.includes("[•]"));
	check("session titles rendered", f.includes("Fix the resume menu checkboxes") && f.includes("Add a tool to pi"));
	check("hint line mentions alt+s", f.includes("alt+s"));
	check("hint line mentions alt+x", f.includes("alt+x"));
	check("no selection summary yet", !f.includes("selected"));

	console.log("\n[2] ctrl+space toggles the focused chat (search box focused)");
	await press("\x00"); // ctrl+space arrives as NUL
	check("checked size is 1", controller.checked.size === 1, `size=${controller.checked.size}`);
	f = frame();
	check("row shows [x]", f.includes("[x]"));
	check("summary shows 1 selected", f.includes("1 selected"));
	const list0 = (selector as unknown as { sessionList: { render(width: number): string[] } }).sessionList;
	const baseRow0 = (Object.getPrototypeOf(list0) as { render(w: number): string[] }).render.call(list0, 96).find((line) => line.includes("Fix the resume menu checkboxes")) ?? "";
	const decoratedRow0 = f.split("\n").find((line) => line.includes("Fix the resume menu checkboxes")) ?? "";
	check(
		"row metadata survives the checkbox column",
		tailOf(decoratedRow0) === tailOf(baseRow0) && tailOf(baseRow0).length > 0,
		`${JSON.stringify(tailOf(decoratedRow0))} vs ${JSON.stringify(tailOf(baseRow0))}`,
	);

	console.log("\n[3] arrow keys still move the list");
	await press("\x1b[B"); // down
	const list = (selector as unknown as { sessionList: { selectedIndex: number } }).sessionList;
	check("selection moved down", list.selectedIndex === 1, `idx=${list.selectedIndex}`);

	console.log("\n[4] ctrl+space on the second row, then ctrl+a toggles the whole filter");
	await press("\x00");
	check("checked size is 2", controller.checked.size === 2, `size=${controller.checked.size}`);
	await press("\x01"); // ctrl+a: every selectable row is already checked -> uncheck all
	check("ctrl+a unchecks when all are checked", controller.checked.size === 0, `size=${controller.checked.size}`);
	await press("\x01");
	check("ctrl+a checks every non-current chat", controller.checked.size === 2, `size=${controller.checked.size}`);
	check("current chat is never checked", !controller.checked.has("ccc333.jsonl"));
	await press("\x01");
	check("ctrl+a again clears the selection", controller.checked.size === 0, `size=${controller.checked.size}`);
	await press("\x01");
	check("ctrl+a re-selects", controller.checked.size === 2, `size=${controller.checked.size}`);

	console.log("\n[5] terminal-safe toggle aliases (Windows Terminal drops ctrl+space and alt+space)");
	const aliases: Array<[string, string]> = [
		["alt+space", "\x1b "],
		["alt+s", "\x1bs"],
		["alt+t", "\x1bt"],
		["alt+m", "\x1bm"],
		["alt+enter", "\x1b\r"],
		["ctrl+-", "\x1f"],
		["ctrl+\\", "\x1c"],
	];
	for (const [label, seq] of aliases) {
		const before = controller.checked.size;
		await press(seq);
		const afterFirst = controller.checked.size;
		await press(seq);
		const afterSecond = controller.checked.size;
		check(`${label} toggles off then on`, afterFirst === before - 1 && afterSecond === before, `${before} -> ${afterFirst} -> ${afterSecond}`);
	}

	console.log("\n[6] the active chat is protected from checking");
	await press("\x1b[B"); // onto the current chat's row
	await press("\x00");
	check("current chat cannot be checked", controller.checked.size === 2, `size=${controller.checked.size}`);
	check("status explains why", frame().includes("Cannot delete the currently active session"));
	await press("\x1b[A");

	console.log("\n[7] ctrl+d asks for confirmation, esc cancels, nothing is deleted");
	await press("\x04");
	f = frame();
	check("confirm prompt shown", f.includes("Delete 2 chats permanently?"), JSON.stringify(f.split("\n").slice(0, 6)));
	check("confirming flag set", controller.confirming === true);
	await press("\x1b");
	check("confirming cleared by esc", controller.confirming === false);
	check("selection survives esc", controller.checked.size === 2, `size=${controller.checked.size}`);
	check("all files still on disk", sessions.every((s) => existsSync(s.path)));

	console.log("\n[7b] alt+x opens the same confirm prompt");
	await press("\x1bx");
	check("alt+x opens confirm", controller.confirming === true, `confirming=${controller.confirming}`);
	await press("\x1b");
	check("alt+x confirm cancelled by esc", controller.confirming === false);
	check("alt+x cancel deleted nothing", sessions.every((s) => existsSync(s.path)));

	console.log("\n[8] typing filters the list (search box keeps working; pi debounces the filter)");
	await press("l");
	await press("u", 120);
	// pi debounces the filter, so poll instead of trusting a fixed sleep
	let filtered = false;
	for (let i = 0; i < 40 && !filtered; i++) {
		await sleep(80);
		render();
		f = frame();
		filtered = f.includes("Current chat about lunch") && !f.includes("Fix the resume menu checkboxes");
	}
	check(
		"search filtered down to the lunch thread",
		f.includes("Current chat about lunch") && !f.includes("Fix the resume menu checkboxes"),
		JSON.stringify(f.split("\n").slice(8)),
	);
	check("selection summary survives filtering", f.includes("2 selected"));
	await press("\x15"); // ctrl+u clears the search line
	let unfiltered = false;
	for (let i = 0; i < 40 && !unfiltered; i++) {
		await sleep(80);
		render();
		f = frame();
		unfiltered = f.includes("Add a tool to pi") && f.includes("Fix the resume menu checkboxes");
	}
	check("search cleared -> all chats listed again", unfiltered);

	console.log("\n[9] ctrl+d then enter deletes for real");
	await press("\x04");
	await press("\r", 250);
	check("first chat deleted", !existsSync(sessions[0]!.path));
	check("second chat deleted", !existsSync(sessions[1]!.path));
	check("current chat NOT deleted", existsSync(currentSessionFile));
	f = frame();
	check("status reports deletion", f.includes("Deleted 2 chats"), JSON.stringify(f.split("\n").slice(0, 8)));
	check("checked set cleared", controller.checked.size === 0);
	check("enter did not resume a chat", resumed === undefined, `resumed=${resumed}`);

	console.log("\n[10] list refreshed after delete");
	await sleep(150);
	render();
	f = frame();
	check("deleted chats gone from the list", !f.includes("Fix the resume menu checkboxes") && !f.includes("Add a tool to pi"));
	check("remaining chat listed", f.includes("Current chat about lunch"));

	console.log("\n[11] enter with nothing checked resumes the focused chat");
	await press("\r", 60);
	check("resume callback fired", resumed === currentSessionFile, `resumed=${resumed}`);

	console.log("\n[12] /sessions all + named start options apply to the selector");
	const internals = selector as unknown as { toggleScope(): void; toggleNameFilter(): void };
	internals.toggleScope();
	internals.toggleNameFilter();
	render();
	f = frame();
	check("scope switched to all projects", f.includes("Resume Session (All)"), JSON.stringify(f.split("\n")[3]));
	check("named filter switched on", f.includes("Name: Named"), JSON.stringify(f.split("\n")[3]));

	console.log("\n[13] checkboxes stay on the right rows when the list scrolls");
	const many = Array.from({ length: 25 }, (_, i) => makeSession(`s${String(i).padStart(2, "0")}`, `Chat number ${i}`, 500 + i));
	const loadMany = async () => many.filter((session) => existsSync(session.path));
	const selector2 = new SessionSelectorComponent(
		loadMany,
		loadMany,
		() => {},
		() => {},
		() => {},
		() => tui.requestRender(),
		{ keybindings: keybindings as never, showRenameHint: true, renameSession: async () => {} },
		currentSessionFile,
	);
	attachBulkDelete(selector2, { theme, tui, keybindings, currentSessionFile });
	const tui2 = new TuiMainScreen(terminal);
	tui2.addChild(selector2);
	tui2.setFocus(selector2);
	tui2.start();
	await sleep(150);
	const list2 = (selector2 as unknown as { sessionList: { selectedIndex: number } }).sessionList;
	for (let i = 0; i < 15; i++) {
		terminal.send("\x1b[B");
		await sleep(6);
	}
	await sleep(40);
	terminal.send("\x00");
	await sleep(40);
	terminal.beginFrame();
	tui2.renderNow(true);
	f = frame();
	check("list scrolled to the focused row", list2.selectedIndex === 15, `idx=${list2.selectedIndex}`);
	const checkedRow = f.split("\n").find((line) => line.includes("Chat number 15")) ?? "";
	const neighbourRow = f.split("\n").find((line) => line.includes("Chat number 16")) ?? "";
	check("checkbox sits on the focused row", checkedRow.includes("[x]"), JSON.stringify(checkedRow));
	check("neighbouring row stays unchecked", neighbourRow.includes("[  ]"), JSON.stringify(neighbourRow));
	const tail = (s: string) => tailOf(s);
	// the summary is appended to the last visible row, so compare metadata on a row above it
	const metaRow = f.split("\n").find((line) => line.includes("Chat number 14")) ?? "";
	const baseRows = (Object.getPrototypeOf(list2) as { render(w: number): string[] }).render.call(list2, 96);
	const baseMeta = baseRows.find((line) => line.includes("Chat number 14")) ?? "";
	check("rows keep their right-aligned metadata", tail(metaRow) === tail(baseMeta) && tail(baseMeta).length > 0, `${JSON.stringify(tail(metaRow))} vs ${JSON.stringify(tail(baseMeta))}`);
	check("selection summary lands on a row", f.includes("1 selected"), JSON.stringify(f.split("\n").slice(-4)));
	check("row width unchanged after decoration", stripAnsi(checkedRow).length <= 96, String(stripAnsi(checkedRow).length));
	tui2.stop();

	tui.stop();
	rmSync(dir, { recursive: true, force: true });

	console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
	if (failures > 0) process.exitCode = 1;
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
