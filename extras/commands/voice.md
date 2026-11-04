---
description: Mimesis voices - status and switch. `/voice` shows the active voice; `/voice use NAME` switches it.
allowed-tools: Bash("<MIMESIS_PATH>/.venv/Scripts/python.exe" *)
---
Run exactly this and report its output to the user verbatim, then stop. This is a
status and management command, so do NOT write anything in any author's voice this
turn.

!`"<MIMESIS_PATH>/.venv/Scripts/python.exe" -m mimesis_voice.cli profile $ARGUMENTS`

With no arguments it lists all voices and marks the active one. `use NAME` switches
the active voice instantly, with no restart. To add a voice: `new NAME --from PATH`,
which imports, ingests and calibrates in one step. To grow an existing voice:
`add NAME --from PATH`.
