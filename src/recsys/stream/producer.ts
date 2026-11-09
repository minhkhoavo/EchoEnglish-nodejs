import { recsysConfig } from '../config.js';
import { knownRegions } from './regions.js';

export interface StreamMessage {
    key: string;
    value: string;
}

/** Narrow port so the exporter is testable without a broker and the client is swappable. */
export interface StreamProducer {
    send(topic: string, messages: StreamMessage[]): Promise<void>;
    disconnect(): Promise<void>;
}

/**
 * Kafka-protocol producer (works with Redpanda). The client is imported lazily so the API boots
 * without brokers or the native module; it is an optionalDependency for the same reason.
 * `kafkajs` was rejected: last published Feb 2023.
 */
export async function createKafkaProducer(
    brokers = recsysConfig.stream.brokers(),
    clientId = recsysConfig.stream.clientId()
): Promise<StreamProducer> {
    if (brokers.length === 0)
        throw new Error('RECSYS_STREAM_BROKERS is not configured');
    const { KafkaJS } = await import('@confluentinc/kafka-javascript');
    const kafka = new KafkaJS.Kafka({ kafkaJS: { brokers, clientId } });
    // Redpanda does not auto-create topics, and Kafka cannot delete single records, so every
    // topic is created with an explicit, bounded retention (existing topics are left as they are).
    const admin = kafka.admin();
    await admin.connect();
    try {
        await admin.createTopics({
            topics: knownRegions().map((region) => ({
                topic: `${recsysConfig.stream.topicBase()}.${region}`,
                numPartitions: 3,
                configEntries: [
                    {
                        name: 'retention.ms',
                        value: String(
                            recsysConfig.stream.topicRetentionHours() *
                                3_600_000
                        ),
                    },
                ],
            })),
        });
    } finally {
        await admin.disconnect();
    }
    const producer = kafka.producer({
        kafkaJS: { acks: -1, idempotent: true },
    });
    await producer.connect();
    return {
        async send(topic, messages) {
            await producer.send({ topic, messages });
        },
        disconnect: () => producer.disconnect(),
    };
}
