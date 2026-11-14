import { NextResponse } from 'next/server';
import { getDb } from '@i-renovation/shared';
import { sql } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';

export async function GET() {
  try {
    await (await getDb()).execute(sql`select 1`);
    return NextResponse.json({ ok: true, service: 'i-renovation-web', database: 'ready' });
  } catch (e) {
    const err = e as Error & { cause?: unknown };
    console.error('[health] database unavailable', e);
    const cause = err.cause instanceof Error ? `${err.cause.name}: ${err.cause.message}` : err.cause ? String(err.cause) : null;
    const probes = [
      '/tmp/pglite-data',
      path.join(process.cwd(), '.pglite-seed'),
      path.join(process.cwd(), 'apps', 'web', '.pglite-seed'),
    ].map((d) => ({ d, exists: fs.existsSync(d), n: fs.existsSync(d) ? fs.readdirSync(d).length : 0 }));
    return NextResponse.json(
      { ok: false, database: 'unavailable', detail: `${err.name}: ${err.message}`, cause, stack: (err.stack || '').split('\n').slice(0, 5), cwd: process.cwd(), probes },
      { status: 503 },
    );
  }
}
