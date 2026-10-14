/** Load the extension through pi's real extension loader and report registration + errors. */
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * pi does not export its internals, so the loader is imported by file path.
 * Prefer the package installed in this checkout, fall back to the global one.
 */
function findLoader(): string {
	const local = fileURLToPath(new URL("../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js", import.meta.url));
	if (existsSync(local)) return local;
	const globalRoot = execSync("npm root -g", { encoding: "utf-8" }).trim();
	const global = join(globalRoot, "@earendil-works", "pi-coding-agent", "dist", "core", "extensions", "loader.js");
	if (existsSync(global)) return global;
	throw new Error(`pi's extension loader not found (tried ${local} and ${global})`);
}

type LoaderResult = {
	extensions: Array<{ path?: string; name?: string; commands: Map<string, unknown>; tools: Map<string, unknown> }>;
	errors: unknown[];
};

const { loadExtensions } = (await import(pathToFileURL(findLoader()).href)) as {
	loadExtensions(paths: string[], cwd: string): Promise<LoaderResult>;
};

const target = fileURLToPath(new URL("../extensions/sessions.ts", import.meta.url));
const result = await loadExtensions([target], process.cwd());

console.log("errors:", JSON.stringify(result.errors, null, 2));
for (const ext of result.extensions) {
	console.log("extension:", ext.path ?? ext.name ?? "<anon>");
	console.log("commands:", [...ext.commands.keys()].map((name) => `/${name}`));
	console.log("tools:", [...ext.tools.keys()]);
}
if (result.errors.length > 0) process.exitCode = 1;
