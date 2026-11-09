/**
 * OPT-IN: the Kafka client against a SECURED broker (SASL/SCRAM-SHA-256 over TLS, private CA).
 * Set up (see docs/recommendation/05-deployment.md §5b) then:
 *   RECSYS_LIVE_KAFKA_SECURE=localhost:19092 RECSYS_LIVE_KAFKA_CA=/path/ca.crt \
 *   RECSYS_LIVE_KAFKA_USER=admin RECSYS_LIVE_KAFKA_PASS=... npx jest __tests__/live/kafkaSecure
 */
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import {
    startMongo,
    stopMongo,
    clearDb,
    syncIndexes,
} from '../helpers/mongo.js';
import { CleanEvent, PipelineLock } from '~/recsys/etl/models.js';
import { Consent, ConsentLedger } from '~/recsys/privacy/consentModel.js';
import { consentService } from '~/recsys/privacy/consentService.js';
import { StreamExporter } from '~/recsys/stream/exporter.js';
import { ErasureTombstone } from '~/recsys/stream/erasure.js';
import { createKafkaProducer } from '~/recsys/stream/producer.js';
import { kafkaClientConfig } from '~/recsys/stream/kafkaConfig.js';

jest.setTimeout(180_000);
const BROKER = process.env.RECSYS_LIVE_KAFKA_SECURE;
const CA = process.env.RECSYS_LIVE_KAFKA_CA;
const USER = process.env.RECSYS_LIVE_KAFKA_USER ?? 'admin';
const PASS = process.env.RECSYS_LIVE_KAFKA_PASS ?? '';
const maybe = BROKER && CA ? describe : describe.skip;
const run = randomUUID().slice(0, 8);

const secureEnv = (over: Record<string, string | undefined> = {}) => ({
    RECSYS_STREAM_BROKERS: BROKER,
    RECSYS_STREAM_TLS: 'true',
    RECSYS_STREAM_TLS_CA_FILE: CA,
    RECSYS_STREAM_SASL_USERNAME: USER,
    RECSYS_STREAM_SASL_PASSWORD: PASS,
    ...over,
});
function setEnv(env: Record<string, string | undefined>) {
    for (const k of [
        'RECSYS_STREAM_TLS',
        'RECSYS_STREAM_TLS_CA_FILE',
        'RECSYS_STREAM_SASL_USERNAME',
        'RECSYS_STREAM_SASL_PASSWORD',
    ])
        delete process.env[k];
    for (const [k, v] of Object.entries(env))
        if (v !== undefined) process.env[k] = v;
}
const within = <T>(p: Promise<T>, ms: number) =>
    Promise.race([
        p,
        new Promise<never>((_, rej) =>
            setTimeout(() => rej(new Error(`still pending after ${ms} ms`)), ms)
        ),
    ]);

beforeAll(async () => {
    process.env.RECSYS_PSEUDONYM_SALT = 'secure-test-salt-0123456789';
    process.env.RECSYS_STREAM_TOPIC = `sec.${run}`;
    process.env.RECSYS_REGIONS = 'vn';
    await startMongo();
    await syncIndexes(
        CleanEvent,
        PipelineLock,
        Consent,
        ConsentLedger,
        ErasureTombstone
    );
});
afterAll(stopMongo);
beforeEach(clearDb);
afterEach(() => setEnv({}));

maybe('LIVE secured Redpanda (SASL/SCRAM-SHA-256 + TLS, private CA)', () => {
    it('exports and a second authenticated client reads the data back', async () => {
        setEnv(secureEnv());
        const u = new mongoose.Types.ObjectId().toString();
        await consentService.update(u, { analytics: true });
        for (let i = 0; i < 3; i++)
            await CleanEvent.create({
                eventId: randomUUID(),
                rawId: new mongoose.Types.ObjectId(),
                userId: u,
                type: 'session_started',
                occurredAt: new Date(),
                day: '2026-03-10',
                hour: 9,
                props: {},
                pipelineVersion: '1',
                runId: 'r',
                receivedAt: new Date(),
            });
        const producer = await createKafkaProducer();
        const res = await new StreamExporter({ producer }).runOnce();
        await producer.disconnect();
        expect(res).toMatchObject({ status: 'ok', exported: 3 });

        const { KafkaJS } = await import('@confluentinc/kafka-javascript');
        const s = kafkaClientConfig([BROKER!], 'sec-check');
        const kafka = new KafkaJS.Kafka({ kafkaJS: s.kafkaJS, ...s.extra });
        const c = kafka.consumer({
            kafkaJS: { groupId: `g-${run}`, fromBeginning: true },
        });
        await c.connect();
        await c.subscribe({ topic: `sec.${run}.vn` });
        const got: string[] = [];
        await within(
            new Promise<void>((resolve) => {
                void c.run({
                    eachMessage: async ({ message }) => {
                        got.push(message.value!.toString());
                        if (got.length >= 3) resolve();
                    },
                });
            }),
            40_000
        );
        await c.disconnect();
        expect(got).toHaveLength(3);
    });

    it('REFUSES a wrong password', async () => {
        setEnv(secureEnv({ RECSYS_STREAM_SASL_PASSWORD: 'definitely-wrong' }));
        await expect(within(createKafkaProducer(), 60_000)).rejects.toThrow();
    });

    it('REFUSES an unauthenticated plaintext client', async () => {
        setEnv({ RECSYS_STREAM_BROKERS: BROKER });
        await expect(within(createKafkaProducer(), 60_000)).rejects.toThrow();
    });

    it('REFUSES TLS with the right password when the broker CA is not trusted', async () => {
        setEnv(secureEnv({ RECSYS_STREAM_TLS_CA_FILE: undefined })); // system roots only; broker uses a private CA
        await expect(within(createKafkaProducer(), 60_000)).rejects.toThrow();
    });
});
