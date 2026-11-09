import { kafkaClientConfig } from '~/recsys/stream/kafkaConfig.js';

describe('kafka client config', () => {
    it('is plaintext by default (dev overlay only)', () => {
        expect(kafkaClientConfig(['b:1'], 'c', {})).toEqual({
            brokers: ['b:1'],
            clientId: 'c',
        });
    });
    it('enables TLS and SASL from the environment', () => {
        const cfg = kafkaClientConfig(['b:1'], 'c', {
            RECSYS_STREAM_TLS: 'true',
            RECSYS_STREAM_SASL_USERNAME: 'u',
            RECSYS_STREAM_SASL_PASSWORD: 'p',
            RECSYS_STREAM_SASL_MECHANISM: 'scram-sha-512',
        });
        expect(cfg).toMatchObject({
            ssl: true,
            sasl: { mechanism: 'scram-sha-512', username: 'u', password: 'p' },
        });
    });
    it('defaults the mechanism to SCRAM-SHA-256', () => {
        const cfg = kafkaClientConfig(['b'], 'c', {
            RECSYS_STREAM_SASL_USERNAME: 'u',
            RECSYS_STREAM_SASL_PASSWORD: 'p',
        });
        expect(cfg.sasl).toMatchObject({ mechanism: 'scram-sha-256' });
    });
    it('rejects half-configured credentials and unknown mechanisms (fail closed, not silently plaintext)', () => {
        expect(() =>
            kafkaClientConfig(['b'], 'c', { RECSYS_STREAM_SASL_USERNAME: 'u' })
        ).toThrow(/together/);
        expect(() =>
            kafkaClientConfig(['b'], 'c', { RECSYS_STREAM_SASL_PASSWORD: 'p' })
        ).toThrow(/together/);
        expect(() =>
            kafkaClientConfig(['b'], 'c', {
                RECSYS_STREAM_SASL_USERNAME: 'u',
                RECSYS_STREAM_SASL_PASSWORD: 'p',
                RECSYS_STREAM_SASL_MECHANISM: 'gssapi',
            })
        ).toThrow(/unsupported/);
    });
});
