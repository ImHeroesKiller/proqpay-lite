export function d1(env) {
  const database = env?.DB;
  if (!database?.prepare || !database?.batch) {
    throw new Error('D1 binding DB belum dikonfigurasi');
  }
  return database;
}

export function hasD1(env) {
  return Boolean(env?.DB?.prepare && env?.DB?.batch);
}

export async function d1All(database, statement, bindings = []) {
  const result = await database.prepare(statement).bind(...bindings).all();
  return result.results || [];
}

export async function d1First(database, statement, bindings = []) {
  return database.prepare(statement).bind(...bindings).first();
}

export async function d1Run(database, statement, bindings = []) {
  return database.prepare(statement).bind(...bindings).run();
}

export async function d1Batch(database, operations) {
  if (!Array.isArray(operations) || operations.length === 0) return [];
  return database.batch(
    operations.map(({ statement, bindings = [] }) =>
      database.prepare(statement).bind(...bindings)
    )
  );
}
