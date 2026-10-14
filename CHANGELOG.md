# Changelog

## 1.0.0

Initial release.

- `/sessions` opens pi's own resume browser (`SessionSelectorComponent`) with a
  checkbox column added to every row.
- Multi-select: `alt+s` toggles the focused chat, `alt+a` toggles every chat in
  the current filter, `alt+x` deletes the checked chats after one confirmation.
- `ctrl+space` / `alt+space` / `ctrl+-` / `ctrl+\` toggle as well, for terminals
  that deliver them; `ctrl+a` and `ctrl+d` work as aliases.
- The chat you are currently in can never be checked or deleted.
- Deletion follows pi's own single-delete behaviour: `trash` CLI when available,
  `unlink` otherwise.
- `/sessions all` and `/sessions named` start in the all-projects scope and with
  the named filter on.
- Test suite drives the real `SessionSelectorComponent` on a real TUI surface
  (53 assertions), plus a loader check through pi's own extension loader.
