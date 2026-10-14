/** Probe: compare the built-in row lines with the checkbox-decorated lines. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTheme, SessionSelectorComponent, type SessionInfo } from "@earendil-works/pi-coding-agent";
import { KeybindingsManager, setKeybindings, TUI_KEYBINDINGS, TuiMainScreen, visibleWidth } from "@earendil-works/pi-tui";
import { attachBulkDelete } from "../extensions/sessions.ts";

initTheme();
const theme = (globalThis as Record<symbol, any>)[Symbol.for("@earendil-works/pi-coding-agent:theme")];
const keybindings = new KeybindingsManager({ ...TUI_KEYBINDINGS, "app.session.delete": { defaultKeys: "ctrl+d" } });
setKeybindings(keybindings as never);

const dir = mkdtempSync(join(tmpdir(), "pi-probe4-"));
const mk = (id: string, msg: string, minsAgo: number): SessionInfo => ({
	path: join(dir, `${id}.jsonl`),
	id,
	cwd: dir,
	created: new Date(),
	modified: new Date(Date.now() - minsAgo * 60_000),
	messageCount: 12,
	firstMessage: msg,
	allMessagesText: msg,
});
const sessions = [mk("aaa", "Fix the resume menu checkboxes", 1), mk("bbb", "Add a tool to pi", 2), mk("ccc", "Current chat about lunch", 3)];

const tui = new TuiMainScreen({
	columns: 96,
	rows: 30,
	kittyProtocolActive: false,
	start() {},
	stop() {},
	drainInput: () => Promise.resolve(),
	write() {},
	moveBy() {},
	hideCursor() {},
	showCursor() {},
	clearLine() {},
	clearFromCursor() {},
	clearScreen() {},
	setTitle() {},
	setProgress() {},
	setProgramStatus() {},
} as never);
const load = async () => sessions;
const selector = new SessionSelectorComponent(load, load, () => {}, () => {}, () => {}, () => {}, { keybindings: keybindings as never }, sessions[2]!.path);
const list = (selector as unknown as { sessionList: any }).sessionList;
await new Promise((r) => setTimeout(r, 60));
list.filterSessions("");

const base = list.render(96);
console.log("BASE lines:");
for (const l of base) console.log(`  w=${String(visibleWidth(l)).padStart(3)} ${JSON.stringify(l)}`);

attachBulkDelete(selector, { theme, tui, keybindings: keybindings as never, currentSessionFile: sessions[2]!.path });
list.handleInput("\x00"); // check row 0
const dec = list.render(96);
console.log("DECORATED lines:");
for (const l of dec) console.log(`  w=${String(visibleWidth(l)).padStart(3)} ${JSON.stringify(l)}`);
rmSync(dir, { recursive: true, force: true });
