import { startMongo, stopMongo, clearDb } from '../../helpers/mongo.js';
import { KpiService } from '~/recsys/analytics/kpiService.js';
import { clickhouseSource, mongoSource } from '~/recsys/analytics/sources.js';

jest.setTimeout(120_000);
beforeAll(startMongo);
afterAll(stopMongo);
beforeEach(clearDb);

describe('KPI backend selection', () => {
    it('defaults to Mongo and says so', async () => {
        const svc = new KpiService();
        const o = await svc.overview();
        expect(o.backend).toBe('mongo');
        expect(o.fallbackReason).toBeUndefined();
        const e = await svc.experiments();
        expect(e).toMatchObject({ backend: 'mongo', variants: [] });
    });

    it('falls back to Mongo with an explicit reason when the warehouse is down', async () => {
        const down = new KpiService(() =>
            clickhouseSource(async () => {
                throw new Error('connect ECONNREFUSED 127.0.0.1:8123');
            })
        );
        const o = await down.overview();
        expect(o.backend).toBe('mongo');
        expect(o.fallbackReason).toMatch(/ECONNREFUSED/);
        const e = await down.experiments();
        expect(e.backend).toBe('mongo');
        expect(e.fallbackReason).toMatch(/ECONNREFUSED/);
    });

    it('a Mongo failure is not masked', async () => {
        const broken = new KpiService(() => ({
            ...mongoSource,
            facts: async () => {
                throw new Error('mongo down');
            },
        }));
        await expect(broken.overview()).rejects.toThrow('mongo down');
    });
});
