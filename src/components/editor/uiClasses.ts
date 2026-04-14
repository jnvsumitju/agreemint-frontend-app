/** Shared Tailwind class strings for editor UI components. */

/** Standard responsive input field (number/text). */
export const INPUT_CLASS =
  'min-w-0 rounded border border-zinc-300 px-1.5 py-0.5 text-xs lg:px-2 lg:py-1 lg:text-sm dark:border-zinc-600 dark:bg-zinc-800'

/** Monospace variant for data keys, JSON, code. */
export const MONO_INPUT_CLASS =
  'rounded border border-zinc-300 px-1.5 py-0.5 font-mono text-xs lg:px-2 lg:py-1 lg:text-sm dark:border-zinc-600 dark:bg-zinc-800'

/** Flex-column label wrapper with responsive text. */
export const LABEL_CLASS = 'flex flex-col gap-1 text-[10px] lg:text-xs'

/** Flex-row checkbox label with responsive text. */
export const CHECKBOX_LABEL_CLASS = 'flex items-center gap-2 text-[10px] lg:text-xs'

/** Uppercase section header. */
export const SECTION_HEADER_CLASS =
  'text-[10px] font-semibold uppercase tracking-wide text-zinc-500 lg:text-xs'

/** Small descriptive paragraph text. */
export const DESCRIPTION_CLASS =
  'text-[9px] leading-snug text-zinc-600 lg:text-[11px] dark:text-zinc-400'

/** Zinc-themed action button. */
export const BUTTON_CLASS =
  'rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-[9px] font-medium text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 lg:text-[11px] dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700'

/** Violet-themed highlight button. */
export const BUTTON_HIGHLIGHT_CLASS =
  'rounded-md border border-violet-300 bg-white px-2.5 py-1.5 text-[9px] font-medium text-violet-900 hover:bg-violet-50 lg:text-[11px] dark:border-violet-600 dark:bg-violet-900/40 dark:text-violet-100 dark:hover:bg-violet-900/70'

/** Red-themed danger button. */
export const BUTTON_DANGER_CLASS =
  'rounded-md border border-red-200 bg-white px-2.5 py-1.5 text-[9px] font-medium text-red-700 hover:bg-red-50 lg:text-[11px] dark:border-red-900 dark:bg-red-950/30 dark:text-red-300 dark:hover:bg-red-950/50'

/** Compact toolbar chip button. */
export const TOOLBAR_CHIP_CLASS =
  'rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-[10px] font-medium hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 lg:px-2 lg:py-1 lg:text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:hover:bg-zinc-700'

/** Emerald-themed toolbar chip. */
export const TOOLBAR_CHIP_HIGHLIGHT_CLASS =
  'rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-900 hover:bg-emerald-100 lg:px-2 lg:py-1 lg:text-xs dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-100 dark:hover:bg-emerald-900/40'

/** Small delete/remove link. */
export const DELETE_LINK_CLASS =
  'text-[10px] text-red-600 hover:underline lg:text-xs'

/** Icon-only toolbar button (28×28 / lg 32×32). */
export const TOOLBAR_ICON_BTN =
  'flex h-7 w-7 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-600 transition-colors hover:bg-zinc-50 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-30 lg:h-8 lg:w-8 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700 dark:hover:text-zinc-100'

/** Active/pressed variant of the icon button (violet accent). */
export const TOOLBAR_ICON_BTN_ACTIVE =
  'flex h-7 w-7 items-center justify-center rounded-md border border-violet-500 bg-violet-100 text-violet-900 transition-colors disabled:cursor-not-allowed disabled:opacity-30 lg:h-8 lg:w-8 dark:border-violet-500 dark:bg-violet-950/60 dark:text-violet-100'

/** Thin vertical divider between toolbar groups. */
export const TOOLBAR_DIVIDER =
  'mx-1 hidden h-5 w-px shrink-0 bg-zinc-200 sm:block dark:bg-zinc-700'
