/** Print what /sessions looks like: 12 chats, 3 checked, list scrolled, confirm prompt. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTheme, SessionSelectorComponent, type SessionInfo } from "@earendil-works/pi-coding-agent";
import {
	KeybindingsManager,
	setKeybindings,
	TUI_KEYBINDINGS,
	TuiMainScreen,
} from "@earendil-works/pi-tui";
import { attachBulkDelete } from "../extensions/sessions.ts";

initTheme();
const theme = (globalThis as Record<symbol, any>)[Symbol.for("@earendil-works/pi-coding-agent:theme")];
const keybindings = new KeybindingsManager({
	...TUI_KEYBINDINGS,
	"app.session.delete": { defaultKeys: "ctrl+d" },
	"app.session.deleteNoninvasive": { defaultKeys: "ctrl+backspace" },
	"app.session.toggleSort": { defaultKeys: "ctrl+s" },
	"app.session.toggleNamedFilter": { defaultKeys: "ctrl+n" },
	"app.session.togglePath": { defaultKeys: "ctrl+p" },
	"app.session.rename": { defaultKeys: "ctrl+r" },
});
setKeybindings(keybindings as never);

const dir = mkdtempSync(join(tmpdir(), "pi-preview-"));
const titles = [
	"Refactor the session selector",
	"Add checkboxes to the resume menu",
	"Fix ANSI truncation on wide CJK rows",
	"Investigate ctrl+space arriving as NUL",
	"Wire up the search rate limiter",
	"Port the renderer to the new engine",
	"Current chat about lunch",
	"Train the small model on the GPU",
	"Debug the flaky keybinding probe",
	"Polish the status line copy",
	"Notes on pi extension keybindings",
	"Old scratch session",
];
const sessions: SessionInfo[] = titles.map((title, i) => ({
	path: join(dir, `s${i}.jsonl`),
	id: `s${i}`,
	cwd: dir,
	name: i === 1 ? "checkboxes" : undefined,
	created: new Date(),
	modified: new Date(Date.now() - (i + 1) * 3_600_000),
	messageCount: (i + 1) * 7,
	firstMessage: title,
	allMessagesText: title,
}));
const current = sessions[6]!.path;

const terminal = {
	columns: 96,
	rows: 24,
	kittyProtocolActive: false,
	out: "",
	start(onInput: (d: string) => void) {
		(this as any).send = onInput;
	},
	stop() {},
	drainInput: () => Promise.resolve(),
	write(d: string) {
		this.out += d;
	},
	moveBy() {},
	hideCursor() {},
	showCursor() {},
	clearLine() {},
	clearFromCursor() {},
	clearScreen() {},
	setTitle() {},
	setProgress() {},
	setProgramStatus() {},
	send(_d: string) {},
};

const tui = new TuiMainScreen(terminal as never);
const load = async () => sessions;
const selector = new SessionSelectorComponent(
	load,
	load,
	() => {},
	() => {},
	() => {},
	() => tui.requestRender(),
	{ keybindings: keybindings as never, showRenameHint: true, renameSession: async () => {} },
	current,
);
const controller = attachBulkDelete(selector, { theme, tui, keybindings: keybindings as never, currentSessionFile: current });
tui.addChild(selector);
tui.setFocus(selector);
tui.start();
await new Promise((r) => setTimeout(r, 120));

const send = (d: string) => (terminal as any).send(d);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const show = async (label: string, keys: string[]) => {
	for (const k of keys) {
		send(k);
		await sleep(25);
	}
	await sleep(60);
	terminal.out = "";
	tui.renderNow(true);
	const plain = terminal.out
		.replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, "")
		.replace(/\x1b\[[0-9;?]*[ -\/]*[0-9;?]*[@-~]/g, "")
		.replace(/\x1b[@-Z\\-_]/g, "")
		.replace(/\r\n/g, "\n")
		.split("\n")
		.map((l) => l.replace(/\s+$/, ""));
	console.log(`\n===== ${label} =====`);
	console.log(plain.slice(0, 20).join("\n"));
};

await show("checked 3 chats, list scrolled to the middle", [
	"\x1b[B", "\x1b[B", "\x1b[B", "\x1b[B", "\x1b[B", "\x1b[B", "\x1b[B", "\x1b[B",
	"\x00", "\x1b[A", "\x00", "\x1b[A", "\x1b[A", "\x1b[A", "\x00",
]);
await show("ctrl+d -> confirm prompt", ["\x04"]);
controller.checked.clear();
send("\x1b");
await show("nothing checked (plain /resume look, with the hint line)", []);
rmSync(dir, { recursive: true, force: true });
tui.stop();
