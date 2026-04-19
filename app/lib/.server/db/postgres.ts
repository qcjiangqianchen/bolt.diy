import type { AppLoadContext } from '@remix-run/cloudflare';
import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { getAuthEnv } from '~/lib/auth/env.server';

let pool: Pool | undefined;
let poolConnectionString: string | undefined;

export function getDatabaseUrl(context: AppLoadContext): string | undefined {
  const env = getAuthEnv(context);
  return env.DATABASE_URL?.trim() || undefined;
}

export function isPostgresConfigured(context: AppLoadContext): boolean {
  return Boolean(getDatabaseUrl(context));
}

async function getPool(context: AppLoadContext): Promise<Pool> {
  const connectionString = getDatabaseUrl(context);

  if (!connectionString) {
    throw new Error('DATABASE_URL is not configured');
  }

  if (pool && poolConnectionString === connectionString) {
    return pool;
  }

  const pg = await import('pg');

  pool = new pg.Pool({
    connectionString,
  });
  poolConnectionString = connectionString;

  return pool;
}

export async function queryPostgres<T extends QueryResultRow = QueryResultRow>(
  context: AppLoadContext,
  text: string,
  values: unknown[] = [],
): Promise<QueryResult<T>> {
  const resolvedPool = await getPool(context);
  return resolvedPool.query<T>(text, values);
}

export async function withPostgresTransaction<T>(
  context: AppLoadContext,
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const resolvedPool = await getPool(context);
  const client = await resolvedPool.connect();

  try {
    await client.query('begin');

    const result = await callback(client);
    await client.query('commit');

    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
