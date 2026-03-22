import { Terminal } from "./vendor/xterm.mjs";
import { FitAddon } from "./vendor/addon-fit.mjs";
import { createBridge } from "./bridge.js";
import {
  clampPaneCount,
  createPendingWorkspaceDraft,
  deriveLayoutForPaneCount,
  formatLauncherCompletionMatches,
  launcherStageSignature,
  renderEmptyState,
  renderLayoutPicker,
} from "./launcher.js";
import { renderActivityRail } from "./activity-rail.js";
import { createRuntimeStore, createUiState } from "./store.js";
import {
  buildWorkspaceTabLabels,
  renderWorkspaceStrip,
} from "./workspace-strip.js";

const MAX_PENDING_TERMINAL_BYTES = 4 * 1024 * 1024;
const MAX_RUNTIME_ACTIVITY_ITEMS = 80;
const MAX_WORKSPACE_ATTENTION_COUNT = 99;
const LAUNCHER_CARD_TRANSITION_MS = 360;
const GIT_REFRESH_INTERVAL_MS = 3000;
const DEFAULT_THEME_ID = "one-dark";
const DEFAULT_INTERFACE_TEXT_SCALE = 1;
const MIN_INTERFACE_TEXT_SCALE = 0.85;
const MAX_INTERFACE_TEXT_SCALE = 1.2;
const DEFAULT_TERMINAL_FONT_SIZE = 13.5;
const MIN_TERMINAL_FONT_SIZE = 11;
const MAX_TERMINAL_FONT_SIZE = 18;
const COMPACT_PANE_HEIGHT = 420;
const LAUNCHER_COMMANDS = Object.freeze(["help", "pwd", "ls", "cd", "open", "clear"]);
const PATH_AWARE_LAUNCHER_COMMANDS = new Set(["ls", "cd", "open"]);

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
const bridge = createBridge({
  defaultThemeId: DEFAULT_THEME_ID,
  themeRegistry: THEME_REGISTRY,
  normalizeDialogPath,
  deriveLayoutForPaneCount,
  buildBalancedPaneLayout,
  splitPaneLayout,
  removePaneLayout,
  relabelMockPanes,
  completeMockLauncherInput,
  resolveMockNavigationPath,
  mockListDirectory,
});

const uiState = createUiState();
const runtimeStore = createRuntimeStore();
const {
  paneTerminals,
  pendingTerminalData,
  workspacePaneIds,
  workspaceScreens,
  terminalViewportLines,
} = runtimeStore;

void init();

async function init() {
  document.body.dataset.platform = detectPlatform();
  uiState.snapshot = await bridge.getAppSnapshot();
  hydrateRuntimeActivityFromSnapshot(uiState.snapshot);
  applySnapshotSettings(uiState.snapshot);

  if (bridge.listenState) {
    await bridge.listenState((snapshot) => {
      uiState.snapshot = snapshot;
      applySnapshotSettings(snapshot);
      render();
    });
  }

  if (bridge.listenTerminalData) {
    await bridge.listenTerminalData((payload) => {
      appendTerminalData(payload.paneId, payload.data);
    });
  }

  if (bridge.listenRuntimeEvents) {
    await bridge.listenRuntimeEvents((event) => {
      const handledSourceControl = handleSourceControlRuntimeEvent(event);
      recordRuntimeEvent(event);
      render();
      if (
        handledSourceControl
        && event?.kind === "gitTaskSnapshot"
        && event?.task?.status
        && event.task.status !== "running"
      ) {
        void loadActiveWorkspaceSourceControl({ force: true });
      }
    });
  }

  if (bridge.listenDragDrop) {
    await bridge.listenDragDrop((payload) => {
      void handleNativeDragDrop(payload).catch((error) => console.error(error));
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

function getActiveWorkspace() {
  return uiState.snapshot?.activeWorkspace || null;
}

function resolveActivePaneId(workspace = getActiveWorkspace()) {
  if (!workspace?.panes?.length) {
    return null;
  }

  if (workspace.panes.some((pane) => pane.id === uiState.activePaneId)) {
    return uiState.activePaneId;
  }

  return workspace.panes[0].id;
}

function syncActivePaneId(workspace = getActiveWorkspace()) {
  uiState.activePaneId = resolveActivePaneId(workspace);
  syncActivePaneSelection(workspace, uiState.activePaneId);
  return uiState.activePaneId;
}

function setActivePaneId(paneId, workspace = getActiveWorkspace()) {
  if (!paneId || !workspace?.panes?.some((pane) => pane.id === paneId)) {
    return syncActivePaneId(workspace);
  }

  uiState.activePaneId = paneId;
  syncActivePaneSelection(workspace, paneId);
  return paneId;
}

function syncActivePaneSelection(workspace = getActiveWorkspace(), activePaneId = resolveActivePaneId(workspace)) {
  const resolvedPaneId = workspace?.panes?.some((pane) => pane.id === activePaneId)
    ? activePaneId
    : null;

  for (const paneElement of document.querySelectorAll("[data-pane-id]")) {
    paneElement.dataset.active = paneElement.dataset.paneId === resolvedPaneId ? "true" : "false";
  }
}

function focusPaneTerminal(paneId) {
  if (!paneId) {
    return;
  }

  requestAnimationFrame(() => {
    paneTerminals.get(paneId)?.terminal.focus();
  });
}

function normalizeDropPosition(position) {
  if (!position) {
    return null;
  }

  const scaleFactor = window.devicePixelRatio || 1;
  const logicalPosition = typeof position.toLogical === "function"
    ? position.toLogical(scaleFactor)
    : position;
  const x = Number(logicalPosition?.x);
  const y = Number(logicalPosition?.y);

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return { x, y };
}

function resolvePaneIdFromDropPosition(position) {
  const logicalPosition = normalizeDropPosition(position);
  if (!logicalPosition) {
    return null;
  }

  const element = document.elementFromPoint(logicalPosition.x, logicalPosition.y);
  return element?.closest?.("[data-pane-id]")?.dataset?.paneId || null;
}

function normalizeDroppedPaths(paths) {
  return Array.from(
    new Set(
      (Array.isArray(paths) ? paths : []).filter(
        (path) => typeof path === "string" && path.trim().length > 0,
      ),
    ),
  );
}

function quoteShellPath(path) {
  return `'${String(path).replaceAll("'", "'\\''")}'`;
}

function formatDroppedPathsForShell(paths) {
  return `${paths.map(quoteShellPath).join(" ")} `;
}

async function handleNativeDragDrop(payload) {
  if (!payload || payload.type !== "drop") {
    return;
  }

  const workspace = getActiveWorkspace();
  const paths = normalizeDroppedPaths(payload.paths);
  if (!workspace || paths.length === 0) {
    return;
  }

  const paneId = resolvePaneIdFromDropPosition(payload.position) || resolveActivePaneId(workspace);
  if (!paneId) {
    return;
  }

  setActivePaneId(paneId, workspace);
  await bridge.writeToPane(paneId, formatDroppedPathsForShell(paths));
  paneTerminals.get(paneId)?.terminal.focus();
}

function normalizeSettingsSection(section) {
  return section === "guide" ? "guide" : "workbench";
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

function normalizeInterfaceTextScale(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return DEFAULT_INTERFACE_TEXT_SCALE;
  }

  return Math.min(MAX_INTERFACE_TEXT_SCALE, Math.max(MIN_INTERFACE_TEXT_SCALE, numericValue));
}

function normalizeTerminalFontSize(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return DEFAULT_TERMINAL_FONT_SIZE;
  }

  return Math.min(MAX_TERMINAL_FONT_SIZE, Math.max(MIN_TERMINAL_FONT_SIZE, numericValue));
}

function getInterfaceTextScale(snapshot = uiState.snapshot) {
  return normalizeInterfaceTextScale(snapshot?.settings?.interfaceTextScale);
}

function getTerminalFontSize(snapshot = uiState.snapshot) {
  return normalizeTerminalFontSize(snapshot?.settings?.terminalFontSize);
}

function hasStoredOpenAiApiKey(snapshot = uiState.snapshot) {
  return Boolean(snapshot?.settings?.hasStoredOpenAiApiKey);
}

function hasEnvironmentOpenAiApiKey(snapshot = uiState.snapshot) {
  return Boolean(snapshot?.settings?.hasEnvironmentOpenAiApiKey);
}

function createSettingsDraft(snapshot = uiState.snapshot) {
  return {
    themeId: getActiveThemeId(snapshot),
    interfaceTextScale: getInterfaceTextScale(snapshot),
    terminalFontSize: getTerminalFontSize(snapshot),
    openAiApiKey: "",
    hasStoredOpenAiApiKey: hasStoredOpenAiApiKey(snapshot),
    hasEnvironmentOpenAiApiKey: hasEnvironmentOpenAiApiKey(snapshot),
    savingOpenAiApiKey: false,
    applyingAppearance: false,
  };
}

function syncSettingsDraftFromSnapshot(snapshot = uiState.snapshot) {
  uiState.settingsDraft = createSettingsDraft(snapshot);
  return uiState.settingsDraft;
}

function getDraftThemeId(snapshot = uiState.snapshot) {
  return normalizeThemeId(uiState.settingsDraft?.themeId ?? snapshot?.settings?.themeId);
}

function getDraftInterfaceTextScale(snapshot = uiState.snapshot) {
  return normalizeInterfaceTextScale(
    uiState.settingsDraft?.interfaceTextScale ?? snapshot?.settings?.interfaceTextScale,
  );
}

function getDraftTerminalFontSize(snapshot = uiState.snapshot) {
  return normalizeTerminalFontSize(
    uiState.settingsDraft?.terminalFontSize ?? snapshot?.settings?.terminalFontSize,
  );
}

function getDraftOpenAiApiKey() {
  return uiState.settingsDraft?.openAiApiKey ?? "";
}

function getDraftHasStoredOpenAiApiKey(snapshot = uiState.snapshot) {
  return Boolean(
    uiState.settingsDraft?.hasStoredOpenAiApiKey ?? hasStoredOpenAiApiKey(snapshot),
  );
}

function getDraftHasEnvironmentOpenAiApiKey(snapshot = uiState.snapshot) {
  return Boolean(
    uiState.settingsDraft?.hasEnvironmentOpenAiApiKey ?? hasEnvironmentOpenAiApiKey(snapshot),
  );
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
}

function applyInterfaceTextScale(interfaceTextScale) {
  const root = document.documentElement;
  root.style.setProperty("--ui-text-scale", String(interfaceTextScale));
}

function applySettingsAppearance(themeId, interfaceTextScale, terminalFontSize) {
  applyActiveTheme(themeId);
  applyInterfaceTextScale(interfaceTextScale);

  if (
    uiState.appliedThemeId !== themeId
    || uiState.appliedTerminalFontSize !== terminalFontSize
  ) {
    syncMountedTerminalAppearance(getThemeDefinition(themeId), terminalFontSize);
    uiState.appliedThemeId = themeId;
    uiState.appliedTerminalFontSize = terminalFontSize;
  }

  uiState.appliedInterfaceTextScale = interfaceTextScale;
}

function applySnapshotSettings(snapshot = uiState.snapshot) {
  applySettingsAppearance(
    getActiveThemeId(snapshot),
    getInterfaceTextScale(snapshot),
    getTerminalFontSize(snapshot),
  );
}

function applyRenderedSettings(snapshot = uiState.snapshot) {
  const useDraft = uiState.settingsVisible && uiState.settingsDraft;
  applySettingsAppearance(
    useDraft ? getDraftThemeId(snapshot) : getActiveThemeId(snapshot),
    useDraft ? getDraftInterfaceTextScale(snapshot) : getInterfaceTextScale(snapshot),
    getTerminalFontSize(snapshot),
  );
}

function clearSettingsDraft({ restoreSnapshot = false } = {}) {
  uiState.settingsDraft = null;
  if (restoreSnapshot) {
    applySnapshotSettings(uiState.snapshot);
  }
}

function hideSettingsSheet({ restoreSnapshot = true } = {}) {
  if (!uiState.settingsVisible && !uiState.settingsDraft) {
    return;
  }

  uiState.settingsVisible = false;
  clearSettingsDraft({ restoreSnapshot });
}

function closeSettingsSheet({ restoreSnapshot = true } = {}) {
  if (uiState.settingsDraft?.applyingAppearance) {
    return;
  }

  hideSettingsSheet({ restoreSnapshot });
  render();
}

function hasSettingsAppearanceChanges(snapshot = uiState.snapshot) {
  if (!uiState.settingsDraft) {
    return false;
  }

  return (
    getDraftThemeId(snapshot) !== getActiveThemeId(snapshot)
    || getDraftInterfaceTextScale(snapshot) !== getInterfaceTextScale(snapshot)
    || getDraftTerminalFontSize(snapshot) !== getTerminalFontSize(snapshot)
  );
}

function syncSettingsActionDom(root = document) {
  const sheet = root.querySelector(".settings-sheet");
  if (!(sheet instanceof HTMLElement) || !uiState.settingsVisible || !uiState.settingsDraft) {
    return;
  }

  const isApplying = Boolean(uiState.settingsDraft.applyingAppearance);
  const hasChanges = hasSettingsAppearanceChanges();
  const applyButton = sheet.querySelector("[data-settings-apply]");
  if (applyButton instanceof HTMLButtonElement) {
    applyButton.disabled = isApplying || !hasChanges;
    applyButton.textContent = isApplying ? "Applying..." : "Apply changes";
  }

  const closeButtons = sheet.querySelectorAll("[data-settings-close]");
  for (const button of closeButtons) {
    if (button instanceof HTMLButtonElement) {
      button.disabled = isApplying;
    }
  }
}

function previewTheme(themeId) {
  if (!uiState.settingsVisible) {
    return;
  }

  if (!uiState.settingsDraft) {
    syncSettingsDraftFromSnapshot();
  }

  uiState.settingsDraft.themeId = normalizeThemeId(themeId);
  render();
}

function formatInterfaceTextScaleLabel(value) {
  return `${Math.round(normalizeInterfaceTextScale(value) * 100)}%`;
}

function formatTerminalFontSizeLabel(value) {
  return `${formatSettingNumber(normalizeTerminalFontSize(value))}px`;
}

function calculateRangeProgress(value, min, max) {
  if (!(max > min)) {
    return 0;
  }

  const progress = ((value - min) / (max - min)) * 100;
  return Math.min(100, Math.max(0, progress));
}

function syncSettingsPreviewDom(root = document) {
  const sheet = root.querySelector(".settings-sheet");
  if (!(sheet instanceof HTMLElement) || !uiState.settingsVisible || !uiState.settingsDraft) {
    return;
  }

  const interfaceTextScale = getDraftInterfaceTextScale();
  const terminalFontSize = getDraftTerminalFontSize();

  const interfaceValue = sheet.querySelector("[data-settings-interface-value]");
  if (interfaceValue) {
    interfaceValue.textContent = formatInterfaceTextScaleLabel(interfaceTextScale);
  }

  const terminalValue = sheet.querySelector("[data-settings-terminal-value]");
  if (terminalValue) {
    terminalValue.textContent = formatTerminalFontSizeLabel(terminalFontSize);
  }

  const interfaceRangeShell = sheet.querySelector("[data-settings-interface-range-shell]");
  if (interfaceRangeShell instanceof HTMLElement) {
    interfaceRangeShell.style.setProperty(
      "--settings-adjustment-progress",
      `${calculateRangeProgress(interfaceTextScale, MIN_INTERFACE_TEXT_SCALE, MAX_INTERFACE_TEXT_SCALE)}%`,
    );
  }
  const interfaceRange = sheet.querySelector("[data-settings-interface-range]");
  if (interfaceRange instanceof HTMLElement) {
    interfaceRange.style.setProperty(
      "--settings-adjustment-progress",
      `${calculateRangeProgress(interfaceTextScale, MIN_INTERFACE_TEXT_SCALE, MAX_INTERFACE_TEXT_SCALE)}%`,
    );
  }

  const terminalRangeShell = sheet.querySelector("[data-settings-terminal-range-shell]");
  if (terminalRangeShell instanceof HTMLElement) {
    terminalRangeShell.style.setProperty(
      "--settings-adjustment-progress",
      `${calculateRangeProgress(terminalFontSize, MIN_TERMINAL_FONT_SIZE, MAX_TERMINAL_FONT_SIZE)}%`,
    );
  }
  const terminalRange = sheet.querySelector("[data-settings-terminal-range]");
  if (terminalRange instanceof HTMLElement) {
    terminalRange.style.setProperty(
      "--settings-adjustment-progress",
      `${calculateRangeProgress(terminalFontSize, MIN_TERMINAL_FONT_SIZE, MAX_TERMINAL_FONT_SIZE)}%`,
    );
  }

  const interfacePreview = sheet.querySelector("[data-settings-interface-preview]");
  if (interfacePreview instanceof HTMLElement) {
    interfacePreview.style.fontSize = `${0.82 * interfaceTextScale}rem`;
    interfacePreview.style.setProperty(
      "--settings-preview-interface-scale",
      String(interfaceTextScale),
    );
  }

  const terminalPreview = sheet.querySelector("[data-settings-terminal-preview]");
  if (terminalPreview instanceof HTMLElement) {
    terminalPreview.style.fontSize = `${terminalFontSize}px`;
    terminalPreview.style.setProperty(
      "--settings-preview-terminal-size",
      String(terminalFontSize),
    );
  }
}

function previewInterfaceTextScale(value) {
  if (!uiState.settingsVisible) {
    return;
  }

  if (!uiState.settingsDraft) {
    syncSettingsDraftFromSnapshot();
  }

  uiState.settingsDraft.interfaceTextScale = normalizeInterfaceTextScale(value);
  applyRenderedSettings(uiState.snapshot);
  syncSettingsPreviewDom(document);
  syncSettingsActionDom(document);
}

function previewTerminalFontSize(value) {
  if (!uiState.settingsVisible) {
    return;
  }

  if (!uiState.settingsDraft) {
    syncSettingsDraftFromSnapshot();
  }

  uiState.settingsDraft.terminalFontSize = normalizeTerminalFontSize(value);
  syncSettingsPreviewDom(document);
  syncSettingsActionDom(document);
}

async function applySettingsDraft() {
  if (!uiState.settingsVisible) {
    return;
  }

  if (!uiState.settingsDraft) {
    syncSettingsDraftFromSnapshot();
  }

  if (!hasSettingsAppearanceChanges(uiState.snapshot)) {
    return;
  }

  uiState.settingsDraft.applyingAppearance = true;
  syncSettingsActionDom(document);

  try {
    if (bridge.setSettings) {
      uiState.snapshot = await bridge.setSettings(
        getDraftThemeId(uiState.snapshot),
        getDraftInterfaceTextScale(uiState.snapshot),
        getDraftTerminalFontSize(uiState.snapshot),
      );
    } else {
      if (getDraftThemeId(uiState.snapshot) !== getActiveThemeId(uiState.snapshot)) {
        uiState.snapshot = await bridge.setTheme(getDraftThemeId(uiState.snapshot));
      }
      if (getDraftInterfaceTextScale(uiState.snapshot) !== getInterfaceTextScale(uiState.snapshot)) {
        uiState.snapshot = await bridge.setInterfaceTextScale(getDraftInterfaceTextScale(uiState.snapshot));
      }
      if (getDraftTerminalFontSize(uiState.snapshot) !== getTerminalFontSize(uiState.snapshot)) {
        uiState.snapshot = await bridge.setTerminalFontSize(getDraftTerminalFontSize(uiState.snapshot));
      }
    }

    syncSettingsDraftFromSnapshot(uiState.snapshot);
    applySnapshotSettings(uiState.snapshot);
  } catch (error) {
    reportSourceControlError(error);
  } finally {
    if (uiState.settingsDraft) {
      uiState.settingsDraft.applyingAppearance = false;
    }
    render();
  }
}

async function commitOpenAiApiKey() {
  if (!bridge.setOpenAiApiKey || !uiState.settingsVisible) {
    return;
  }

  if (!uiState.settingsDraft) {
    syncSettingsDraftFromSnapshot();
  }

  const nextKey = getDraftOpenAiApiKey().trim();
  if (!nextKey) {
    window.alert("Paste an OpenAI API key first, or use Remove to clear the stored one.");
    return;
  }

  uiState.settingsDraft.savingOpenAiApiKey = true;
  render();

  try {
    uiState.snapshot = await bridge.setOpenAiApiKey(nextKey);
    syncSettingsDraftFromSnapshot(uiState.snapshot);
    applySnapshotSettings(uiState.snapshot);
  } catch (error) {
    reportSourceControlError(error);
  } finally {
    if (uiState.settingsDraft) {
      uiState.settingsDraft.savingOpenAiApiKey = false;
    }
    render();
  }
}

async function clearStoredOpenAiApiKey() {
  if (!bridge.setOpenAiApiKey || !uiState.settingsVisible) {
    return;
  }

  const hasStoredKey = getDraftHasStoredOpenAiApiKey();
  if (!hasStoredKey) {
    if (uiState.settingsDraft) {
      uiState.settingsDraft.openAiApiKey = "";
    }
    render();
    return;
  }

  if (!window.confirm("Remove the stored OpenAI API key from CrewDock settings?")) {
    return;
  }

  if (!uiState.settingsDraft) {
    syncSettingsDraftFromSnapshot();
  }

  uiState.settingsDraft.savingOpenAiApiKey = true;
  render();

  try {
    uiState.snapshot = await bridge.setOpenAiApiKey(null);
    syncSettingsDraftFromSnapshot(uiState.snapshot);
    applySnapshotSettings(uiState.snapshot);
  } catch (error) {
    reportSourceControlError(error);
  } finally {
    if (uiState.settingsDraft) {
      uiState.settingsDraft.savingOpenAiApiKey = false;
    }
    render();
  }
}

function bindSettingsSheetControls(root = document) {
  const settingsBackdrop = root.querySelector(".settings-sheet-backdrop");
  if (settingsBackdrop instanceof HTMLElement) {
    settingsBackdrop.addEventListener("click", (event) => {
      if (event.target !== settingsBackdrop) {
        return;
      }

      event.preventDefault();
      closeSettingsSheet();
    });
  }

  const settingsCloseButton = root.querySelector(".settings-sheet-close");
  if (settingsCloseButton instanceof HTMLButtonElement) {
    settingsCloseButton.type = "button";
    settingsCloseButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeSettingsSheet();
    });
  }

  const interfaceRange = root.querySelector("[data-settings-interface-range]");
  if (interfaceRange instanceof HTMLInputElement) {
    interfaceRange.addEventListener("input", (event) => {
      event.stopPropagation();
      previewInterfaceTextScale(interfaceRange.value);
    });
  }

  const terminalRange = root.querySelector("[data-settings-terminal-range]");
  if (terminalRange instanceof HTMLInputElement) {
    terminalRange.addEventListener("input", (event) => {
      event.stopPropagation();
      previewTerminalFontSize(terminalRange.value);
    });
  }

  const openAiInput = root.querySelector("[data-settings-openai-api-key-input]");
  if (openAiInput instanceof HTMLInputElement) {
    openAiInput.addEventListener("input", (event) => {
      event.stopPropagation();
      if (!uiState.settingsDraft) {
        syncSettingsDraftFromSnapshot();
      }
      uiState.settingsDraft.openAiApiKey = openAiInput.value;
    });
    openAiInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      void commitOpenAiApiKey();
    });
  }

  const openAiSaveButton = root.querySelector("[data-settings-openai-save]");
  if (openAiSaveButton instanceof HTMLButtonElement) {
    openAiSaveButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void commitOpenAiApiKey();
    });
  }

  const openAiClearButton = root.querySelector("[data-settings-openai-clear]");
  if (openAiClearButton instanceof HTMLButtonElement) {
    openAiClearButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void clearStoredOpenAiApiKey();
    });
  }
}

function bindModalLayerControls(root = document) {
  if (!(root instanceof HTMLElement) || root.dataset.modalLayerBound === "true") {
    return;
  }

  root.dataset.modalLayerBound = "true";
  root.addEventListener("click", (event) => {
    const clickedElement = event.target instanceof Element ? event.target : null;
    if (!clickedElement) {
      return;
    }

    const settingsCloseButton = clickedElement.closest(".settings-sheet-close");
    if (settingsCloseButton) {
      event.preventDefault();
      event.stopPropagation();
      closeSettingsSheet();
      return;
    }

    if (clickedElement.classList.contains("settings-sheet-backdrop")) {
      event.preventDefault();
      event.stopPropagation();
      closeSettingsSheet();
      return;
    }

    const gitCloseButton = clickedElement.closest('.workspace-git-panel-button[data-action="close-git-panel"]');
    if (gitCloseButton) {
      event.preventDefault();
      event.stopPropagation();
      uiState.gitPanelVisible = false;
      render();
      return;
    }

    if (clickedElement.classList.contains("workspace-git-backdrop")) {
      event.preventDefault();
      event.stopPropagation();
      uiState.gitPanelVisible = false;
      render();
      return;
    }

    const quickSwitcherCloseButton = clickedElement.closest(".workspace-quick-switcher-close");
    if (quickSwitcherCloseButton) {
      event.preventDefault();
      event.stopPropagation();
      closeQuickSwitcher();
      render();
      return;
    }

    if (clickedElement.classList.contains("workspace-quick-switcher-backdrop")) {
      event.preventDefault();
      event.stopPropagation();
      closeQuickSwitcher();
      render();
    }
  });
}

function syncMountedTerminalAppearance(
  theme = getCurrentThemeDefinition(),
  terminalFontSize = getTerminalFontSize(),
) {
  for (const [paneId, state] of paneTerminals.entries()) {
    let shouldRefit = false;
    let shouldRefresh = false;
    if (state.themeId !== theme.id) {
      state.terminal.setOption("theme", { ...theme.terminalTheme });
      state.themeId = theme.id;
      shouldRefresh = true;
    }
    if (state.fontSize !== terminalFontSize) {
      state.terminal.setOption("fontSize", terminalFontSize);
      state.fontSize = terminalFontSize;
      shouldRefit = true;
      shouldRefresh = true;
    }
    if (shouldRefit || shouldRefresh) {
      requestAnimationFrame(() => {
        if (shouldRefit) {
          state.fitAddon.fit();
          state.size = { cols: 0, rows: 0 };
          fitTerminal(paneId);
        }
        if (shouldRefresh) {
          state.terminal.clearTextureAtlas();
          state.terminal.refresh(0, Math.max(0, state.terminal.rows - 1));
        }
      });
    }
  }
}

async function handleClick(event) {
  const clickedElement = event.target instanceof Element ? event.target : null;
  const target = clickedElement?.closest("[data-action]");
  if (!target) {
    return;
  }

  if (
    target.dataset.action === "close-settings"
    && target.classList.contains("settings-sheet-backdrop")
    && clickedElement?.closest(".settings-sheet")
  ) {
    return;
  }

  if (
    target.dataset.action === "close-git-panel"
    && target.classList.contains("workspace-git-backdrop")
    && clickedElement?.closest(".workspace-git-panel")
  ) {
    return;
  }

  if (
    target.dataset.action === "close-quick-switcher"
    && target.classList.contains("workspace-quick-switcher-backdrop")
    && clickedElement?.closest(".workspace-quick-switcher")
  ) {
    return;
  }

  if (target.closest(".terminal-context-menu")) {
    await handleContextMenuAction(target);
    return;
  }

  if (target.dataset.action?.startsWith("scm-")) {
    await handleSourceControlAction(target);
    return;
  }

  if (target.dataset.action === "show-settings") {
    uiState.settingsVisible = true;
    uiState.settingsSection = "workbench";
    uiState.gitPanelVisible = false;
    uiState.activityRailVisible = false;
    closeQuickSwitcher();
    uiState.pendingWorkspaceDraft = null;
    uiState.contextMenu = null;
    render();
    return;
  }

  if (target.dataset.action === "close-settings") {
    closeSettingsSheet();
    return;
  }

  if (target.dataset.action === "show-settings-section") {
    const nextSection = normalizeSettingsSection(target.dataset.settingsSection);
    if (uiState.settingsSection !== nextSection) {
      uiState.settingsSection = nextSection;
      render();
    }
    return;
  }

  if (target.dataset.action === "show-launcher") {
    uiState.launcherVisible = true;
    hideSettingsSheet();
    uiState.gitPanelVisible = false;
    uiState.activityRailVisible = false;
    closeQuickSwitcher();
    uiState.pendingWorkspaceDraft = null;
    uiState.contextMenu = null;
    uiState.maximizedPaneId = null;
    render();
    return;
  }

  if (target.dataset.action === "show-git-panel") {
    await openSourceControlPanel({ force: true });
    return;
  }

  if (target.dataset.action === "toggle-activity-rail") {
    toggleActivityRail();
    render();
    return;
  }

  if (target.dataset.action === "close-activity-rail") {
    uiState.activityRailVisible = false;
    render();
    return;
  }

  if (target.dataset.action === "set-activity-scope") {
    const nextScope = normalizeActivityScope(target.dataset.activityScope, uiState.snapshot);
    if (uiState.activityRailScope !== nextScope) {
      uiState.activityRailScope = nextScope;
      render();
    }
    return;
  }

  if (target.dataset.action === "mark-all-activity-seen") {
    if (clearAllActivityAttention()) {
      render();
    }
    return;
  }

  if (target.dataset.action === "jump-to-activity-workspace") {
    const workspaceId = target.dataset.workspaceId;
    if (!workspaceId) {
      return;
    }

    if (workspaceId === uiState.snapshot?.activeWorkspaceId) {
      markWorkspaceAttentionSeen(workspaceId);
    } else {
      await activateWorkspace(workspaceId);
    }

    uiState.activityRailVisible = false;
    render();
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
    if (uiState.gitPanelVisible) {
      await loadActiveWorkspaceSourceControl({ force: true });
    }
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
    hideSettingsSheet();
    uiState.gitPanelVisible = false;
    uiState.activityRailVisible = false;
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
    if (!themeId) {
      return;
    }

    if (uiState.settingsVisible) {
      if (normalizeThemeId(themeId) === getDraftThemeId()) {
        return;
      }

      previewTheme(themeId);
      return;
    }

    if (themeId === getActiveThemeId()) {
      return;
    }

    uiState.snapshot = await bridge.setTheme(themeId);
    applySnapshotSettings(uiState.snapshot);
    render();
    return;
  }

  if (target.dataset.action === "apply-settings") {
    await applySettingsDraft();
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
    hideSettingsSheet();
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
      hideSettingsSheet();
      markWorkspaceAttentionSeen(workspaceId || null);
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
    uiState.runtimeAttentionByWorkspace.delete(workspaceId);
    uiState.runtimeActivity = uiState.runtimeActivity.filter((entry) => entry.workspaceId !== workspaceId);

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

  setActivePaneId(paneId);
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
  const paneId = event.target instanceof Element
    ? event.target.closest("[data-pane-id]")?.dataset?.paneId || null
    : null;
  if (paneId) {
    setActivePaneId(paneId);
  }

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
  const activeWorkspaceId = uiState.snapshot?.activeWorkspaceId || null;
  const didClearAttention = markWorkspaceAttentionSeen(activeWorkspaceId);
  if (didClearAttention && activeWorkspaceId) {
    render();
  }
  scheduleVisibleTerminalRefresh();
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

  const sourceControlForm = event.target.closest("[data-action]");
  if (sourceControlForm?.dataset.action === "scm-create-branch") {
    event.preventDefault();
    await submitSourceControlCreateBranch();
    return;
  }

  if (sourceControlForm?.dataset.action === "scm-task-input") {
    event.preventDefault();
    await submitSourceControlTaskInput();
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
  const commitInput = event.target.closest("[data-scm-commit-input]");
  if (commitInput) {
    uiState.sourceControl.commitMessage = commitInput.value;
    return;
  }

  const branchSearchInput = event.target.closest("[data-scm-branch-search]");
  if (branchSearchInput) {
    uiState.sourceControl.branchSearch = branchSearchInput.value;
    render();
    return;
  }

  const createBranchNameInput = event.target.closest("[data-scm-create-branch-name]");
  if (createBranchNameInput) {
    uiState.sourceControl.createBranchName = createBranchNameInput.value;
    return;
  }

  const createBranchStartInput = event.target.closest("[data-scm-create-branch-start]");
  if (createBranchStartInput) {
    uiState.sourceControl.createBranchStartPoint = createBranchStartInput.value;
    return;
  }

  const taskInput = event.target.closest("[data-scm-task-input-value]");
  if (taskInput) {
    uiState.sourceControl.taskInput = taskInput.value;
    return;
  }

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

async function handleChange(event) {
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
    uiState.settingsSection = "workbench";
    uiState.gitPanelVisible = false;
    uiState.activityRailVisible = false;
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

  if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "a") {
    event.preventDefault();
    toggleActivityRail();
    render();
    return;
  }

  if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "g") {
    event.preventDefault();
    if (uiState.gitPanelVisible) {
      uiState.gitPanelVisible = false;
    } else {
      await openSourceControlPanel({ force: true });
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
    closeSettingsSheet();
    return;
  }

  if (uiState.gitPanelVisible && event.key === "Escape") {
    event.preventDefault();
    uiState.gitPanelVisible = false;
    render();
    return;
  }

  const commitInput = event.target.closest("[data-scm-commit-input]");
  if (
    commitInput
    && (event.metaKey || event.ctrlKey)
    && !event.shiftKey
    && event.key === "Enter"
  ) {
    event.preventDefault();
    await submitSourceControlCommit({ commitAll: false });
    return;
  }

  if (uiState.activityRailVisible && event.key === "Escape") {
    event.preventDefault();
    uiState.activityRailVisible = false;
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
    return;
  }

  if (
    uiState.quickSwitcherVisible
    || uiState.settingsVisible
    || uiState.gitPanelVisible
    || uiState.pendingWorkspaceDraft
  ) {
    return;
  }

  const workspace = getActiveWorkspace();
  const activePaneId = resolveActivePaneId(workspace);
  if (!workspace || !activePaneId || !(event.metaKey || event.ctrlKey) || event.altKey) {
    return;
  }

  if (event.key.toLowerCase() === "d") {
    event.preventDefault();
    const focusPaneId = await runPaneAction("context-split-pane", activePaneId, {
      direction: event.shiftKey ? "down" : "right",
    });
    render();
    focusPaneTerminal(focusPaneId);
    return;
  }

  if (!event.shiftKey && event.key.toLowerCase() === "w") {
    event.preventDefault();
    const focusPaneId = await runPaneAction("context-close-pane", activePaneId);
    render();
    focusPaneTerminal(focusPaneId);
    return;
  }

  if (event.shiftKey && event.key === "Enter") {
    event.preventDefault();
    const focusPaneId = await runPaneAction("context-maximize-pane", activePaneId);
    render();
    focusPaneTerminal(focusPaneId);
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

  const keepSourceControlOpen = uiState.gitPanelVisible;

  if (workspaceId !== uiState.snapshot?.activeWorkspaceId) {
    uiState.snapshot = await bridge.switchWorkspace(workspaceId);
  }

  uiState.launcherVisible = false;
  hideSettingsSheet();
  uiState.gitPanelVisible = keepSourceControlOpen;
  uiState.pendingWorkspaceDraft = null;
  uiState.contextMenu = null;
  markWorkspaceAttentionSeen(workspaceId);
  closeQuickSwitcher();
  if (keepSourceControlOpen) {
    resetSourceControlState();
    void loadActiveWorkspaceSourceControl({ force: true });
  }
  void refreshActiveWorkspaceGitStatus({ force: true });
}

function openQuickSwitcher() {
  if (!uiState.snapshot?.workspaces?.length) {
    return;
  }

  uiState.quickSwitcherVisible = true;
  uiState.launcherVisible = false;
  uiState.activityRailVisible = false;
  uiState.quickSwitcherQuery = "";
  uiState.quickSwitcherCursor = Math.max(
    0,
    uiState.snapshot.workspaces.findIndex((workspace) => workspace.id === uiState.snapshot?.activeWorkspaceId),
  );
  uiState.quickSwitcherShouldFocus = true;
  hideSettingsSheet();
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

function captureSourceControlFocusState(root = document) {
  const activeElement = document.activeElement;
  if (!(activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement)) {
    return null;
  }

  if (!root.contains(activeElement) || !activeElement.closest(".workspace-git-panel")) {
    return null;
  }

  const selector = [
    "[data-scm-commit-input]",
    "[data-scm-branch-search]",
    "[data-scm-create-branch-name]",
    "[data-scm-create-branch-start]",
    "[data-scm-task-input-value]",
  ].find((candidate) => activeElement.matches(candidate));

  if (!selector) {
    return null;
  }

  return {
    selector,
    selectionStart: typeof activeElement.selectionStart === "number" ? activeElement.selectionStart : null,
    selectionEnd: typeof activeElement.selectionEnd === "number" ? activeElement.selectionEnd : null,
    scrollTop: "scrollTop" in activeElement ? activeElement.scrollTop : null,
  };
}

function captureSourceControlScrollState(root = document) {
  const panel = root.querySelector(".workspace-git-panel");
  if (!(panel instanceof HTMLElement)) {
    return [];
  }

  const selectors = [
    ".workspace-git-panel-body",
    ".workspace-scm-column-list",
    ".workspace-scm-column-detail",
    ".workspace-scm-diff",
    ".workspace-scm-task-output",
    ".workspace-scm-commit-body",
  ];

  return selectors.flatMap((selector) => Array
    .from(panel.querySelectorAll(selector))
    .map((element, index) => {
      if (!(element instanceof HTMLElement)) {
        return null;
      }

      return {
        selector,
        index,
        scrollTop: element.scrollTop,
        scrollLeft: element.scrollLeft,
      };
    })
    .filter(Boolean));
}

function restoreSourceControlFocusState(state, root = document) {
  if (!state?.selector) {
    return;
  }

  const input = root.querySelector(state.selector);
  if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) {
    return;
  }

  input.focus({ preventScroll: true });

  if (
    typeof state.selectionStart === "number"
    && typeof state.selectionEnd === "number"
    && typeof input.setSelectionRange === "function"
  ) {
    try {
      input.setSelectionRange(state.selectionStart, state.selectionEnd);
    } catch (error) {
      console.error(error);
    }
  }

  if (typeof state.scrollTop === "number" && "scrollTop" in input) {
    input.scrollTop = state.scrollTop;
  }
}

function restoreSourceControlScrollState(states, root = document) {
  if (!Array.isArray(states) || states.length === 0) {
    return;
  }

  const panel = root.querySelector(".workspace-git-panel");
  if (!(panel instanceof HTMLElement)) {
    return;
  }

  for (const state of states) {
    if (!state?.selector) {
      continue;
    }

    const element = panel.querySelectorAll(state.selector)[state.index];
    if (!(element instanceof HTMLElement)) {
      continue;
    }

    if (typeof state.scrollTop === "number") {
      element.scrollTop = state.scrollTop;
    }
    if (typeof state.scrollLeft === "number") {
      element.scrollLeft = state.scrollLeft;
    }
  }
}

function isSourceControlTextEntryActive() {
  const activeElement = document.activeElement;
  return Boolean(
    activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement
      ? activeElement.matches(
          [
            "[data-scm-commit-input]",
            "[data-scm-branch-search]",
            "[data-scm-create-branch-name]",
            "[data-scm-create-branch-start]",
            "[data-scm-task-input-value]",
          ].join(","),
        )
      : false,
  );
}

async function openSourceControlPanel({ force = false } = {}) {
  if (!uiState.snapshot?.activeWorkspaceId) {
    return;
  }

  const workspaceId = uiState.snapshot.activeWorkspaceId;
  const alreadyLoaded = uiState.sourceControl.lastLoadedWorkspaceId === workspaceId
    && uiState.sourceControl.snapshot;

  uiState.gitPanelVisible = true;
  hideSettingsSheet();
  uiState.activityRailVisible = false;
  closeQuickSwitcher();
  uiState.pendingWorkspaceDraft = null;
  uiState.contextMenu = null;
  if (!alreadyLoaded) {
    resetSourceControlState();
  }
  render();
  await refreshActiveWorkspaceGitStatus({ force: true });
  await loadActiveWorkspaceSourceControl({ force: force || !alreadyLoaded });
}

function resetSourceControlState({ keepTab = true } = {}) {
  const activeTab = keepTab ? uiState.sourceControl.activeTab : "changes";
  uiState.sourceControl = {
    ...uiState.sourceControl,
    snapshot: null,
    activeTab,
    selectedPath: "",
    selectedDiffMode: "working-tree",
    diff: null,
    diffLoading: false,
    selectedCommitOid: "",
    commitDetail: null,
    commitDetailLoading: false,
    graphLoadingMore: false,
    createBranchName: "",
    createBranchStartPoint: "",
    generatingCommitMessage: false,
    taskInput: "",
    submitting: false,
    lastLoadedWorkspaceId: "",
  };
}

function applySourceControlSnapshot(snapshot, { appendGraph = false } = {}) {
  const previous = uiState.sourceControl.snapshot;
  const nextSnapshot = appendGraph && previous?.workspaceId === snapshot.workspaceId
    ? {
        ...snapshot,
        graph: {
          ...(snapshot.graph || {}),
          commits: [
            ...(previous.graph?.commits || []),
            ...(snapshot.graph?.commits || []),
          ],
        },
        task: snapshot.task || previous.task || null,
      }
    : snapshot;

  uiState.sourceControl.snapshot = nextSnapshot;
  uiState.sourceControl.lastLoadedWorkspaceId = nextSnapshot.workspaceId || "";
  uiState.sourceControl.graphLoadingMore = false;

  if (
    uiState.sourceControl.selectedPath
    && !nextSnapshot.changes.some((file) => file.path === uiState.sourceControl.selectedPath)
  ) {
    uiState.sourceControl.selectedPath = "";
    uiState.sourceControl.diff = null;
  } else if (uiState.sourceControl.selectedPath) {
    const selectedFile = nextSnapshot.changes.find((file) => file.path === uiState.sourceControl.selectedPath) || null;
    const availableModes = getSourceControlDiffModes(selectedFile).map((entry) => entry.id);
    if (!availableModes.includes(uiState.sourceControl.selectedDiffMode)) {
      uiState.sourceControl.selectedDiffMode = preferredDiffModeForFile(selectedFile);
    }
  }

  if (
    uiState.sourceControl.selectedCommitOid
    && !nextSnapshot.graph?.commits?.some((commit) => commit.oid === uiState.sourceControl.selectedCommitOid)
  ) {
    uiState.sourceControl.selectedCommitOid = "";
    uiState.sourceControl.commitDetail = null;
  }

  if (
    uiState.sourceControl.activeTab === "changes"
    && !uiState.sourceControl.selectedPath
    && nextSnapshot.changes?.length
  ) {
    const firstFile = nextSnapshot.changes[0];
    uiState.sourceControl.selectedPath = firstFile.path;
    uiState.sourceControl.selectedDiffMode = preferredDiffModeForFile(firstFile);
    void loadSourceControlDiff(firstFile.path, uiState.sourceControl.selectedDiffMode);
  }

  return nextSnapshot;
}

function handleSourceControlRuntimeEvent(event) {
  if (!event || event.kind !== "gitTaskSnapshot" || !event.workspaceId || !event.task) {
    return false;
  }

  const sourceControl = uiState.sourceControl;
  if (sourceControl.snapshot?.workspaceId === event.workspaceId) {
    sourceControl.snapshot = {
      ...sourceControl.snapshot,
      task: event.task,
    };
  }

  if (uiState.snapshot?.activeWorkspaceId === event.workspaceId) {
    const activeWorkspace = uiState.snapshot?.activeWorkspace;
    if (activeWorkspace?.gitDetail?.summary) {
      activeWorkspace.gitDetail.summary = {
        ...activeWorkspace.gitDetail.summary,
      };
    }
  }

  return true;
}

async function loadActiveWorkspaceSourceControl({
  force = false,
  graphCursor = null,
  appendGraph = false,
} = {}) {
  const workspaceId = uiState.snapshot?.activeWorkspaceId;
  if (!workspaceId || !bridge.loadWorkspaceSourceControl) {
    return null;
  }

  if (
    !force
    && uiState.sourceControl.snapshot?.workspaceId === workspaceId
    && !graphCursor
  ) {
    return uiState.sourceControl.snapshot;
  }

  return loadWorkspaceSourceControlFor(workspaceId, { graphCursor, appendGraph });
}

async function loadWorkspaceSourceControlFor(
  workspaceId,
  { graphCursor = null, appendGraph = false } = {},
) {
  if (!workspaceId || !bridge.loadWorkspaceSourceControl) {
    return null;
  }

  const snapshot = await bridge.loadWorkspaceSourceControl(workspaceId, graphCursor);
  return applySourceControlSnapshot(snapshot, { appendGraph });
}

function preferredDiffModeForFile(file) {
  if (!file) {
    return "working-tree";
  }

  return file.worktreeStatus ? "working-tree" : "staged";
}

function getSourceControlFileByPath(path, snapshot = uiState.sourceControl.snapshot) {
  return snapshot?.changes?.find((file) => file.path === path) || null;
}

async function selectSourceControlPath(path, mode = null) {
  const file = getSourceControlFileByPath(path);
  uiState.sourceControl.selectedPath = path;
  uiState.sourceControl.selectedCommitOid = "";
  uiState.sourceControl.commitDetail = null;
  uiState.sourceControl.selectedDiffMode = mode || preferredDiffModeForFile(file);
  uiState.sourceControl.diff = null;
  uiState.sourceControl.diffLoading = true;
  render();
  await loadSourceControlDiff(path, uiState.sourceControl.selectedDiffMode);
}

async function loadSourceControlDiff(path, mode = "working-tree") {
  const workspaceId = uiState.sourceControl.snapshot?.workspaceId || uiState.snapshot?.activeWorkspaceId;
  if (!workspaceId || !path || !bridge.loadWorkspaceGitDiff) {
    uiState.sourceControl.diffLoading = false;
    return null;
  }

  uiState.sourceControl.diffLoading = true;
  render();

  try {
    const diff = await bridge.loadWorkspaceGitDiff(workspaceId, path, mode);
    if (
      uiState.sourceControl.selectedPath === path
      && uiState.sourceControl.selectedDiffMode === mode
    ) {
      uiState.sourceControl.diff = diff;
    }
    return diff;
  } finally {
    uiState.sourceControl.diffLoading = false;
    render();
  }
}

async function selectSourceControlCommit(oid) {
  uiState.sourceControl.selectedCommitOid = oid;
  uiState.sourceControl.selectedPath = "";
  uiState.sourceControl.diff = null;
  uiState.sourceControl.commitDetail = null;
  uiState.sourceControl.commitDetailLoading = true;
  render();
  await loadSourceControlCommitDetail(oid);
}

async function loadSourceControlCommitDetail(oid) {
  const workspaceId = uiState.sourceControl.snapshot?.workspaceId || uiState.snapshot?.activeWorkspaceId;
  if (!workspaceId || !oid || !bridge.loadWorkspaceGitCommitDetail) {
    uiState.sourceControl.commitDetailLoading = false;
    return null;
  }

  try {
    const detail = await bridge.loadWorkspaceGitCommitDetail(workspaceId, oid);
    if (uiState.sourceControl.selectedCommitOid === oid) {
      uiState.sourceControl.commitDetail = detail;
    }
    return detail;
  } finally {
    uiState.sourceControl.commitDetailLoading = false;
    render();
  }
}

function getSourceControlSections(snapshot = uiState.sourceControl.snapshot) {
  const groups = new Map();
  const files = snapshot?.changes || [];
  const order = ["conflicted", "staged", "changes", "untracked"];

  for (const file of files) {
    const key = getGitFileSectionKey(file);
    const bucket = groups.get(key) || [];
    bucket.push(file);
    groups.set(key, bucket);
  }

  return order
    .filter((key) => groups.has(key))
    .map((key) => ({
      key,
      label: formatGitFileSectionLabel(key),
      files: groups.get(key) || [],
    }));
}

function getSourceControlWorkspaceId() {
  return uiState.sourceControl.snapshot?.workspaceId || uiState.snapshot?.activeWorkspaceId || "";
}

function getSourceControlSummary(snapshot = uiState.sourceControl.snapshot) {
  return snapshot?.summary || null;
}

function getSourceControlSection(key, snapshot = uiState.sourceControl.snapshot) {
  return getSourceControlSections(snapshot).find((section) => section.key === key) || null;
}

function getSourceControlSectionPaths(key, snapshot = uiState.sourceControl.snapshot) {
  return (getSourceControlSection(key, snapshot)?.files || []).map((file) => file.path);
}

function hasStagedSourceControlChanges(snapshot = uiState.sourceControl.snapshot) {
  return getSourceControlSectionPaths("staged", snapshot).length > 0;
}

function hasPendingSourceControlChanges(snapshot = uiState.sourceControl.snapshot) {
  return Boolean(snapshot?.changes?.length);
}

function getSuggestedUpstream(branchName, snapshot = uiState.sourceControl.snapshot) {
  if (!branchName) {
    return "";
  }

  const directMatch = snapshot?.remoteBranches?.find((branch) => branch.name.endsWith(`/${branchName}`));
  if (directMatch) {
    return directMatch.name;
  }

  return snapshot?.remoteBranches?.[0]?.name || "";
}

async function runSourceControlMutation(runner, { resetGraphSelection = false } = {}) {
  uiState.sourceControl.submitting = true;
  render();

  try {
    const snapshot = await runner();
    if (snapshot) {
      applySourceControlSnapshot(snapshot);
      if (resetGraphSelection) {
        uiState.sourceControl.selectedCommitOid = "";
        uiState.sourceControl.commitDetail = null;
      }
      if (uiState.sourceControl.selectedPath) {
        void loadSourceControlDiff(
          uiState.sourceControl.selectedPath,
          uiState.sourceControl.selectedDiffMode,
        );
      }
    }
    render();
    return snapshot;
  } catch (error) {
    reportSourceControlError(error);
    return null;
  } finally {
    uiState.sourceControl.submitting = false;
    render();
  }
}

function reportSourceControlError(error) {
  const message = error instanceof Error ? error.message : String(error || "Source control action failed");
  console.error(error);
  window.alert(message);
}

async function submitSourceControlCommit({ commitAll = false } = {}) {
  const workspaceId = getSourceControlWorkspaceId();
  const message = uiState.sourceControl.commitMessage.trim();
  if (!workspaceId || !bridge.gitCommit) {
    return;
  }

  if (!message) {
    window.alert("Enter a commit message.");
    return;
  }

  const snapshot = await runSourceControlMutation(() => bridge.gitCommit(workspaceId, message, commitAll), {
    resetGraphSelection: true,
  });
  if (snapshot) {
    uiState.sourceControl.commitMessage = "";
    render();
  }
}

async function generateSourceControlCommitMessage() {
  const workspaceId = getSourceControlWorkspaceId();
  if (!workspaceId || !bridge.generateGitCommitMessage || uiState.sourceControl.generatingCommitMessage) {
    return;
  }

  const existingMessage = uiState.sourceControl.commitMessage.trim();
  if (
    existingMessage
    && !window.confirm("Replace the current commit message with an AI suggestion?")
  ) {
    return;
  }

  const initialMessage = uiState.sourceControl.commitMessage;
  uiState.sourceControl.generatingCommitMessage = true;
  render();

  try {
    const suggestion = await bridge.generateGitCommitMessage(workspaceId);
    const currentMessage = uiState.sourceControl.commitMessage;
    if (
      currentMessage.trim()
      && currentMessage.trim() !== initialMessage.trim()
      && !window.confirm("Replace the current commit message with the AI suggestion?")
    ) {
      return;
    }

    uiState.sourceControl.commitMessage = String(suggestion || "").trim();
  } catch (error) {
    reportSourceControlError(error);
  } finally {
    uiState.sourceControl.generatingCommitMessage = false;
    render();
  }
}

async function submitSourceControlCreateBranch() {
  const workspaceId = getSourceControlWorkspaceId();
  const branchName = uiState.sourceControl.createBranchName.trim();
  const startPoint = uiState.sourceControl.createBranchStartPoint.trim();
  if (!workspaceId || !bridge.gitCreateBranch) {
    return;
  }

  if (!branchName) {
    window.alert("Enter a branch name.");
    return;
  }

  const snapshot = await runSourceControlMutation(
    () => bridge.gitCreateBranch(workspaceId, branchName, startPoint || null),
    { resetGraphSelection: true },
  );
  if (snapshot) {
    uiState.sourceControl.createBranchName = "";
    uiState.sourceControl.createBranchStartPoint = "";
    render();
  }
}

async function submitSourceControlTaskInput() {
  const workspaceId = getSourceControlWorkspaceId();
  const task = uiState.sourceControl.snapshot?.task || null;
  const rawValue = uiState.sourceControl.taskInput;
  if (!workspaceId || !task?.canWriteInput || !bridge.gitTaskWriteStdin) {
    return;
  }

  if (!rawValue.trim()) {
    return;
  }

  try {
    const payload = rawValue.endsWith("\n") ? rawValue : `${rawValue}\n`;
    await bridge.gitTaskWriteStdin(workspaceId, payload);
    uiState.sourceControl.taskInput = "";
    render();
  } catch (error) {
    reportSourceControlError(error);
  }
}

async function handleSourceControlAction(target) {
  const workspaceId = getSourceControlWorkspaceId();
  const action = target.dataset.action;
  const path = target.dataset.path || "";
  const sectionKey = target.dataset.section || "";
  const branchName = target.dataset.branchName || "";
  const commitOid = target.dataset.oid || "";

  if (!workspaceId && action !== "scm-switch-tab") {
    return;
  }

  switch (action) {
    case "scm-refresh":
      await refreshActiveWorkspaceGitStatus({ force: true });
      await loadActiveWorkspaceSourceControl({ force: true });
      return;
    case "scm-switch-tab": {
      const nextTab = target.dataset.scmTab || "changes";
      if (uiState.sourceControl.activeTab !== nextTab) {
        uiState.sourceControl.activeTab = nextTab;
        if (nextTab === "changes" && !uiState.sourceControl.snapshot) {
          void loadActiveWorkspaceSourceControl({ force: true });
        }
        if (
          nextTab === "graph"
          && !uiState.sourceControl.selectedCommitOid
          && uiState.sourceControl.snapshot?.graph?.commits?.length
        ) {
          void selectSourceControlCommit(uiState.sourceControl.snapshot.graph.commits[0].oid);
        }
        render();
      }
      return;
    }
    case "scm-select-path":
      await selectSourceControlPath(path, target.dataset.diffMode || null);
      render();
      return;
    case "scm-set-diff-mode":
      if (path) {
        uiState.sourceControl.selectedDiffMode = target.dataset.diffMode || "working-tree";
        await loadSourceControlDiff(path, uiState.sourceControl.selectedDiffMode);
      }
      return;
    case "scm-stage-path":
      await runSourceControlMutation(() => bridge.gitStagePaths(workspaceId, [path]));
      return;
    case "scm-unstage-path":
      await runSourceControlMutation(() => bridge.gitUnstagePaths(workspaceId, [path]));
      return;
    case "scm-discard-path":
      if (!window.confirm(`Discard changes for ${path}?`)) {
        return;
      }
      await runSourceControlMutation(() => bridge.gitDiscardPaths(workspaceId, [path]));
      return;
    case "scm-stage-section": {
      const paths = getSourceControlSectionPaths(sectionKey);
      if (paths.length) {
        await runSourceControlMutation(() => bridge.gitStagePaths(workspaceId, paths));
      }
      return;
    }
    case "scm-unstage-section": {
      const paths = getSourceControlSectionPaths(sectionKey);
      if (paths.length) {
        await runSourceControlMutation(() => bridge.gitUnstagePaths(workspaceId, paths));
      }
      return;
    }
    case "scm-discard-section": {
      const paths = getSourceControlSectionPaths(sectionKey);
      if (!paths.length) {
        return;
      }
      if (!window.confirm(`Discard ${paths.length} ${paths.length === 1 ? "change" : "changes"} from ${formatGitFileSectionLabel(sectionKey)}?`)) {
        return;
      }
      await runSourceControlMutation(() => bridge.gitDiscardPaths(workspaceId, paths));
      return;
    }
    case "scm-commit":
      await submitSourceControlCommit({ commitAll: false });
      return;
    case "scm-commit-all":
      await submitSourceControlCommit({ commitAll: true });
      return;
    case "scm-generate-commit-message":
      await generateSourceControlCommitMessage();
      return;
    case "scm-fetch":
      await runSourceControlMutation(() => bridge.gitFetch(workspaceId), { resetGraphSelection: true });
      return;
    case "scm-pull":
      await runSourceControlMutation(() => bridge.gitPull(workspaceId), { resetGraphSelection: true });
      return;
    case "scm-push":
      await runSourceControlMutation(() => bridge.gitPush(workspaceId), { resetGraphSelection: true });
      return;
    case "scm-checkout-branch": {
      const summary = getSourceControlSummary();
      if (summary?.isDirty && !window.confirm(`Switch to ${branchName} with uncommitted changes present?`)) {
        return;
      }
      await runSourceControlMutation(() => bridge.gitCheckoutBranch(workspaceId, branchName), {
        resetGraphSelection: true,
      });
      return;
    }
    case "scm-branch-from-remote": {
      const nextBranchName = target.dataset.branchName || branchName;
      const startPoint = target.dataset.startPoint || "";
      await runSourceControlMutation(
        () => bridge.gitCreateBranch(workspaceId, nextBranchName, startPoint || null),
        { resetGraphSelection: true },
      );
      return;
    }
    case "scm-rename-branch": {
      const nextName = window.prompt("Rename branch", branchName) || "";
      if (!nextName.trim() || nextName.trim() === branchName) {
        return;
      }
      await runSourceControlMutation(() => bridge.gitRenameBranch(workspaceId, branchName, nextName.trim()), {
        resetGraphSelection: true,
      });
      return;
    }
    case "scm-delete-branch":
      if (!window.confirm(`Delete branch ${branchName}?`)) {
        return;
      }
      await runSourceControlMutation(() => bridge.gitDeleteBranch(workspaceId, branchName), {
        resetGraphSelection: true,
      });
      return;
    case "scm-publish-branch":
      await runSourceControlMutation(() => bridge.gitPublishBranch(workspaceId, branchName), {
        resetGraphSelection: true,
      });
      return;
    case "scm-set-upstream": {
      const suggested = target.dataset.upstreamName || getSuggestedUpstream(branchName);
      const upstreamName = window.prompt("Set upstream", suggested) || "";
      if (!upstreamName.trim()) {
        return;
      }
      await runSourceControlMutation(() => bridge.gitSetUpstream(workspaceId, branchName, upstreamName.trim()), {
        resetGraphSelection: true,
      });
      return;
    }
    case "scm-select-commit":
      await selectSourceControlCommit(commitOid);
      return;
    case "scm-copy-oid":
      if (commitOid) {
        try {
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(commitOid);
          }
        } catch (error) {
          reportSourceControlError(error);
        }
      }
      return;
    case "scm-branch-from-commit":
      uiState.sourceControl.activeTab = "branches";
      uiState.sourceControl.createBranchStartPoint = commitOid;
      render();
      return;
    case "scm-load-more-graph":
      if (!target.dataset.cursor || uiState.sourceControl.graphLoadingMore) {
        return;
      }
      uiState.sourceControl.graphLoadingMore = true;
      render();
      await loadActiveWorkspaceSourceControl({
        graphCursor: target.dataset.cursor,
        appendGraph: true,
      });
      render();
      return;
    default:
      return;
  }
}

function getWorkspaceById(workspaceId, snapshot = uiState.snapshot) {
  return snapshot?.workspaces?.find((workspace) => workspace.id === workspaceId) || null;
}

function syncRuntimeActivityState(snapshot = uiState.snapshot) {
  const workspaceIds = new Set((snapshot?.workspaces || []).map((workspace) => workspace.id));

  for (const workspaceId of uiState.runtimeAttentionByWorkspace.keys()) {
    if (!workspaceIds.has(workspaceId)) {
      uiState.runtimeAttentionByWorkspace.delete(workspaceId);
    }
  }

  uiState.runtimeActivity = uiState.runtimeActivity.filter((entry) => workspaceIds.has(entry.workspaceId));
  uiState.activityRailScope = normalizeActivityScope(uiState.activityRailScope, snapshot);

  if (snapshot?.activeWorkspaceId && document.hasFocus()) {
    markWorkspaceAttentionSeen(snapshot.activeWorkspaceId);
  }
}

function hydrateRuntimeActivityFromSnapshot(snapshot = uiState.snapshot) {
  const recentEvents = Array.isArray(snapshot?.activity?.recentEvents)
    ? snapshot.activity.recentEvents
    : [];
  uiState.runtimeAttentionByWorkspace = new Map();
  uiState.runtimeActivity = recentEvents
    .map((event) => {
      if (!event || typeof event !== "object" || !event.workspaceId || typeof event.kind !== "string") {
        return null;
      }

      const normalized = {
        kind: event.kind,
        workspaceId: String(event.workspaceId),
        paneId: String(event.paneId || ""),
        label: String(event.label || "Terminal"),
        error: event.error ? String(event.error) : "",
        at: Number(event.at || 0),
      };

      return {
        ...normalized,
        tone: runtimeEventTone(normalized.kind),
        message: formatRuntimeEventMessage(normalized),
      };
    })
    .filter(Boolean);
}

function markWorkspaceAttentionSeen(workspaceId) {
  if (!workspaceId) {
    return false;
  }

  const attention = uiState.runtimeAttentionByWorkspace.get(workspaceId);
  if (!attention || attention.unreadCount <= 0) {
    return false;
  }

  uiState.runtimeAttentionByWorkspace.set(workspaceId, {
    ...attention,
    unreadCount: 0,
  });
  return true;
}

function clearAllActivityAttention() {
  let changed = false;

  for (const [workspaceId, attention] of uiState.runtimeAttentionByWorkspace.entries()) {
    if (!attention || attention.unreadCount <= 0) {
      continue;
    }

    uiState.runtimeAttentionByWorkspace.set(workspaceId, {
      ...attention,
      unreadCount: 0,
    });
    changed = true;
  }

  return changed;
}

function normalizeActivityScope(scope, snapshot = uiState.snapshot) {
  if (scope === "current" && snapshot?.activeWorkspaceId) {
    return "current";
  }

  return "all";
}

function toggleActivityRail(forceVisible = !uiState.activityRailVisible) {
  if (!forceVisible) {
    uiState.activityRailVisible = false;
    return;
  }

  uiState.activityRailVisible = true;
  uiState.activityRailScope = normalizeActivityScope(uiState.activityRailScope);
  hideSettingsSheet();
  uiState.gitPanelVisible = false;
  closeQuickSwitcher();
  uiState.pendingWorkspaceDraft = null;
  uiState.contextMenu = null;
}

function recordRuntimeEvent(event) {
  const normalizedEvent = normalizeRuntimeEvent(event);
  if (!normalizedEvent) {
    return;
  }

  const workspace = getWorkspaceById(normalizedEvent.workspaceId);
  if (!workspace) {
    return;
  }

  const nextEvent = {
    ...normalizedEvent,
    at: Date.now(),
    tone: runtimeEventTone(normalizedEvent.kind),
    message: formatRuntimeEventMessage(normalizedEvent),
  };
  const currentAttention =
    uiState.runtimeAttentionByWorkspace.get(normalizedEvent.workspaceId) || {
      unreadCount: 0,
      tone: runtimeEventTone(normalizedEvent.kind),
      lastEvent: null,
    };
  const shouldMarkUnread =
    normalizedEvent.workspaceId !== uiState.snapshot?.activeWorkspaceId || !document.hasFocus();

  uiState.runtimeAttentionByWorkspace.set(normalizedEvent.workspaceId, {
    unreadCount: shouldMarkUnread
      ? Math.min(MAX_WORKSPACE_ATTENTION_COUNT, currentAttention.unreadCount + 1)
      : 0,
    tone: runtimeEventTone(normalizedEvent.kind),
    lastEvent: nextEvent,
  });

  uiState.runtimeActivity.unshift(nextEvent);
  if (uiState.runtimeActivity.length > MAX_RUNTIME_ACTIVITY_ITEMS) {
    uiState.runtimeActivity.length = MAX_RUNTIME_ACTIVITY_ITEMS;
  }
}

function normalizeRuntimeEvent(event) {
  if (!event || typeof event !== "object") {
    return null;
  }

  if (!event.workspaceId || !event.paneId || typeof event.kind !== "string") {
    return null;
  }

  if (!["paneReady", "paneClosed", "paneFailed"].includes(event.kind)) {
    return null;
  }

  return {
    kind: event.kind,
    workspaceId: event.workspaceId,
    paneId: event.paneId,
    label: String(event.label || "Terminal"),
    error: event.error ? String(event.error) : "",
  };
}

function runtimeEventTone(kind) {
  switch (kind) {
    case "paneFailed":
      return "failed";
    case "paneClosed":
      return "closed";
    case "paneReady":
    default:
      return "ready";
  }
}

function formatRuntimeEventMessage(event) {
  const label = event.label || "Terminal";

  switch (event.kind) {
    case "paneFailed":
      return `${label} failed${event.error ? `: ${event.error}` : ""}`;
    case "paneClosed":
      return `${label} closed`;
    case "paneReady":
    default:
      return `${label} is live`;
  }
}

function getWorkspaceAttention(workspaceId) {
  return uiState.runtimeAttentionByWorkspace.get(workspaceId) || null;
}

function activityToneRank(tone) {
  switch (tone) {
    case "failed":
      return 3;
    case "ready":
      return 2;
    case "closed":
      return 1;
    default:
      return 0;
  }
}

function getRuntimeActivitySummary(snapshot = uiState.snapshot) {
  const workspaceIds = new Set((snapshot?.workspaces || []).map((workspace) => workspace.id));
  let totalUnreadCount = 0;
  let unreadWorkspaceCount = 0;
  let tone = "neutral";

  for (const [workspaceId, attention] of uiState.runtimeAttentionByWorkspace.entries()) {
    if (!workspaceIds.has(workspaceId) || !attention?.unreadCount) {
      continue;
    }

    totalUnreadCount += attention.unreadCount;
    unreadWorkspaceCount += 1;
    if (activityToneRank(attention.tone) > activityToneRank(tone)) {
      tone = attention.tone;
    }
  }

  return {
    totalUnreadCount,
    unreadWorkspaceCount,
    tone,
    hasActivity: uiState.runtimeActivity.length > 0,
  };
}

function buildActivityWorkspaceSummaries(snapshot = uiState.snapshot) {
  const workspaces = snapshot?.workspaces || [];
  const labels = buildWorkspaceTabLabels(workspaces);
  const activeWorkspaceId = snapshot?.activeWorkspaceId || null;
  const scope = normalizeActivityScope(uiState.activityRailScope, snapshot);

  return workspaces
    .filter((workspace) => scope === "all" || workspace.id === activeWorkspaceId)
    .map((workspace) => {
      const attention = getWorkspaceAttention(workspace.id);
      const latestEvent = attention?.lastEvent || uiState.runtimeActivity.find((entry) => entry.workspaceId === workspace.id) || null;
      return {
        workspaceId: workspace.id,
        label: labels.get(workspace.id) || workspace.name,
        path: workspace.path,
        unreadCount: attention?.unreadCount || 0,
        tone: attention?.tone || latestEvent?.tone || "neutral",
        meta: latestEvent?.message || compactWorkspacePath(workspace.path),
        isActive: workspace.id === snapshot?.activeWorkspaceId,
        lastEventAt: latestEvent?.at || 0,
      };
    })
    .sort((left, right) => {
      if (right.unreadCount !== left.unreadCount) {
        return right.unreadCount - left.unreadCount;
      }
      if (Number(right.isActive) !== Number(left.isActive)) {
        return Number(right.isActive) - Number(left.isActive);
      }
      return right.lastEventAt - left.lastEventAt;
    });
}

function buildActivityFeedItems(snapshot = uiState.snapshot) {
  const workspaces = snapshot?.workspaces || [];
  const labels = buildWorkspaceTabLabels(workspaces);
  const activeWorkspaceId = snapshot?.activeWorkspaceId || null;
  const scope = normalizeActivityScope(uiState.activityRailScope, snapshot);

  return uiState.runtimeActivity
    .filter((entry) => scope === "all" || entry.workspaceId === activeWorkspaceId)
    .map((entry) => {
      const workspace = getWorkspaceById(entry.workspaceId, snapshot);
      if (!workspace) {
        return null;
      }

      const attention = getWorkspaceAttention(entry.workspaceId);
      return {
        ...entry,
        tone: entry.tone || runtimeEventTone(entry.kind),
        workspaceLabel: labels.get(entry.workspaceId) || workspace.name,
        path: workspace.path,
        pathLabel: compactWorkspacePath(workspace.path),
        isActiveWorkspace: entry.workspaceId === activeWorkspaceId,
        isUnread: Boolean(attention?.unreadCount && attention.lastEvent?.at === entry.at),
      };
    })
    .filter(Boolean);
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
  hideSettingsSheet();
  uiState.gitPanelVisible = false;
  uiState.activityRailVisible = false;
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
      <div class="workspace-activity-layer" data-region="activity"></div>
      <div class="workspace-context-layer" data-region="context"></div>
      <div class="workspace-modal-layer" data-region="modal"></div>
    </div>
  `;
  app.dataset.frameMounted = "true";
}

function createWorkspaceScreenElement(
  workspace,
  layoutSignature = workspaceLayoutSignature(workspace),
) {
  const template = document.createElement("template");
  template.innerHTML = renderWorkspace(workspace).trim();
  const screen = template.content.firstElementChild;
  if (!(screen instanceof HTMLElement)) {
    throw new Error("failed to create workspace screen");
  }

  screen.dataset.workspaceId = workspace.id;
  screen.dataset.layoutSignature = layoutSignature;
  return screen;
}

function collectPaneIdsFromElement(element) {
  if (!(element instanceof Element)) {
    return [];
  }

  return Array.from(element.querySelectorAll("[data-pane-id]"))
    .map((paneElement) => paneElement.dataset.paneId || "")
    .filter(Boolean);
}

function discardCachedWorkspaceScreen(workspaceId, { dispose = true } = {}) {
  const cached = workspaceScreens.get(workspaceId);
  if (!cached) {
    return;
  }

  if (dispose) {
    for (const paneId of collectPaneIdsFromElement(cached.element)) {
      disposeTerminal(paneId);
    }
  }

  cached.element.remove();
  workspaceScreens.delete(workspaceId);
}

function stashMountedWorkspaceScreen(stageRegion) {
  if (!uiState.mountedWorkspaceId) {
    return;
  }

  const mountedScreen = stageRegion.firstElementChild;
  if (!(mountedScreen instanceof HTMLElement)) {
    uiState.mountedWorkspaceId = null;
    uiState.mountedLayoutSignature = null;
    return;
  }

  workspaceScreens.set(uiState.mountedWorkspaceId, {
    element: mountedScreen,
    layoutSignature: uiState.mountedLayoutSignature || mountedScreen.dataset.layoutSignature || "",
  });
  mountedScreen.remove();
  uiState.mountedWorkspaceId = null;
  uiState.mountedLayoutSignature = null;
}

function render() {
  if (!uiState.snapshot) {
    return;
  }

  const snapshot = uiState.snapshot;
  if (!uiState.settingsVisible && uiState.settingsDraft) {
    clearSettingsDraft();
  } else if (uiState.settingsVisible && !uiState.settingsDraft) {
    syncSettingsDraftFromSnapshot(snapshot);
  }

  applyRenderedSettings(snapshot);
  syncRuntimeActivityState(snapshot);
  ensureFrame();

  const activeWorkspace = snapshot.activeWorkspace;
  const shouldShowLauncher = uiState.launcherVisible || !activeWorkspace;

  if (activeWorkspace) {
    syncActivePaneId(activeWorkspace);
  } else {
    uiState.activePaneId = null;
  }

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
  const activityRegion = app.querySelector('[data-region="activity"]');
  const contextRegion = app.querySelector('[data-region="context"]');
  const modalRegion = app.querySelector('[data-region="modal"]');
  bindModalLayerControls(modalRegion);
  const sourceControlFocusState = uiState.gitPanelVisible
    ? captureSourceControlFocusState(modalRegion)
    : null;
  const sourceControlScrollState = uiState.gitPanelVisible
    ? captureSourceControlScrollState(modalRegion)
    : null;

  stripRegion.innerHTML = renderWorkspaceStrip({
    windowSummary: snapshot.window,
    workspaces: snapshot.workspaces,
    activeWorkspaceId: snapshot.activeWorkspaceId,
    workspaceRenameDraft: uiState.workspaceRenameDraft,
    getWorkspaceAttention,
    escapeHtml,
    getGitTone,
    formatGitBadgeTitle,
  });
  statusRegion.innerHTML = renderWorkspaceStatusBar(snapshot, activeWorkspace);
  activityRegion.innerHTML = renderActivityRail({
    visible: uiState.activityRailVisible,
    scope: normalizeActivityScope(uiState.activityRailScope, snapshot),
    hasActiveWorkspace: Boolean(snapshot.activeWorkspaceId),
    ...getRuntimeActivitySummary(snapshot),
    workspaceSummaries: buildActivityWorkspaceSummaries(snapshot),
    items: buildActivityFeedItems(snapshot),
    escapeHtml,
  });
  syncWorkspaceTabRail(snapshot.activeWorkspaceId, snapshot.workspaces.length);
  if (uiState.workspaceRenameDraft && uiState.workspaceRenameShouldFocus) {
    focusWorkspaceRenameInput();
  }
  modalRegion.innerHTML = uiState.quickSwitcherVisible
    ? renderQuickSwitcher(snapshot)
    : uiState.settingsVisible
      ? renderSettingsSheet(snapshot)
      : uiState.pendingWorkspaceDraft
        ? renderLayoutPicker({
            presets: snapshot.launcher.presets,
            draft: uiState.pendingWorkspaceDraft,
            basename,
            escapeHtml,
          })
        : uiState.gitPanelVisible && activeWorkspace
          ? renderGitPanel(activeWorkspace)
          : "";
  modalRegion.classList.toggle(
    "is-active",
    Boolean(
      uiState.quickSwitcherVisible
      || uiState.settingsVisible
      || uiState.pendingWorkspaceDraft
      || (uiState.gitPanelVisible && activeWorkspace),
    ),
  );
  if (uiState.settingsVisible) {
    syncSettingsPreviewDom(modalRegion);
    bindSettingsSheetControls(modalRegion);
    syncSettingsActionDom(modalRegion);
  }
  if (sourceControlScrollState && uiState.gitPanelVisible) {
    restoreSourceControlScrollState(sourceControlScrollState, modalRegion);
  }
  if (sourceControlFocusState && uiState.gitPanelVisible) {
    restoreSourceControlFocusState(sourceControlFocusState, modalRegion);
  }
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
      stashMountedWorkspaceScreen(stageRegion);
    }

    const preservedLauncherInputState = captureLauncherInputState(stageRegion);
    const nextLauncherSignature = launcherStageSignature(snapshot.launcher.basePath, uiState);
    const shouldRemountLauncher =
      stageRegion.dataset.stageMode !== "launcher"
      || stageRegion.dataset.stageSignature !== nextLauncherSignature;

    if (shouldRemountLauncher) {
      stageRegion.innerHTML = renderEmptyState({
        basePath: snapshot.launcher.basePath,
        launcherCommandValue: uiState.launcherCommandValue,
        launcherLatestCard: uiState.launcherLatestCard,
        escapeHtml,
      });
      stageRegion.dataset.stageMode = "launcher";
      stageRegion.dataset.stageSignature = nextLauncherSignature;
    }

    if (!uiState.settingsVisible) {
      if (shouldRemountLauncher && preservedLauncherInputState?.wasFocused) {
        restoreLauncherInputState(preservedLauncherInputState);
      } else {
        focusLauncherInput();
      }
    }
    return;
  }

  const nextLayoutSignature = workspaceLayoutSignature(activeWorkspace);
  if (uiState.mountedWorkspaceId && uiState.mountedWorkspaceId !== activeWorkspace.id) {
    stashMountedWorkspaceScreen(stageRegion);
  }

  const mountedPaneCount = uiState.mountedWorkspaceId === activeWorkspace.id
    ? stageRegion.querySelectorAll("[data-pane-id]").length
    : 0;
  const mountedLayoutChanged = uiState.mountedWorkspaceId === activeWorkspace.id
    && (
      mountedPaneCount !== activeWorkspace.panes.length
      || uiState.mountedLayoutSignature !== nextLayoutSignature
    );
  if (mountedLayoutChanged) {
    for (const paneId of collectPaneIdsFromElement(stageRegion)) {
      disposeTerminal(paneId);
    }
    stageRegion.innerHTML = "";
    uiState.mountedWorkspaceId = null;
    uiState.mountedLayoutSignature = null;
  }

  if (uiState.mountedWorkspaceId !== activeWorkspace.id) {
    const cachedScreen = workspaceScreens.get(activeWorkspace.id) || null;
    const canReuseCachedScreen = Boolean(
      cachedScreen
        && cachedScreen.layoutSignature === nextLayoutSignature
        && collectPaneIdsFromElement(cachedScreen.element).length === activeWorkspace.panes.length,
    );

    stageRegion.innerHTML = "";
    if (canReuseCachedScreen) {
      stageRegion.appendChild(cachedScreen.element);
      workspaceScreens.delete(activeWorkspace.id);
    } else {
      discardCachedWorkspaceScreen(activeWorkspace.id);
      const screen = createWorkspaceScreenElement(activeWorkspace, nextLayoutSignature);
      stageRegion.appendChild(screen);
      mountWorkspaceTerminals(activeWorkspace, screen);
    }

    uiState.mountedWorkspaceId = activeWorkspace.id;
    uiState.mountedLayoutSignature = nextLayoutSignature;
    stageRegion.dataset.stageMode = "workspace";
    stageRegion.dataset.stageSignature = nextLayoutSignature;
  }

  syncWorkspace(activeWorkspace);
  scheduleVisibleTerminalRefresh(activeWorkspace);
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

function renderActivityIcon() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M5 5h14v2H5V5Zm0 6h14v2H5v-2Zm0 6h9v2H5v-2Z" fill="currentColor"></path>
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

function renderWorkspaceStatusBar(snapshot, activeWorkspace) {
  const leftItems = [`<span class="workspace-statusbar-brand">CrewDock</span>`];
  const rightItems = [];
  const activitySummary = getRuntimeActivitySummary(snapshot);

  if (!activeWorkspace) {
    leftItems.push(renderStatusBarItem("Launcher", "Source folders and workspace creation"));
    leftItems.push(renderStatusBarActivityButton(activitySummary));

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
    leftItems.push(renderStatusBarActivityButton(activitySummary));

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

function renderStatusBarActivityButton(summary) {
  const unreadLabel = summary.totalUnreadCount > 0 ? ` ${summary.totalUnreadCount}` : "";
  const title = summary.totalUnreadCount > 0
    ? `${summary.totalUnreadCount} unread updates across ${summary.unreadWorkspaceCount} ${summary.unreadWorkspaceCount === 1 ? "workspace" : "workspaces"}`
    : summary.hasActivity
      ? `${uiState.runtimeActivity.length} recent activity ${uiState.runtimeActivity.length === 1 ? "event" : "events"}`
      : "No recent activity yet";

  return `
    <button
      class="workspace-statusbar-item workspace-statusbar-button is-${escapeHtml(summary.tone)} ${uiState.activityRailVisible ? "is-panel-open" : ""}"
      type="button"
      data-action="toggle-activity-rail"
      title="${escapeHtml(title)}"
      aria-label="${escapeHtml(title)}"
      aria-pressed="${uiState.activityRailVisible ? "true" : "false"}"
    >
      <span class="workspace-statusbar-icon" aria-hidden="true">${renderActivityIcon()}</span>
      <span>Activity${escapeHtml(unreadLabel)}</span>
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

function renderSettingsSheet(snapshot) {
  const activeThemeId = getDraftThemeId(snapshot);
  const interfaceTextScale = getDraftInterfaceTextScale(snapshot);
  const terminalFontSize = getDraftTerminalFontSize(snapshot);
  const hasStoredKey = getDraftHasStoredOpenAiApiKey(snapshot);
  const hasEnvironmentKey = getDraftHasEnvironmentOpenAiApiKey(snapshot);
  const hasAppearanceChanges = hasSettingsAppearanceChanges(snapshot);
  const isApplyingAppearance = Boolean(uiState.settingsDraft?.applyingAppearance);
  const themes = Object.values(THEME_REGISTRY);
  const primaryModifier = getPrimaryModifierLabel();
  const activeSection = normalizeSettingsSection(uiState.settingsSection);
  const isWorkbenchSection = activeSection === "workbench";
  const sectionTitle = isWorkbenchSection ? "Workbench" : "How to use";
  const sectionCopy = isWorkbenchSection
    ? "Tune the workbench theme and keep CrewDock's interface aligned with how you like to work."
    : "Keep the core shortcuts close and move through workspaces faster without breaking terminal flow.";

  return `
    <div class="settings-sheet-backdrop" data-action="close-settings">
      <section class="settings-sheet" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header class="settings-sheet-header">
          <div>
            <p class="settings-sheet-mark">Settings</p>
            <h2 id="settings-title">${sectionTitle}</h2>
            <p class="settings-sheet-copy">${sectionCopy}</p>
          </div>
          <button class="settings-sheet-close" type="button" data-action="close-settings" data-settings-close aria-label="Close settings">
            ${renderCloseIcon()}
          </button>
        </header>
        <div class="settings-sheet-body">
          <aside class="settings-nav" aria-label="Settings sections">
            <button
              class="settings-nav-item ${isWorkbenchSection ? "is-active" : ""}"
              type="button"
              data-action="show-settings-section"
              data-settings-section="workbench"
              aria-current="${isWorkbenchSection ? "page" : "false"}"
            >
              <span class="settings-nav-item-label">Workbench</span>
              <span class="settings-nav-item-value">${themes.length} themes</span>
            </button>
            <button
              class="settings-nav-item ${!isWorkbenchSection ? "is-active" : ""}"
              type="button"
              data-action="show-settings-section"
              data-settings-section="guide"
              aria-current="${!isWorkbenchSection ? "page" : "false"}"
            >
              <span class="settings-nav-item-label">How to use</span>
              <span class="settings-nav-item-value">Shortcuts + flow</span>
            </button>
          </aside>
          ${isWorkbenchSection
            ? `
              <section class="settings-panel">
                <div class="settings-panel-intro">
                  <div>
                    <p class="settings-panel-kicker">Theme library</p>
                    <h3>${escapeHtml(getThemeDefinition(activeThemeId).label)}</h3>
                  </div>
                  <p class="settings-panel-copy">Pick a palette and CrewDock updates the launcher, chrome, menus, panes, and xterm colors in place.</p>
                </div>
                <div class="settings-adjustment-grid">
                  ${renderSettingsSliderCard({
                    kind: "interface",
                    title: "Interface text",
                    copy: "Scales the chrome, panels, menus, and settings UI across CrewDock.",
                    valueLabel: formatInterfaceTextScaleLabel(interfaceTextScale),
                    min: MIN_INTERFACE_TEXT_SCALE,
                    max: MAX_INTERFACE_TEXT_SCALE,
                    step: 0.0125,
                    value: interfaceTextScale,
                    preview: renderInterfaceTextPreview(),
                  })}
                  ${renderSettingsSliderCard({
                    kind: "terminal",
                    title: "Terminal text",
                    copy: "Updates xterm font sizing for every mounted pane and future sessions.",
                    valueLabel: formatTerminalFontSizeLabel(terminalFontSize),
                    min: MIN_TERMINAL_FONT_SIZE,
                    max: MAX_TERMINAL_FONT_SIZE,
                    step: 0.25,
                    value: terminalFontSize,
                    preview: renderTerminalTextPreview(),
                  })}
                </div>
                ${renderSettingsAiCard({
                  hasStoredKey,
                  hasEnvironmentKey,
                })}
                <div class="settings-theme-grid">
                  ${themes.map((theme) => renderThemeCard(theme, activeThemeId)).join("")}
                </div>
              </section>
            `
            : `
              <section class="settings-panel settings-panel-guide">
                ${renderSettingsGuide(primaryModifier)}
              </section>
            `}
        </div>
        <footer class="settings-sheet-footer">
          <p class="settings-sheet-footer-copy">
            Preview workbench changes here. Apply keeps them, and close discards anything still in draft.
          </p>
          <div class="settings-sheet-actions">
            <button
              class="settings-ai-button"
              type="button"
              data-action="close-settings"
              data-settings-close
              ${isApplyingAppearance ? "disabled" : ""}
            >
              Cancel
            </button>
            <button
              class="settings-ai-button settings-ai-button-primary"
              type="button"
              data-action="apply-settings"
              data-settings-apply
              ${(!hasAppearanceChanges || isApplyingAppearance) ? "disabled" : ""}
            >
              ${isApplyingAppearance ? "Applying..." : "Apply changes"}
            </button>
          </div>
        </footer>
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
      label: "Open activity rail",
      copy: "Review unread workspace changes without leaving the keyboard.",
      keys: [primaryModifier, "Shift", "A"],
    },
    {
      label: "Complete launcher paths",
      copy: "Autocomplete folders while using the launcher command bar.",
      keys: ["Tab"],
    },
    {
      label: "Split pane right",
      copy: "Create a sibling pane beside the active terminal.",
      keys: [primaryModifier, "D"],
    },
    {
      label: "Split pane down",
      copy: "Drop a new pane below the active terminal.",
      keys: [primaryModifier, "Shift", "D"],
    },
    {
      label: "Maximize active pane",
      copy: "Focus on one terminal without losing the wider layout.",
      keys: [primaryModifier, "Shift", "Enter"],
    },
    {
      label: "Close active pane",
      copy: "Remove the active pane without reaching for the context menu.",
      keys: [primaryModifier, "W"],
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
      <div class="settings-guide-header">
        <div>
          <p class="settings-guide-kicker">How to use</p>
          <h4 class="settings-guide-title">Shortcuts and workflow</h4>
        </div>
        <p class="settings-guide-summary">CrewDock works best when the keyboard handles movement and the terminals stay visually front and center.</p>
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

function formatSettingNumber(value) {
  return Number(value).toFixed(2).replace(/\.?0+$/, "");
}

function renderSettingsSliderCard({
  kind,
  title,
  copy,
  valueLabel,
  min,
  max,
  step,
  value,
  preview,
}) {
  const progress = calculateRangeProgress(value, min, max);
  return `
    <section class="settings-adjustment-card">
      <div class="settings-adjustment-head">
        <div>
          <h4 class="settings-adjustment-title">${escapeHtml(title)}</h4>
          <p class="settings-adjustment-copy">${escapeHtml(copy)}</p>
        </div>
        <span class="settings-adjustment-value" data-settings-${escapeHtml(kind)}-value>${escapeHtml(valueLabel)}</span>
      </div>
      <div
        class="settings-adjustment-range-shell"
        data-settings-${escapeHtml(kind)}-range-shell
        style="--settings-adjustment-progress:${escapeHtml(`${progress}%`)}"
      >
        <input
          class="settings-adjustment-range"
          type="range"
          min="${escapeHtml(String(min))}"
          max="${escapeHtml(String(max))}"
          step="${escapeHtml(String(step))}"
          value="${escapeHtml(String(value))}"
          data-settings-${escapeHtml(kind)}-range
          aria-label="${escapeHtml(title)}"
        />
        <div class="settings-adjustment-range-labels" aria-hidden="true">
          <span>Smaller</span>
          <span>Larger</span>
        </div>
      </div>
      ${preview}
    </section>
  `;
}

function renderInterfaceTextPreview() {
  return `
    <div class="settings-adjustment-preview settings-adjustment-preview-interface" data-settings-interface-preview>
      <div class="settings-preview-interface-rail">
        <span class="settings-preview-interface-tab is-active">Workspace</span>
        <span class="settings-preview-interface-pill">Dirty</span>
      </div>
      <div class="settings-preview-interface-card">
        <strong>Source Control</strong>
        <span>Branch, changes, and quick actions stay readable without crowding the workbench.</span>
      </div>
      <div class="settings-preview-interface-meta">Status bar · quick switch · settings</div>
    </div>
  `;
}

function renderTerminalTextPreview() {
  return `
    <div class="settings-adjustment-preview settings-adjustment-preview-terminal" data-settings-terminal-preview>
      <div class="settings-preview-terminal-line">
        <span class="settings-preview-terminal-prompt">~/crewdock</span>
        <span>git status</span>
      </div>
      <div class="settings-preview-terminal-line is-muted">On branch main</div>
      <div class="settings-preview-terminal-line is-accent">modified: src-web/app.js</div>
    </div>
  `;
}

function renderSettingsAiCard({ hasStoredKey, hasEnvironmentKey }) {
  const draftValue = getDraftOpenAiApiKey();
  const isSaving = Boolean(uiState.settingsDraft?.savingOpenAiApiKey);
  const statusLabel = hasStoredKey
    ? "Saved locally"
    : hasEnvironmentKey
      ? "Using env"
      : "Not set";
  const statusTone = hasStoredKey || hasEnvironmentKey ? "is-active" : "";
  const saveDisabled = isSaving || !draftValue.trim();
  const clearDisabled = isSaving || !hasStoredKey;
  const placeholder = hasStoredKey
    ? "Stored locally. Paste a new key to replace it."
    : "Paste OpenAI API key";
  const note = hasStoredKey
    ? "CrewDock will use the key saved here for AI commit messages."
    : hasEnvironmentKey
      ? "CrewDock is currently falling back to OPENAI_API_KEY from the launch environment."
      : "Used for AI commit message generation in Source Control. Stored locally on this machine.";

  return `
    <section class="settings-ai-card">
      <div class="settings-ai-head">
        <div>
          <p class="settings-panel-kicker">AI commit messages</p>
          <h4 class="settings-adjustment-title">OpenAI API key</h4>
          <p class="settings-adjustment-copy">${escapeHtml(note)}</p>
        </div>
        <span class="settings-ai-status ${statusTone}">${escapeHtml(statusLabel)}</span>
      </div>
      <div class="settings-ai-controls">
        <input
          class="settings-ai-input"
          type="password"
          value="${escapeHtml(draftValue)}"
          data-settings-openai-api-key-input
          placeholder="${escapeHtml(placeholder)}"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
        />
        <div class="settings-ai-actions">
          <button
            type="button"
            class="settings-ai-button settings-ai-button-primary"
            data-settings-openai-save
            ${saveDisabled ? "disabled" : ""}
          >
            ${isSaving ? "Saving..." : "Save key"}
          </button>
          <button
            type="button"
            class="settings-ai-button"
            data-settings-openai-clear
            ${clearDisabled ? "disabled" : ""}
          >
            Remove
          </button>
        </div>
      </div>
    </section>
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
  const snapshot = uiState.sourceControl.snapshot?.workspaceId === workspace.id
    ? uiState.sourceControl.snapshot
    : null;
  const summary = snapshot?.summary || workspace.gitDetail?.summary || null;
  const isLoading = uiState.gitPanelVisible
    && uiState.sourceControl.lastLoadedWorkspaceId !== workspace.id
    && !snapshot;

  return `
    <div class="workspace-git-backdrop" data-action="close-git-panel">
      <section class="workspace-git-panel" role="dialog" aria-modal="true" aria-labelledby="git-panel-title">
        <header class="workspace-git-panel-header">
          <div class="workspace-git-panel-heading">
            <p class="workspace-git-panel-mark">Source Control</p>
            <div class="workspace-git-panel-title-row">
              <h2 id="git-panel-title">${escapeHtml(workspace.name)}</h2>
              <span class="workspace-git-panel-state is-${getGitTone(summary)}">
                ${escapeHtml(formatGitStateText(summary))}
              </span>
            </div>
            <p class="workspace-git-panel-copy">${escapeHtml(workspace.path)}</p>
          </div>
          <div class="workspace-git-panel-actions">
            <button
              class="workspace-git-panel-button"
              type="button"
              data-action="scm-refresh"
              aria-label="Refresh source control"
              title="Refresh source control"
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
          isLoading
            ? renderSourceControlEmpty(
                "Checking repository",
                "CrewDock is collecting branch, change, and commit graph data for this workspace.",
              )
            : snapshot
              ? renderSourceControlBody(snapshot)
              : renderSourceControlEmpty(
                  "Source control unavailable",
                  "Open the panel again once the active workspace finishes loading.",
                )
        }
      </section>
    </div>
  `;
}

function renderSourceControlBody(snapshot) {
  const summary = snapshot.summary;
  if (summary.state === "not-repo") {
    return renderSourceControlEmpty(
      "No repository detected",
      summary.message || "This workspace is not inside a Git repository.",
    );
  }

  if (summary.state === "error") {
    return renderSourceControlEmpty(
      "Git unavailable",
      summary.message || "CrewDock could not load Git state for this workspace.",
    );
  }

  return `
    <div class="workspace-git-panel-body workspace-scm-shell">
      ${renderSourceControlToolbar(snapshot)}
      ${renderSourceControlTabs()}
      ${
        uiState.sourceControl.activeTab === "changes"
          ? renderSourceControlChangesTab(snapshot)
          : uiState.sourceControl.activeTab === "branches"
            ? renderSourceControlBranchesTab(snapshot)
            : renderSourceControlGraphTab(snapshot)
      }
      ${renderSourceControlTaskPanel(snapshot.task)}
    </div>
  `;
}

function renderSourceControlToolbar(snapshot) {
  const summary = snapshot.summary;
  const fileCount = snapshot.changes?.length || 0;
  const metaItems = [
    {
      label: formatGitBranchLabel(summary),
      title: summary.upstream || "Current branch",
      tone: getGitTone(summary),
      icon: renderBranchIcon(),
    },
    summary.upstream
      ? { label: summary.upstream, title: "Upstream branch" }
      : { label: "Local only", title: "No upstream configured" },
    {
      label: summary.upstream ? `+${summary.ahead || 0} / -${summary.behind || 0}` : "No sync",
      title: "Ahead / behind",
    },
    {
      label: fileCount === 0 ? "Clean" : `${fileCount} ${fileCount === 1 ? "change" : "changes"}`,
      title: "Pending changes",
      tone: fileCount ? getGitTone(summary) : "clean",
    },
  ];

  return `
    <section class="workspace-scm-toolbar">
      <div class="workspace-scm-toolbar-meta">
        ${metaItems
          .map(
            (item) => `
              <span class="workspace-scm-toolbar-chip ${item.tone ? `is-${item.tone}` : ""}" title="${escapeHtml(item.title || item.label)}">
                ${item.icon ? `<span class="workspace-scm-toolbar-chip-icon" aria-hidden="true">${item.icon}</span>` : ""}
                <span>${escapeHtml(item.label)}</span>
              </span>
            `,
          )
          .join("")}
      </div>
      <div class="workspace-scm-toolbar-actions">
        <button type="button" class="workspace-scm-toolbar-button" data-action="scm-fetch">Fetch</button>
        <button type="button" class="workspace-scm-toolbar-button" data-action="scm-pull">Pull</button>
        <button type="button" class="workspace-scm-toolbar-button" data-action="scm-push">Push</button>
      </div>
    </section>
  `;
}

function renderSourceControlTabs() {
  const tabs = [
    { id: "changes", label: "Changes" },
    { id: "branches", label: "Branches" },
    { id: "graph", label: "Graph" },
  ];

  return `
    <nav class="workspace-scm-tabs" aria-label="Source control views">
      ${tabs
        .map(
          (tab) => `
            <button
              type="button"
              class="workspace-scm-tab ${uiState.sourceControl.activeTab === tab.id ? "is-active" : ""}"
              data-action="scm-switch-tab"
              data-scm-tab="${tab.id}"
              aria-pressed="${uiState.sourceControl.activeTab === tab.id ? "true" : "false"}"
            >
              ${tab.label}
            </button>
          `,
        )
        .join("")}
    </nav>
  `;
}

function renderSourceControlChangesTab(snapshot) {
  const sections = getSourceControlSections(snapshot);
  const selectedFile = getSourceControlFileByPath(uiState.sourceControl.selectedPath, snapshot);
  const stagedPaths = getSourceControlSectionPaths("staged", snapshot);
  const commitDisabled = !hasStagedSourceControlChanges(snapshot) || uiState.sourceControl.submitting;
  const commitAllDisabled = hasStagedSourceControlChanges(snapshot) || !hasPendingSourceControlChanges(snapshot) || uiState.sourceControl.submitting;
  const generateDisabled = !hasPendingSourceControlChanges(snapshot) || uiState.sourceControl.generatingCommitMessage;

  return `
    <div class="workspace-scm-main workspace-scm-main-changes">
      <section class="workspace-scm-column workspace-scm-column-list">
        <div class="workspace-scm-commit">
          <div class="workspace-scm-commit-head">
            <div>
              <p class="workspace-scm-detail-kicker">Commit</p>
              <strong>Message</strong>
            </div>
            <span>Staged changes commit by default</span>
          </div>
          <textarea
            class="workspace-scm-commit-input"
            data-scm-commit-input
            placeholder="Commit message"
            rows="4"
            spellcheck="false"
            autocapitalize="off"
          >${escapeHtml(uiState.sourceControl.commitMessage)}</textarea>
          <div class="workspace-scm-commit-actions">
            <div class="workspace-scm-count-row">
              ${renderSourceControlCountBadges(snapshot.summary)}
            </div>
            <div class="workspace-scm-action-row">
              <button
                type="button"
                class="workspace-scm-ghost-button"
                data-action="scm-generate-commit-message"
                title="Generate with AI from staged changes when present, otherwise all pending changes."
                ${generateDisabled ? "disabled" : ""}
              >
                ${uiState.sourceControl.generatingCommitMessage ? "Generating..." : "Generate"}
              </button>
              <button
                type="button"
                class="workspace-scm-primary-button"
                data-action="scm-commit"
                ${commitDisabled ? "disabled" : ""}
              >
                Commit
              </button>
              <button
                type="button"
                class="workspace-scm-secondary-button"
                data-action="scm-commit-all"
                ${commitAllDisabled ? "disabled" : ""}
              >
                Commit All
              </button>
              ${
                stagedPaths.length
                  ? `
                    <button
                      type="button"
                      class="workspace-scm-ghost-button"
                      data-action="scm-unstage-section"
                      data-section="staged"
                    >
                      Unstage All
                    </button>
                  `
                  : ""
              }
            </div>
          </div>
          <p class="workspace-scm-commit-hint">${escapeHtml(getPrimaryModifierLabel())}+Enter commits staged changes. AI generation uses <code>OPENAI_API_KEY</code> and staged changes when present.</p>
        </div>
        <div class="workspace-scm-section-list">
          ${
            sections.length
              ? sections.map((section) => renderSourceControlSection(section)).join("")
              : renderSourceControlEmpty(
                  "Working tree clean",
                  "Staged, modified, and untracked files will appear here as you work.",
                )
          }
        </div>
      </section>
      <aside class="workspace-scm-column workspace-scm-column-detail">
        ${renderSourceControlDiffPanel(selectedFile)}
      </aside>
    </div>
  `;
}

function renderSourceControlCountBadges(summary) {
  const counts = summary?.counts || {};
  const definitions = [
    ["staged", "Staged"],
    ["modified", "Modified"],
    ["deleted", "Deleted"],
    ["renamed", "Renamed"],
    ["untracked", "Untracked"],
    ["conflicted", "Conflicts"],
  ];

  const badges = definitions
    .filter(([key]) => Number(counts[key] || 0) > 0)
    .map(
      ([key, label]) => `
        <span class="workspace-scm-count-badge is-${key}">
          <strong>${Number(counts[key] || 0)}</strong>
          <span>${label}</span>
        </span>
      `,
    );

  return badges.length
    ? badges.join("")
    : `
      <span class="workspace-scm-count-badge is-clean">
        <strong>0</strong>
        <span>Clean</span>
      </span>
    `;
}

function renderSourceControlSection(section) {
  const sectionActions = [];

  if (section.key === "staged") {
    sectionActions.push(`
      <button type="button" class="workspace-scm-inline-action" data-action="scm-unstage-section" data-section="${section.key}">
        Unstage all
      </button>
    `);
  } else {
    sectionActions.push(`
      <button type="button" class="workspace-scm-inline-action" data-action="scm-stage-section" data-section="${section.key}">
        Stage all
      </button>
    `);
    sectionActions.push(`
      <button type="button" class="workspace-scm-inline-action is-danger" data-action="scm-discard-section" data-section="${section.key}">
        Discard
      </button>
    `);
  }

  return `
    <section class="workspace-scm-section">
      <header class="workspace-scm-section-header">
        <div class="workspace-scm-section-title">
          <strong>${escapeHtml(section.label)}</strong>
          <span>${section.files.length}</span>
        </div>
        <div class="workspace-scm-section-actions">
          ${sectionActions.join("")}
        </div>
      </header>
      <div class="workspace-scm-file-list">
        ${section.files.map((file) => renderSourceControlFileRow(file, section.key)).join("")}
      </div>
    </section>
  `;
}

function renderSourceControlFileRow(file, sectionKey) {
  const pathParts = splitGitFilePath(file.path);
  const presentation = getGitFilePresentation(file);
  const secondaryParts = [];
  if (pathParts.directory) {
    secondaryParts.push(pathParts.directory);
  }
  if (file.originalPath) {
    secondaryParts.push(`from ${file.originalPath}`);
  }

  const isSelected = uiState.sourceControl.selectedPath === file.path;
  const primaryAction = sectionKey === "staged"
    ? { action: "scm-unstage-path", label: "Unstage" }
    : { action: "scm-stage-path", label: "Stage" };

  return `
    <article class="workspace-scm-file-row ${isSelected ? "is-selected" : ""}">
      <button
        type="button"
        class="workspace-scm-file-main"
        data-action="scm-select-path"
        data-path="${escapeHtml(file.path)}"
        title="${escapeHtml(file.path)}"
      >
        <span class="workspace-scm-file-status is-${presentation.tone}" aria-hidden="true">${escapeHtml(presentation.code)}</span>
        <span class="workspace-scm-file-copy">
          <strong>${escapeHtml(pathParts.name)}</strong>
          <span>${escapeHtml(secondaryParts.join(" • ") || file.path)}</span>
        </span>
      </button>
      <div class="workspace-scm-file-actions">
        <button
          type="button"
          class="workspace-scm-inline-action"
          data-action="${primaryAction.action}"
          data-path="${escapeHtml(file.path)}"
        >
          ${primaryAction.label}
        </button>
        <button
          type="button"
          class="workspace-scm-inline-action is-danger"
          data-action="scm-discard-path"
          data-path="${escapeHtml(file.path)}"
        >
          Discard
        </button>
      </div>
    </article>
  `;
}

function renderSourceControlDiffPanel(selectedFile) {
  if (!selectedFile) {
    return renderSourceControlEmpty(
      "Select a file",
      "Choose a change to review the diff. CrewDock keeps the view read-only and pushes editing back to your terminals.",
    );
  }

  const diff = uiState.sourceControl.diff;
  const diffModes = getSourceControlDiffModes(selectedFile);

  return `
    <div class="workspace-scm-detail-shell">
      <header class="workspace-scm-detail-header">
        <div>
          <p class="workspace-scm-detail-kicker">${escapeHtml(formatGitFileKindLabel(selectedFile.kind))}</p>
          <strong title="${escapeHtml(selectedFile.path)}">${escapeHtml(selectedFile.path)}</strong>
        </div>
        ${
          diffModes.length > 1
            ? `
              <div class="workspace-scm-detail-toggle">
                ${diffModes
                  .map(
                    (mode) => `
                      <button
                        type="button"
                        class="workspace-scm-toggle-button ${uiState.sourceControl.selectedDiffMode === mode.id ? "is-active" : ""}"
                        data-action="scm-set-diff-mode"
                        data-path="${escapeHtml(selectedFile.path)}"
                        data-diff-mode="${mode.id}"
                      >
                        ${mode.label}
                      </button>
                    `,
                  )
                  .join("")}
              </div>
            `
            : ""
        }
      </header>
      ${
        uiState.sourceControl.diffLoading
          ? renderSourceControlEmpty("Loading diff", "CrewDock is collecting the latest patch preview.")
          : diff
            ? renderSourceControlDiffContent(diff)
            : renderSourceControlEmpty("No diff available", "This change does not have a patch preview yet.")
      }
    </div>
  `;
}

function renderSourceControlDiffContent(diff) {
  if (diff.isBinary) {
    return renderSourceControlEmpty(
      "Binary file",
      "Binary changes cannot be previewed here. Use the active terminal if you need to inspect the file directly.",
    );
  }

  return `
    <div class="workspace-scm-diff-shell">
      <pre class="workspace-scm-diff">${escapeHtml(diff.text || "No diff output")}</pre>
      ${diff.isTruncated ? '<p class="workspace-scm-diff-note">Diff truncated to keep the panel responsive.</p>' : ""}
    </div>
  `;
}

function renderSourceControlBranchesTab(snapshot) {
  const query = uiState.sourceControl.branchSearch.trim().toLowerCase();
  const branchMatches = (branch) => {
    if (!query) {
      return true;
    }

    return `${branch.name} ${branch.subject} ${branch.upstream || ""}`.toLowerCase().includes(query);
  };
  const localBranches = (snapshot.localBranches || []).filter(branchMatches);
  const remoteBranches = (snapshot.remoteBranches || []).filter(branchMatches);
  const currentBranch = (snapshot.localBranches || []).find((branch) => branch.isCurrent) || null;

  return `
    <div class="workspace-scm-main workspace-scm-main-branches">
      <section class="workspace-scm-branches-head">
        <div class="workspace-scm-branch-summary">
          <strong>${escapeHtml(currentBranch?.name || formatGitBranchLabel(snapshot.summary))}</strong>
          <span>${escapeHtml(currentBranch?.upstream || snapshot.summary.upstream || "No upstream configured")}</span>
        </div>
        <form class="workspace-scm-branch-form" data-action="scm-create-branch">
          <input
            class="workspace-scm-input"
            data-scm-create-branch-name
            type="text"
            value="${escapeHtml(uiState.sourceControl.createBranchName)}"
            placeholder="Create branch"
            autocomplete="off"
            spellcheck="false"
          />
          <input
            class="workspace-scm-input"
            data-scm-create-branch-start
            type="text"
            value="${escapeHtml(uiState.sourceControl.createBranchStartPoint)}"
            placeholder="Start point (optional)"
            autocomplete="off"
            spellcheck="false"
          />
          <button type="submit" class="workspace-scm-primary-button">Create</button>
        </form>
        <input
          class="workspace-scm-input workspace-scm-search"
          data-scm-branch-search
          type="text"
          value="${escapeHtml(uiState.sourceControl.branchSearch)}"
          placeholder="Search branches"
          autocomplete="off"
          spellcheck="false"
        />
      </section>
      <div class="workspace-scm-branch-groups">
        ${renderSourceControlBranchGroup("Local", localBranches, { remote: false })}
        ${renderSourceControlBranchGroup("Remote", remoteBranches, { remote: true })}
      </div>
    </div>
  `;
}

function renderSourceControlBranchGroup(title, branches, { remote = false } = {}) {
  return `
    <section class="workspace-scm-section">
      <header class="workspace-scm-section-header">
        <div class="workspace-scm-section-title">
          <strong>${title}</strong>
          <span>${branches.length}</span>
        </div>
      </header>
      ${
        branches.length
          ? `
            <div class="workspace-scm-branch-list">
              ${branches.map((branch) => renderSourceControlBranchRow(branch, { remote })).join("")}
            </div>
          `
          : renderSourceControlEmpty(
              `No ${title.toLowerCase()} branches`,
              queryableEmptyCopy(title, remote),
            )
      }
    </section>
  `;
}

function renderSourceControlBranchRow(branch, { remote = false } = {}) {
  const actions = [];

  if (remote) {
    const branchName = branch.name.split("/").slice(1).join("/") || branch.name;
    actions.push(`
      <button
        type="button"
        class="workspace-scm-inline-action"
        data-action="scm-branch-from-remote"
        data-branch-name="${escapeHtml(branchName)}"
        data-start-point="${escapeHtml(branch.name)}"
      >
        Track
      </button>
    `);
  } else if (!branch.isCurrent) {
    actions.push(`
      <button
        type="button"
        class="workspace-scm-inline-action"
        data-action="scm-checkout-branch"
        data-branch-name="${escapeHtml(branch.name)}"
      >
        Checkout
      </button>
    `);
  }

  if (!remote) {
    actions.push(`
      <button
        type="button"
        class="workspace-scm-inline-action"
        data-action="scm-rename-branch"
        data-branch-name="${escapeHtml(branch.name)}"
      >
        Rename
      </button>
    `);

    if (!branch.isCurrent) {
      actions.push(`
        <button
          type="button"
          class="workspace-scm-inline-action is-danger"
          data-action="scm-delete-branch"
          data-branch-name="${escapeHtml(branch.name)}"
        >
          Delete
        </button>
      `);
    }

    if (branch.isCurrent && !branch.upstream) {
      actions.push(`
        <button
          type="button"
          class="workspace-scm-inline-action"
          data-action="scm-publish-branch"
          data-branch-name="${escapeHtml(branch.name)}"
        >
          Publish
        </button>
      `);
    }

    if (!branch.upstream) {
      actions.push(`
        <button
          type="button"
          class="workspace-scm-inline-action"
          data-action="scm-set-upstream"
          data-branch-name="${escapeHtml(branch.name)}"
          data-upstream-name="${escapeHtml(getSuggestedUpstream(branch.name))}"
        >
          Set upstream
        </button>
      `);
    }
  }

  return `
    <article class="workspace-scm-branch-row">
      <div class="workspace-scm-branch-copy">
        <div class="workspace-scm-branch-head">
          <strong>${escapeHtml(branch.name)}</strong>
          ${branch.isCurrent ? '<span class="workspace-scm-branch-badge">Current</span>' : ""}
        </div>
        <span>${escapeHtml(branch.subject || "No recent commit summary")}</span>
        <span>${escapeHtml([branch.shortOid, branch.relativeDate, branch.upstream].filter(Boolean).join(" • "))}</span>
      </div>
      <div class="workspace-scm-branch-actions">
        ${actions.join("")}
      </div>
    </article>
  `;
}

function renderSourceControlGraphTab(snapshot) {
  const selectedCommit = uiState.sourceControl.commitDetail;
  const loadingCommit = uiState.sourceControl.commitDetailLoading;
  const commits = snapshot.graph?.commits || [];

  return `
    <div class="workspace-scm-main workspace-scm-main-graph">
      <section class="workspace-scm-column workspace-scm-column-list">
        <div class="workspace-scm-graph-list">
          ${
            commits.length
              ? commits.map((commit) => renderSourceControlGraphRow(commit)).join("")
              : renderSourceControlEmpty(
                  "No commit history",
                  "CrewDock could not load a graph for this repository.",
                )
          }
        </div>
        ${
          snapshot.graph?.nextCursor
            ? `
              <button
                type="button"
                class="workspace-scm-load-more"
                data-action="scm-load-more-graph"
                data-cursor="${escapeHtml(snapshot.graph.nextCursor)}"
                ${uiState.sourceControl.graphLoadingMore ? "disabled" : ""}
              >
                ${uiState.sourceControl.graphLoadingMore ? "Loading…" : "Load more"}
              </button>
            `
            : ""
        }
      </section>
      <aside class="workspace-scm-column workspace-scm-column-detail">
        ${
          loadingCommit
            ? renderSourceControlEmpty("Loading commit", "CrewDock is collecting the selected commit details.")
            : selectedCommit
              ? renderSourceControlCommitDetail(selectedCommit)
              : renderSourceControlEmpty(
                  "Select a commit",
                  "Choose a commit to inspect its metadata, changed files, and branch actions.",
                )
        }
      </aside>
    </div>
  `;
}

function renderSourceControlGraphRow(commit) {
  const isSelected = uiState.sourceControl.selectedCommitOid === commit.oid;
  return `
    <button
      type="button"
      class="workspace-scm-graph-row ${isSelected ? "is-selected" : ""}"
      data-action="scm-select-commit"
      data-oid="${escapeHtml(commit.oid)}"
    >
      <span class="workspace-scm-graph-prefix" aria-hidden="true">${escapeHtml(commit.graphPrefix || "*")}</span>
      <span class="workspace-scm-graph-copy">
        <strong>${escapeHtml(commit.subject)}</strong>
        <span>${escapeHtml([commit.shortOid, commit.author, commit.relativeDate].filter(Boolean).join(" • "))}</span>
        ${
          commit.refs?.length
            ? `
              <span class="workspace-scm-ref-row">
                ${commit.refs.map((ref) => renderSourceControlRef(ref)).join("")}
              </span>
            `
            : ""
        }
      </span>
    </button>
  `;
}

function renderSourceControlRef(ref) {
  return `
    <span class="workspace-scm-ref-pill is-${escapeHtml(ref.kind)}">
      ${escapeHtml(ref.label)}
    </span>
  `;
}

function renderSourceControlCommitDetail(detail) {
  return `
    <div class="workspace-scm-detail-shell">
      <header class="workspace-scm-detail-header is-commit">
        <div>
          <p class="workspace-scm-detail-kicker">${escapeHtml(detail.shortOid)}</p>
          <strong>${escapeHtml(detail.subject)}</strong>
          <span>${escapeHtml([detail.author, detail.relativeDate].filter(Boolean).join(" • "))}</span>
        </div>
        <div class="workspace-scm-detail-actions">
          <button type="button" class="workspace-scm-inline-action" data-action="scm-copy-oid" data-oid="${escapeHtml(detail.oid)}">Copy SHA</button>
          <button type="button" class="workspace-scm-inline-action" data-action="scm-branch-from-commit" data-oid="${escapeHtml(detail.oid)}">Branch here</button>
        </div>
      </header>
      ${
        detail.body
          ? `<pre class="workspace-scm-commit-body">${escapeHtml(detail.body)}</pre>`
          : ""
      }
      ${
        detail.refs?.length
          ? `<div class="workspace-scm-ref-row is-detail">${detail.refs.map((ref) => renderSourceControlRef(ref)).join("")}</div>`
          : ""
      }
      <section class="workspace-scm-commit-files">
        <header class="workspace-scm-section-header">
          <div class="workspace-scm-section-title">
            <strong>Files</strong>
            <span>${detail.files.length}</span>
          </div>
        </header>
        <div class="workspace-scm-file-list">
          ${detail.files
            .map(
              (file) => `
                <article class="workspace-scm-file-row is-static">
                  <div class="workspace-scm-file-main is-static">
                    <span class="workspace-scm-file-status">${escapeHtml(file.status)}</span>
                    <span class="workspace-scm-file-copy">
                      <strong>${escapeHtml(splitGitFilePath(file.path).name)}</strong>
                      <span>${escapeHtml(file.originalPath ? `${file.path} • from ${file.originalPath}` : file.path)}</span>
                    </span>
                  </div>
                </article>
              `,
            )
            .join("")}
        </div>
      </section>
    </div>
  `;
}

function renderSourceControlTaskPanel(task) {
  if (!task) {
    return "";
  }

  return `
    <section class="workspace-scm-task">
      <header class="workspace-scm-task-header">
        <div>
          <p class="workspace-scm-detail-kicker">Task</p>
          <strong>${escapeHtml(task.title)}</strong>
          <span>${escapeHtml(formatSourceControlTaskStatus(task))}</span>
        </div>
        <span class="workspace-scm-task-command">${escapeHtml(task.command)}</span>
      </header>
      <pre class="workspace-scm-task-output">${escapeHtml(task.output || "Waiting for task output…")}</pre>
      ${
        task.canWriteInput
          ? `
            <form class="workspace-scm-task-form" data-action="scm-task-input">
              <input
                class="workspace-scm-input"
                data-scm-task-input-value
                type="text"
                value="${escapeHtml(uiState.sourceControl.taskInput)}"
                placeholder="Send input to Git task"
                autocomplete="off"
                spellcheck="false"
              />
              <button type="submit" class="workspace-scm-primary-button">Send</button>
            </form>
          `
          : ""
      }
    </section>
  `;
}

function renderSourceControlEmpty(title, copy) {
  return `
    <div class="workspace-git-empty">
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(copy)}</p>
    </div>
  `;
}

function getSourceControlDiffModes(file) {
  const modes = [];
  if (file?.worktreeStatus || file?.kind === "untracked") {
    modes.push({ id: "working-tree", label: "Working tree" });
  }
  if (file?.indexStatus) {
    modes.push({ id: "staged", label: "Staged" });
  }
  return modes.length ? modes : [{ id: "working-tree", label: "Working tree" }];
}

function formatSourceControlTaskStatus(task) {
  if (!task) {
    return "Idle";
  }

  switch (task.status) {
    case "failed":
      return "Failed";
    case "succeeded":
      return "Complete";
    default:
      return "Running";
  }
}

function queryableEmptyCopy(title, remote) {
  if (uiState.sourceControl.branchSearch.trim()) {
    return "Try a broader branch query.";
  }

  return remote
    ? "No remote tracking branches were returned for this repository."
    : `No ${title.toLowerCase()} branches are available right now.`;
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
    if (runtimeStore.gitRefreshIntervalTimer) {
      window.clearInterval(runtimeStore.gitRefreshIntervalTimer);
      runtimeStore.gitRefreshIntervalTimer = 0;
    }
    return;
  }

  if (runtimeStore.gitRefreshIntervalTimer) {
    return;
  }

  runtimeStore.gitRefreshIntervalTimer = window.setInterval(() => {
    if (isSourceControlTextEntryActive()) {
      return;
    }
    void refreshActiveWorkspaceGitStatus();
  }, GIT_REFRESH_INTERVAL_MS);
}

async function refreshActiveWorkspaceGitStatus({ force = false } = {}) {
  const workspaceId = uiState.snapshot?.activeWorkspaceId;
  if (!workspaceId || !bridge.refreshWorkspaceGitStatus) {
    return uiState.snapshot;
  }

  if (runtimeStore.gitRefreshInFlight) {
    runtimeStore.gitRefreshQueuedWorkspaceId = workspaceId;
    return runtimeStore.gitRefreshInFlight;
  }

  runtimeStore.gitRefreshInFlight = (async () => {
    try {
      const snapshot = await bridge.refreshWorkspaceGitStatus(workspaceId);
      uiState.snapshot = snapshot;
      render();
      if (uiState.gitPanelVisible && uiState.sourceControl.lastLoadedWorkspaceId === workspaceId) {
        void loadActiveWorkspaceSourceControl({ force: true });
      }
      return snapshot;
    } catch (error) {
      if (force) {
        console.error(error);
      }
      return uiState.snapshot;
    } finally {
      const queuedWorkspaceId = runtimeStore.gitRefreshQueuedWorkspaceId;
      runtimeStore.gitRefreshInFlight = null;
      runtimeStore.gitRefreshQueuedWorkspaceId = null;
      if (
        queuedWorkspaceId
        && queuedWorkspaceId === uiState.snapshot?.activeWorkspaceId
      ) {
        void refreshActiveWorkspaceGitStatus({ force: true });
      }
    }
  })();

  return runtimeStore.gitRefreshInFlight;
}

function escapeSelectorValue(value) {
  if (window.CSS?.escape) {
    return window.CSS.escape(String(value));
  }

  return String(value).replace(/["\\]/g, "\\$&");
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
  return `
    <article
      class="terminal-pane"
      data-pane-id="${escapeHtml(pane.id)}"
      data-status="${escapeHtml(pane.status)}"
      data-density="default"
      data-active="${uiState.activePaneId === pane.id ? "true" : "false"}"
    >
      <header class="terminal-pane-header">
        <div class="terminal-pane-title">
          <strong>Terminal ${paneIndex + 1}</strong>
        </div>
      </header>
      <div class="terminal-host" data-terminal-host="${escapeHtml(pane.id)}"></div>
    </article>
  `;
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

function resolveFallbackPaneIdAfterClose(workspace, paneId) {
  if (!workspace?.panes?.length) {
    return null;
  }

  const remainingPaneIds = workspace.panes
    .map((pane) => pane.id)
    .filter((entry) => entry !== paneId);
  if (!remainingPaneIds.length) {
    return null;
  }

  const paneIndex = workspace.panes.findIndex((pane) => pane.id === paneId);
  if (paneIndex < 0) {
    return remainingPaneIds[0];
  }

  const fallbackIndex = Math.min(paneIndex, remainingPaneIds.length - 1);
  return remainingPaneIds[fallbackIndex];
}

async function runPaneAction(action, paneId, options = {}) {
  const workspace = getActiveWorkspace();
  if (!workspace || !paneId || !workspace.panes.some((pane) => pane.id === paneId)) {
    return null;
  }

  if (action === "context-split-pane") {
    if (workspace.panes.length >= 16) {
      return resolveActivePaneId(workspace);
    }

    const previousPaneIds = new Set(workspace.panes.map((pane) => pane.id));
    uiState.snapshot = await bridge.splitPane(paneId, options.direction || "right");
    const nextWorkspace = uiState.snapshot?.activeWorkspace || null;
    const nextPaneId = nextWorkspace?.panes.find((pane) => !previousPaneIds.has(pane.id))?.id || paneId;
    return setActivePaneId(nextPaneId, nextWorkspace);
  }

  if (action === "context-close-pane") {
    if (workspace.panes.length <= 1) {
      return resolveActivePaneId(workspace);
    }

    const fallbackPaneId = resolveFallbackPaneIdAfterClose(workspace, paneId);
    if (uiState.maximizedPaneId === paneId) {
      uiState.maximizedPaneId = null;
    }

    clearSinglePaneBuffer(paneId);
    uiState.snapshot = await bridge.closePane(paneId);
    return setActivePaneId(fallbackPaneId, uiState.snapshot?.activeWorkspace || null);
  }

  if (action === "context-maximize-pane") {
    uiState.maximizedPaneId = uiState.maximizedPaneId === paneId ? null : paneId;
    return setActivePaneId(paneId, workspace);
  }

  return resolveActivePaneId(workspace);
}

async function handleContextMenuAction(target) {
  const action = target.dataset.action;
  const contextMenu = uiState.contextMenu;
  const workspace = uiState.snapshot?.activeWorkspace;
  if (!contextMenu || !workspace) {
    return;
  }

  const paneId = contextMenu.paneId;
  let focusPaneId = null;

  try {
    if (action === "context-copy-path") {
      await copyText(workspace.path);
    } else if (action === "context-show-in-finder") {
      await bridge.showInFinder(workspace.path);
    } else if (
      action === "context-split-pane"
      || action === "context-close-pane"
      || action === "context-maximize-pane"
    ) {
      focusPaneId = await runPaneAction(action, paneId, {
        direction: target.dataset.direction || "right",
      });
    }
  } catch (error) {
    console.error(error);
  } finally {
    uiState.contextMenu = null;
    render();
    focusPaneTerminal(focusPaneId);
  }
}

function mountWorkspaceTerminals(workspace, root = document) {
  const theme = getCurrentThemeDefinition();
  const terminalFontSize = getTerminalFontSize();

  for (const pane of workspace.panes) {
    const host = root.querySelector(`[data-terminal-host="${pane.id}"]`);
    if (!host) {
      continue;
    }

    const terminal = new Terminal({
      allowTransparency: true,
      cursorBlink: true,
      convertEol: true,
      fontFamily: '"SF Mono", "SFMono-Regular", "Menlo", monospace',
      fontSize: terminalFontSize,
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
      fontSize: terminalFontSize,
      element: host.closest(".terminal-pane"),
    };

    state.observer.observe(host);
    host.addEventListener("focusin", () => {
      setActivePaneId(pane.id, workspace);
    });
    host.addEventListener("pointerdown", () => {
      setActivePaneId(pane.id, workspace);
    });
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

  const initialPaneId = syncActivePaneId(workspace);
  if (initialPaneId) {
    focusPaneTerminal(initialPaneId);
  }
}

function syncWorkspace(workspace) {
  const theme = getCurrentThemeDefinition();
  const terminalFontSize = getTerminalFontSize();
  const nextPaneIds = workspace.panes.map((pane) => pane.id);
  const previousPaneIds = workspacePaneIds.get(workspace.id) || [];

  for (const pane of workspace.panes) {
    const paneElement = document.querySelector(`[data-pane-id="${pane.id}"]`);
    if (paneElement) {
      paneElement.dataset.status = pane.status;
    }
  }

  syncMountedTerminalAppearance(theme, terminalFontSize);

  for (const paneId of previousPaneIds) {
    if (!nextPaneIds.includes(paneId)) {
      disposeTerminal(paneId);
    }
  }

  workspacePaneIds.set(workspace.id, nextPaneIds);
  syncActivePaneSelection(workspace);
}

function isTerminalVisible(pane) {
  const host = pane?.terminal?.element?.parentElement;
  if (!(host instanceof HTMLElement) || !host.isConnected) {
    return false;
  }

  return host.getClientRects().length > 0;
}

function scheduleVisibleTerminalRefresh(workspace = getActiveWorkspace()) {
  if (runtimeStore.visibleTerminalRefreshFrame) {
    cancelAnimationFrame(runtimeStore.visibleTerminalRefreshFrame);
  }

  runtimeStore.visibleTerminalRefreshFrame = requestAnimationFrame(() => {
    runtimeStore.visibleTerminalRefreshFrame = requestAnimationFrame(() => {
      runtimeStore.visibleTerminalRefreshFrame = 0;
      for (const pane of workspace?.panes || []) {
        const paneState = paneTerminals.get(pane.id);
        if (!paneState || !isTerminalVisible(paneState)) {
          continue;
        }

        fitTerminal(pane.id);
        paneState.terminal.clearTextureAtlas();
        paneState.terminal.refresh(0, Math.max(0, paneState.terminal.rows - 1));
      }
    });
  });
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

  if (uiState.mountedWorkspaceId === workspaceId) {
    const stageRegion = app.querySelector('[data-region="stage"]');
    if (stageRegion) {
      stageRegion.innerHTML = "";
    }
    uiState.mountedWorkspaceId = null;
    uiState.mountedLayoutSignature = null;
  }

  discardCachedWorkspaceScreen(workspaceId, { dispose: false });
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
  if (!pane || !isTerminalVisible(pane)) {
    return;
  }

  syncPaneDensity(pane);
  pane.fitAddon.fit();
  const nextCols = pane.terminal.cols;
  const nextRows = pane.terminal.rows;

  if (pane.size.cols === nextCols && pane.size.rows === nextRows) {
    return;
  }

  pane.size = { cols: nextCols, rows: nextRows };
  bridge.resizePane(paneId, nextCols, nextRows).catch((error) => console.error(error));
}

function syncPaneDensity(pane) {
  const paneElement = pane?.element;
  if (!(paneElement instanceof HTMLElement)) {
    return;
  }

  const nextDensity = paneElement.clientHeight <= COMPACT_PANE_HEIGHT ? "compact" : "default";
  if (paneElement.dataset.density !== nextDensity) {
    paneElement.dataset.density = nextDensity;
  }
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
      hideSettingsSheet();
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
    if (document.activeElement === input && !select) {
      return;
    }
    input.focus();
    if (select) {
      input.select();
    }
  });
}

function captureLauncherInputState(root = app) {
  const input = root.querySelector("[data-launcher-path-input]");
  if (!(input instanceof HTMLInputElement)) {
    return null;
  }

  return {
    wasFocused: document.activeElement === input,
    selectionStart: input.selectionStart,
    selectionEnd: input.selectionEnd,
  };
}

function restoreLauncherInputState(state) {
  if (!state?.wasFocused) {
    return;
  }

  const input = app.querySelector("[data-launcher-path-input]");
  if (!(input instanceof HTMLInputElement)) {
    return;
  }

  requestAnimationFrame(() => {
    input.focus();
    const maxIndex = input.value.length;
    const selectionStart = Number.isFinite(state.selectionStart)
      ? Math.max(0, Math.min(maxIndex, state.selectionStart))
      : maxIndex;
    const selectionEnd = Number.isFinite(state.selectionEnd)
      ? Math.max(selectionStart, Math.min(maxIndex, state.selectionEnd))
      : selectionStart;
    input.setSelectionRange(selectionStart, selectionEnd);
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

  runtimeStore.launcherCardAnimationFrame = window.requestAnimationFrame(() => {
    uiState.launcherLatestCard = {
      ...uiState.launcherLatestCard,
      phase: "run",
    };
    render();

    runtimeStore.launcherCardTransitionTimer = window.setTimeout(() => {
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
  if (runtimeStore.launcherCardAnimationFrame) {
    window.cancelAnimationFrame(runtimeStore.launcherCardAnimationFrame);
    runtimeStore.launcherCardAnimationFrame = 0;
  }

  if (runtimeStore.launcherCardTransitionTimer) {
    window.clearTimeout(runtimeStore.launcherCardTransitionTimer);
    runtimeStore.launcherCardTransitionTimer = 0;
  }
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
