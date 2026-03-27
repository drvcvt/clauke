# Clauke — Feature Roadmap

## Geplante Features

### 1. Diff-Anzeige bei Edits
Edit/Write Tool-Ergebnisse als farbige Diffs anzeigen statt raw JSON.
**Status:** Fertig

### 2. Token Tracking
Usage-Daten aus `result`-Events auswerten und anzeigen.
Keine Kostenanzeige — Token-Stats in den Settings oder als dezentes UI-Element.
**Status:** Fertig

### 3. Permission System
Granulare Allow/Deny pro Tool. Standard-Modus einstellbar (bypass/ask).
`--dangerously-skip-permissions` bleibt Default, aber konfigurierbar.
**Status:** Fertig

### 4. Plan Mode
Interaktiver Planungsmodus von Claude Code übernehmen.
Claude schlägt Plan vor bevor es Code ändert.
**Status:** Fertig

### 5. Task Tracking (TodoWrite)
Inline Task-Liste die Claude selbst verwaltet und abhakt.
Von Claude Code CLI übernehmen.
**Status:** Fertig

### 6. MCP Server Support
MCP-Server Anbindung sauber unterstützen und MCP-Tools im UI anzeigen.
**Status:** Fertig

### 7. Hooks
Pre/Post-Tool Hooks die Shell-Commands ausführen.
Von Claude Code CLI übernehmen.
**Status:** Fertig

### 8. Compact Mode
Minimale Ausgabe für schnelles Arbeiten.
**Status:** Übersprungen (nicht benötigt)

### 9. Context Window Indicator
Schöne Anzeige wie voll das Context Window ist.
Muss visuell ansprechend sein.
**Status:** Fertig

### 10. Auto-Compact
Automatische Context-Komprimierung Status anzeigen.
**Status:** Fertig

### 11. File Tree
Projektstruktur-View für File-Referenzen/Pings.
Kein integrierter File-Renderer — nur Tree-Ansicht.
**Status:** Fertig

### 12. Search in Chat
Suche durch bisherige Messages in der aktuellen Conversation (Ctrl+F).
**Status:** Fertig

### 13. Keyboard Shortcut Cheatsheet
Overlay/Modal mit allen verfügbaren Shortcuts (Ctrl+/).
**Status:** Fertig

### 14. Code Change Tracker
Sidebar die alle File-Aenderungen pro Session gruppiert anzeigt mit expandierbaren Diffs (Ctrl+J).
**Status:** Fertig

### 15. Built-in File Editor
CodeMirror 6 basierter Editor mit Syntax Highlighting fuer 15+ Sprachen.
Oeffnet sich per Click im File Explorer oder Change Tracker. Save mit Ctrl+S.
**Status:** Fertig

### 16. External Editor Integration
Preferred Editor konfigurierbar in Settings (VS Code, Cursor, Sublime Text, Antigravity, Neovim).
Middle-click im File Explorer oeffnet externen Editor. Windows cmd /c Workaround fuer .cmd Wrapper.
**Status:** Fertig

### 17. Token Bar Always Visible
Token-Statistiken (in/out/cache/total/cost) und Context Indicator immer sichtbar, nicht nur bei aktiver Usage.
**Status:** Fertig
