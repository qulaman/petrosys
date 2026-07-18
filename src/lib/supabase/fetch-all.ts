/**
 * Постраничная выгрузка ВСЕХ строк запроса.
 *
 * PostgREST (Supabase) молча режет любой запрос до max-rows (по умолчанию 1000),
 * включая явные .limit()/.range() — «сырые» выборки событий за период обязаны
 * идти через этот хелпер, иначе агрегаты занижаются без единой ошибки.
 *
 * Запрос ДОЛЖЕН иметь детерминированный порядок (например .order("id")),
 * иначе страницы могут пересекаться.
 */
const PAGE = 1000; // = серверный max-rows; страница короче PAGE означает конец данных

export async function fetchAll<T>(
  makePage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await makePage(from, from + PAGE - 1);
    if (error) throw new Error(`fetchAll: ${error.message}`);
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < PAGE) break;
  }
  return all;
}
