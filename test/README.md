# Test harness for `/sessions`

These scripts drive pi's **real** `SessionSelectorComponent` on a **real**
`TuiMainScreen` with a fake terminal: they press keys, capture rendered frames,
and delete real session files in a temp directory. Nothing is mocked.

```bash
npm install            # pi + pi-tui as devDependencies
npm test               # 53 render / keybinding / deletion assertions
npm run loader         # pi's own extension loader on extensions/sessions.ts
npm run typecheck      # tsc --noEmit
npm run verify         # all three
npm run preview        # prints the /sessions screen (scrolled, checked, confirm prompt)
npm run probe          # live: shows what YOUR terminal sends for each key (q quits)
node --experimental-strip-types test/probe4.ts   # raw vs decorated row lines (ANSI visible)
```

`test.ts` creates fixtures in a temp dir and removes them at the end, so it is
safe to run repeatedly.

## Covered

checkbox column rendering; `alt+s` / `alt+t` / `alt+m` / `alt+enter` /
`ctrl+space` / `alt+space` / `ctrl+-` / `ctrl+\` toggling; arrow keys; `ctrl+a`
select-all and uncheck-all; active-session protection (never checkable,
deletion refused); `alt+x` / `ctrl+d` confirm, `esc` cancel, `enter` confirm;
real file deletion and list refresh; search filtering while chats stay checked;
resume on enter; `all` / `named` start options; row alignment while scrolled;
and that the checkbox column never eats a row's right-aligned metadata
(`12 1m` style suffixes) or the row width.

## Keys

| Action | Keys |
|---|---|
| toggle focused chat | `alt+s` (also `alt+t`, `alt+m`, `alt+enter`, `ctrl+-`, `ctrl+\`, `ctrl+space`, `alt+space`) |
| check/uncheck all in filter | `alt+a`, `ctrl+a` (only while the search line is empty) |
| delete checked | `alt+x`, `ctrl+d`, `ctrl+backspace` (asks once, Enter confirms) |

Windows Terminal never delivers `ctrl+space` (Windows grabs it as the IME
toggle) or `alt+space` (window system menu), which is why the `alt+letter`
bindings are the primary ones. Every `ctrl+letter` is already used by pi, so
there is nothing else free on Windows. `ctrl+-` (0x1f) and `ctrl+\` (0x1c) do
arrive as control bytes and are unbound in pi 1.1.0.

`npm run probe` prints the raw bytes and the key name pi's own parser derives,
then a summary of which bindings reached the app.
