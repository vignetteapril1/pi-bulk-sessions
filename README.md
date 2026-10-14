# pi-bulk-sessions

Bulk-delete chats from [pi](https://github.com/badlogic/pi-mono)'s resume browser with checkboxes.

`/sessions` opens pi's **own** `/resume` screen — same search, scope, sort, rename, regex — and adds
a checkbox column so you can tick a bunch of chats and delete them in one go.

```
Resume Session (Current Folder)              ◉ Current Folder | ○ All  Name: All  Sort: Threaded
 alt+s/ctrl+space toggle · alt+a all · alt+x/ctrl+d delete checked
tab scope · re:<pattern> regex · "phrase" exact
ctrl+s sort · ctrl+n named · ctrl+d delete · ctrl+p path (off) · ctrl+r rename

>

[  ]   Refactor the session selector                                                        7 1h
[  ]   Fix ANSI truncation on wide CJK rows                                                21 3h
[x] › Wire up the VPS searxng limiter                                                      35 5h
[•]   Current chat about lunch                                                             49 7h
[x]   Debug the Unity MCP lease                                                63 9h  3 selected
```

`ctrl+d` then asks for confirmation (`enter` confirms, `escape` cancels) and replaces the hint line
with `Delete 3 chats permanently? enter confirm · escape/ctrl+c cancel`.

## Install

```bash
pi install npm:pi-bulk-sessions          # permanent
pi -e npm:pi-bulk-sessions               # one-shot trial, no install
pi install git:github.com/vignetteapril1/pi-bulk-sessions          # from source, no npm needed
pi install git:github.com/vignetteapril1/pi-bulk-sessions@v1.0.1   # pinned to a tag
```

Then run `pi` and type `/sessions`.

## Usage

| Command | What it opens |
| --- | --- |
| `/sessions` | chats in the current folder (same default as `/resume`) |
| `/sessions all` | every chat pi knows about |
| `/sessions named` | only chats you renamed |

The scope and name filters are the selector's own — `tab` switches scope, `ctrl+n` toggles
named-only, `ctrl+s` changes sort. Arguments are only the initial state.

## Keys

| Key | Action |
| --- | --- |
| `alt+s` · `alt+t` · `alt+m` · `alt+enter` · `ctrl+space` · `alt+space` · `ctrl+-` · `ctrl+\` | toggle the focused chat |
| `alt+a` · `ctrl+a` | check / uncheck every visible chat (`ctrl+a` is ignored while the search box has text, because terminals send it as "move to line start") |
| `alt+x` · `ctrl+d` | delete the checked chats (asks first). With nothing checked, `ctrl+d` keeps pi's built-in single-delete |
| `enter` · `escape` | resume the focused chat / close the browser |
| everything else | unchanged pi behaviour: search, `re:` and `"exact"` filters, `tab`, `ctrl+p` path, `ctrl+r` rename |

**Why `alt+…` is the primary binding:** Windows Terminal swallows `ctrl+space` (IME language switch)
and `alt+space` (window system menu) before the app sees them, so on Windows those two never reach
pi. `alt+letter` keys survive, and none of them are used by pi 1.1.0. On terminals that deliver
`ctrl+space` (most Linux/macOS terminals, and Windows Terminal with the IME hotkey cleared) it works
too — every key above is an alias for the same action.

## What gets deleted

The session file under pi's session directory (`~/.pi/agent/sessions/…` by default). It tries the
`trash` CLI first and falls back to a permanent `unlink`, so on Windows the delete is **permanent**
unless you have a `trash` command installed. The chat you are currently in is marked `[•]` and
refuses to be checked.

## How it works

It is a single pi extension (`extensions/sessions.ts`, ~380 lines) that reuses pi's own
`SessionSelectorComponent` instead of building a second browser UI:

- `selector.handleInput` is wrapped, so the checkbox keys work whether the search box or the list
  holds focus, and every built-in key keeps working.
- `sessionList.render` is wrapped to prefix each visible row with a checkbox. The box and the
  `N selected` counter are paid for out of each row's **internal padding**, so right-aligned
  metadata (message count, age) and the exact row width survive — no ANSI-truncation artifacts.
- Deletes go through `SessionManager` and then `refreshSessionsAfterMutation()`, so the list,
  search results and scope stay consistent.
- Because it wraps pi's component, pi updates to search/sort/scope/rename land for free.

## Development

```bash
npm install
npm run typecheck   # strict TS, noUncheckedIndexedAccess
npm test            # 54 assertions driving the real selector on a real TUI surface
npm run preview     # prints the exact screen you will see
npm run probe       # which key combos your terminal delivers
npm run loader      # loads the extension with pi's own extension loader
```

`npm test` builds a real `SessionSelectorComponent` on a real TUI surface with a fake terminal,
sends real key bytes, and asserts on rendered frames — checkbox column, key handling, active-chat
protection, confirm/cancel, search interaction, real file deletion + list refresh, resume-on-enter,
`all`/`named` start options, and scroll alignment with 25 sessions. See `test/README.md`.

## Related work

- [`@fahrizkyputra/pi-delete-session`](https://www.npmjs.com/package/@fahrizkyputra/pi-delete-session)
  — a polished bulk deleter with its own overlay UI (plain `space`/`a`/`enter` keys, favorites
  protection, subagent-artifact cleanup). If you want a dedicated delete screen, use that.
  This package's difference is that it is pi's own resume screen with checkboxes added, so search,
  scope, sort, rename and future pi changes behave exactly like `/resume`, and the keys are chosen
  to survive Windows Terminal.
- pi's built-in `/resume` deletes one chat at a time (`ctrl+d` / `ctrl+backspace`).

## License

MIT — see [LICENSE](LICENSE).
