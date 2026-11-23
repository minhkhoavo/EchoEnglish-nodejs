import { existsSync } from 'node:fs';

export type SaslMechanism = 'plain' | 'scram-sha-256' | 'scram-sha-512';

export interface KafkaClientConfig {
    brokers: string[];
    clientId: string;
    /** The Confluent client accepts only a boolean here; extra TLS settings go in `extra`. */
    ssl?: true;
    sasl?: { mechanism: SaslMechanism; username: string; password: string };
}

export interface KafkaSettings {
    /** Goes in the `kafkaJS` block. */
    kafkaJS: KafkaClientConfig;
    /** librdkafka properties that live OUTSIDE the `kafkaJS` block (e.g. a private CA). */
    extra: Record<string, string>;
}

/**
 * Connection settings for the Kafka-protocol client. Plaintext/unauthenticated is acceptable only
 * for the local dev overlay; any real broker needs TLS and SASL (RECSYS_STREAM_TLS /
 * RECSYS_STREAM_SASL_*). A private CA is passed as a PEM file path (RECSYS_STREAM_TLS_CA_FILE).
 * Credentials come from the environment only. Misconfiguration throws instead of silently
 * downgrading to an insecure connection.
 */
export function kafkaClientConfig(
    brokers: string[],
    clientId: string,
    env: NodeJS.ProcessEnv = process.env
): KafkaSettings {
    const kafkaJS: KafkaClientConfig = { brokers, clientId };
    const extra: Record<string, string> = {};
    const tls = env.RECSYS_STREAM_TLS === 'true';
    if (tls) kafkaJS.ssl = true;
    const caFile = env.RECSYS_STREAM_TLS_CA_FILE;
    if (caFile) {
        if (!tls)
            throw new Error(
                'RECSYS_STREAM_TLS_CA_FILE requires RECSYS_STREAM_TLS=true'
            );
        if (!existsSync(caFile))
            throw new Error(`RECSYS_STREAM_TLS_CA_FILE not found: ${caFile}`);
        extra['ssl.ca.location'] = caFile;
    }
    const username = env.RECSYS_STREAM_SASL_USERNAME;
    const password = env.RECSYS_STREAM_SASL_PASSWORD;
    if (username || password) {
        if (!username || !password)
            throw new Error(
                'RECSYS_STREAM_SASL_USERNAME and RECSYS_STREAM_SASL_PASSWORD must be set together'
            );
        const mechanism = (env.RECSYS_STREAM_SASL_MECHANISM ??
            'scram-sha-256') as SaslMechanism;
        if (!['plain', 'scram-sha-256', 'scram-sha-512'].includes(mechanism))
            throw new Error(`unsupported SASL mechanism "${mechanism}"`);
        kafkaJS.sasl = { mechanism, username, password };
    }
    return { kafkaJS, extra };
}
