# 042 — Collapsible workspace panes

## Decision

Keep a stable resizable panel tree for the editor, right-hand tools, and bottom
Driver Station. Collapse sets a panel's size to zero and hides/inerts its contents;
it does not unmount the editor or tool frames. Console lessons use this same tree
so opening Preview cannot remount the editor. Driver Station is only mounted for
robot projects.

Visibility is owned by the workspace page so boundary controls, the Layout menu,
and the tool selector share one state. Upper visibility is an enum to prevent
hiding both upper panes. Robot and console preferences are stored separately in
sessionStorage. Narrow screens (at most 900px) remember a single selected pane
without overwriting the desktop visibility or split.

Persist only expanded sizes using the existing resizable-layout keys. This avoids
replacing the restore size with zero or 100%; Reset layout clears these sizes.
The console layout accepts the previous editor/preview panel IDs on read.

Collapse controls float beside the resize grips and appear on handle hover or
keyboard focus (always visible on touch screens), preserving the full pane height.
Restore controls are semicircular caret tabs overlaid at the workspace edges. Separators remain
direct children of their resizable groups, as required by the resize library's
keyboard and pointer target discovery. Panel constraints use explicit percentage
units; numeric size props in this library version mean pixels.
Edge restore controls and the user dropdown's Layout submenu provide recovery. Selecting a
right-pane tool reveals it even when the selected tab does not change.

The collapsed Driver Station bar shows status (including unavailable status) and
retains Disable. Collapsing does not stop the simulation or release a controller;
keyboard capture is deactivated and pressed keys are released explicitly because
hiding a focused element does not reliably trigger blur.

## Validation

Frontend and mocked browser tests cover persisted sizing, collapse/restore,
iframe continuity, active-tab reveal, reset, console Preview, and narrow-screen
switching. The editor and extensions themselves are unchanged.
