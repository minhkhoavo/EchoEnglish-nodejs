import { recsysConfig } from '../config.js';

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
