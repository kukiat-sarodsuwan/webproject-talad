const paths = {
  market: '<path d="M3 9l2-5h14l2 5M4 13v7h16v-7M9 20v-5h6v5M3 9v2a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0V9Z"/>',
  cart: '<path d="M2 3h3l3 12h11l3-9H6"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/>',
  receipt: '<path d="M5 3l3 2 4-2 4 2 3-2v18l-3-2-4 2-4-2-3 2ZM8 9h8M8 13h6"/>',
  box: '<path d="m3 7 9-4 9 4v10l-9 4-9-4ZM3 7l9 4 9-4m-9 4v10M7.5 5l9 4"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="1.5"/><path d="m3 17 5-5 4 4 4-5 5 6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2m0-14-2 2M7 17l-2 2"/><circle cx="12" cy="12" r="7"/>',
  team: '<circle cx="9" cy="8" r="3"/><path d="M2 21v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v2m1-16a3 3 0 0 1 0 6m1 3a5 5 0 0 1 4 5v2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5v2"/>',
  shield: '<path d="m12 2 8 4v6c0 4-4 8-8 10-4-2-8-6-8-10V6Z"/><path d="m8 12 3 3 5-6"/>',
  key: '<circle cx="8" cy="9" r="5"/><path d="m12 13 8 8m-4-4 3-3m-1 5 3-3"/>',
  exit: '<path d="M10 3H4v18h6m4-14 5 5-5 5m-5-5h10"/>',
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2"/>',
  link: '<path d="M14 4h6v6m0-6-9 9m8 0v7H4V5h7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>'
};

export function icon(name) {
  return `<svg class="icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name]}</svg>`;
}
