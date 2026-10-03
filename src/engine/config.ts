export const dynamicalCatalogUrl = (import.meta.env.VITE_DYNAMICAL_CATALOG_URL ?? '').trim();
export const sourceCoopUrl = (import.meta.env.VITE_SOURCE_COOP_URL ?? '').trim().replace(/\/$/, '');

export function dynamicalDatasetId(url: URL): string | null {
  if (!dynamicalCatalogUrl) return null;
  const catalog = new URL(dynamicalCatalogUrl);
  const base = new URL('.', catalog);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return null;
  return url.pathname.slice(base.pathname.length).split('/')[0] || null;
}
