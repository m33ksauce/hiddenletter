/** Dev-only tooling: shape preview screen and local capture scripts. */
export function isDebugToolsEnabled(): boolean {
  return import.meta.env.VITE_DEBUG_TOOLS === 'true'
}
