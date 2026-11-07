export interface Pagination {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
}

export function ok<T>(data: T): { data: T } {
  return { data };
}

export function paginated<T>(data: T[], meta: Pagination): { data: T[]; meta: Pagination } {
  return { data, meta };
}

export function buildPagination(page: number, perPage: number, total: number): Pagination {
  return {
    page,
    per_page: perPage,
    total,
    total_pages: Math.ceil(total / perPage),
  };
}
