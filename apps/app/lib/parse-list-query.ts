export interface ListQuery {
  page: number;
  per: number;
  skip: number;
  take: number;
  sort: string;
  filters: Record<string, string>;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseListQuery(
  searchParams: Record<string, string | string[] | undefined>,
  opts: { defaultPer?: number; maxPer?: number; knownFilters?: string[] } = {}
): ListQuery {
  const defaultPer = opts.defaultPer ?? 25;
  const maxPer = opts.maxPer ?? 100;
  const rawPage = Number(first(searchParams.page) ?? 1);
  const rawPer = Number(first(searchParams.per) ?? defaultPer);
  const page = Number.isFinite(rawPage) ? Math.max(1, rawPage) : 1;
  const per = Number.isFinite(rawPer) ? Math.min(maxPer, Math.max(1, rawPer)) : defaultPer;
  const sort = first(searchParams.sort) ?? '-createdAt';
  const filters: Record<string, string> = {};

  for (const key of opts.knownFilters ?? []) {
    const value = first(searchParams[key]);
    if (value) filters[key] = value;
  }

  return {
    page,
    per,
    skip: (page - 1) * per,
    take: per,
    sort,
    filters,
  };
}
