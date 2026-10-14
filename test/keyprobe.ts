/**
 * Raw key probe — tells you exactly what your terminal sends for a key.
 *
 * Run it, then press the keys listed below. `q` quits.
 * It prints the raw bytes and the key name pi's own parser derives from them,
 * so what you see here is exactly what pi (and /sessions) receives.
 *
 *   npm run probe   (or: node --experimental-strip-types test/keyprobe.ts)
 */
import { parseKey, setKittyProtocolActive } from "@earendil-works/pi-tui";

const CANDIDATES = [
	"ctrl+space",
	"alt+space",
	"alt+s",
	"alt+t",
	"alt+m",
	"alt+enter",
	"ctrl+-",
	"ctrl+\\",
	"ctrl+a",
	"alt+a",
	"ctrl+d",
	"ctrl+backspace",
	"alt+x",
	"enter",
	"escape",
];

const seen = new Map<string, string>();

if (!process.stdin.isTTY) {
	console.error("stdin is not a TTY - run this in a plain shell inside your terminal (not inside pi)");
	process.exit(1);
}

// pi enables the kitty keyboard protocol only when the terminal answers the query;
// Windows Terminal does not, so leave it off to match pi's real state here.
setKittyProtocolActive(false);

process.stdin.setRawMode(true);
process.stdin.resume();

console.log("These are the /sessions bindings. Press each key, then q to quit:\n");
for (const candidate of CANDIDATES) console.log(`  ${candidate}`);
console.log("");

process.stdin.on("data", (chunk: Buffer) => {
	const text = chunk.toString("utf8");
	if (text === "q" || text === "\x03") {
		finish();
		return;
	}
	const hex = [...chunk].map((b) => b.toString(16).padStart(2, "0")).join(" ");
	const name = parseKey(text);
	if (name) seen.set(name, hex);
	console.log(`  bytes=${hex.padEnd(16)} pi sees: ${name ?? "(nothing - terminal swallowed it)"}`);
});

function finish(): void {
	process.stdin.setRawMode(false);
	process.stdin.pause();
	console.log("\n--- keys that reached the app ---");
	for (const candidate of CANDIDATES) {
		const hex = seen.get(candidate);
		console.log(`  ${candidate.padEnd(18)} ${hex ? `OK   (bytes ${hex})` : "MISSING"}`);
	}
	console.log("\nUse the OK keys for the checkbox bindings. Quitting.");
	process.exit(0);
}
