import { Terminal } from "./vendor/xterm.mjs";
import { FitAddon } from "./vendor/addon-fit.mjs";

const STATE_EVENT = "crewdock://state-changed";
const TERMINAL_DATA_EVENT = "crewdock://terminal-data";
const MAX_PENDING_TERMINAL_BYTES = 4 * 1024 * 1024;
const LAUNCHER_CARD_TRANSITION_MS = 360;
const GIT_REFRESH_INTERVAL_MS = 3000;
const DEFAULT_THEME_ID = "one-dark";
const LAUNCHER_COMMANDS = Object.freeze(["help", "pwd", "ls", "cd", "open", "clear"]);
const PATH_AWARE_LAUNCHER_COMMANDS = new Set(["ls", "cd", "open"]);
const MAX_LAUNCHER_COMPLETION_MATCHES = 24;

const THEME_REGISTRY = Object.freeze({
  "one-dark": {
    id: "one-dark",
    label: "One Dark",
    description: "Atom-born default adopted by modern IDEs.",
    preview: ["#61afef", "#98c379", "#e5c07b", "#e06c75", "#dfe5ec"],
    appVars: {
      "--bg": "#1b1f27",
      "--bg-soft": "rgba(24, 28, 35, 0.94)",
      "--panel": "rgba(33, 37, 43, 0.96)",
      "--panel-strong": "rgba(40, 44, 52, 0.98)",
      "--border": "rgba(171, 178, 191, 0.12)",
      "--border-strong": "rgba(171, 178, 191, 0.2)",
      "--text": "#dfe5ec",
      "--muted": "#8b93a1",
      "--accent": "#61afef",
      "--accent-soft": "rgba(97, 175, 239, 0.16)",
      "--danger": "#e06c75",
      "--body-top-glow": "rgba(97, 175, 239, 0.14)",
      "--body-bottom-glow": "rgba(152, 195, 121, 0.1)",
      "--grid-line": "rgba(255, 255, 255, 0.024)",
      "--strip-start": "rgba(34, 39, 46, 0.96)",
      "--strip-end": "rgba(24, 28, 34, 0.92)",
      "--strip-border": "rgba(171, 178, 191, 0.1)",
      "--tab-bg": "rgba(29, 33, 39, 0.76)",
      "--tab-bg-hover": "rgba(36, 41, 48, 0.9)",
      "--tab-bg-active": "rgba(42, 47, 55, 0.98)",
      "--tab-border": "rgba(171, 178, 191, 0.08)",
      "--tab-border-hover": "rgba(171, 178, 191, 0.16)",
      "--tab-border-active": "rgba(97, 175, 239, 0.24)",
      "--tab-text": "rgba(223, 229, 236, 0.82)",
      "--tab-text-active": "#f3f6fa",
      "--tab-close": "rgba(198, 205, 214, 0.66)",
      "--tab-close-hover-bg": "rgba(255, 255, 255, 0.08)",
      "--control-bg": "rgba(29, 33, 39, 0.78)",
      "--control-bg-hover": "rgba(36, 41, 48, 0.9)",
      "--control-border": "rgba(171, 178, 191, 0.1)",
      "--control-border-strong": "rgba(97, 175, 239, 0.22)",
      "--control-text": "rgba(198, 205, 214, 0.78)",
      "--control-text-strong": "#f3f6fa",
      "--launcher-shell-bg": "rgba(18, 21, 25, 0.76)",
      "--launcher-input-bg": "rgba(16, 19, 23, 0.96)",
      "--launcher-card-bg": "rgba(14, 17, 21, 0.92)",
      "--launcher-prefix": "#98c379",
      "--launcher-output": "rgba(237, 241, 245, 0.74)",
      "--launcher-output-muted": "rgba(237, 241, 245, 0.56)",
      "--overlay-bg": "rgba(8, 10, 14, 0.58)",
      "--modal-bg": "rgba(24, 28, 35, 0.96)",
      "--surface-card-bg": "rgba(18, 22, 27, 0.72)",
      "--surface-card-border": "rgba(171, 178, 191, 0.1)",
      "--surface-input-bg": "rgba(15, 18, 23, 0.96)",
      "--surface-pill-bg": "rgba(255, 255, 255, 0.05)",
      "--surface-pill-active-bg": "rgba(97, 175, 239, 0.12)",
      "--surface-pill-active-border": "rgba(97, 175, 239, 0.22)",
      "--surface-soft-text": "rgba(223, 229, 236, 0.64)",
      "--pane-seam": "rgba(171, 178, 191, 0.12)",
      "--pane-bg": "#0f131a",
      "--pane-top-gloss": "rgba(255, 255, 255, 0.02)",
      "--context-bg": "rgba(26, 30, 36, 0.98)",
      "--context-divider": "rgba(255, 255, 255, 0.12)",
      "--context-item-hover": "rgba(255, 255, 255, 0.06)",
    },
    terminalTheme: {
      background: "#0f131a",
      foreground: "#abb2bf",
      cursor: "#e5c07b",
      cursorAccent: "#0f131a",
      selectionBackground: "rgba(97, 175, 239, 0.26)",
      black: "#1f2329",
      red: "#e06c75",
      green: "#98c379",
      yellow: "#e5c07b",
      blue: "#61afef",
      magenta: "#c678dd",
      cyan: "#56b6c2",
      white: "#abb2bf",
      brightBlack: "#5c6370",
      brightRed: "#be5046",
      brightGreen: "#98c379",
      brightYellow: "#d19a66",
      brightBlue: "#61afef",
      brightMagenta: "#c678dd",
      brightCyan: "#56b6c2",
      brightWhite: "#dfe5ec",
    },
  },
  "tokyo-night": {
    id: "tokyo-night",
    label: "Tokyo Night",
    description: "Electric navy with luminous blue accents.",
    preview: ["#7aa2f7", "#9ece6a", "#e0af68", "#f7768e", "#c0caf5"],
    appVars: {
      "--bg": "#16161e",
      "--bg-soft": "rgba(21, 24, 37, 0.95)",
      "--panel": "rgba(26, 27, 38, 0.96)",
      "--panel-strong": "rgba(31, 35, 53, 0.98)",
      "--border": "rgba(122, 162, 247, 0.14)",
      "--border-strong": "rgba(122, 162, 247, 0.24)",
      "--text": "#c0caf5",
      "--muted": "#7f89b5",
      "--accent": "#7aa2f7",
      "--accent-soft": "rgba(122, 162, 247, 0.16)",
      "--danger": "#f7768e",
      "--body-top-glow": "rgba(122, 162, 247, 0.18)",
      "--body-bottom-glow": "rgba(158, 206, 106, 0.09)",
      "--grid-line": "rgba(122, 162, 247, 0.026)",
      "--strip-start": "rgba(26, 27, 38, 0.96)",
      "--strip-end": "rgba(21, 24, 37, 0.92)",
      "--strip-border": "rgba(122, 162, 247, 0.12)",
      "--tab-bg": "rgba(24, 26, 39, 0.78)",
      "--tab-bg-hover": "rgba(31, 35, 53, 0.9)",
      "--tab-bg-active": "rgba(36, 40, 59, 0.98)",
      "--tab-border": "rgba(122, 162, 247, 0.08)",
      "--tab-border-hover": "rgba(122, 162, 247, 0.18)",
      "--tab-border-active": "rgba(122, 162, 247, 0.28)",
      "--tab-text": "rgba(192, 202, 245, 0.84)",
      "--tab-text-active": "#e5e9ff",
      "--tab-close": "rgba(167, 177, 218, 0.66)",
      "--tab-close-hover-bg": "rgba(122, 162, 247, 0.12)",
      "--control-bg": "rgba(24, 26, 39, 0.8)",
      "--control-bg-hover": "rgba(31, 35, 53, 0.92)",
      "--control-border": "rgba(122, 162, 247, 0.1)",
      "--control-border-strong": "rgba(122, 162, 247, 0.24)",
      "--control-text": "rgba(192, 202, 245, 0.8)",
      "--control-text-strong": "#f0f4ff",
      "--launcher-shell-bg": "rgba(17, 19, 30, 0.8)",
      "--launcher-input-bg": "rgba(19, 21, 33, 0.96)",
      "--launcher-card-bg": "rgba(16, 18, 30, 0.92)",
      "--launcher-prefix": "#9ece6a",
      "--launcher-output": "rgba(192, 202, 245, 0.76)",
      "--launcher-output-muted": "rgba(192, 202, 245, 0.58)",
      "--overlay-bg": "rgba(7, 9, 16, 0.62)",
      "--modal-bg": "rgba(22, 24, 37, 0.96)",
      "--surface-card-bg": "rgba(19, 21, 33, 0.74)",
      "--surface-card-border": "rgba(122, 162, 247, 0.1)",
      "--surface-input-bg": "rgba(16, 18, 28, 0.96)",
      "--surface-pill-bg": "rgba(122, 162, 247, 0.08)",
      "--surface-pill-active-bg": "rgba(122, 162, 247, 0.14)",
      "--surface-pill-active-border": "rgba(122, 162, 247, 0.26)",
      "--surface-soft-text": "rgba(192, 202, 245, 0.66)",
      "--pane-seam": "rgba(122, 162, 247, 0.14)",
      "--pane-bg": "#15161e",
      "--pane-top-gloss": "rgba(122, 162, 247, 0.04)",
      "--context-bg": "rgba(21, 23, 35, 0.98)",
      "--context-divider": "rgba(122, 162, 247, 0.16)",
      "--context-item-hover": "rgba(122, 162, 247, 0.1)",
    },
    terminalTheme: {
      background: "#15161e",
      foreground: "#c0caf5",
      cursor: "#c0caf5",
      cursorAccent: "#15161e",
      selectionBackground: "rgba(122, 162, 247, 0.28)",
      black: "#15161e",
      red: "#f7768e",
      green: "#9ece6a",
      yellow: "#e0af68",
      blue: "#7aa2f7",
      magenta: "#bb9af7",
      cyan: "#7dcfff",
      white: "#a9b1d6",
      brightBlack: "#414868",
      brightRed: "#f7768e",
      brightGreen: "#9ece6a",
      brightYellow: "#e0af68",
      brightBlue: "#7aa2f7",
      brightMagenta: "#bb9af7",
      brightCyan: "#7dcfff",
      brightWhite: "#c0caf5",
    },
  },
  "gruvbox-material-dark": {
    id: "gruvbox-material-dark",
    label: "Gruvbox Material",
    description: "Warm contrast with earthy terminal tones.",
    preview: ["#7daea3", "#a9b665", "#d8a657", "#ea6962", "#d4be98"],
    appVars: {
      "--bg": "#1d2021",
      "--bg-soft": "rgba(29, 32, 33, 0.96)",
      "--panel": "rgba(40, 40, 40, 0.96)",
      "--panel-strong": "rgba(50, 48, 47, 0.98)",
      "--border": "rgba(212, 190, 152, 0.14)",
      "--border-strong": "rgba(212, 190, 152, 0.22)",
      "--text": "#d4be98",
      "--muted": "#a89984",
      "--accent": "#7daea3",
      "--accent-soft": "rgba(125, 174, 163, 0.16)",
      "--danger": "#ea6962",
      "--body-top-glow": "rgba(125, 174, 163, 0.12)",
      "--body-bottom-glow": "rgba(169, 182, 101, 0.1)",
      "--grid-line": "rgba(212, 190, 152, 0.024)",
      "--strip-start": "rgba(44, 43, 41, 0.96)",
      "--strip-end": "rgba(35, 34, 32, 0.92)",
      "--strip-border": "rgba(212, 190, 152, 0.1)",
      "--tab-bg": "rgba(35, 34, 32, 0.78)",
      "--tab-bg-hover": "rgba(48, 47, 45, 0.9)",
      "--tab-bg-active": "rgba(59, 57, 54, 0.98)",
      "--tab-border": "rgba(212, 190, 152, 0.08)",
      "--tab-border-hover": "rgba(212, 190, 152, 0.16)",
      "--tab-border-active": "rgba(125, 174, 163, 0.24)",
      "--tab-text": "rgba(221, 205, 172, 0.84)",
      "--tab-text-active": "#f1e4c4",
      "--tab-close": "rgba(212, 190, 152, 0.64)",
      "--tab-close-hover-bg": "rgba(212, 190, 152, 0.08)",
      "--control-bg": "rgba(36, 35, 33, 0.8)",
      "--control-bg-hover": "rgba(48, 47, 45, 0.92)",
      "--control-border": "rgba(212, 190, 152, 0.1)",
      "--control-border-strong": "rgba(125, 174, 163, 0.24)",
      "--control-text": "rgba(221, 205, 172, 0.82)",
      "--control-text-strong": "#f1e4c4",
      "--launcher-shell-bg": "rgba(29, 28, 26, 0.8)",
      "--launcher-input-bg": "rgba(26, 24, 23, 0.96)",
      "--launcher-card-bg": "rgba(24, 23, 21, 0.92)",
      "--launcher-prefix": "#a9b665",
      "--launcher-output": "rgba(221, 205, 172, 0.76)",
      "--launcher-output-muted": "rgba(221, 205, 172, 0.56)",
      "--overlay-bg": "rgba(10, 9, 8, 0.64)",
      "--modal-bg": "rgba(32, 31, 29, 0.96)",
      "--surface-card-bg": "rgba(28, 27, 25, 0.74)",
      "--surface-card-border": "rgba(212, 190, 152, 0.1)",
      "--surface-input-bg": "rgba(24, 23, 21, 0.96)",
      "--surface-pill-bg": "rgba(212, 190, 152, 0.06)",
      "--surface-pill-active-bg": "rgba(125, 174, 163, 0.14)",
      "--surface-pill-active-border": "rgba(125, 174, 163, 0.26)",
      "--surface-soft-text": "rgba(221, 205, 172, 0.66)",
      "--pane-seam": "rgba(212, 190, 152, 0.12)",
      "--pane-bg": "#141617",
      "--pane-top-gloss": "rgba(212, 190, 152, 0.02)",
      "--context-bg": "rgba(31, 30, 28, 0.98)",
      "--context-divider": "rgba(212, 190, 152, 0.14)",
      "--context-item-hover": "rgba(212, 190, 152, 0.07)",
    },
    terminalTheme: {
      background: "#141617",
      foreground: "#d4be98",
      cursor: "#d8a657",
      cursorAccent: "#141617",
      selectionBackground: "rgba(125, 174, 163, 0.24)",
      black: "#1d2021",
      red: "#ea6962",
      green: "#a9b665",
      yellow: "#d8a657",
      blue: "#7daea3",
      magenta: "#d3869b",
      cyan: "#89b482",
      white: "#d4be98",
      brightBlack: "#665c54",
      brightRed: "#ea6962",
      brightGreen: "#a9b665",
      brightYellow: "#d8a657",
      brightBlue: "#7daea3",
      brightMagenta: "#d3869b",
      brightCyan: "#89b482",
      brightWhite: "#f2e5bc",
    },
  },
  dracula: {
    id: "dracula",
    label: "Dracula",
    description: "High-contrast violet dark theme with neon syntax.",
    preview: ["#bd93f9", "#50fa7b", "#f1fa8c", "#ff79c6", "#f8f8f2"],
    appVars: {
      "--bg": "#1f2029",
      "--bg-soft": "rgba(31, 32, 41, 0.95)",
      "--panel": "rgba(40, 42, 54, 0.96)",
      "--panel-strong": "rgba(45, 48, 62, 0.98)",
      "--border": "rgba(189, 147, 249, 0.14)",
      "--border-strong": "rgba(189, 147, 249, 0.24)",
      "--text": "#f8f8f2",
      "--muted": "#bdc0d4",
      "--accent": "#bd93f9",
      "--accent-soft": "rgba(189, 147, 249, 0.16)",
      "--danger": "#ff5555",
      "--body-top-glow": "rgba(189, 147, 249, 0.16)",
      "--body-bottom-glow": "rgba(139, 233, 253, 0.1)",
      "--grid-line": "rgba(248, 248, 242, 0.022)",
      "--strip-start": "rgba(44, 46, 59, 0.96)",
      "--strip-end": "rgba(35, 36, 47, 0.92)",
      "--strip-border": "rgba(189, 147, 249, 0.1)",
      "--tab-bg": "rgba(36, 37, 49, 0.78)",
      "--tab-bg-hover": "rgba(46, 48, 62, 0.9)",
      "--tab-bg-active": "rgba(54, 56, 72, 0.98)",
      "--tab-border": "rgba(189, 147, 249, 0.08)",
      "--tab-border-hover": "rgba(189, 147, 249, 0.18)",
      "--tab-border-active": "rgba(189, 147, 249, 0.3)",
      "--tab-text": "rgba(248, 248, 242, 0.84)",
      "--tab-text-active": "#ffffff",
      "--tab-close": "rgba(235, 236, 244, 0.68)",
      "--tab-close-hover-bg": "rgba(189, 147, 249, 0.14)",
      "--control-bg": "rgba(36, 37, 49, 0.8)",
      "--control-bg-hover": "rgba(46, 48, 62, 0.92)",
      "--control-border": "rgba(189, 147, 249, 0.1)",
      "--control-border-strong": "rgba(189, 147, 249, 0.24)",
      "--control-text": "rgba(248, 248, 242, 0.82)",
      "--control-text-strong": "#ffffff",
      "--launcher-shell-bg": "rgba(29, 31, 41, 0.82)",
      "--launcher-input-bg": "rgba(33, 35, 45, 0.96)",
      "--launcher-card-bg": "rgba(30, 31, 41, 0.92)",
      "--launcher-prefix": "#50fa7b",
      "--launcher-output": "rgba(248, 248, 242, 0.76)",
      "--launcher-output-muted": "rgba(248, 248, 242, 0.58)",
      "--overlay-bg": "rgba(12, 12, 18, 0.62)",
      "--modal-bg": "rgba(35, 37, 48, 0.96)",
      "--surface-card-bg": "rgba(31, 33, 43, 0.74)",
      "--surface-card-border": "rgba(189, 147, 249, 0.1)",
      "--surface-input-bg": "rgba(29, 31, 41, 0.96)",
      "--surface-pill-bg": "rgba(189, 147, 249, 0.08)",
      "--surface-pill-active-bg": "rgba(189, 147, 249, 0.16)",
      "--surface-pill-active-border": "rgba(189, 147, 249, 0.28)",
      "--surface-soft-text": "rgba(248, 248, 242, 0.68)",
      "--pane-seam": "rgba(189, 147, 249, 0.14)",
      "--pane-bg": "#16171d",
      "--pane-top-gloss": "rgba(255, 255, 255, 0.025)",
      "--context-bg": "rgba(35, 36, 47, 0.98)",
      "--context-divider": "rgba(189, 147, 249, 0.14)",
      "--context-item-hover": "rgba(189, 147, 249, 0.1)",
    },
    terminalTheme: {
      background: "#16171d",
      foreground: "#f8f8f2",
      cursor: "#f8f8f2",
      cursorAccent: "#16171d",
      selectionBackground: "rgba(189, 147, 249, 0.24)",
      black: "#21222c",
      red: "#ff5555",
      green: "#50fa7b",
      yellow: "#f1fa8c",
      blue: "#bd93f9",
      magenta: "#ff79c6",
      cyan: "#8be9fd",
      white: "#f8f8f2",
      brightBlack: "#6272a4",
      brightRed: "#ff6e6e",
      brightGreen: "#69ff94",
      brightYellow: "#ffffa5",
      brightBlue: "#d6acff",
      brightMagenta: "#ff92df",
      brightCyan: "#a4ffff",
      brightWhite: "#ffffff",
    },
  },
  "catppuccin-mocha": {
    id: "catppuccin-mocha",
    label: "Catppuccin Mocha",
    description: "Soft contrast with polished pastel accents.",
    preview: ["#89b4fa", "#a6e3a1", "#f9e2af", "#f38ba8", "#cdd6f4"],
    appVars: {
      "--bg": "#181825",
      "--bg-soft": "rgba(24, 24, 37, 0.95)",
      "--panel": "rgba(30, 30, 46, 0.96)",
      "--panel-strong": "rgba(36, 36, 57, 0.98)",
      "--border": "rgba(137, 180, 250, 0.14)",
      "--border-strong": "rgba(137, 180, 250, 0.24)",
      "--text": "#cdd6f4",
      "--muted": "#a6adc8",
      "--accent": "#89b4fa",
      "--accent-soft": "rgba(137, 180, 250, 0.16)",
      "--danger": "#f38ba8",
      "--body-top-glow": "rgba(137, 180, 250, 0.16)",
      "--body-bottom-glow": "rgba(166, 227, 161, 0.1)",
      "--grid-line": "rgba(205, 214, 244, 0.022)",
      "--strip-start": "rgba(30, 30, 46, 0.96)",
      "--strip-end": "rgba(24, 24, 37, 0.92)",
      "--strip-border": "rgba(137, 180, 250, 0.1)",
      "--tab-bg": "rgba(36, 36, 57, 0.78)",
      "--tab-bg-hover": "rgba(49, 50, 68, 0.9)",
      "--tab-bg-active": "rgba(58, 60, 82, 0.98)",
      "--tab-border": "rgba(137, 180, 250, 0.08)",
      "--tab-border-hover": "rgba(137, 180, 250, 0.18)",
      "--tab-border-active": "rgba(137, 180, 250, 0.3)",
      "--tab-text": "rgba(205, 214, 244, 0.84)",
      "--tab-text-active": "#f2f5ff",
      "--tab-close": "rgba(205, 214, 244, 0.68)",
      "--tab-close-hover-bg": "rgba(137, 180, 250, 0.14)",
      "--control-bg": "rgba(36, 36, 57, 0.8)",
      "--control-bg-hover": "rgba(49, 50, 68, 0.92)",
      "--control-border": "rgba(137, 180, 250, 0.1)",
      "--control-border-strong": "rgba(137, 180, 250, 0.24)",
      "--control-text": "rgba(205, 214, 244, 0.82)",
      "--control-text-strong": "#f2f5ff",
      "--launcher-shell-bg": "rgba(24, 24, 37, 0.82)",
      "--launcher-input-bg": "rgba(30, 30, 46, 0.96)",
      "--launcher-card-bg": "rgba(24, 24, 37, 0.92)",
      "--launcher-prefix": "#a6e3a1",
      "--launcher-output": "rgba(205, 214, 244, 0.76)",
      "--launcher-output-muted": "rgba(205, 214, 244, 0.58)",
      "--overlay-bg": "rgba(9, 9, 15, 0.62)",
      "--modal-bg": "rgba(30, 30, 46, 0.96)",
      "--surface-card-bg": "rgba(36, 36, 57, 0.74)",
      "--surface-card-border": "rgba(137, 180, 250, 0.1)",
      "--surface-input-bg": "rgba(24, 24, 37, 0.96)",
      "--surface-pill-bg": "rgba(137, 180, 250, 0.08)",
      "--surface-pill-active-bg": "rgba(137, 180, 250, 0.16)",
      "--surface-pill-active-border": "rgba(137, 180, 250, 0.28)",
      "--surface-soft-text": "rgba(205, 214, 244, 0.66)",
      "--pane-seam": "rgba(137, 180, 250, 0.14)",
      "--pane-bg": "#11111b",
      "--pane-top-gloss": "rgba(255, 255, 255, 0.022)",
      "--context-bg": "rgba(30, 30, 46, 0.98)",
      "--context-divider": "rgba(137, 180, 250, 0.14)",
      "--context-item-hover": "rgba(137, 180, 250, 0.1)",
    },
    terminalTheme: {
      background: "#11111b",
      foreground: "#cdd6f4",
      cursor: "#f5e0dc",
      cursorAccent: "#11111b",
      selectionBackground: "rgba(137, 180, 250, 0.24)",
      black: "#45475a",
      red: "#f38ba8",
      green: "#a6e3a1",
      yellow: "#f9e2af",
      blue: "#89b4fa",
      magenta: "#cba6f7",
      cyan: "#94e2d5",
      white: "#bac2de",
      brightBlack: "#585b70",
      brightRed: "#f38ba8",
      brightGreen: "#a6e3a1",
      brightYellow: "#f9e2af",
      brightBlue: "#89b4fa",
      brightMagenta: "#cba6f7",
      brightCyan: "#94e2d5",
      brightWhite: "#a6adc8",
    },
  },
  "catppuccin-latte": {
    id: "catppuccin-latte",
    label: "Catppuccin Latte",
    description: "A bright studio palette with crisp blue chrome and soft paper terminals.",
    colorScheme: "light",
    preview: ["#1e66f5", "#40a02b", "#df8e1d", "#d20f39", "#4c4f69"],
    appVars: {
      "--bg": "#eff1f5",
      "--bg-soft": "rgba(239, 241, 245, 0.94)",
      "--panel": "rgba(250, 250, 252, 0.94)",
      "--panel-strong": "rgba(255, 255, 255, 0.98)",
      "--border": "rgba(108, 112, 134, 0.14)",
      "--border-strong": "rgba(108, 112, 134, 0.24)",
      "--text": "#4c4f69",
      "--muted": "#7c7f93",
      "--accent": "#1e66f5",
      "--accent-soft": "rgba(30, 102, 245, 0.12)",
      "--danger": "#d20f39",
      "--body-top-glow": "rgba(30, 102, 245, 0.12)",
      "--body-bottom-glow": "rgba(64, 160, 43, 0.1)",
      "--grid-line": "rgba(76, 79, 105, 0.04)",
      "--strip-start": "rgba(255, 255, 255, 0.9)",
      "--strip-end": "rgba(233, 237, 243, 0.94)",
      "--strip-border": "rgba(108, 112, 134, 0.12)",
      "--strip-shadow": "0 4px 12px rgba(76, 79, 105, 0.06)",
      "--tab-bg": "rgba(255, 255, 255, 0.62)",
      "--tab-bg-hover": "rgba(255, 255, 255, 0.84)",
      "--tab-bg-active": "rgba(255, 255, 255, 0.98)",
      "--tab-border": "rgba(108, 112, 134, 0.1)",
      "--tab-border-hover": "rgba(30, 102, 245, 0.18)",
      "--tab-border-active": "rgba(30, 102, 245, 0.24)",
      "--tab-text": "rgba(76, 79, 105, 0.8)",
      "--tab-text-active": "#303446",
      "--tab-close": "rgba(92, 95, 119, 0.62)",
      "--tab-close-hover-bg": "rgba(30, 102, 245, 0.08)",
      "--control-bg": "rgba(255, 255, 255, 0.76)",
      "--control-bg-hover": "rgba(255, 255, 255, 0.96)",
      "--control-border": "rgba(108, 112, 134, 0.12)",
      "--control-border-strong": "rgba(30, 102, 245, 0.22)",
      "--control-text": "rgba(76, 79, 105, 0.78)",
      "--control-text-strong": "#303446",
      "--launcher-shell-bg": "rgba(255, 255, 255, 0.78)",
      "--launcher-input-bg": "rgba(255, 255, 255, 0.96)",
      "--launcher-card-bg": "rgba(248, 249, 252, 0.94)",
      "--launcher-prefix": "#40a02b",
      "--launcher-output": "rgba(76, 79, 105, 0.76)",
      "--launcher-output-muted": "rgba(108, 112, 134, 0.62)",
      "--overlay-bg": "rgba(228, 231, 238, 0.72)",
      "--modal-bg": "rgba(250, 250, 252, 0.96)",
      "--surface-card-bg": "rgba(255, 255, 255, 0.78)",
      "--surface-card-border": "rgba(108, 112, 134, 0.12)",
      "--surface-input-bg": "rgba(255, 255, 255, 0.96)",
      "--surface-pill-bg": "rgba(76, 79, 105, 0.05)",
      "--surface-pill-active-bg": "rgba(30, 102, 245, 0.1)",
      "--surface-pill-active-border": "rgba(30, 102, 245, 0.18)",
      "--surface-soft-text": "rgba(92, 95, 119, 0.72)",
      "--pane-seam": "rgba(140, 143, 161, 0.18)",
      "--pane-bg": "#ffffff",
      "--pane-top-gloss": "rgba(30, 102, 245, 0.035)",
      "--context-bg": "rgba(252, 252, 253, 0.98)",
      "--context-divider": "rgba(108, 112, 134, 0.12)",
      "--context-item-hover": "rgba(30, 102, 245, 0.08)",
      "--scrollbar-thumb": "rgba(108, 112, 134, 0.22)",
      "--theme-card-bg": "rgba(76, 79, 105, 0.035)",
      "--theme-card-hover-bg": "rgba(76, 79, 105, 0.06)",
      "--theme-card-shadow": "rgba(76, 79, 105, 0.14)",
      "--swatch-ring": "rgba(108, 112, 134, 0.18)",
      "--create-button-text": "#24304f",
    },
    terminalTheme: {
      background: "#ffffff",
      foreground: "#4c4f69",
      cursor: "#dc8a78",
      cursorAccent: "#ffffff",
      selectionBackground: "rgba(30, 102, 245, 0.18)",
      black: "#5c5f77",
      red: "#d20f39",
      green: "#40a02b",
      yellow: "#df8e1d",
      blue: "#1e66f5",
      magenta: "#ea76cb",
      cyan: "#179299",
      white: "#acb0be",
      brightBlack: "#6c6f85",
      brightRed: "#d20f39",
      brightGreen: "#40a02b",
      brightYellow: "#df8e1d",
      brightBlue: "#1e66f5",
      brightMagenta: "#8839ef",
      brightCyan: "#209fb5",
      brightWhite: "#bcc0cc",
    },
  },
});

const APP_THEME_VARIABLES = Object.freeze(
  Array.from(
    new Set(Object.values(THEME_REGISTRY).flatMap((theme) => Object.keys(theme.appVars))),
  ),
);

const app = document.querySelector("#app");
const bridge = createBridge();

const uiState = {
  snapshot: null,
  mountedWorkspaceId: null,
  mountedLayoutSignature: null,
  appliedThemeId: null,
  launcherVisible: false,
  settingsVisible: false,
  pendingWorkspaceDraft: null,
  launcherCommandValue: "",
  launcherHistory: [],
  launcherLatestCard: {
    current: null,
    previous: null,
    phase: "idle",
  },
  launcherCommands: [],
  launcherCommandCursor: null,
  contextMenu: null,
  maximizedPaneId: null,
  gitPanelVisible: false,
  quickSwitcherVisible: false,
  quickSwitcherQuery: "",
  quickSwitcherCursor: 0,
  quickSwitcherShouldFocus: false,
  workspaceRenameDraft: null,
  workspaceRenameShouldFocus: false,
  workspaceRenameSaving: false,
  workspaceTabsScrollLeft: 0,
  workspaceTabsLastActiveWorkspaceId: null,
  workspaceTabsLastCount: 0,
};

const paneTerminals = new Map();
const pendingTerminalData = new Map();
const workspacePaneIds = new Map();
const terminalViewportLines = new Map();
let launcherCardTransitionTimer = 0;
let launcherCardAnimationFrame = 0;
let gitRefreshIntervalTimer = 0;
let gitRefreshInFlight = null;
let gitRefreshQueuedWorkspaceId = null;

void init();

async function init() {
  document.body.dataset.platform = detectPlatform();
  uiState.snapshot = await bridge.getAppSnapshot();
  applyActiveTheme(getActiveThemeId(uiState.snapshot));

  if (bridge.listenState) {
    await bridge.listenState((snapshot) => {
      uiState.snapshot = snapshot;
      applyActiveTheme(getActiveThemeId(snapshot));
      render();
    });
  }

  if (bridge.listenTerminalData) {
    await bridge.listenTerminalData((payload) => {
      appendTerminalData(payload.paneId, payload.data);
    });
  }

  document.addEventListener("click", handleClick);
  document.addEventListener("contextmenu", handleContextMenu);
  document.addEventListener("mousedown", handleMouseDown, true);
  document.addEventListener("submit", handleSubmit);
  document.addEventListener("input", handleInput);
  document.addEventListener("change", handleChange);
  document.addEventListener("keydown", handleKeyDown);
  document.addEventListener("focusout", handleFocusOut, true);
  document.addEventListener("pointerdown", handlePointerDown, true);
  document.addEventListener("scroll", handleScroll, true);
  document.addEventListener("wheel", handleWheel, { passive: false });
  window.addEventListener("focus", handleWindowFocus);
  window.addEventListener("blur", handleWindowBlur);
  window.addEventListener("resize", handleWindowResize);

  render();
  syncGitRefreshLoop();
  void refreshActiveWorkspaceGitStatus();
}

function detectPlatform() {
  const agent = navigator.userAgent || "";

  if (/Mac|iPhone|iPad/.test(agent)) {
    return "macos";
  }

  if (/Windows/.test(agent)) {
    return "windows";
  }

  return "other";
}

function createBridge() {
  const tauriApi = window.__TAURI__;

  if (tauriApi?.core?.invoke) {
    return {
      getAppSnapshot: () => tauriApi.core.invoke("get_app_snapshot"),
      setTheme: (themeId) => tauriApi.core.invoke("set_theme", { themeId }),
      createWorkspace: (path, paneCount) =>
        tauriApi.core.invoke("create_workspace", { path, paneCount }),
      renameWorkspace: (workspaceId, name) =>
        tauriApi.core.invoke("rename_workspace", { workspaceId, name }),
      refreshWorkspaceGitStatus: (workspaceId) =>
        tauriApi.core.invoke("refresh_workspace_git_status", { workspaceId }),
      switchWorkspace: (workspaceId) =>
        tauriApi.core.invoke("switch_workspace", { workspaceId }),
      closeWorkspace: (workspaceId) =>
        tauriApi.core.invoke("close_workspace", { workspaceId }),
      splitPane: (paneId, direction) =>
        tauriApi.core.invoke("split_pane", { paneId, direction }),
      closePane: (paneId) =>
        tauriApi.core.invoke("close_pane", { paneId }),
      showInFinder: (path) =>
        tauriApi.core.invoke("show_in_finder", { path }),
      runLauncherCommand: (input) =>
        tauriApi.core.invoke("run_launcher_command", { input }),
      completeLauncherInput: (input) =>
        tauriApi.core.invoke("complete_launcher_input", { input }),
      resetToLauncher: () => tauriApi.core.invoke("reset_to_launcher"),
      startDragging: () => tauriApi.core.invoke("plugin:window|start_dragging"),
      writeToPane: (paneId, data) =>
        tauriApi.core.invoke("write_to_pane", { paneId, data }),
      resizePane: (paneId, cols, rows) =>
        tauriApi.core.invoke("resize_pane", { paneId, cols, rows }),
      openDirectory: async (defaultPath) => {
        const options = {
          title: "Open Workspace Folder",
          directory: true,
          multiple: false,
        };
        if (defaultPath) {
          options.defaultPath = defaultPath;
        }

        const result = await tauriApi.core.invoke("plugin:dialog|open", { options });
        return normalizeDialogPath(result);
      },
      listenState: (handler) =>
        tauriApi.event.listen(STATE_EVENT, (event) => handler(event.payload)),
      listenTerminalData: (handler) =>
        tauriApi.event.listen(TERMINAL_DATA_EVENT, (event) => handler(event.payload)),
    };
  }

  return createMockBridge();
}

function createMockBridge() {
  const stateListeners = new Set();
  const terminalListeners = new Set();
  const launcher = {
    basePath: "/Users/ashutoshbele/Desktop/ashlab/crewdock",
    presets: [
      { id: "count-1", label: "1 terminal", rows: 1, columns: 1, paneCount: 1 },
      { id: "count-2", label: "2 terminals", rows: 1, columns: 2, paneCount: 2 },
      { id: "count-4", label: "4 terminals", rows: 2, columns: 2, paneCount: 4 },
      { id: "count-8", label: "8 terminals", rows: 3, columns: 3, paneCount: 8 },
      { id: "count-12", label: "12 terminals", rows: 3, columns: 4, paneCount: 12 },
      { id: "count-16", label: "16 terminals", rows: 4, columns: 4, paneCount: 16 },
    ],
  };
  const settings = {
    themeId: DEFAULT_THEME_ID,
  };

  let workspaceCounter = 0;
  let workspaces = [];
  let activeWorkspaceId = null;

  function emitState() {
    const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId);
    const snapshot = {
      launcher,
      settings,
      workspaces: workspaces.map((workspace) => ({
        id: workspace.id,
        name: workspace.name,
        path: workspace.path,
        layout: workspace.layout,
        isLive: workspace.started,
        gitSummary: workspace.gitDetail?.summary || null,
      })),
      activeWorkspaceId,
      activeWorkspace: activeWorkspace
        ? {
            id: activeWorkspace.id,
            name: activeWorkspace.name,
            path: activeWorkspace.path,
            layout: activeWorkspace.layout,
            panes: activeWorkspace.panes.map((pane) => ({ ...pane })),
            paneLayout: structuredClone(activeWorkspace.paneLayout),
            gitDetail: activeWorkspace.gitDetail ? structuredClone(activeWorkspace.gitDetail) : null,
          }
        : null,
    };

    for (const listener of stateListeners) {
      listener(structuredClone(snapshot));
    }

    return snapshot;
  }

  function emitTerminal(payload) {
    for (const listener of terminalListeners) {
      listener(structuredClone(payload));
    }
  }

  function startWorkspace(workspace) {
    if (!workspace || workspace.started) {
      return;
    }

    workspace.started = true;
    workspace.panes.forEach((pane, index) => {
      pane.status = "booting";
      window.setTimeout(() => {
        if (!workspaces.some((entry) => entry.id === workspace.id)) {
          return;
        }

        const currentWorkspace = workspaces.find((entry) => entry.id === workspace.id);
        const currentPane = currentWorkspace?.panes.find((entry) => entry.id === pane.id);
        if (!currentPane) {
          return;
        }

        currentPane.status = "ready";
        emitState();
        emitTerminal({
          paneId: pane.id,
          data:
            `CrewDock shell session attached\r\n` +
            `Session: ${currentPane.label}\r\n` +
            `Layout: ${workspace.layout.label}\r\n` +
            `Shell: /bin/zsh\r\n` +
            `Directory: ${workspace.path}\r\n\r\n` +
            `This is the mock fallback bridge. Type here and the session will echo.\r\n$ `,
        });
      }, 140 + index * 40);
    });

    emitState();
  }

  function workspaceName(path) {
    const parts = path.split("/").filter(Boolean);
    return parts[parts.length - 1] || path;
  }

  function buildMockGitDetail(path) {
    return {
      summary: {
        state: "clean",
        branch: "main",
        upstream: "origin/main",
        ahead: 0,
        behind: 0,
        counts: {
          staged: 0,
          modified: 0,
          deleted: 0,
          renamed: 0,
          untracked: 0,
          conflicted: 0,
        },
        isDirty: false,
        hasConflicts: false,
        message: null,
      },
      repoRoot: path,
      workspaceRelativePath: null,
      files: [],
    };
  }

  return {
    getAppSnapshot: async () => emitState(),
    listenState: async (handler) => {
      stateListeners.add(handler);
      return () => stateListeners.delete(handler);
    },
    listenTerminalData: async (handler) => {
      terminalListeners.add(handler);
      return () => terminalListeners.delete(handler);
    },
    startDragging: async () => {},
    setTheme: async (themeId) => {
      if (!THEME_REGISTRY[themeId]) {
        throw new Error("theme not found");
      }

      settings.themeId = themeId;
      return emitState();
    },
    openDirectory: async (defaultPath) => {
      const value = window.prompt("Workspace folder", defaultPath || "/Users/ashutoshbele/Desktop/ashlab/crewdock");
      return value?.trim() || null;
    },
    resetToLauncher: async () => {
      workspaces = [];
      activeWorkspaceId = null;
      return emitState();
    },
    createWorkspace: async (path, paneCount) => {
      const normalizedPath = path.trim();
      const layout = deriveLayoutForPaneCount(paneCount);
      if (!layout) {
        return emitState();
      }

      workspaceCounter += 1;
      const workspace = {
        id: `workspace-${workspaceCounter}`,
        name: workspaceName(normalizedPath),
        path: normalizedPath,
        layout,
        started: false,
        gitDetail: buildMockGitDetail(normalizedPath),
        panes: Array.from({ length: layout.paneCount }, (_, index) => ({
          id: `pane-${workspaceCounter}-${index + 1}`,
          label: `Shell ${String(index + 1).padStart(2, "0")}`,
          status: "closed",
        })),
      };
      workspace.paneLayout = buildBalancedPaneLayout(
        workspace.panes.map((pane) => pane.id),
        layout.columns >= layout.rows,
      );

      workspaces.push(workspace);
      activeWorkspaceId = workspace.id;
      launcher.basePath = normalizedPath;
      startWorkspace(workspace);
      return emitState();
    },
    renameWorkspace: async (workspaceId, name) => {
      const workspace = workspaces.find((entry) => entry.id === workspaceId);
      const nextName = String(name || "").trim();
      if (!workspace || !nextName) {
        return emitState();
      }

      workspace.name = nextName;
      return emitState();
    },
    refreshWorkspaceGitStatus: async (workspaceId) => {
      const workspace = workspaces.find((entry) => entry.id === workspaceId);
      if (workspace) {
        workspace.gitDetail = buildMockGitDetail(workspace.path);
      }
      return emitState();
    },
    switchWorkspace: async (workspaceId) => {
      const workspace = workspaces.find((entry) => entry.id === workspaceId);
      if (!workspace) {
        return emitState();
      }

      activeWorkspaceId = workspace.id;
      launcher.basePath = workspace.path;
      startWorkspace(workspace);
      return emitState();
    },
    closeWorkspace: async (workspaceId) => {
      const index = workspaces.findIndex((workspace) => workspace.id === workspaceId);
      if (index === -1) {
        return emitState();
      }

      const isActive = activeWorkspaceId === workspaceId;
      workspaces.splice(index, 1);

      if (isActive) {
        if (index > 0) {
          activeWorkspaceId = workspaces[index - 1]?.id ?? null;
        } else {
          activeWorkspaceId = workspaces[0]?.id ?? null;
        }
      }

      return emitState();
    },
    splitPane: async (paneId, direction) => {
      const workspace = workspaces.find((entry) => entry.id === activeWorkspaceId);
      const paneIndex = workspace?.panes.findIndex((pane) => pane.id === paneId) ?? -1;
      if (!workspace || paneIndex === -1 || workspace.panes.length >= 16) {
        return emitState();
      }

      const insertAt = direction === "left" || direction === "up" ? paneIndex : paneIndex + 1;
      const nextCount = workspace.panes.length + 1;
      const layout = deriveLayoutForPaneCount(nextCount);
      const pane = {
        id: `pane-${workspace.id}-${Date.now()}`,
        label: "",
        status: workspace.started ? "booting" : "closed",
      };

      workspace.panes.splice(insertAt, 0, pane);
      relabelMockPanes(workspace.panes);
      workspace.layout = layout;
      workspace.paneLayout = splitPaneLayout(
        workspace.paneLayout,
        paneId,
        direction === "left" || direction === "right" ? "horizontal" : "vertical",
        direction === "left" || direction === "up",
        pane.id,
      );
      emitState();

      if (workspace.started) {
        window.setTimeout(() => {
          pane.status = "ready";
          emitState();
          emitTerminal({
            paneId: pane.id,
            data:
              `CrewDock shell session attached\r\n` +
              `Session: ${pane.label}\r\n` +
              `Layout: ${workspace.layout.label}\r\n` +
              `Shell: /bin/zsh\r\n` +
              `Directory: ${workspace.path}\r\n\r\n$ `,
          });
        }, 120);
      }

      return emitState();
    },
    closePane: async (paneId) => {
      const workspace = workspaces.find((entry) => entry.panes.some((pane) => pane.id === paneId));
      if (!workspace || workspace.panes.length <= 1) {
        return emitState();
      }

      workspace.panes = workspace.panes.filter((pane) => pane.id !== paneId);
      relabelMockPanes(workspace.panes);
      workspace.layout = deriveLayoutForPaneCount(workspace.panes.length);
      workspace.paneLayout = removePaneLayout(workspace.paneLayout, paneId);
      return emitState();
    },
    showInFinder: async () => {},
    runLauncherCommand: async (input) => {
      const command = String(input || "").trim();
      if (!command) {
        throw new Error("enter a command. Try help.");
      }

      if (command === "help") {
        return {
          basePath: launcher.basePath,
          output: ["Commands: help, pwd, ls [path], cd <path>, open [path], clear"],
          openPath: null,
          clearOutput: false,
        };
      }

      if (command === "pwd") {
        return {
          basePath: launcher.basePath,
          output: [launcher.basePath],
          openPath: null,
          clearOutput: false,
        };
      }

      if (command === "clear") {
        return {
          basePath: launcher.basePath,
          output: [],
          openPath: null,
          clearOutput: true,
        };
      }

      if (command === "ls" || command.startsWith("ls ")) {
        const target = command === "ls" ? launcher.basePath : resolveMockNavigationPath(launcher.basePath, command.slice(3));
        return {
          basePath: launcher.basePath,
          output: mockListDirectory(target),
          openPath: null,
          clearOutput: false,
        };
      }

      if (command === "open" || command.startsWith("open ")) {
        const target = command === "open" ? launcher.basePath : resolveMockNavigationPath(launcher.basePath, command.slice(5));
        launcher.basePath = target;
        return {
          basePath: launcher.basePath,
          output: [`Opening workspace at ${target}`],
          openPath: target,
          clearOutput: false,
        };
      }

      const nextPath = resolveMockNavigationPath(launcher.basePath, command);
      launcher.basePath = nextPath;
      return {
        basePath: launcher.basePath,
        output: [`cwd -> ${nextPath}`],
        openPath: null,
        clearOutput: false,
      };
    },
    completeLauncherInput: async (input) => completeMockLauncherInput(launcher.basePath, input),
    writeToPane: async (paneId, data) => {
      const output = data === "\r" ? "\r\n$ " : data;
      emitTerminal({ paneId, data: output });
    },
    resizePane: async () => {},
  };
}

function normalizeThemeId(themeId) {
  return THEME_REGISTRY[themeId] ? themeId : DEFAULT_THEME_ID;
}

function getThemeDefinition(themeId) {
  return THEME_REGISTRY[normalizeThemeId(themeId)];
}

function getActiveThemeId(snapshot = uiState.snapshot) {
  return normalizeThemeId(snapshot?.settings?.themeId);
}

function getCurrentThemeDefinition() {
  return getThemeDefinition(getActiveThemeId());
}

function applyActiveTheme(themeId) {
  const theme = getThemeDefinition(themeId);
  const root = document.documentElement;

  for (const variableName of APP_THEME_VARIABLES) {
    const variableValue = theme.appVars[variableName];
    if (variableValue === undefined) {
      root.style.removeProperty(variableName);
    } else {
      root.style.setProperty(variableName, variableValue);
    }
  }

  root.style.colorScheme = theme.colorScheme || "dark";
  document.body.dataset.theme = theme.id;
  if (uiState.appliedThemeId !== theme.id) {
    uiState.appliedThemeId = theme.id;
    syncMountedTerminalThemes(theme);
  }
}

function syncMountedTerminalThemes(theme = getCurrentThemeDefinition()) {
  for (const state of paneTerminals.values()) {
    state.terminal.setOption("theme", { ...theme.terminalTheme });
    state.themeId = theme.id;
  }
}

async function handleClick(event) {
  const clickedElement = event.target instanceof Element ? event.target : null;
  const target = clickedElement?.closest("[data-action]");
  if (!target) {
    return;
  }

  if (target.dataset.action === "close-settings" && clickedElement?.closest(".settings-sheet")) {
    return;
  }

  if (target.dataset.action === "close-git-panel" && clickedElement?.closest(".workspace-git-panel")) {
    return;
  }

  if (target.dataset.action === "close-quick-switcher" && clickedElement?.closest(".workspace-quick-switcher")) {
    return;
  }

  if (target.closest(".terminal-context-menu")) {
    await handleContextMenuAction(target);
    return;
  }

  if (target.dataset.action === "show-settings") {
    uiState.settingsVisible = true;
    uiState.gitPanelVisible = false;
    closeQuickSwitcher();
    uiState.pendingWorkspaceDraft = null;
    uiState.contextMenu = null;
    render();
    return;
  }

  if (target.dataset.action === "close-settings") {
    uiState.settingsVisible = false;
    render();
    return;
  }

  if (target.dataset.action === "show-launcher") {
    uiState.launcherVisible = true;
    uiState.settingsVisible = false;
    uiState.gitPanelVisible = false;
    closeQuickSwitcher();
    uiState.pendingWorkspaceDraft = null;
    uiState.contextMenu = null;
    uiState.maximizedPaneId = null;
    render();
    return;
  }

  if (target.dataset.action === "show-git-panel") {
    if (!uiState.snapshot?.activeWorkspace) {
      return;
    }

    uiState.gitPanelVisible = true;
    uiState.settingsVisible = false;
    closeQuickSwitcher();
    uiState.pendingWorkspaceDraft = null;
    render();
    void refreshActiveWorkspaceGitStatus();
    return;
  }

  if (target.dataset.action === "close-git-panel") {
    uiState.gitPanelVisible = false;
    render();
    return;
  }

  if (target.dataset.action === "close-quick-switcher") {
    closeQuickSwitcher();
    render();
    return;
  }

  if (target.dataset.action === "refresh-git-status") {
    await refreshActiveWorkspaceGitStatus({ force: true });
    return;
  }

  if (target.dataset.action === "scroll-workspaces-left") {
    scrollWorkspaceTabs(-1);
    return;
  }

  if (target.dataset.action === "scroll-workspaces-right") {
    scrollWorkspaceTabs(1);
    return;
  }

  if (target.dataset.action === "open-workspace") {
    uiState.settingsVisible = false;
    uiState.gitPanelVisible = false;
    closeQuickSwitcher();
    await beginWorkspaceCreation();
    return;
  }

  if (target.dataset.action === "start-rename-workspace") {
    const workspaceId = target.dataset.workspaceId;
    if (!workspaceId) {
      return;
    }

    closeQuickSwitcher();
    startWorkspaceRename(workspaceId);
    render();
    return;
  }

  if (target.dataset.action === "run-launcher-example") {
    await executeLauncherCommand(target.dataset.command || "");
    return;
  }

  if (target.dataset.action === "cancel-layout-picker") {
    uiState.pendingWorkspaceDraft = null;
    render();
    return;
  }

  if (target.dataset.action === "set-theme") {
    const themeId = target.dataset.themeId;
    if (!themeId || themeId === getActiveThemeId()) {
      return;
    }

    uiState.snapshot = await bridge.setTheme(themeId);
    render();
    return;
  }

  if (target.dataset.action === "adjust-terminal-count") {
    if (!uiState.pendingWorkspaceDraft) {
      return;
    }

    const delta = Number(target.dataset.delta || 0);
    uiState.pendingWorkspaceDraft = {
      ...uiState.pendingWorkspaceDraft,
      paneCount: clampPaneCount(uiState.pendingWorkspaceDraft.paneCount + delta),
    };
    render();
    return;
  }

  if (target.dataset.action === "set-terminal-count") {
    if (!uiState.pendingWorkspaceDraft) {
      return;
    }

    uiState.pendingWorkspaceDraft = {
      ...uiState.pendingWorkspaceDraft,
      paneCount: clampPaneCount(Number(target.dataset.paneCount || uiState.pendingWorkspaceDraft.paneCount)),
    };
    render();
    return;
  }

  if (target.dataset.action === "create-workspace") {
    if (!uiState.pendingWorkspaceDraft) {
      return;
    }

    uiState.snapshot = await bridge.createWorkspace(
      uiState.pendingWorkspaceDraft.path,
      uiState.pendingWorkspaceDraft.paneCount,
    );
    uiState.launcherVisible = false;
    uiState.settingsVisible = false;
    uiState.gitPanelVisible = false;
    closeQuickSwitcher();
    uiState.pendingWorkspaceDraft = null;
    clearLauncherCommandState();
    render();
    void refreshActiveWorkspaceGitStatus({ force: true });
    return;
  }

  if (target.dataset.action === "switch-workspace") {
    const workspaceId = target.dataset.workspaceId;
    if (!workspaceId || workspaceId === uiState.snapshot?.activeWorkspaceId) {
      uiState.launcherVisible = false;
      uiState.settingsVisible = false;
      closeQuickSwitcher();
      render();
      return;
    }

    await activateWorkspace(workspaceId);
    render();
    return;
  }

  if (target.dataset.action === "quick-switch-workspace") {
    const workspaceId = target.dataset.workspaceId;
    if (!workspaceId) {
      return;
    }

    await activateWorkspace(workspaceId);
    return;
  }

  if (target.dataset.action === "close-workspace") {
    const workspaceId = target.dataset.workspaceId;
    if (!workspaceId) {
      return;
    }

    clearWorkspaceBuffers(workspaceId);
    if (uiState.mountedWorkspaceId === workspaceId) {
      disposeAllTerminals();
      uiState.mountedWorkspaceId = null;
    }

    uiState.snapshot = await bridge.closeWorkspace(workspaceId);
    render();
    void refreshActiveWorkspaceGitStatus({ force: true });
  }
}

function handleContextMenu(event) {
  const pane = event.target.closest("[data-pane-id]");
  if (!pane || !uiState.snapshot?.activeWorkspace) {
    uiState.contextMenu = null;
    render();
    return;
  }

  event.preventDefault();
  const paneId = pane.dataset.paneId;
  if (!paneId) {
    return;
  }

  uiState.contextMenu = {
    paneId,
    x: event.clientX,
    y: event.clientY,
  };
  render();
}

function handleMouseDown(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target || event.button !== 0 || !bridge.startDragging) {
    return;
  }

  if (!target.closest(".workspace-strip-track")) {
    return;
  }

  if (target.closest("button, input, textarea, select, a, [data-action]")) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  void bridge.startDragging();
}

function handlePointerDown(event) {
  if (!uiState.contextMenu) {
    return;
  }

  if (event.target.closest(".terminal-context-menu")) {
    return;
  }

  uiState.contextMenu = null;
  render();
}

function handleScroll(event) {
  const tabs = event.target instanceof Element && event.target.matches(".workspace-tabs")
    ? event.target
    : null;
  if (!tabs) {
    return;
  }

  rememberWorkspaceTabsScroll(tabs);
  syncWorkspaceTabsOverflow(tabs);
}

function handleWheel(event) {
  const target = event.target instanceof Element ? event.target : null;
  const shell = target?.closest("[data-workspace-tabs-shell]");
  if (!shell || event.ctrlKey || event.metaKey) {
    return;
  }

  const tabs = shell.querySelector("[data-workspace-tabs]");
  if (!tabs || tabs.scrollWidth <= tabs.clientWidth + 1) {
    return;
  }

  if (Math.abs(event.deltaX) > Math.abs(event.deltaY) && event.deltaY !== 0) {
    return;
  }

  const delta = normalizeWheelDelta(event, tabs);
  if (!delta) {
    return;
  }

  event.preventDefault();
  tabs.scrollLeft += delta;
  rememberWorkspaceTabsScroll(tabs);
  syncWorkspaceTabsOverflow(tabs);
}

function handleWindowResize() {
  fitAllTerminals();
  syncWorkspaceTabRail(
    uiState.snapshot?.activeWorkspaceId || null,
    uiState.snapshot?.workspaces?.length || 0,
  );
}

function handleWindowFocus() {
  syncGitRefreshLoop();
  void refreshActiveWorkspaceGitStatus({ force: true });
}

function handleWindowBlur() {
  syncGitRefreshLoop();
}

function handleFocusOut(event) {
  const renameInput = event.target.closest("[data-workspace-rename-input]");
  if (!renameInput || uiState.workspaceRenameSaving) {
    return;
  }

  const nextTarget = event.relatedTarget instanceof Element ? event.relatedTarget : null;
  if (nextTarget?.closest("[data-workspace-rename-form]")) {
    return;
  }

  void commitWorkspaceRename();
}

async function handleSubmit(event) {
  const renameForm = event.target.closest('[data-action="rename-workspace"]');
  if (renameForm) {
    event.preventDefault();
    await commitWorkspaceRename();
    return;
  }

  const form = event.target.closest('[data-action="run-launcher-command"]');
  if (!form) {
    return;
  }

  event.preventDefault();

  const input = form.querySelector("[data-launcher-path-input]");
  const value = input?.value ?? uiState.launcherCommandValue;
  await executeLauncherCommand(value);
}

function handleInput(event) {
  const quickSwitcherInput = event.target.closest("[data-quick-switcher-input]");
  if (quickSwitcherInput) {
    uiState.quickSwitcherQuery = quickSwitcherInput.value;
    syncQuickSwitcherCursor();
    uiState.quickSwitcherShouldFocus = true;
    render();
    return;
  }

  const renameInput = event.target.closest("[data-workspace-rename-input]");
  if (renameInput && uiState.workspaceRenameDraft) {
    uiState.workspaceRenameDraft = {
      ...uiState.workspaceRenameDraft,
      value: renameInput.value,
    };
    return;
  }

  const input = event.target.closest("[data-launcher-path-input]");
  if (input) {
    uiState.launcherCommandValue = input.value;
  }

  const countInput = event.target.closest("[data-terminal-count-input]");
  if (countInput && uiState.pendingWorkspaceDraft) {
    uiState.pendingWorkspaceDraft = {
      ...uiState.pendingWorkspaceDraft,
      paneCount: clampPaneCount(Number(countInput.value || uiState.pendingWorkspaceDraft.paneCount)),
    };
  }
}

function handleChange(event) {
  const countInput = event.target.closest("[data-terminal-count-input]");
  if (!countInput || !uiState.pendingWorkspaceDraft) {
    return;
  }

  uiState.pendingWorkspaceDraft = {
    ...uiState.pendingWorkspaceDraft,
    paneCount: clampPaneCount(Number(countInput.value || uiState.pendingWorkspaceDraft.paneCount)),
  };
  render();
}

async function handleKeyDown(event) {
  const quickSwitcherInput = event.target.closest("[data-quick-switcher-input]");
  if (quickSwitcherInput) {
    const items = getQuickSwitcherItems();

    if (event.key === "Escape") {
      event.preventDefault();
      closeQuickSwitcher();
      render();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveQuickSwitcherCursor(1, items.length);
      uiState.quickSwitcherShouldFocus = true;
      render();
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveQuickSwitcherCursor(-1, items.length);
      uiState.quickSwitcherShouldFocus = true;
      render();
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const item = items[uiState.quickSwitcherCursor] || items[0] || null;
      if (item) {
        await activateWorkspace(item.id);
        render();
      }
      return;
    }
  }

  const renameInput = event.target.closest("[data-workspace-rename-input]");
  if (renameInput) {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelWorkspaceRename();
      render();
    }
    return;
  }

  if ((event.metaKey || event.ctrlKey) && event.key === ",") {
    event.preventDefault();
    uiState.settingsVisible = true;
    uiState.gitPanelVisible = false;
    closeQuickSwitcher();
    uiState.pendingWorkspaceDraft = null;
    uiState.contextMenu = null;
    render();
    return;
  }

  if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "k") {
    event.preventDefault();
    openQuickSwitcher();
    render();
    return;
  }

  if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "g") {
    event.preventDefault();
    if (!uiState.snapshot?.activeWorkspace) {
      return;
    }

    uiState.gitPanelVisible = !uiState.gitPanelVisible;
    if (uiState.gitPanelVisible) {
      uiState.settingsVisible = false;
      closeQuickSwitcher();
      uiState.pendingWorkspaceDraft = null;
      void refreshActiveWorkspaceGitStatus({ force: true });
    }
    render();
    return;
  }

  if (uiState.quickSwitcherVisible && event.key === "Escape") {
    event.preventDefault();
    closeQuickSwitcher();
    render();
    return;
  }

  if (uiState.settingsVisible && event.key === "Escape") {
    event.preventDefault();
    uiState.settingsVisible = false;
    render();
    return;
  }

  if (uiState.gitPanelVisible && event.key === "Escape") {
    event.preventDefault();
    uiState.gitPanelVisible = false;
    render();
    return;
  }

  const input = event.target.closest("[data-launcher-path-input]");
  if (input) {
    if (event.key === "Tab" && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      await completeLauncherCommandInput(input);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      clearLauncherCommandState();
      input.value = "";
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      const nextValue = moveLauncherCursor(-1);
      input.value = nextValue;
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      input.value = moveLauncherCursor(1);
    }
    return;
  }

  const countInput = event.target.closest("[data-terminal-count-input]");
  if (countInput && event.key === "Escape") {
    event.preventDefault();
    uiState.pendingWorkspaceDraft = null;
    render();
  }
}

async function beginWorkspaceCreation() {
  const snapshot = uiState.snapshot;
  const defaultPath =
    snapshot?.activeWorkspace?.path ||
    snapshot?.workspaces?.[0]?.path ||
    snapshot?.launcher?.basePath ||
    null;
  const selectedPath = await bridge.openDirectory?.(defaultPath);

  if (!selectedPath) {
    return;
  }

  uiState.pendingWorkspaceDraft = createPendingWorkspaceDraft(
    selectedPath,
    snapshot?.launcher?.presets,
  );
  uiState.launcherVisible = true;
  closeQuickSwitcher();
  render();
}

async function activateWorkspace(workspaceId) {
  if (!workspaceId) {
    return;
  }

  if (workspaceId !== uiState.snapshot?.activeWorkspaceId) {
    uiState.snapshot = await bridge.switchWorkspace(workspaceId);
  }

  uiState.launcherVisible = false;
  uiState.settingsVisible = false;
  uiState.gitPanelVisible = false;
  uiState.pendingWorkspaceDraft = null;
  uiState.contextMenu = null;
  closeQuickSwitcher();
  void refreshActiveWorkspaceGitStatus({ force: true });
}

function openQuickSwitcher() {
  if (!uiState.snapshot?.workspaces?.length) {
    return;
  }

  uiState.quickSwitcherVisible = true;
  uiState.launcherVisible = false;
  uiState.quickSwitcherQuery = "";
  uiState.quickSwitcherCursor = Math.max(
    0,
    uiState.snapshot.workspaces.findIndex((workspace) => workspace.id === uiState.snapshot?.activeWorkspaceId),
  );
  uiState.quickSwitcherShouldFocus = true;
  uiState.settingsVisible = false;
  uiState.gitPanelVisible = false;
  uiState.pendingWorkspaceDraft = null;
  uiState.contextMenu = null;
}

function closeQuickSwitcher() {
  uiState.quickSwitcherVisible = false;
  uiState.quickSwitcherQuery = "";
  uiState.quickSwitcherCursor = 0;
  uiState.quickSwitcherShouldFocus = false;
}

function getWorkspaceById(workspaceId, snapshot = uiState.snapshot) {
  return snapshot?.workspaces?.find((workspace) => workspace.id === workspaceId) || null;
}

function startWorkspaceRename(workspaceId) {
  const workspace = getWorkspaceById(workspaceId);
  if (!workspace) {
    return;
  }

  uiState.workspaceRenameDraft = {
    workspaceId,
    value: workspace.name,
  };
  uiState.workspaceRenameShouldFocus = true;
  uiState.workspaceRenameSaving = false;
  uiState.launcherVisible = false;
  uiState.settingsVisible = false;
  uiState.gitPanelVisible = false;
  uiState.contextMenu = null;
}

function cancelWorkspaceRename() {
  uiState.workspaceRenameDraft = null;
  uiState.workspaceRenameShouldFocus = false;
  uiState.workspaceRenameSaving = false;
}

async function commitWorkspaceRename() {
  const draft = uiState.workspaceRenameDraft;
  if (!draft || uiState.workspaceRenameSaving) {
    return;
  }

  const workspace = getWorkspaceById(draft.workspaceId);
  if (!workspace) {
    cancelWorkspaceRename();
    render();
    return;
  }

  const nextName = draft.value.trim();
  if (!nextName || nextName === workspace.name) {
    cancelWorkspaceRename();
    render();
    return;
  }

  uiState.workspaceRenameSaving = true;

  try {
    uiState.snapshot = await bridge.renameWorkspace(draft.workspaceId, nextName);
    cancelWorkspaceRename();
    render();
  } catch (error) {
    uiState.workspaceRenameSaving = false;
    uiState.workspaceRenameShouldFocus = true;
    console.error(error);
    render();
  }
}

function ensureFrame() {
  if (app.dataset.frameMounted === "true") {
    return;
  }

  app.innerHTML = `
    <div class="app-shell">
      <header class="workspace-strip" data-region="strip"></header>
      <section class="workspace-stage" data-region="stage"></section>
      <footer class="workspace-statusbar-region" data-region="status"></footer>
      <div class="workspace-context-layer" data-region="context"></div>
      <div class="workspace-modal-layer" data-region="modal"></div>
    </div>
  `;
  app.dataset.frameMounted = "true";
}

function render() {
  if (!uiState.snapshot) {
    return;
  }

  applyActiveTheme(getActiveThemeId(uiState.snapshot));
  ensureFrame();

  const snapshot = uiState.snapshot;
  const activeWorkspace = snapshot.activeWorkspace;
  const shouldShowLauncher = uiState.launcherVisible || !activeWorkspace;

  if (
    uiState.workspaceRenameDraft &&
    !snapshot.workspaces.some((workspace) => workspace.id === uiState.workspaceRenameDraft.workspaceId)
  ) {
    cancelWorkspaceRename();
  }

  if (
    uiState.maximizedPaneId &&
    (!activeWorkspace || !activeWorkspace.panes.some((pane) => pane.id === uiState.maximizedPaneId))
  ) {
    uiState.maximizedPaneId = null;
  }

  if (
    uiState.contextMenu &&
    (!activeWorkspace || !activeWorkspace.panes.some((pane) => pane.id === uiState.contextMenu.paneId))
  ) {
    uiState.contextMenu = null;
  }

  if (uiState.gitPanelVisible && !activeWorkspace) {
    uiState.gitPanelVisible = false;
  }

  if (uiState.quickSwitcherVisible && snapshot.workspaces.length === 0) {
    closeQuickSwitcher();
  }

  const stripRegion = app.querySelector('[data-region="strip"]');
  const stageRegion = app.querySelector('[data-region="stage"]');
  const statusRegion = app.querySelector('[data-region="status"]');
  const contextRegion = app.querySelector('[data-region="context"]');
  const modalRegion = app.querySelector('[data-region="modal"]');

  stripRegion.innerHTML = renderWorkspaceStrip(
    snapshot.workspaces,
    snapshot.activeWorkspaceId,
  );
  statusRegion.innerHTML = renderWorkspaceStatusBar(snapshot, activeWorkspace);
  syncWorkspaceTabRail(snapshot.activeWorkspaceId, snapshot.workspaces.length);
  if (uiState.workspaceRenameDraft && uiState.workspaceRenameShouldFocus) {
    focusWorkspaceRenameInput();
  }
  modalRegion.innerHTML = uiState.quickSwitcherVisible
    ? renderQuickSwitcher(snapshot)
    : uiState.settingsVisible
      ? renderSettingsSheet(snapshot)
      : uiState.pendingWorkspaceDraft
        ? renderLayoutPicker(snapshot.launcher.presets, uiState.pendingWorkspaceDraft)
        : uiState.gitPanelVisible && activeWorkspace
          ? renderGitPanel(activeWorkspace)
          : "";
  contextRegion.innerHTML =
    uiState.contextMenu && activeWorkspace
      ? renderContextMenu(uiState.contextMenu, activeWorkspace, snapshot)
      : "";
  if (uiState.quickSwitcherVisible && uiState.quickSwitcherShouldFocus) {
    focusQuickSwitcherInput();
  }
  syncGitRefreshLoop();

  if (shouldShowLauncher) {
    if (uiState.mountedWorkspaceId) {
      disposeAllTerminals();
      uiState.mountedWorkspaceId = null;
      uiState.mountedLayoutSignature = null;
    }
    stageRegion.innerHTML = renderEmptyState(snapshot.launcher.basePath);
    if (!uiState.settingsVisible) {
      focusLauncherInput();
    }
    return;
  }

  workspacePaneIds.set(
    activeWorkspace.id,
    activeWorkspace.panes.map((pane) => pane.id),
  );

  const mountedPaneCount = stageRegion.querySelectorAll("[data-pane-id]").length;
  const nextLayoutSignature = workspaceLayoutSignature(activeWorkspace);
  if (
    uiState.mountedWorkspaceId !== activeWorkspace.id ||
    mountedPaneCount !== activeWorkspace.panes.length ||
    uiState.mountedLayoutSignature !== nextLayoutSignature
  ) {
    disposeAllTerminals();
    stageRegion.innerHTML = renderWorkspace(activeWorkspace);
    uiState.mountedWorkspaceId = activeWorkspace.id;
    uiState.mountedLayoutSignature = nextLayoutSignature;
    mountWorkspaceTerminals(activeWorkspace);
  }

  syncWorkspace(activeWorkspace);
}

function renderWorkspaceStrip(workspaces, activeWorkspaceId) {
  const tabLabels = buildWorkspaceTabLabels(workspaces);
  return `
    <div class="workspace-strip-track" data-tauri-drag-region>
      <div class="workspace-strip-leading" data-tauri-drag-region aria-hidden="true"></div>
      <div class="workspace-tabs-shell" data-workspace-tabs-shell data-tauri-drag-region>
        <button
          class="workspace-tabs-scroll workspace-tabs-scroll-left"
          type="button"
          data-tauri-drag-region="false"
          data-action="scroll-workspaces-left"
          aria-label="Scroll workspaces left"
          title="Scroll workspaces left"
          disabled
        >
          ${renderChevronIcon("left")}
        </button>
        <div class="workspace-tabs-viewport" data-workspace-tabs-viewport data-tauri-drag-region>
          <div class="workspace-tabs" data-workspace-tabs data-tauri-drag-region>
            ${
              workspaces.length
                ? workspaces
                    .map((workspace) =>
                      renderWorkspaceTab(
                        workspace,
                        activeWorkspaceId,
                        tabLabels.get(workspace.id) || workspace.name,
                      ),
                    )
                    .join("")
                : '<span class="workspace-tabs-empty" data-tauri-drag-region="true">No workspaces open</span>'
            }
          </div>
        </div>
        <button
          class="workspace-tabs-scroll workspace-tabs-scroll-right"
          type="button"
          data-tauri-drag-region="false"
          data-action="scroll-workspaces-right"
          aria-label="Scroll workspaces right"
          title="Scroll workspaces right"
          disabled
        >
          ${renderChevronIcon("right")}
        </button>
      </div>
      <div class="workspace-strip-actions">
        <button
          class="workspace-strip-button workspace-settings-button"
          data-tauri-drag-region="false"
          data-action="show-settings"
          aria-label="Open settings"
          title="Settings"
        >
          ${renderSettingsIcon()}
        </button>
        <button
          class="workspace-add"
          data-tauri-drag-region="false"
          data-action="show-launcher"
          aria-label="New workspace"
          title="New workspace"
        >
          ${renderPlusIcon()}
        </button>
      </div>
    </div>
  `;
}

function renderSettingsIcon() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M10.3 2.8h3.4l.5 2.2c.5.1.9.3 1.4.6l2-1.1 2.4 2.4-1.1 2c.3.4.5.9.6 1.4l2.2.5v3.4l-2.2.5c-.1.5-.3.9-.6 1.4l1.1 2-2.4 2.4-2-1.1c-.4.3-.9.5-1.4.6l-.5 2.2h-3.4l-.5-2.2c-.5-.1-.9-.3-1.4-.6l-2 1.1-2.4-2.4 1.1-2c-.3-.4-.5-.9-.6-1.4l-2.2-.5v-3.4l2.2-.5c.1-.5.3-.9.6-1.4l-1.1-2 2.4-2.4 2 1.1c.4-.3.9-.5 1.4-.6l.5-2.2Zm1.7 5.2a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" fill="currentColor"></path>
    </svg>
  `;
}

function renderPlusIcon() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6Z" fill="currentColor"></path>
    </svg>
  `;
}

function renderChevronIcon(direction) {
  const rotation = direction === "left" ? " style=\"transform: rotate(180deg)\"" : "";
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"${rotation}>
      <path d="m9.2 6.7 5.3 5.3-5.3 5.3-1.4-1.4 3.9-3.9-3.9-3.9Z" fill="currentColor"></path>
    </svg>
  `;
}

function renderBranchIcon() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M7 3a3 3 0 1 1 0 6v7.2a3 3 0 1 1-2 0V9a3 3 0 0 1 2-6Zm0 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm10 4a3 3 0 1 1-2.9 3.8H9v2h5.1A3 3 0 1 1 17 9Zm0 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm0 7a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z" fill="currentColor"></path>
    </svg>
  `;
}

function renderRefreshIcon() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 5a7 7 0 0 1 6.2 3.8V6.5h2v6h-6v-2h2.7A5 5 0 1 0 17 15h2a7 7 0 1 1-7-10Z" fill="currentColor"></path>
    </svg>
  `;
}

function renderFileIcon() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M7 3h6.8L19 8.2V19a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm6 1.8V9h4.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>
  `;
}

function renderTabRenameIcon() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m15.1 5.2 3.7 3.7-9.9 9.9-4.4.7.7-4.4 9.9-9.9Zm1.4-1.4 1.1-1.1a1.8 1.8 0 0 1 2.6 0l1.1 1.1a1.8 1.8 0 0 1 0 2.6l-1.1 1.1-3.7-3.7Z" fill="currentColor"></path>
    </svg>
  `;
}

function renderTabCloseIcon() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m7.4 6 4.6 4.6L16.6 6 18 7.4 13.4 12 18 16.6 16.6 18 12 13.4 7.4 18 6 16.6 10.6 12 6 7.4Z" fill="currentColor"></path>
    </svg>
  `;
}

function renderWorkspaceStatusBar(snapshot, activeWorkspace) {
  const leftItems = [`<span class="workspace-statusbar-brand">CrewDock</span>`];
  const rightItems = [];

  if (!activeWorkspace) {
    leftItems.push(renderStatusBarItem("Launcher", "Source folders and workspace creation"));

    if (snapshot.workspaces.length > 0) {
      rightItems.push(
        renderStatusBarItem(
          `${snapshot.workspaces.length} ${snapshot.workspaces.length === 1 ? "workspace" : "workspaces"}`,
        ),
      );
    }

    rightItems.push(
      renderStatusBarItem(compactWorkspacePath(snapshot.launcher.basePath), snapshot.launcher.basePath, "is-path"),
    );
  } else {
    const summary = activeWorkspace.gitDetail?.summary || null;
    const paneCount = activeWorkspace.panes?.length || activeWorkspace.layout?.paneCount || 0;
    const pathLabel = compactWorkspacePath(activeWorkspace.path);

    leftItems.push(renderStatusBarItem(pathLabel, activeWorkspace.path, "is-path is-primary"));
    leftItems.push(renderStatusBarGitButton(summary));

    const stateLabel = formatStatusBarState(summary);
    if (stateLabel) {
      rightItems.push(renderStatusBarItem(stateLabel, null, `is-${getGitTone(summary)}`));
    }

    const syncLabel = formatStatusBarSync(summary);
    if (syncLabel) {
      rightItems.push(renderStatusBarItem(syncLabel, summary?.upstream || "Repository sync"));
    }

    rightItems.push(
      renderStatusBarItem(
        `${paneCount} ${paneCount === 1 ? "pane" : "panes"}`,
        `${paneCount} ${paneCount === 1 ? "pane" : "panes"} active`,
      ),
    );
  }

  return `
    <div class="workspace-statusbar" role="status" aria-live="polite">
      <div class="workspace-statusbar-group">
        ${leftItems.join("")}
      </div>
      <div class="workspace-statusbar-group is-right">
        ${rightItems.join("")}
      </div>
    </div>
  `;
}

function renderStatusBarItem(label, title = null, className = "") {
  return `
    <span class="workspace-statusbar-item ${className}"${title ? ` title="${escapeHtml(title)}"` : ""}>
      ${escapeHtml(label)}
    </span>
  `;
}

function renderStatusBarGitButton(summary) {
  const tone = getGitTone(summary);
  const label = summary ? formatGitBranchLabel(summary) : "Checking repo";
  return `
    <button
      class="workspace-statusbar-item workspace-statusbar-button is-${tone}"
      type="button"
      data-action="show-git-panel"
      title="${escapeHtml(formatGitBadgeTitle(summary))}"
      aria-label="${escapeHtml(formatGitBadgeTitle(summary))}"
    >
      <span class="workspace-statusbar-icon" aria-hidden="true">${renderBranchIcon()}</span>
      <span>${escapeHtml(label)}</span>
    </button>
  `;
}

function formatStatusBarState(summary) {
  if (!summary) {
    return "Checking";
  }

  if (summary.state === "error") {
    return "Git unavailable";
  }

  if (summary.state === "not-repo") {
    return "No repo";
  }

  if (summary.hasConflicts) {
    return "Conflicted";
  }

  if (summary.isDirty) {
    return "Dirty";
  }

  return null;
}

function formatStatusBarSync(summary) {
  if (!summary || !summary.upstream) {
    return null;
  }

  const ahead = Number(summary.ahead || 0);
  const behind = Number(summary.behind || 0);
  if (ahead <= 0 && behind <= 0) {
    return null;
  }

  return `+${ahead} / -${behind}`;
}

function renderQuickSwitcher(snapshot) {
  const items = getQuickSwitcherItems(snapshot);
  const activeItem = items[uiState.quickSwitcherCursor] || items[0] || null;

  return `
    <div class="workspace-quick-switcher-backdrop" data-action="close-quick-switcher">
      <section class="workspace-quick-switcher" role="dialog" aria-modal="true" aria-labelledby="quick-switcher-title">
        <header class="workspace-quick-switcher-header">
          <div>
            <p class="workspace-quick-switcher-mark">Quick Switch</p>
            <h2 id="quick-switcher-title">Jump to workspace</h2>
          </div>
          <button
            class="workspace-quick-switcher-close"
            type="button"
            data-action="close-quick-switcher"
            aria-label="Close quick switcher"
            title="Close quick switcher"
          >
            ${renderCloseIcon()}
          </button>
        </header>
        <div class="workspace-quick-switcher-search">
          <span class="workspace-quick-switcher-search-mark">K</span>
          <input
            class="workspace-quick-switcher-input"
            data-quick-switcher-input
            type="text"
            value="${escapeHtml(uiState.quickSwitcherQuery)}"
            placeholder="Search workspaces"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
          />
        </div>
        <div class="workspace-quick-switcher-list" role="listbox" aria-activedescendant="${activeItem ? `quick-switcher-${escapeHtml(activeItem.id)}` : ""}">
          ${
            items.length
              ? items
                  .map((item, index) => renderQuickSwitcherItem(item, index === uiState.quickSwitcherCursor))
                  .join("")
              : `
                <div class="workspace-quick-switcher-empty">
                  <strong>No matching workspaces</strong>
                  <span>Try a different name or path.</span>
                </div>
              `
          }
        </div>
      </section>
    </div>
  `;
}

function renderQuickSwitcherItem(item, isActive) {
  return `
    <button
      id="quick-switcher-${escapeHtml(item.id)}"
      class="workspace-quick-switcher-item ${isActive ? "is-active" : ""}"
      type="button"
      role="option"
      aria-selected="${isActive ? "true" : "false"}"
      data-action="quick-switch-workspace"
      data-workspace-id="${escapeHtml(item.id)}"
      title="${escapeHtml(item.path)}"
    >
      <span class="workspace-quick-switcher-item-dot is-${getGitTone(item.gitSummary || null)}" aria-hidden="true"></span>
      <span class="workspace-quick-switcher-item-copy">
        <strong>${escapeHtml(item.label)}</strong>
        <span>${escapeHtml(item.meta)}</span>
      </span>
      ${
        item.isActive
          ? '<span class="workspace-quick-switcher-item-badge">Current</span>'
          : ""
      }
    </button>
  `;
}

function renderWorkspaceGitIndicator(summary) {
  if (!summary || summary.state === "not-repo" || summary.state === "error") {
    return "";
  }

  return `
    <span
      class="workspace-tab-git is-${getGitTone(summary)}"
      aria-hidden="true"
      title="${escapeHtml(formatGitBadgeTitle(summary))}"
    ></span>
  `;
}

function renderWorkspaceTab(workspace, activeWorkspaceId, label) {
  const activeClass = workspace.id === activeWorkspaceId ? "is-active" : "";
  const liveClass = workspace.isLive ? "is-live" : "is-idle";
  const renameDraft = uiState.workspaceRenameDraft;
  const isRenaming = renameDraft?.workspaceId === workspace.id;
  const gitSummary = workspace.gitSummary || null;
  return `
    <div class="workspace-tab-shell ${activeClass} ${isRenaming ? "is-renaming" : ""}">
      ${
        isRenaming
          ? `
      <form
        class="workspace-tab-main workspace-tab-rename-form"
        data-tauri-drag-region="false"
        data-action="rename-workspace"
        data-workspace-rename-form
        data-workspace-id="${escapeHtml(workspace.id)}"
      >
        <span class="workspace-tab-status ${liveClass}" aria-hidden="true"></span>
        <input
          class="workspace-tab-rename-input"
          data-workspace-rename-input
          data-workspace-id="${escapeHtml(workspace.id)}"
          type="text"
          value="${escapeHtml(renameDraft.value)}"
          aria-label="Rename ${escapeHtml(workspace.name)}"
          title="${escapeHtml(workspace.path)}"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
        />
      </form>
      `
          : `
      <button
        class="workspace-tab-main"
        data-tauri-drag-region="false"
        data-action="switch-workspace"
        data-workspace-id="${escapeHtml(workspace.id)}"
        title="${escapeHtml(workspace.path)}"
      >
        <span class="workspace-tab-status ${liveClass}" aria-hidden="true"></span>
        <span class="workspace-tab-name">${escapeHtml(label)}</span>
        ${renderWorkspaceGitIndicator(gitSummary)}
      </button>
      <button
        class="workspace-tab-action workspace-tab-rename"
        data-tauri-drag-region="false"
        data-action="start-rename-workspace"
        data-workspace-id="${escapeHtml(workspace.id)}"
        aria-label="Rename ${escapeHtml(workspace.name)}"
        title="Rename ${escapeHtml(workspace.name)}"
      >
        ${renderTabRenameIcon()}
      </button>
      <button
        class="workspace-tab-action workspace-tab-close"
        data-tauri-drag-region="false"
        data-action="close-workspace"
        data-workspace-id="${escapeHtml(workspace.id)}"
        aria-label="Close ${escapeHtml(workspace.name)}"
        title="Close ${escapeHtml(workspace.name)}"
      >
        ${renderTabCloseIcon()}
      </button>
      `
      }
    </div>
  `;
}

function buildWorkspaceTabLabels(workspaces) {
  const labelCounts = new Map();
  for (const workspace of workspaces) {
    labelCounts.set(workspace.name, (labelCounts.get(workspace.name) || 0) + 1);
  }

  const seenLabels = new Map();
  const labels = new Map();
  for (const workspace of workspaces) {
    const total = labelCounts.get(workspace.name) || 1;
    const nextIndex = (seenLabels.get(workspace.name) || 0) + 1;
    seenLabels.set(workspace.name, nextIndex);
    labels.set(
      workspace.id,
      total > 1 ? `${workspace.name} ${nextIndex}` : workspace.name,
    );
  }

  return labels;
}

function getQuickSwitcherItems(snapshot = uiState.snapshot) {
  const workspaces = snapshot?.workspaces || [];
  const labels = buildWorkspaceTabLabels(workspaces);
  const query = uiState.quickSwitcherQuery.trim().toLowerCase();

  return workspaces
    .map((workspace) => {
      const label = labels.get(workspace.id) || workspace.name;
      const paneCount = workspace.layout?.paneCount || 0;
      return {
        id: workspace.id,
        path: workspace.path,
        label,
        gitSummary: workspace.gitSummary || null,
        isActive: workspace.id === snapshot?.activeWorkspaceId,
        meta: `${paneCount} ${paneCount === 1 ? "pane" : "panes"} • ${compactWorkspacePath(workspace.path)}`,
      };
    })
    .filter((workspace) => {
      if (!query) {
        return true;
      }

      return `${workspace.label} ${workspace.path}`.toLowerCase().includes(query);
    });
}

function syncQuickSwitcherCursor() {
  const items = getQuickSwitcherItems();
  if (!items.length) {
    uiState.quickSwitcherCursor = 0;
    return;
  }

  uiState.quickSwitcherCursor = clampQuickSwitcherCursor(uiState.quickSwitcherCursor, items.length);
}

function moveQuickSwitcherCursor(delta, itemCount) {
  if (itemCount <= 0) {
    uiState.quickSwitcherCursor = 0;
    return;
  }

  uiState.quickSwitcherCursor = clampQuickSwitcherCursor(
    uiState.quickSwitcherCursor + delta,
    itemCount,
  );
}

function clampQuickSwitcherCursor(index, itemCount) {
  if (itemCount <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(itemCount - 1, index));
}

function syncWorkspaceTabRail(activeWorkspaceId, workspaceCount) {
  const shell = document.querySelector("[data-workspace-tabs-shell]");
  const tabs = shell?.querySelector("[data-workspace-tabs]");
  if (!shell || !tabs) {
    uiState.workspaceTabsLastActiveWorkspaceId = activeWorkspaceId;
    uiState.workspaceTabsLastCount = workspaceCount;
    return;
  }

  const activeChanged = activeWorkspaceId !== uiState.workspaceTabsLastActiveWorkspaceId;
  const countChanged = workspaceCount !== uiState.workspaceTabsLastCount;
  if (activeChanged || countChanged) {
    scrollWorkspaceTabIntoView(tabs, activeWorkspaceId, "smooth");
  } else if (Math.abs(tabs.scrollLeft - uiState.workspaceTabsScrollLeft) > 1) {
    tabs.scrollLeft = uiState.workspaceTabsScrollLeft;
    rememberWorkspaceTabsScroll(tabs);
  } else {
    rememberWorkspaceTabsScroll(tabs);
  }

  syncWorkspaceTabsOverflow(tabs, shell);
  uiState.workspaceTabsLastActiveWorkspaceId = activeWorkspaceId;
  uiState.workspaceTabsLastCount = workspaceCount;
}

function scrollWorkspaceTabs(direction) {
  const tabs = document.querySelector("[data-workspace-tabs]");
  if (!tabs) {
    return;
  }

  const distance = Math.max(180, Math.round(tabs.clientWidth * 0.68));
  const maxScrollLeft = Math.max(0, tabs.scrollWidth - tabs.clientWidth);
  const nextLeft = Math.min(maxScrollLeft, Math.max(0, tabs.scrollLeft + distance * direction));
  tabs.scrollTo({
    left: nextLeft,
    behavior: "smooth",
  });

  uiState.workspaceTabsScrollLeft = nextLeft;
  window.setTimeout(() => {
    rememberWorkspaceTabsScroll(tabs);
    syncWorkspaceTabsOverflow(tabs);
  }, 180);
}

function scrollWorkspaceTabIntoView(tabs, workspaceId, behavior = "auto") {
  if (!workspaceId) {
    return;
  }

  const selector = `[data-action="switch-workspace"][data-workspace-id="${escapeSelectorValue(workspaceId)}"]`;
  const activeTab = tabs.querySelector(selector);
  if (!activeTab) {
    return;
  }

  const tabLeft = activeTab.offsetLeft;
  const tabWidth = activeTab.offsetWidth;
  const viewportWidth = tabs.clientWidth;
  const maxScrollLeft = Math.max(0, tabs.scrollWidth - viewportWidth);
  const nextLeft = Math.min(
    maxScrollLeft,
    Math.max(0, tabLeft - (viewportWidth - tabWidth) / 2),
  );

  tabs.scrollTo({
    left: nextLeft,
    behavior,
  });
  uiState.workspaceTabsScrollLeft = nextLeft;
}

function syncWorkspaceTabsOverflow(tabs, shell = tabs.closest("[data-workspace-tabs-shell]")) {
  if (!tabs || !shell) {
    return;
  }

  const maxScrollLeft = Math.max(0, tabs.scrollWidth - tabs.clientWidth);
  const hasLeft = tabs.scrollLeft > 6;
  const hasRight = tabs.scrollLeft < maxScrollLeft - 6;

  shell.classList.toggle("has-overflow-left", hasLeft);
  shell.classList.toggle("has-overflow-right", hasRight);
  shell.classList.toggle("has-overflow-any", maxScrollLeft > 6);

  const leftButton = shell.querySelector(".workspace-tabs-scroll-left");
  const rightButton = shell.querySelector(".workspace-tabs-scroll-right");
  if (leftButton) {
    leftButton.disabled = !hasLeft;
  }
  if (rightButton) {
    rightButton.disabled = !hasRight;
  }
}

function rememberWorkspaceTabsScroll(tabs) {
  uiState.workspaceTabsScrollLeft = tabs ? Math.max(0, tabs.scrollLeft) : 0;
}

function normalizeWheelDelta(event, tabs) {
  const dominantDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
  if (!dominantDelta) {
    return 0;
  }

  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    return dominantDelta * 18;
  }

  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return dominantDelta * tabs.clientWidth * 0.85;
  }

  return dominantDelta;
}

function renderEmptyState(basePath) {
  return `
    <div class="workspace-empty">
      <div class="workspace-empty-panel">
        <p class="workspace-empty-mark">CrewDock</p>
        <h1>Open a folder to start a workspace.</h1>
        <p class="workspace-empty-copy">Each workspace becomes a live tab with its own terminal grid.</p>
        <button class="workspace-empty-action" data-action="open-workspace">Open workspace</button>
        <div class="workspace-launch-shell" title="${escapeHtml(basePath)}">
          ${renderLauncherLatestStage()}
          <form class="workspace-launch-form" data-action="run-launcher-command" title="${escapeHtml(basePath)}">
            <span class="workspace-launch-prefix">$</span>
            <input
              class="workspace-launch-input"
              data-launcher-path-input
              type="text"
              value="${escapeHtml(uiState.launcherCommandValue)}"
              placeholder="Type a command"
              aria-label="Run launcher command"
              autocomplete="off"
              autocapitalize="off"
              spellcheck="false"
            />
          </form>
        </div>
      </div>
    </div>
  `;
}

function renderLayoutPicker(presets, draft) {
  const layout = deriveLayoutForPaneCount(draft.paneCount);
  const previewCells = renderPreviewCells(layout);
  return `
    <div class="workspace-modal-backdrop">
      <div class="workspace-modal">
        <div class="workspace-modal-header">
          <div>
            <p class="workspace-modal-mark">New workspace</p>
            <h2>${escapeHtml(basename(draft.path))}</h2>
            <p class="workspace-modal-path">${escapeHtml(draft.path)}</p>
          </div>
          <button class="workspace-modal-cancel" data-action="cancel-layout-picker">Cancel</button>
        </div>
        <div class="workspace-layout-builder">
          <section class="workspace-layout-controls">
            <p class="workspace-layout-kicker">Terminal count</p>
            <div class="workspace-count-stepper">
              <button class="workspace-count-button" data-action="adjust-terminal-count" data-delta="-1" aria-label="Decrease terminal count">-</button>
              <label class="workspace-count-input-shell">
                <input
                  class="workspace-count-input"
                  data-terminal-count-input
                  type="number"
                  min="1"
                  max="16"
                  value="${escapeHtml(draft.paneCount)}"
                  aria-label="Terminal count"
                />
                <span>terminals</span>
              </label>
              <button class="workspace-count-button" data-action="adjust-terminal-count" data-delta="1" aria-label="Increase terminal count">+</button>
            </div>
            <div class="workspace-count-presets">
              ${presets.map((preset) => renderCountPreset(preset, draft.paneCount)).join("")}
            </div>
            <p class="workspace-layout-note">CrewDock balances the grid automatically so you can choose the count first and worry about layout later.</p>
          </section>
          <section class="workspace-layout-preview-card">
            <div class="workspace-layout-preview-head">
              <p class="workspace-layout-kicker">Preview</p>
              <div class="workspace-layout-meta">
                <span>${layout.rows} rows</span>
                <span>${layout.columns} columns</span>
              </div>
            </div>
            <div class="workspace-layout-preview" style="--rows:${layout.rows}; --columns:${layout.columns};">
              ${previewCells}
            </div>
            <div class="workspace-layout-summary">
              <strong>${draft.paneCount}</strong>
              <span>${draft.paneCount === 1 ? "terminal" : "terminals"} in a ${layout.rows} x ${layout.columns} grid</span>
            </div>
            <button class="workspace-create-button" data-action="create-workspace">Create workspace</button>
          </section>
        </div>
      </div>
    </div>
  `;
}

function renderSettingsSheet(snapshot) {
  const activeThemeId = getActiveThemeId(snapshot);
  const themes = Object.values(THEME_REGISTRY);
  const primaryModifier = getPrimaryModifierLabel();

  return `
    <div class="settings-sheet-backdrop" data-action="close-settings">
      <section class="settings-sheet" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header class="settings-sheet-header">
          <div>
            <p class="settings-sheet-mark">Settings</p>
            <h2 id="settings-title">Workbench</h2>
            <p class="settings-sheet-copy">Tune the workbench theme, keep the core shortcuts close, and move through workspaces faster.</p>
          </div>
          <button class="settings-sheet-close" data-action="close-settings" aria-label="Close settings">
            ${renderCloseIcon()}
          </button>
        </header>
        <div class="settings-sheet-body">
          <aside class="settings-nav" aria-label="Settings sections">
            <button class="settings-nav-item is-active" type="button" aria-current="page">
              <span class="settings-nav-item-label">Workbench</span>
              <span class="settings-nav-item-value">${themes.length} themes + guide</span>
            </button>
          </aside>
          <section class="settings-panel">
            <div class="settings-panel-intro">
              <div>
                <p class="settings-panel-kicker">Theme library</p>
                <h3>${escapeHtml(getThemeDefinition(activeThemeId).label)}</h3>
              </div>
              <p class="settings-panel-copy">Pick a palette and CrewDock updates the launcher, chrome, menus, panes, and xterm colors in place.</p>
            </div>
            <div class="settings-theme-grid">
              ${themes.map((theme) => renderThemeCard(theme, activeThemeId)).join("")}
            </div>
            ${renderSettingsGuide(primaryModifier)}
          </section>
        </div>
      </section>
    </div>
  `;
}

function renderSettingsGuide(primaryModifier) {
  const shortcuts = [
    {
      label: "Open settings",
      copy: "Jump back to this panel without leaving the keyboard.",
      keys: [primaryModifier, ","],
    },
    {
      label: "Quick switch workspaces",
      copy: "Search workspaces by name or path and jump instantly.",
      keys: [primaryModifier, "K"],
    },
    {
      label: "Open source control",
      copy: "Bring up the Git drawer for the active workspace.",
      keys: [primaryModifier, "Shift", "G"],
    },
    {
      label: "Complete launcher paths",
      copy: "Autocomplete folders while using the launcher command bar.",
      keys: ["Tab"],
    },
    {
      label: "Split or close panes",
      copy: "Use the pane context menu shortcuts for the common pane actions.",
      keys: [primaryModifier, "D"],
    },
    {
      label: "Dismiss overlays",
      copy: "Close the switcher, settings, Git drawer, or rename mode.",
      keys: ["Esc"],
    },
  ];

  const tips = [
    {
      title: "Start from the launcher",
      copy: "Open a folder, choose the pane count first, then use manual splits only when the layout needs to become asymmetric.",
    },
    {
      title: "Switch from the keyboard",
      copy: "Use quick switch for workspace changes, then keep your eyes on the terminals instead of hunting through tabs.",
    },
    {
      title: "Let the footer carry context",
      copy: "Use the bottom status bar for branch, sync, and pane state so the top strip can stay focused on navigation.",
    },
  ];

  return `
    <section class="settings-guide-shell">
      <div class="settings-panel-intro">
        <div>
          <p class="settings-panel-kicker">How to use</p>
          <h3>Shortcuts and workflow</h3>
        </div>
        <p class="settings-panel-copy">CrewDock feels best when the keyboard drives workspace movement and the terminals stay visually front and center.</p>
      </div>
      <div class="settings-guide-grid">
        <article class="settings-guide-card">
          <div class="settings-guide-card-head">
            <strong>Key bindings</strong>
            <span>Core</span>
          </div>
          <div class="settings-guide-list">
            ${shortcuts.map((shortcut) => renderSettingsShortcutRow(shortcut)).join("")}
          </div>
        </article>
        <article class="settings-guide-card">
          <div class="settings-guide-card-head">
            <strong>Recommended flow</strong>
            <span>Practical</span>
          </div>
          <div class="settings-guide-tips">
            ${tips
              .map(
                (tip) => `
                  <div class="settings-guide-tip">
                    <strong>${escapeHtml(tip.title)}</strong>
                    <p>${escapeHtml(tip.copy)}</p>
                  </div>
                `,
              )
              .join("")}
          </div>
        </article>
      </div>
    </section>
  `;
}

function renderSettingsShortcutRow(shortcut) {
  return `
    <div class="settings-guide-item">
      <div class="settings-guide-copy">
        <strong>${escapeHtml(shortcut.label)}</strong>
        <span>${escapeHtml(shortcut.copy)}</span>
      </div>
      <div class="settings-guide-keys">
        ${renderSettingsShortcutKeys(shortcut.keys)}
      </div>
    </div>
  `;
}

function renderSettingsShortcutKeys(keys) {
  return keys
    .map(
      (key, index) => `
        ${index > 0 ? '<span class="settings-guide-key-separator">+</span>' : ""}
        <span class="settings-guide-key">${escapeHtml(key)}</span>
      `,
    )
    .join("");
}

function getPrimaryModifierLabel() {
  return document.body.dataset.platform === "macos" ? "Cmd" : "Ctrl";
}

function renderCloseIcon() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M6.7 5.3 12 10.6l5.3-5.3 1.4 1.4L13.4 12l5.3 5.3-1.4 1.4L12 13.4l-5.3 5.3-1.4-1.4L10.6 12 5.3 6.7l1.4-1.4Z" fill="currentColor"></path>
    </svg>
  `;
}

function renderThemeCard(theme, activeThemeId) {
  const activeClass = theme.id === activeThemeId ? "is-active" : "";
  const swatches = theme.preview
    .map((color) => `<span class="settings-theme-swatch" style="background:${escapeHtml(color)}"></span>`)
    .join("");
  const previewStyle = [
    `--theme-preview-workbench:${theme.appVars["--panel-strong"]}`,
    `--theme-preview-panel:${theme.appVars["--panel"]}`,
    `--theme-preview-pane:${theme.appVars["--pane-bg"]}`,
    `--theme-preview-text:${theme.appVars["--text"]}`,
    `--theme-preview-muted:${theme.appVars["--muted"]}`,
    `--theme-preview-accent:${theme.appVars["--accent"]}`,
    `--theme-preview-border:${theme.appVars["--pane-seam"]}`,
  ].join(";");

  return `
    <button
      class="settings-theme-card ${activeClass}"
      type="button"
      data-action="set-theme"
      data-theme-id="${escapeHtml(theme.id)}"
      aria-pressed="${theme.id === activeThemeId ? "true" : "false"}"
    >
      <div class="settings-theme-preview" style="${previewStyle}">
        <div class="settings-theme-preview-strip">
          <span></span>
          <span></span>
          <span class="is-active"></span>
        </div>
        <div class="settings-theme-preview-terminal">
          <span class="settings-theme-preview-prompt">~</span>
          <span class="settings-theme-preview-command">git status</span>
        </div>
      </div>
      <div class="settings-theme-meta">
        <div>
          <strong>${escapeHtml(theme.label)}</strong>
          <p>${escapeHtml(theme.description)}</p>
        </div>
        <span class="settings-theme-badge">${theme.id === activeThemeId ? "Active" : "Apply"}</span>
      </div>
      <div class="settings-theme-swatches">${swatches}</div>
    </button>
  `;
}

function renderGitPanel(workspace) {
  const detail = workspace.gitDetail || null;
  const summary = detail?.summary || null;
  return `
    <div class="workspace-git-backdrop" data-action="close-git-panel">
      <section class="workspace-git-panel" role="dialog" aria-modal="true" aria-labelledby="git-panel-title">
        <header class="workspace-git-panel-header">
          <div class="workspace-git-panel-heading">
            <p class="workspace-git-panel-mark">Source Control</p>
            <div class="workspace-git-panel-title-row">
              <h2 id="git-panel-title">${escapeHtml(workspace.name)}</h2>
              ${
                summary
                  ? `
                    <span class="workspace-git-panel-state is-${getGitTone(summary)}">
                      ${escapeHtml(formatGitStateText(summary))}
                    </span>
                  `
                  : ""
              }
            </div>
            <p class="workspace-git-panel-copy">${escapeHtml(workspace.path)}</p>
          </div>
          <div class="workspace-git-panel-actions">
            <button
              class="workspace-git-panel-button"
              type="button"
              data-action="refresh-git-status"
              aria-label="Refresh git status"
              title="Refresh git status"
            >
              ${renderRefreshIcon()}
            </button>
            <button
              class="workspace-git-panel-button"
              type="button"
              data-action="close-git-panel"
              aria-label="Close git panel"
              title="Close git panel"
            >
              ${renderCloseIcon()}
            </button>
          </div>
        </header>
        ${
          detail
            ? renderGitPanelBody(detail)
            : renderGitPanelEmpty(
                "Checking repository",
                "CrewDock is collecting Git metadata for this workspace.",
              )
        }
      </section>
    </div>
  `;
}

function renderGitPanelBody(detail) {
  const summary = detail.summary;
  if (summary.state === "not-repo") {
    return renderGitPanelEmpty(
      "No repository detected",
      summary.message || "This workspace is not inside a Git repository.",
    );
  }

  if (summary.state === "error") {
    return renderGitPanelEmpty(
      "Git unavailable",
      summary.message || "CrewDock could not load Git status for this workspace.",
    );
  }

  const fileCount = detail.files?.length || 0;

  return `
    <div class="workspace-git-panel-body">
      <section class="workspace-git-summary-shell">
        <div class="workspace-git-summary-line">
          <span class="workspace-git-summary-branch">
            <span class="workspace-git-summary-branch-icon" aria-hidden="true">${renderBranchIcon()}</span>
            <strong>${escapeHtml(formatGitBranchLabel(summary))}</strong>
          </span>
          <span class="workspace-git-summary-meta">${escapeHtml(summary.upstream || "Local only")}</span>
          <span class="workspace-git-summary-meta">${escapeHtml(summary.upstream ? `+${summary.ahead} / -${summary.behind}` : "No remote")}</span>
          <span class="workspace-git-summary-meta is-${getGitTone(summary)}">${escapeHtml(formatGitStateText(summary))}</span>
        </div>
        <div class="workspace-git-summary-paths">
          ${
            detail.repoRoot
              ? `
                <div class="workspace-git-summary-path">
                  <span>Repository</span>
                  <strong title="${escapeHtml(detail.repoRoot)}">${escapeHtml(detail.repoRoot)}</strong>
                </div>
              `
              : ""
          }
          ${
            detail.workspaceRelativePath
              ? `
                <div class="workspace-git-summary-path">
                  <span>Workspace path</span>
                  <strong title="${escapeHtml(detail.workspaceRelativePath)}">${escapeHtml(detail.workspaceRelativePath)}</strong>
                </div>
              `
              : ""
          }
        </div>
        <div class="workspace-git-chip-row">
          ${renderGitSummaryChips(summary)}
        </div>
      </section>
      <section class="workspace-git-change-shell">
        <header class="workspace-git-section-head">
          <div>
            <p class="workspace-git-section-mark">Changes</p>
            <strong>${fileCount === 0 ? "Working tree clean" : `${fileCount} ${fileCount === 1 ? "file" : "files"}`}</strong>
          </div>
          <span class="workspace-git-section-total">${fileCount}</span>
        </header>
        ${
          fileCount
            ? `
              <div class="workspace-git-file-sections">
                ${renderGitFileSections(detail.files)}
              </div>
            `
            : renderGitPanelEmpty(
                "No pending changes",
                "Staged, modified, and untracked files will appear here.",
              )
        }
      </section>
    </div>
  `;
}

function renderGitPanelEmpty(title, copy) {
  return `
    <div class="workspace-git-empty">
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(copy)}</p>
    </div>
  `;
}

function renderGitSummaryChips(summary) {
  const chips = [];
  const counts = summary.counts || {};
  const definitions = [
    ["staged", "Staged"],
    ["modified", "Modified"],
    ["deleted", "Deleted"],
    ["renamed", "Renamed"],
    ["untracked", "Untracked"],
    ["conflicted", "Conflicted"],
  ];

  for (const [key, label] of definitions) {
    const value = Number(counts[key] || 0);
    if (value > 0) {
      chips.push(`
        <span class="workspace-git-chip is-${key}">
          <span>${escapeHtml(label)}</span>
          <strong>${value}</strong>
        </span>
      `);
    }
  }

  if (chips.length === 0) {
    chips.push(`
      <span class="workspace-git-chip is-clean">
        <span>Changes</span>
        <strong>0</strong>
      </span>
    `);
  }

  return chips.join("");
}

function renderGitFileSections(files) {
  const groups = new Map();
  const order = ["conflicted", "staged", "changes", "untracked"];

  for (const file of files) {
    const key = getGitFileSectionKey(file);
    const bucket = groups.get(key) || [];
    bucket.push(file);
    groups.set(key, bucket);
  }

  return order
    .filter((key) => groups.has(key))
    .map((key) => {
      const bucket = groups.get(key) || [];
      return `
        <section class="workspace-git-file-section">
          <header class="workspace-git-file-section-head">
            <strong>${escapeHtml(formatGitFileSectionLabel(key))}</strong>
            <span>${bucket.length}</span>
          </header>
          <div class="workspace-git-file-list">
            ${bucket.map((file) => renderGitFileRow(file)).join("")}
          </div>
        </section>
      `;
    })
    .join("");
}

function renderGitFileRow(file) {
  const pathParts = splitGitFilePath(file.path);
  const presentation = getGitFilePresentation(file);
  const secondaryParts = [];

  if (pathParts.directory) {
    secondaryParts.push(pathParts.directory);
  }

  if (file.originalPath) {
    secondaryParts.push(`from ${file.originalPath}`);
  }

  return `
    <article class="workspace-git-file-row">
      <span class="workspace-git-file-icon" aria-hidden="true">${renderFileIcon()}</span>
      <div class="workspace-git-file-copy">
        <strong title="${escapeHtml(file.path)}">${escapeHtml(pathParts.name)}</strong>
        <span title="${escapeHtml(file.path)}">${escapeHtml(secondaryParts.join(" • ") || ".")}</span>
      </div>
      <span
        class="workspace-git-file-status is-${presentation.tone}"
        title="${escapeHtml(presentation.label)}"
        aria-label="${escapeHtml(presentation.label)}"
      >
        ${escapeHtml(presentation.code)}
      </span>
    </article>
  `;
}

function getGitFileSectionKey(file) {
  switch (file.kind) {
    case "conflicted":
      return "conflicted";
    case "staged":
      return "staged";
    case "untracked":
      return "untracked";
    default:
      return "changes";
  }
}

function formatGitFileSectionLabel(key) {
  switch (key) {
    case "conflicted":
      return "Conflicts";
    case "staged":
      return "Staged Changes";
    case "untracked":
      return "Untracked";
    default:
      return "Changes";
  }
}

function splitGitFilePath(path) {
  const normalized = String(path || "").replaceAll("\\", "/");
  const segments = normalized.split("/").filter(Boolean);
  const name = segments.pop() || normalized || "file";
  return {
    name,
    directory: segments.join("/"),
  };
}

function getGitFilePresentation(file) {
  let status = file.indexStatus || file.worktreeStatus || "modified";

  switch (file.kind) {
    case "conflicted":
      status = "unmerged";
      break;
    case "untracked":
      status = "untracked";
      break;
    case "deleted":
      status = "deleted";
      break;
    case "renamed":
      status = "renamed";
      break;
    default:
      break;
  }

  let tone = "modified";
  if (status === "unmerged") {
    tone = "conflicted";
  } else if (status === "untracked") {
    tone = "untracked";
  } else if (status === "added") {
    tone = "staged";
  } else if (status === "deleted") {
    tone = "deleted";
  } else if (status === "renamed" || status === "copied") {
    tone = "renamed";
  }

  return {
    code: formatGitFileStatusCode(status),
    label: formatGitFileStatusLabel(status),
    tone,
  };
}

function formatGitFileStatusCode(status) {
  switch (status) {
    case "added":
      return "A";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    case "copied":
      return "C";
    case "untracked":
      return "U";
    case "unmerged":
      return "!";
    default:
      return "M";
  }
}

function getGitTone(summary) {
  if (!summary) {
    return "pending";
  }

  if (summary.state === "conflicted") {
    return "conflicted";
  }

  if (summary.state === "error") {
    return "error";
  }

  if (summary.state === "not-repo") {
    return "neutral";
  }

  if (summary.state === "dirty" || summary.isDirty) {
    return "dirty";
  }

  return "clean";
}

function formatGitBranchLabel(summary) {
  if (!summary) {
    return "Checking repo";
  }

  if (summary.state === "not-repo") {
    return "No repo";
  }

  if (summary.state === "error") {
    return "Git error";
  }

  if (summary.state === "detached") {
    return summary.branch ? `Detached @ ${summary.branch}` : "Detached HEAD";
  }

  return summary.branch || "Repository";
}

function formatGitBadgeMeta(summary) {
  if (!summary) {
    return "Loading";
  }

  if (summary.state === "not-repo") {
    return "No repository";
  }

  if (summary.state === "error") {
    return "Unavailable";
  }

  if (summary.hasConflicts) {
    return `${summary.counts?.conflicted || 0} conflict${summary.counts?.conflicted === 1 ? "" : "s"}`;
  }

  if (summary.isDirty) {
    return "Dirty";
  }

  if ((summary.ahead || 0) > 0 || (summary.behind || 0) > 0) {
    return `+${summary.ahead || 0} / -${summary.behind || 0}`;
  }

  return "Clean";
}

function formatGitBadgeTitle(summary) {
  if (!summary) {
    return "Open git panel";
  }

  const pieces = [formatGitBranchLabel(summary), formatGitBadgeMeta(summary)];
  if (summary.message) {
    pieces.push(summary.message);
  }
  return pieces.filter(Boolean).join(" • ");
}

function formatGitStateText(summary) {
  if (!summary) {
    return "Checking";
  }

  if (summary.state === "not-repo") {
    return "No repository";
  }

  if (summary.state === "error") {
    return "Unavailable";
  }

  if (summary.state === "detached") {
    return summary.isDirty ? "Detached / Dirty" : "Detached";
  }

  if (summary.state === "conflicted") {
    return "Conflicted";
  }

  if (summary.state === "dirty") {
    return "Dirty";
  }

  return "Clean";
}

function formatGitFileKindLabel(kind) {
  switch (kind) {
    case "conflicted":
      return "Conflicted";
    case "renamed":
      return "Renamed";
    case "deleted":
      return "Deleted";
    case "staged":
      return "Staged";
    case "untracked":
      return "Untracked";
    default:
      return "Modified";
  }
}

function formatGitFileStatusLabel(status) {
  switch (status) {
    case "added":
      return "Added";
    case "deleted":
      return "Deleted";
    case "renamed":
      return "Renamed";
    case "copied":
      return "Copied";
    case "type-changed":
      return "Type changed";
    case "untracked":
      return "Untracked";
    case "unmerged":
      return "Unmerged";
    default:
      return "Modified";
  }
}

function syncGitRefreshLoop() {
  const shouldRefresh = Boolean(
    uiState.snapshot?.activeWorkspaceId
      && document.hasFocus()
      && bridge.refreshWorkspaceGitStatus,
  );

  if (!shouldRefresh) {
    if (gitRefreshIntervalTimer) {
      window.clearInterval(gitRefreshIntervalTimer);
      gitRefreshIntervalTimer = 0;
    }
    return;
  }

  if (gitRefreshIntervalTimer) {
    return;
  }

  gitRefreshIntervalTimer = window.setInterval(() => {
    void refreshActiveWorkspaceGitStatus();
  }, GIT_REFRESH_INTERVAL_MS);
}

async function refreshActiveWorkspaceGitStatus({ force = false } = {}) {
  const workspaceId = uiState.snapshot?.activeWorkspaceId;
  if (!workspaceId || !bridge.refreshWorkspaceGitStatus) {
    return uiState.snapshot;
  }

  if (gitRefreshInFlight) {
    gitRefreshQueuedWorkspaceId = workspaceId;
    return gitRefreshInFlight;
  }

  gitRefreshInFlight = (async () => {
    try {
      const snapshot = await bridge.refreshWorkspaceGitStatus(workspaceId);
      uiState.snapshot = snapshot;
      render();
      return snapshot;
    } catch (error) {
      if (force) {
        console.error(error);
      }
      return uiState.snapshot;
    } finally {
      const queuedWorkspaceId = gitRefreshQueuedWorkspaceId;
      gitRefreshInFlight = null;
      gitRefreshQueuedWorkspaceId = null;
      if (
        queuedWorkspaceId
        && queuedWorkspaceId === uiState.snapshot?.activeWorkspaceId
      ) {
        void refreshActiveWorkspaceGitStatus({ force: true });
      }
    }
  })();

  return gitRefreshInFlight;
}

function renderCountPreset(preset, selectedCount) {
  const isActive = preset.paneCount === selectedCount ? "is-active" : "";
  return `
    <button
      class="workspace-count-preset ${isActive}"
      data-action="set-terminal-count"
      data-pane-count="${preset.paneCount}"
    >
      ${preset.paneCount}
    </button>
  `;
}

function createPendingWorkspaceDraft(path, presets) {
  const defaultCount = presets?.[0]?.paneCount || 1;
  return {
    path,
    paneCount: clampPaneCount(defaultCount),
  };
}

function clampPaneCount(value) {
  const nextValue = Number.isFinite(value) ? Math.round(value) : 1;
  return Math.min(16, Math.max(1, nextValue));
}

function escapeSelectorValue(value) {
  if (window.CSS?.escape) {
    return window.CSS.escape(String(value));
  }

  return String(value).replace(/["\\]/g, "\\$&");
}

function deriveLayoutForPaneCount(paneCount) {
  const count = clampPaneCount(paneCount);
  const columns = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(count))));
  const rows = Math.min(4, Math.max(1, Math.ceil(count / columns)));
  return {
    id: `count-${count}`,
    label: `${count} terminals`,
    rows,
    columns,
    paneCount: count,
  };
}

function renderPreviewCells(layout) {
  const totalSlots = layout.rows * layout.columns;
  const cells = [];

  for (let index = 0; index < totalSlots; index += 1) {
    const ghostClass = index >= layout.paneCount ? " is-ghost" : "";
    cells.push(`<span class="preset-cell${ghostClass}"></span>`);
  }

  return cells.join("");
}

function buildBalancedPaneLayout(paneIds, preferHorizontal = true) {
  if (paneIds.length === 1) {
    return {
      kind: "leaf",
      paneId: paneIds[0],
    };
  }

  const midpoint = Math.ceil(paneIds.length / 2);
  return {
    kind: "split",
    axis: preferHorizontal ? "horizontal" : "vertical",
    first: buildBalancedPaneLayout(paneIds.slice(0, midpoint), !preferHorizontal),
    second: buildBalancedPaneLayout(paneIds.slice(midpoint), !preferHorizontal),
  };
}

function splitPaneLayout(layout, paneId, axis, newPaneFirst, newPaneId) {
  if (!layout) {
    return null;
  }

  if (layout.kind === "leaf") {
    if (layout.paneId !== paneId) {
      return layout;
    }

    const existing = { kind: "leaf", paneId };
    const incoming = { kind: "leaf", paneId: newPaneId };
    return {
      kind: "split",
      axis,
      first: newPaneFirst ? incoming : existing,
      second: newPaneFirst ? existing : incoming,
    };
  }

  const nextFirst = splitPaneLayout(layout.first, paneId, axis, newPaneFirst, newPaneId);
  if (nextFirst !== layout.first) {
    return {
      ...layout,
      first: nextFirst,
    };
  }

  return {
    ...layout,
    second: splitPaneLayout(layout.second, paneId, axis, newPaneFirst, newPaneId),
  };
}

function removePaneLayout(layout, paneId) {
  if (!layout) {
    return null;
  }

  if (layout.kind === "leaf") {
    return layout.paneId === paneId ? null : layout;
  }

  const first = removePaneLayout(layout.first, paneId);
  const second = removePaneLayout(layout.second, paneId);
  if (!first) {
    return second;
  }
  if (!second) {
    return first;
  }

  return {
    ...layout,
    first,
    second,
  };
}

function relabelMockPanes(panes) {
  panes.forEach((pane, index) => {
    pane.label = `Shell ${String(index + 1).padStart(2, "0")}`;
  });
}

function renderWorkspace(workspace) {
  const paneLayout = resolveWorkspacePaneLayout(workspace);
  const maximizedPane = uiState.maximizedPaneId
    ? workspace.panes.find((pane) => pane.id === uiState.maximizedPaneId) || null
    : null;
  const paneIndexById = new Map(workspace.panes.map((pane, index) => [pane.id, index]));
  return `
    <main class="workspace-screen ${maximizedPane ? "is-maximized" : ""}">
      <section class="terminal-layout">
        ${
          maximizedPane
            ? renderPaneShell(maximizedPane, paneIndexById.get(maximizedPane.id) || 0)
            : renderPaneLayout(paneLayout, workspace, paneIndexById)
        }
      </section>
    </main>
  `;
}

function renderPaneLayout(node, workspace, paneIndexById) {
  const layoutNode = normalizePaneLayoutNode(node);
  if (!layoutNode) {
    return "";
  }

  if (layoutNode.kind === "leaf") {
    const pane = workspace.panes.find((entry) => entry.id === layoutNode.paneId);
    return pane
      ? `<div class="pane-branch is-leaf">${renderPaneShell(pane, paneIndexById.get(pane.id) || 0)}</div>`
      : "";
  }

  return `
    <div class="pane-split" data-axis="${escapeHtml(layoutNode.axis)}">
      <div class="pane-branch">${renderPaneLayout(layoutNode.first, workspace, paneIndexById)}</div>
      <div class="pane-branch">${renderPaneLayout(layoutNode.second, workspace, paneIndexById)}</div>
    </div>
  `;
}

function resolveWorkspacePaneLayout(workspace) {
  const normalized = normalizePaneLayoutNode(workspace.paneLayout || workspace.pane_layout);
  if (normalized) {
    return normalized;
  }

  return buildBalancedPaneLayout(
    workspace.panes.map((pane) => pane.id),
    true,
  );
}

function normalizePaneLayoutNode(node) {
  if (!node) {
    return null;
  }

  const paneId = node.paneId || node.pane_id || null;
  const kind = typeof node.kind === "string" ? node.kind : null;

  if (kind === "leaf" || (!kind && paneId)) {
    return paneId
      ? {
          kind: "leaf",
          paneId,
        }
      : null;
  }

  const first = normalizePaneLayoutNode(node.first);
  const second = normalizePaneLayoutNode(node.second);
  if (!first && !second) {
    return null;
  }
  if (!first) {
    return second;
  }
  if (!second) {
    return first;
  }

  return {
    kind: "split",
    axis: node.axis === "vertical" ? "vertical" : "horizontal",
    first,
    second,
  };
}

function workspaceLayoutSignature(workspace) {
  return JSON.stringify(resolveWorkspacePaneLayout(workspace));
}

function renderPaneShell(pane, paneIndex) {
  const statusLabel = formatPaneStatusLabel(pane.status);
  return `
    <article class="terminal-pane" data-pane-id="${escapeHtml(pane.id)}" data-status="${escapeHtml(pane.status)}">
      <header class="terminal-pane-header">
        <div class="terminal-pane-title">
          <span class="terminal-pane-status is-${escapeHtml(pane.status)}" aria-hidden="true"></span>
          <strong>Terminal ${paneIndex + 1}</strong>
        </div>
        <div class="terminal-pane-meta">
          <span>${escapeHtml(statusLabel)}</span>
        </div>
      </header>
      <div class="terminal-host" data-terminal-host="${escapeHtml(pane.id)}"></div>
    </article>
  `;
}

function formatPaneStatusLabel(status) {
  switch (status) {
    case "ready":
      return "Live";
    case "booting":
      return "Booting";
    case "failed":
      return "Error";
    case "closed":
      return "Closed";
    default:
      return "Idle";
  }
}

function renderContextMenu(contextMenu, workspace) {
  const maxX = Math.max(20, window.innerWidth - 320);
  const maxY = Math.max(20, window.innerHeight - 360);
  const left = Math.min(contextMenu.x, maxX);
  const top = Math.min(contextMenu.y, maxY);
  const canSplit = workspace.panes.length < 16;
  const canClose = workspace.panes.length > 1;

  return `
    <div class="terminal-context-menu" style="left:${left}px; top:${top}px;">
      <button class="terminal-context-item" data-action="context-copy-path">
        <span>Copy Path</span>
      </button>
      <button class="terminal-context-item" data-action="context-show-in-finder">
        <span>Show in Finder</span>
      </button>
      <div class="terminal-context-divider"></div>
      ${renderContextSplitAction("Split pane right", "context-split-pane", "right", "⌘D", canSplit)}
      ${renderContextSplitAction("Split pane left", "context-split-pane", "left", "", canSplit)}
      ${renderContextSplitAction("Split pane down", "context-split-pane", "down", "⇧⌘D", canSplit)}
      ${renderContextSplitAction("Split pane up", "context-split-pane", "up", "", canSplit)}
      ${renderContextSplitAction("Maximize pane", "context-maximize-pane", "", "⇧⌘↩", true)}
      ${renderContextSplitAction("Close pane", "context-close-pane", "", "⌘W", canClose)}
    </div>
  `;
}

function renderContextSplitAction(label, action, direction, shortcut, enabled) {
  return `
    <button
      class="terminal-context-item"
      data-action="${action}"
      ${direction ? `data-direction="${direction}"` : ""}
      ${enabled ? "" : "disabled"}
    >
      <span>${label}</span>
      <span class="terminal-context-shortcut">${shortcut}</span>
    </button>
  `;
}

async function handleContextMenuAction(target) {
  const action = target.dataset.action;
  const contextMenu = uiState.contextMenu;
  const workspace = uiState.snapshot?.activeWorkspace;
  if (!contextMenu || !workspace) {
    return;
  }

  const paneId = contextMenu.paneId;

  try {
    if (action === "context-copy-path") {
      await copyText(workspace.path);
    } else if (action === "context-show-in-finder") {
      await bridge.showInFinder(workspace.path);
    } else if (action === "context-split-pane") {
      uiState.snapshot = await bridge.splitPane(paneId, target.dataset.direction || "right");
    } else if (action === "context-close-pane") {
      clearSinglePaneBuffer(paneId);
      uiState.snapshot = await bridge.closePane(paneId);
    } else if (action === "context-maximize-pane") {
      uiState.maximizedPaneId = uiState.maximizedPaneId === paneId ? null : paneId;
    }
  } catch (error) {
    console.error(error);
  } finally {
    uiState.contextMenu = null;
    render();
  }
}

function mountWorkspaceTerminals(workspace) {
  const theme = getCurrentThemeDefinition();

  for (const pane of workspace.panes) {
    const host = document.querySelector(`[data-terminal-host="${pane.id}"]`);
    if (!host) {
      continue;
    }

    const terminal = new Terminal({
      allowTransparency: true,
      cursorBlink: true,
      convertEol: true,
      fontFamily: '"SF Mono", "SFMono-Regular", "Menlo", monospace',
      fontSize: 13.5,
      fontWeight: "450",
      lineHeight: 1.18,
      scrollback: 8000,
      theme: { ...theme.terminalTheme },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(host);

    const state = {
      terminal,
      fitAddon,
      observer: new ResizeObserver(() => fitTerminal(pane.id)),
      size: { cols: 0, rows: 0 },
      themeId: theme.id,
    };

    state.observer.observe(host);
    terminal.onData((data) => {
      bridge.writeToPane(pane.id, data).catch((error) => console.error(error));
    });
    terminal.onScroll(() => {
      terminalViewportLines.set(pane.id, terminal.buffer.active.viewportY);
    });

    paneTerminals.set(pane.id, state);
    drainPendingTerminalData(pane.id);

    requestAnimationFrame(() => {
      fitTerminal(pane.id);
    });
  }

  const firstPane = workspace.panes[0];
  if (firstPane) {
    requestAnimationFrame(() => {
      paneTerminals.get(firstPane.id)?.terminal.focus();
    });
  }
}

function syncWorkspace(workspace) {
  const theme = getCurrentThemeDefinition();
  for (const pane of workspace.panes) {
    const paneElement = document.querySelector(`[data-pane-id="${pane.id}"]`);
    if (paneElement) {
      paneElement.dataset.status = pane.status;
    }
  }

  for (const [paneId, paneState] of paneTerminals.entries()) {
    if (paneState.themeId !== theme.id) {
      paneState.terminal.setOption("theme", { ...theme.terminalTheme });
      paneState.themeId = theme.id;
    }

    if (!workspace.panes.some((pane) => pane.id === paneId)) {
      disposeTerminal(paneId);
    }
  }
}

function appendTerminalData(paneId, data) {
  const pane = paneTerminals.get(paneId);
  if (pane) {
    pane.terminal.write(data);
  }

  const queue = pendingTerminalData.get(paneId) || { bytes: 0, chunks: [] };
  queue.chunks.push(data);
  queue.bytes += data.length;

  while (queue.bytes > MAX_PENDING_TERMINAL_BYTES && queue.chunks.length > 1) {
    const removed = queue.chunks.shift();
    queue.bytes -= removed.length;
  }

  pendingTerminalData.set(paneId, queue);
}

function drainPendingTerminalData(paneId) {
  const pane = paneTerminals.get(paneId);
  const queue = pendingTerminalData.get(paneId);

  if (!pane || !queue || queue.chunks.length === 0) {
    restoreTerminalViewport(paneId);
    return;
  }

  pane.terminal.reset();
  pane.terminal.write(queue.chunks.join(""), () => {
    restoreTerminalViewport(paneId);
  });
}

function clearWorkspaceBuffers(workspaceId) {
  const paneIds = workspacePaneIds.get(workspaceId) || [];
  for (const paneId of paneIds) {
    pendingTerminalData.delete(paneId);
    terminalViewportLines.delete(paneId);
    disposeTerminal(paneId);
  }
  workspacePaneIds.delete(workspaceId);
}

function clearSinglePaneBuffer(paneId) {
  pendingTerminalData.delete(paneId);
  terminalViewportLines.delete(paneId);
  disposeTerminal(paneId);
  for (const [workspaceId, paneIds] of workspacePaneIds.entries()) {
    if (paneIds.includes(paneId)) {
      workspacePaneIds.set(
        workspaceId,
        paneIds.filter((entry) => entry !== paneId),
      );
    }
  }
}

function fitAllTerminals() {
  for (const paneId of paneTerminals.keys()) {
    fitTerminal(paneId);
  }
}

function fitTerminal(paneId) {
  const pane = paneTerminals.get(paneId);
  if (!pane) {
    return;
  }

  pane.fitAddon.fit();
  const nextCols = pane.terminal.cols;
  const nextRows = pane.terminal.rows;

  if (pane.size.cols === nextCols && pane.size.rows === nextRows) {
    return;
  }

  pane.size = { cols: nextCols, rows: nextRows };
  bridge.resizePane(paneId, nextCols, nextRows).catch((error) => console.error(error));
}

function disposeTerminal(paneId) {
  const pane = paneTerminals.get(paneId);
  if (!pane) {
    return;
  }

  terminalViewportLines.set(paneId, pane.terminal.buffer.active.viewportY);
  pane.observer.disconnect();
  pane.terminal.dispose();
  paneTerminals.delete(paneId);
}

function disposeAllTerminals() {
  for (const paneId of Array.from(paneTerminals.keys())) {
    disposeTerminal(paneId);
  }
}

function restoreTerminalViewport(paneId) {
  const pane = paneTerminals.get(paneId);
  if (!pane) {
    return;
  }

  const viewportLine = terminalViewportLines.get(paneId);
  if (!Number.isFinite(viewportLine)) {
    return;
  }

  pane.terminal.scrollToLine(viewportLine);
}

async function executeLauncherCommand(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) {
    pushLauncherHistory({ input: "", output: ["Enter a command. Try help."], tone: "error" });
    render();
    focusLauncherInput({ select: true });
    return;
  }

  uiState.launcherCommandValue = value;
  rememberLauncherCommand(value);

  try {
    const result = await bridge.runLauncherCommand(value);
    if (uiState.snapshot?.launcher && result.basePath) {
      uiState.snapshot.launcher.basePath = result.basePath;
    }

    if (result.clearOutput) {
      uiState.launcherHistory = [];
      animateLauncherLatestCard(null);
    } else {
      pushLauncherHistory({
        input: value,
        output: result.output || [],
        tone: "normal",
      });
    }

    uiState.launcherCommandValue = "";
    if (result.openPath) {
      uiState.launcherVisible = true;
      uiState.settingsVisible = false;
      uiState.pendingWorkspaceDraft = createPendingWorkspaceDraft(
        result.openPath,
        uiState.snapshot?.launcher?.presets,
      );
    }
    render();
    focusLauncherInput();
  } catch (error) {
    pushLauncherHistory({
      input: value,
      output: [normalizeErrorMessage(error)],
      tone: "error",
    });
    render();
    focusLauncherInput({ select: true });
  }
}

async function completeLauncherCommandInput(input) {
  const currentValue = String(input?.value || "");
  if (!currentValue.trim()) {
    return;
  }

  try {
    const result = await bridge.completeLauncherInput?.(currentValue);
    if (!result) {
      return;
    }

    const nextValue = typeof result.completedInput === "string"
      ? result.completedInput
      : currentValue;

    if (nextValue !== currentValue) {
      uiState.launcherCommandValue = nextValue;
      input.value = nextValue;
      input.setSelectionRange(nextValue.length, nextValue.length);
      return;
    }

    if (Array.isArray(result.matches) && result.matches.length > 1) {
      pushLauncherHistory({
        input: currentValue,
        output: formatLauncherCompletionMatches(result.matches),
        tone: "normal",
      });
      render();
      focusLauncherInput();
    }
  } catch (error) {
    pushLauncherHistory({
      input: currentValue,
      output: [normalizeErrorMessage(error)],
      tone: "error",
    });
    render();
    focusLauncherInput({ select: true });
  }
}

function pushLauncherHistory(entry) {
  uiState.launcherHistory = [...uiState.launcherHistory, entry].slice(-6);
  animateLauncherLatestCard(entry);
}

function formatLauncherCompletionMatches(matches) {
  const lines = [];
  const limited = matches.slice(0, MAX_LAUNCHER_COMPLETION_MATCHES);

  for (let index = 0; index < limited.length; index += 3) {
    lines.push(limited.slice(index, index + 3).join("    "));
  }

  return lines;
}

function clearLauncherCommandState() {
  uiState.launcherCommandValue = "";
  uiState.launcherCommandCursor = null;
}

function rememberLauncherCommand(command) {
  const lastCommand = uiState.launcherCommands.at(-1);
  if (lastCommand !== command) {
    uiState.launcherCommands = [...uiState.launcherCommands, command].slice(-20);
  }
  uiState.launcherCommandCursor = null;
}

function moveLauncherCursor(direction) {
  const commands = uiState.launcherCommands;
  if (commands.length === 0) {
    return uiState.launcherCommandValue;
  }

  if (direction < 0) {
    if (uiState.launcherCommandCursor === null) {
      uiState.launcherCommandCursor = commands.length - 1;
    } else {
      uiState.launcherCommandCursor = Math.max(0, uiState.launcherCommandCursor - 1);
    }
  } else if (uiState.launcherCommandCursor === null) {
    return uiState.launcherCommandValue;
  } else if (uiState.launcherCommandCursor >= commands.length - 1) {
    uiState.launcherCommandCursor = null;
    uiState.launcherCommandValue = "";
    return "";
  } else {
    uiState.launcherCommandCursor += 1;
  }

  const nextValue = uiState.launcherCommandCursor === null
    ? ""
    : commands[uiState.launcherCommandCursor] || "";
  uiState.launcherCommandValue = nextValue;
  return nextValue;
}

function focusLauncherInput({ select = false } = {}) {
  const input = app.querySelector("[data-launcher-path-input]");
  if (!input) {
    return;
  }

  requestAnimationFrame(() => {
    input.focus();
    if (select) {
      input.select();
    }
  });
}

function focusQuickSwitcherInput({ select = false } = {}) {
  const input = app.querySelector("[data-quick-switcher-input]");
  if (!input) {
    uiState.quickSwitcherShouldFocus = false;
    return;
  }

  requestAnimationFrame(() => {
    input.focus();
    if (select) {
      input.select();
    }
    uiState.quickSwitcherShouldFocus = false;
  });
}

function focusWorkspaceRenameInput() {
  const input = app.querySelector("[data-workspace-rename-input]");
  if (!input) {
    uiState.workspaceRenameShouldFocus = false;
    return;
  }

  requestAnimationFrame(() => {
    input.focus();
    input.select();
    uiState.workspaceRenameShouldFocus = false;
  });
}

function animateLauncherLatestCard(entry) {
  const currentEntry = uiState.launcherLatestCard.current;
  const nextEntry = entry ? { ...entry } : null;
  clearLauncherLatestCardTimers();

  if (!nextEntry) {
    uiState.launcherLatestCard = {
      current: null,
      previous: null,
      phase: "idle",
    };
    return;
  }

  if (!currentEntry) {
    uiState.launcherLatestCard = {
      current: nextEntry,
      previous: null,
      phase: "settled",
    };
    return;
  }

  uiState.launcherLatestCard = {
    current: nextEntry,
    previous: currentEntry,
    phase: "prepare",
  };

  launcherCardAnimationFrame = window.requestAnimationFrame(() => {
    uiState.launcherLatestCard = {
      ...uiState.launcherLatestCard,
      phase: "run",
    };
    render();

    launcherCardTransitionTimer = window.setTimeout(() => {
      uiState.launcherLatestCard = {
        current: nextEntry,
        previous: null,
        phase: "settled",
      };
      render();
    }, LAUNCHER_CARD_TRANSITION_MS);
  });
}

function clearLauncherLatestCardTimers() {
  if (launcherCardAnimationFrame) {
    window.cancelAnimationFrame(launcherCardAnimationFrame);
    launcherCardAnimationFrame = 0;
  }

  if (launcherCardTransitionTimer) {
    window.clearTimeout(launcherCardTransitionTimer);
    launcherCardTransitionTimer = 0;
  }
}

function renderLauncherLatestStage() {
  const { current, previous, phase } = uiState.launcherLatestCard;
  if (!current && !previous) {
    return "";
  }

  return `
    <div class="workspace-launch-history-stage ${previous ? `is-transitioning is-${phase}` : "is-settled"}">
      ${
        previous
          ? `<div class="workspace-launch-latest-card is-previous is-${phase}">${renderLauncherHistoryEntry(previous)}</div>`
          : ""
      }
      ${
        current
          ? `<div class="workspace-launch-latest-card is-current is-${phase}">${renderLauncherHistoryEntry(current)}</div>`
          : ""
      }
    </div>
  `;
}

function renderLauncherHistoryEntry(entry) {
  const tone = entry.tone === "error" ? "is-error" : "";
  const output = (entry.output || []).map((line) => `<div>${escapeHtml(line)}</div>`).join("");
  return `
    <div class="workspace-launch-entry ${tone}">
      ${entry.input ? `<div class="workspace-launch-command">$ ${escapeHtml(entry.input)}</div>` : ""}
      <div class="workspace-launch-output">${output}</div>
    </div>
  `;
}

function normalizeDialogPath(result) {
  if (!result) {
    return null;
  }

  const value = Array.isArray(result) ? result[0] : result;
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    if (value.startsWith("file://")) {
      return decodeURIComponent(new URL(value).pathname);
    }
    return value;
  }

  if (typeof value === "object") {
    if (typeof value.Path === "string") {
      return value.Path;
    }
    if (typeof value.path === "string") {
      return value.path;
    }
    if (typeof value.Url === "string") {
      return decodeURIComponent(new URL(value.Url).pathname);
    }
    if (typeof value.url === "string") {
      return decodeURIComponent(new URL(value.url).pathname);
    }
  }

  return null;
}

function resolveMockNavigationPath(basePath, rawInput) {
  const target = extractNavigationTarget(rawInput);
  const value = stripWrappingQuotes(target);
  const home = "/Users/ashutoshbele";

  if (value === "~") {
    return home;
  }

  if (value.startsWith("~/")) {
    return normalizePath(`${home}/${value.slice(2)}`);
  }

  if (value.startsWith("/")) {
    return normalizePath(value);
  }

  return normalizePath(`${basePath}/${value}`);
}

function completeMockLauncherInput(basePath, rawInput) {
  const currentValue = String(rawInput || "");
  if (!currentValue.trim()) {
    return {
      completedInput: currentValue,
      matches: [],
    };
  }

  if (containsForbiddenNavigationTokens(currentValue)) {
    throw new Error("only directory navigation is supported");
  }

  const commandCompletion = completeLauncherCommandName(currentValue);
  if (commandCompletion) {
    return commandCompletion;
  }

  if (startsWithNonPathLauncherCommand(currentValue)) {
    return {
      completedInput: currentValue,
      matches: [],
    };
  }

  const { commandPrefix, rawTarget } = splitLauncherCompletionInput(currentValue);
  const normalizedTarget = rawTarget.trimStart();
  const quotePrefix = normalizedTarget.startsWith('"') || normalizedTarget.startsWith("'")
    ? normalizedTarget[0]
    : "";
  const targetValue = quotePrefix ? normalizedTarget.slice(1) : normalizedTarget;
  const { containerRaw, typedPathPrefix, fragment } = splitLauncherCompletionTarget(targetValue);
  const scanPath = resolveMockCompletionBase(basePath, containerRaw);
  const fragmentLower = fragment.toLowerCase();
  const matches = mockDirectoryEntries(scanPath)
    .filter((entry) => entry.endsWith("/"))
    .map((entry) => entry.slice(0, -1))
    .filter((entry) => !fragmentLower || entry.toLowerCase().startsWith(fragmentLower))
    .sort((left, right) => left.localeCompare(right));

  if (matches.length === 0) {
    return {
      completedInput: currentValue,
      matches: [],
    };
  }

  const completedFragment = matches.length === 1
    ? `${matches[0]}/`
    : longestCommonPrefix(matches).length > fragment.length
      ? longestCommonPrefix(matches)
      : fragment;

  return {
    completedInput: `${commandPrefix}${quotePrefix}${typedPathPrefix}${completedFragment}`,
    matches: summarizeLauncherCompletionMatches(
      matches.map((entry) => `${quotePrefix}${typedPathPrefix}${entry}/`),
    ),
  };
}

function mockDirectoryEntries(path) {
  const index = {
    "/Users/ashutoshbele/Desktop/ashlab/crewdock": ["README.md", "package.json", "src-tauri/", "src-web/"],
    "/Users/ashutoshbele/Desktop/ashlab": ["crewdock/"],
    "/Users/ashutoshbele/Desktop": ["ashlab/"],
  };

  return index[path] || ["(mock listing unavailable)"];
}

function mockListDirectory(path) {
  const entries = mockDirectoryEntries(path);
  return [path, entries.join("  ")];
}

function completeLauncherCommandName(rawInput) {
  const trimmed = String(rawInput || "").trim();
  if (
    !trimmed
    || /\s/.test(trimmed)
    || trimmed.startsWith("/")
    || trimmed.startsWith(".")
    || trimmed.startsWith("~")
    || trimmed.includes("/")
  ) {
    return null;
  }

  const matches = LAUNCHER_COMMANDS.filter((command) => command.startsWith(trimmed));
  if (matches.length === 0) {
    return null;
  }

  const completedInput = matches.length === 1
    ? PATH_AWARE_LAUNCHER_COMMANDS.has(matches[0])
      ? `${matches[0]} `
      : matches[0]
    : longestCommonPrefix(matches);

  return {
    completedInput,
    matches,
  };
}

function startsWithNonPathLauncherCommand(rawInput) {
  const trimmed = String(rawInput || "").trimStart();
  return ["help", "pwd", "clear"].some((command) => {
    if (!trimmed.startsWith(command)) {
      return false;
    }

    const next = trimmed.slice(command.length, command.length + 1);
    return Boolean(next && /\s/.test(next));
  });
}

function splitLauncherCompletionInput(rawInput) {
  const trimmed = String(rawInput || "").trimStart();

  for (const command of PATH_AWARE_LAUNCHER_COMMANDS) {
    if (!trimmed.startsWith(command)) {
      continue;
    }

    const next = trimmed.slice(command.length, command.length + 1);
    if (next && /\s/.test(next)) {
      return {
        commandPrefix: `${command} `,
        rawTarget: trimmed.slice(command.length).trimStart(),
      };
    }
  }

  return {
    commandPrefix: "",
    rawTarget: trimmed,
  };
}

function splitLauncherCompletionTarget(value) {
  const separatorIndex = value.lastIndexOf("/");
  if (separatorIndex === -1) {
    return {
      containerRaw: "",
      typedPathPrefix: "",
      fragment: value,
    };
  }

  return {
    containerRaw: value.slice(0, separatorIndex),
    typedPathPrefix: value.slice(0, separatorIndex + 1),
    fragment: value.slice(separatorIndex + 1),
  };
}

function resolveMockCompletionBase(basePath, containerRaw) {
  if (!containerRaw) {
    return normalizePath(basePath);
  }

  const home = "/Users/ashutoshbele";
  if (containerRaw === "~") {
    return home;
  }

  if (containerRaw.startsWith("~/")) {
    return normalizePath(`${home}/${containerRaw.slice(2)}`);
  }

  if (containerRaw.startsWith("/")) {
    return normalizePath(containerRaw);
  }

  return normalizePath(`${basePath}/${containerRaw}`);
}

function summarizeLauncherCompletionMatches(matches) {
  if (matches.length <= MAX_LAUNCHER_COMPLETION_MATCHES) {
    return matches;
  }

  return [
    ...matches.slice(0, MAX_LAUNCHER_COMPLETION_MATCHES),
    `... ${matches.length - MAX_LAUNCHER_COMPLETION_MATCHES} more`,
  ];
}

function longestCommonPrefix(values) {
  if (!values.length) {
    return "";
  }

  let prefix = values[0];
  for (const value of values.slice(1)) {
    let index = 0;
    while (index < prefix.length && index < value.length && prefix[index] === value[index]) {
      index += 1;
    }
    prefix = prefix.slice(0, index);
    if (!prefix) {
      break;
    }
  }

  return prefix;
}

function extractNavigationTarget(rawInput) {
  const trimmed = String(rawInput || "").trim();
  if (!trimmed) {
    throw new Error("enter a folder path");
  }

  if (containsForbiddenNavigationTokens(trimmed)) {
    throw new Error("only directory navigation is supported");
  }

  if (trimmed === "cd") {
    return "~";
  }

  if (trimmed.startsWith("cd") && /\s/.test(trimmed[2] || "")) {
    const target = trimmed.slice(2).trim();
    return target || "~";
  }

  return trimmed;
}

function containsForbiddenNavigationTokens(value) {
  return ["&&", "||", ";", "|", "`", "$(", "\n", "\r"].some((token) => value.includes(token));
}

function stripWrappingQuotes(value) {
  const trimmed = String(value).trim();
  if (trimmed.length < 2) {
    return trimmed;
  }

  const first = trimmed[0];
  const last = trimmed.at(-1);
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function normalizePath(path) {
  const isAbsolute = path.startsWith("/");
  const parts = [];

  for (const part of path.split("/")) {
    if (!part || part === ".") {
      continue;
    }

    if (part === "..") {
      if (parts.length > 0) {
        parts.pop();
      }
      continue;
    }

    parts.push(part);
  }

  if (!isAbsolute) {
    return parts.join("/") || ".";
  }

  return `/${parts.join("/")}` || "/";
}

function normalizeErrorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  if (error && typeof error === "object" && typeof error.message === "string") {
    return error.message;
  }

  return "navigation failed";
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "true");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  document.execCommand("copy");
  input.remove();
}

function basename(path) {
  const parts = String(path).split("/").filter(Boolean);
  return parts[parts.length - 1] || path;
}

function compactWorkspacePath(path) {
  const parts = String(path || "").split("/").filter(Boolean);
  if (parts.length === 0) {
    return "/";
  }

  if (parts.length === 1) {
    return parts[0];
  }

  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
