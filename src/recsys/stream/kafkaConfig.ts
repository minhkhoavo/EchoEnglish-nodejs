export interface KafkaClientConfig {
    brokers: string[];
    clientId: string;
    ssl?: true;
    sasl?: { mechanism: SaslMechanism; username: string; password: string };
}

export type SaslMechanism = 'plain' | 'scram-sha-256' | 'scram-sha-512';

/**
 * Connection settings for the Kafka-protocol client. Plaintext/unauthenticated is acceptable only
 * for the local dev overlay; any real broker needs TLS and SASL (RECSYS_STREAM_TLS /
 * RECSYS_STREAM_SASL_*). Credentials come from the environment only.
 */
export function kafkaClientConfig(
    brokers: string[],
    clientId: string,
    env: NodeJS.ProcessEnv = process.env
): KafkaClientConfig {
    const cfg: KafkaClientConfig = { brokers, clientId };
    if (env.RECSYS_STREAM_TLS === 'true') cfg.ssl = true;
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
        cfg.sasl = { mechanism, username, password };
    }
    return cfg;
}
