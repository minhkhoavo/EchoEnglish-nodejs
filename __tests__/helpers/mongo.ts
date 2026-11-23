import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

let server: MongoMemoryServer | undefined;

/** Start an in-memory MongoDB and connect mongoose. Call in beforeAll. */
export async function startMongo(): Promise<void> {
    server = await MongoMemoryServer.create();
    await mongoose.connect(server.getUri(), { dbName: 'recsys_test' });
}

/** Sync indexes for the given models (unique/TTL indexes matter for behaviour). */
export async function syncIndexes(
    ...models: Array<{ syncIndexes(): Promise<unknown> }>
) {
    for (const m of models) await m.syncIndexes();
}

export async function clearDb(): Promise<void> {
    const cols = await mongoose.connection.db!.collections();
    await Promise.all(cols.map((c) => c.deleteMany({})));
}

export async function stopMongo(): Promise<void> {
    await mongoose.disconnect();
    await server?.stop();
}
