// Petit jeu d'icônes SVG cohérentes (trait 2px, currentColor) pour remplacer
// les emoji dans l'interface : rendu identique sur toutes les plateformes,
// contrairement aux polices d'emoji système qui varient beaucoup.

function svg(inner: string, { filled = false }: { filled?: boolean } = {}): string {
  const style = filled
    ? 'fill="currentColor" stroke="none"'
    : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  return `<svg viewBox="0 0 24 24" width="1em" height="1em" ${style} aria-hidden="true" focusable="false">${inner}</svg>`;
}

export const icons = {
  back: svg('<path d="M19 12H5M12 19l-7-7 7-7"/>'),
  share: svg(
    '<path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11 5"/><path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07L13 19"/>',
  ),
  more: svg('<circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/>', { filled: true }),
  close: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
  trash: svg(
    '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/>',
  ),
  gripVertical: svg(
    '<circle cx="9" cy="5" r="1.3"/><circle cx="9" cy="12" r="1.3"/><circle cx="9" cy="19" r="1.3"/><circle cx="15" cy="5" r="1.3"/><circle cx="15" cy="12" r="1.3"/><circle cx="15" cy="19" r="1.3"/>',
    { filled: true },
  ),
  cart: svg(
    '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>',
  ),
  sun: svg(
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  ),
  moon: svg('<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'),
  themeAuto: svg(
    '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/>',
  ),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  star: svg('<path d="M12 2.5l2.9 6.1 6.6.9-4.8 4.7 1.1 6.6-5.8-3.1-5.8 3.1 1.1-6.6-4.8-4.7 6.6-.9z"/>'),
  starFilled: svg('<path d="M12 2.5l2.9 6.1 6.6.9-4.8 4.7 1.1 6.6-5.8-3.1-5.8 3.1 1.1-6.6-4.8-4.7 6.6-.9z"/>', { filled: true }),
  users: svg(
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  ),
  sort: svg('<path d="M7 15l5 5 5-5"/><path d="M7 9l5-5 5 5"/>'),
  tag: svg(
    '<path d="M12.59 2.59A2 2 0 0 0 11.17 2H4a2 2 0 0 0-2 2v7.17a2 2 0 0 0 .59 1.42l8.82 8.82a2 2 0 0 0 2.83 0l7.17-7.17a2 2 0 0 0 0-2.83Z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  ),
  history: svg('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>'),
  checkCircle: svg('<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>'),
  download: svg('<path d="M12 3v13"/><path d="m7 11 5 5 5-5"/><path d="M4 21h16"/>'),
  upload: svg('<path d="M12 20V7"/><path d="m7 12 5-5 5 5"/><path d="M4 21h16"/>'),
} as const;

export type IconName = keyof typeof icons;
