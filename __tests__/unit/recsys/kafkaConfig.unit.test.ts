import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { kafkaClientConfig } from '~/recsys/stream/kafkaConfig.js';

const caFile = () => {
    const f = join(mkdtempSync(join(tmpdir(), 'ca-')), 'ca.crt');
    writeFileSync(f, 'pem');
    return f;
};

describe('kafka client config', () => {
    it('is plaintext by default (dev overlay only)', () => {
        expect(kafkaClientConfig(['b:1'], 'c', {})).toEqual({
            kafkaJS: { brokers: ['b:1'], clientId: 'c' },
            extra: {},
        });
    });
    it('enables TLS and SASL from the environment', () => {
        const { kafkaJS } = kafkaClientConfig(['b:1'], 'c', {
            RECSYS_STREAM_TLS: 'true',
            RECSYS_STREAM_SASL_USERNAME: 'u',
            RECSYS_STREAM_SASL_PASSWORD: 'p',
            RECSYS_STREAM_SASL_MECHANISM: 'scram-sha-512',
        });
        expect(kafkaJS).toMatchObject({
            ssl: true,
            sasl: { mechanism: 'scram-sha-512', username: 'u', password: 'p' },
        });
    });
    it('defaults the mechanism to SCRAM-SHA-256', () => {
        const { kafkaJS } = kafkaClientConfig(['b'], 'c', {
            RECSYS_STREAM_SASL_USERNAME: 'u',
            RECSYS_STREAM_SASL_PASSWORD: 'p',
        });
        expect(kafkaJS.sasl).toMatchObject({ mechanism: 'scram-sha-256' });
    });
    it('passes a private CA as a librdkafka property OUTSIDE the kafkaJS block (the client rejects object-form ssl)', () => {
        const f = caFile();
        const { kafkaJS, extra } = kafkaClientConfig(['b'], 'c', {
            RECSYS_STREAM_TLS: 'true',
            RECSYS_STREAM_TLS_CA_FILE: f,
        });
        expect(kafkaJS.ssl).toBe(true);
        expect(extra).toEqual({ 'ssl.ca.location': f });
    });
    it('rejects half-configured credentials, unknown mechanisms, and a CA without TLS (fail closed)', () => {
        const k = (env: NodeJS.ProcessEnv) => () =>
            kafkaClientConfig(['b'], 'c', env);
        expect(k({ RECSYS_STREAM_SASL_USERNAME: 'u' })).toThrow(/together/);
        expect(k({ RECSYS_STREAM_SASL_PASSWORD: 'p' })).toThrow(/together/);
        expect(
            k({
                RECSYS_STREAM_SASL_USERNAME: 'u',
                RECSYS_STREAM_SASL_PASSWORD: 'p',
                RECSYS_STREAM_SASL_MECHANISM: 'gssapi',
            })
        ).toThrow(/unsupported/);
        expect(k({ RECSYS_STREAM_TLS_CA_FILE: caFile() })).toThrow(
            /requires RECSYS_STREAM_TLS/
        );
    });
    it('fails loudly (not silently insecure) if the CA file is missing', () => {
        expect(() =>
            kafkaClientConfig(['b'], 'c', {
                RECSYS_STREAM_TLS: 'true',
                RECSYS_STREAM_TLS_CA_FILE: '/nonexistent/ca.crt',
            })
        ).toThrow(/not found/);
    });
});
