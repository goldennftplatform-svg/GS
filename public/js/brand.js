/**
 * SKULLBOND brand tokens — single source of truth.
 * Rebrand here; CSS variables are pushed onto :root and JS imports BRAND.
 */
export const BRAND = {
  org: 'NSES',
  title: 'SKULLBOND',
  tagline: 'SHOOT FIRST. RESPAWN FASTER.',
  red: '#e5392d',
  cream: '#fff2b3',
  green: '#6baf6e',
  greenDark: '#2e6e3e',
  dark: '#10140f',
  font: '"Press Start 2P", monospace',
};

if (typeof document !== 'undefined') {
  const s = document.documentElement.style;
  s.setProperty('--red', BRAND.red);
  s.setProperty('--cream', BRAND.cream);
  s.setProperty('--green', BRAND.green);
  s.setProperty('--green-dark', BRAND.greenDark);
}
