import { recsysConfig } from '../config.js';
import { Warehouse } from './clickhouse.js';
import { loadBatch } from './loader.js';
import { kafkaClientConfig } from '../stream/kafkaConfig.js';
import { sweepRecentTombstones } from './erasure.js';

export interface LoaderHandle {
    stop(): Promise<void>;
}

/**
 * Long-running consumer: topic `<base>.<region>` → ClickHouse. Offsets are committed only after
 * the insert succeeded (at-least-once; ReplacingMergeTree absorbs re-delivery). Runs as its own
 * process (`npm run recsys:loader`), never inside the API.
 */
export async function runLoader(opts: {
    region: string;
    wh: Warehouse;
    brokers?: string[];
}): Promise<LoaderHandle> {
    const brokers = opts.brokers ?? recsysConfig.stream.brokers();
    if (brokers.length === 0)
        throw new Error('RECSYS_STREAM_BROKERS is not configured');
    const { KafkaJS } = await import('@confluentinc/kafka-javascript');
    const topic = `${recsysConfig.stream.topicBase()}.${opts.region}`;
    const settings = kafkaClientConfig(
        brokers,
        `${recsysConfig.stream.clientId()}-loader`
    );
    const kafka = new KafkaJS.Kafka({
        kafkaJS: settings.kafkaJS,
        ...settings.extra,
    });
    const consumer = kafka.consumer({
        kafkaJS: {
            groupId: `echo-warehouse-loader-${opts.region}`,
            fromBeginning: true,
            autoCommit: false,
        },
    });
    await consumer.connect();
    await consumer.subscribe({ topic });
    await consumer.run({
        eachBatchAutoResolve: false,
        eachBatch: async ({ batch, resolveOffset, heartbeat }) => {
            const values = batch.messages.map((m) => m.value?.toString() ?? '');
            const r = await loadBatch(values, opts.wh, { region: opts.region });
            if (r.invalid || r.erased || r.wrongRegion)
                console.warn(`[recsys] loader dropped ${JSON.stringify(r)}`);
            const last = batch.messages[batch.messages.length - 1];
            if (last) resolveOffset(last.offset);
            await heartbeat();
            await consumer.commitOffsets([
                {
                    topic,
                    partition: batch.partition,
                    offset: (BigInt(last?.offset ?? '0') + 1n).toString(),
                },
            ]);
        },
    });
    const sweep = setInterval(() => {
        sweepRecentTombstones(opts.wh).catch((e) =>
            console.error(
                '[recsys] erasure sweep failed:',
                (e as Error).message
            )
        );
    }, 60_000);
    return {
        async stop() {
            clearInterval(sweep);
            await consumer.disconnect();
        },
    };
}
