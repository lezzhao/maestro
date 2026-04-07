/**
 * Centralized default values for the frontend.
 */

/** Fallback engine id when no engines are configured. */
export const DEFAULT_ENGINE_ID = "cursor";

/** Fallback profile id when engine has no profiles. */
export const DEFAULT_PROFILE_ID = "default";

/** Unified Z-Index hierarchy for consistent layering. */
export const Z_INDEX = {
  /** Baseline level for normal layout elements. */
  BASE: 0,
  /** Sidebars and status bars. */
  SIDEBAR: 30,
  /** Non-blocking overlays, dropdowns, and context menus. */
  DROPDOWN: 50,
  /** Secondary sliding panels (e.g., Engine Config). */
  DRAWER: 80,
  /** Primary blocking modal dialogs (e.g., Workspace Creation). */
  DIALOG: 100,
  /** Top-most system alerts and tooltips. */
  TOOLTIP: 200,
  /** Absolute top-level notifications (e.g., Toasts). */
  TOAST: 500,
} as const;
