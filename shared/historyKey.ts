/** Lowercased, trimmed dedupe key for a suggestion/history entry — shared
 * between the reducer (worker/reducer.ts) and the client (src/views/list.ts,
 * which uses it to optimistically retag a renamed row's data-key before the
 * round trip confirms, see openSuggestionManager). */
export function historyKey(name: string): string {
  return name.trim().toLowerCase();
}
