export const WORK_INSTRUCTION_EDITOR_SELECT_CLASS_NAME =
  'min-h-11 min-w-0 rounded border border-white/30 bg-slate-950 !bg-slate-950 px-2 text-sm text-white !text-white [color-scheme:dark] focus:border-cyan-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300';

export const WORK_INSTRUCTION_EDITOR_OPTION_CLASS_NAME =
  'bg-slate-950 !bg-slate-950 text-sm text-white !text-white [color-scheme:dark]';

/**
 * The shared Input component intentionally defaults to a light form control.
 * Keep this override local to the dark editor inspector and make it
 * important so Tailwind's generated component order cannot wash out values.
 */
export const WORK_INSTRUCTION_EDITOR_INPUT_CLASS_NAME =
  'bg-slate-950 !bg-slate-950 text-white !text-white placeholder:text-white/50 placeholder:!text-white/50';
