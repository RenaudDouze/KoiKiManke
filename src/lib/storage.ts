import type { ListState } from "../../shared/types";

export interface RecentList {
  code: string;
  name: string;
  lastOpened: number;
}

const RECENT_KEY = "nldc:recent";
const CACHE_PREFIX = "nldc:cache:";
const MAX_RECENT = 20;

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function getRecentLists(): RecentList[] {
  const list = safeParse<RecentList[]>(localStorage.getItem(RECENT_KEY)) ?? [];
  return list.sort((a, b) => b.lastOpened - a.lastOpened);
}

export function touchRecentList(code: string, name: string): void {
  const list = getRecentLists().filter((l) => l.code !== code);
  list.unshift({ code, name, lastOpened: Date.now() });
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
  } catch {
    // storage full or unavailable, ignore
  }
}

export function forgetRecentList(code: string): void {
  const list = getRecentLists().filter((l) => l.code !== code);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // ignore
  }
}

export function cacheListState(state: ListState): void {
  try {
    localStorage.setItem(CACHE_PREFIX + state.code, JSON.stringify(state));
  } catch {
    // ignore
  }
}

export function getCachedListState(code: string): ListState | null {
  return safeParse<ListState>(localStorage.getItem(CACHE_PREFIX + code));
}
