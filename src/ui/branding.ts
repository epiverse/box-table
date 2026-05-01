// BoxTable wordmark. Inline SVG icon (a 16px stroked square split into a
// 2x2 grid — reads as both "box" and "cells of a table") + the wordmark
// "Box" in Box-blue and "Table" in the foreground color.

const ICON_SVG = `
  <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
    <rect x="2" y="2" width="18" height="18" rx="3" stroke="currentColor" stroke-width="1.75"/>
    <line x1="2" y1="11" x2="20" y2="11" stroke="currentColor" stroke-width="1.25"/>
    <line x1="11" y1="2" x2="11" y2="20" stroke="currentColor" stroke-width="1.25"/>
  </svg>
`.trim();

export function renderBrand(target: HTMLElement): void {
  target.innerHTML = `
    <span class="brand">
      <span class="brand__icon">${ICON_SVG}</span>
      <span class="brand__word"><span class="brand__box">Box</span><span class="brand__table">Table</span></span>
    </span>
  `;
}
