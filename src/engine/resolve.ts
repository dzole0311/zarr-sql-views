import { readDatacube, type Datacube } from './datacube';

export { dynamicalCatalogUrl as AIFS } from './config';

/** Normalize public store URLs; reject credentials before converting S3 paths. */
export function normalizeUrl(input: string) {
  const u = new URL(input);
  if (u.username || u.password)
    throw Error('Embedded credentials are not supported. Use a public CORS-enabled store.');
  if (u.protocol === 's3:') return `https://${u.hostname}.s3.amazonaws.com${u.pathname}`;
  if (!['https:', 'http:'].includes(u.protocol))
    throw Error('Use an HTTP, HTTPS, or public S3 URL.');

  return u.href.replace(/\/$/, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Resolve a collection asset or direct store while rejecting unsupported virtual chunks. */
export async function resolveStore(input: string) {
  let url = normalizeUrl(input);
  let title = 'Remote dataset';
  let variables: string[] = [];
  let cube: Datacube = { dimensions: {}, variables: {} };
  if (new URL(url).pathname.endsWith('.json')) {
    const doc = await json(url);
    if (doc.type === 'Catalog') throw Error('Choose a dataset from this catalog first.');
    if (doc.type !== 'Collection' && doc.type !== 'Feature')
      throw Error('Expected a STAC Collection or Item.');
    title = documentTitle(doc, title);
    const assets = isRecord(doc.assets) ? doc.assets : {};
    const supported = (value: unknown): value is Record<string, unknown> & { href: string } =>
      isRecord(value) && typeof value.href === 'string';
    const preferred = assets['icechunk-https'];

    const asset = supported(preferred)
      ? preferred
      : Object.values(assets)
          .filter(supported)
          .find((value) => /zarr|icechunk/.test(`${value.type ?? ''} ${value.href}`));

    if (!asset) throw Error('This collection has no supported Zarr or Icechunk asset.');

    cube = readDatacube(
      doc.type === 'Feature' && isRecord(doc.properties) ? doc.properties : doc,
      asset,
    );

    variables = Object.keys(cube.variables);
    const containers = asset['icechunk:virtual_chunk_containers'];
    if (
      Array.isArray(containers) &&
      containers.some(
        (container) =>
          isRecord(container) &&
          typeof container.url_prefix === 'string' &&
          /^(s3|gs|file):/.test(container.url_prefix),
      )
    )
      throw Error(
        'This virtual dataset references external cloud chunks that zarr-sql-views’s browser reader cannot load yet. Choose the regular, non-virtual dataset instead.',
      );

    url = normalizeUrl(new URL(asset.href, url).href);
  }

  return { url, title, variables, cube, icechunk: /icechunk(?:\/|$)/.test(new URL(url).pathname) };
}

async function json(url: string): Promise<Record<string, unknown>> {
  const r = await fetch(url);
  if (!r.ok)
    throw Error(`Catalog returned HTTP ${r.status}. Check the URL and access permissions.`);
  const value: unknown = await r.json();
  if (!isRecord(value)) throw Error('Expected a STAC JSON object.');

  return value;
}

function documentTitle(doc: Record<string, unknown>, fallback: string) {
  return typeof doc.title === 'string' && doc.title
    ? doc.title
    : typeof doc.id === 'string' && doc.id
      ? doc.id
      : fallback;
}

export type CatalogChoice = { title: string; url: string };

/** List unique child links, or return null when the URL is a collection or direct store. */
export async function readCatalog(
  input: string,
): Promise<{ title: string; choices: CatalogChoice[] } | null> {
  const url = normalizeUrl(input);
  if (!new URL(url).pathname.endsWith('.json')) return null;
  const doc = await json(url);
  if (doc.type !== 'Catalog') return null;
  const seen = new Set<string>();
  const choices: CatalogChoice[] = [];
  for (const link of Array.isArray(doc.links) ? doc.links : []) {
    if (!isRecord(link) || link.rel !== 'child' || typeof link.href !== 'string') continue;
    const href = normalizeUrl(new URL(link.href, url).href);
    if (seen.has(href)) continue;
    seen.add(href);
    const parts = new URL(href).pathname.split('/').filter(Boolean);

    choices.push({
      url: href,
      title:
        typeof link.title === 'string' && link.title
          ? link.title
          : (parts.at(-2) ?? parts.at(-1) ?? href).replaceAll('-', ' '),
    });
  }
  if (!choices.length)
    throw Error('This catalog has no child datasets. Enter a collection or store URL.');

  return { title: documentTitle(doc, 'Dataset catalog'), choices };
}
