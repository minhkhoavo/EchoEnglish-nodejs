/**
 * OPT-IN: the warehouse client over HTTPS with a private CA.
 *   RECSYS_LIVE_CLICKHOUSE_TLS=https://localhost:18443 RECSYS_LIVE_CLICKHOUSE_CA=/path/ca.crt npx jest __tests__/live/clickhouseTls
 */
import { createWarehouse } from '~/recsys/warehouse/clickhouse.js';

jest.setTimeout(60_000);
const URL_ = process.env.RECSYS_LIVE_CLICKHOUSE_TLS;
const CA = process.env.RECSYS_LIVE_CLICKHOUSE_CA;
const maybe = URL_ && CA ? describe : describe.skip;

const setEnv = (ca: string | undefined) => {
    process.env.RECSYS_CLICKHOUSE_URL = URL_;
    process.env.RECSYS_CLICKHOUSE_USER = 'echo';
    process.env.RECSYS_CLICKHOUSE_PASSWORD = 'echo';
    process.env.RECSYS_CLICKHOUSE_DB = 'default';
    if (ca) process.env.RECSYS_CLICKHOUSE_CA_FILE = ca;
    else delete process.env.RECSYS_CLICKHOUSE_CA_FILE;
};
afterEach(() => {
    delete process.env.RECSYS_CLICKHOUSE_CA_FILE;
});

maybe('LIVE ClickHouse over HTTPS (private CA)', () => {
    it('works with the CA', async () => {
        setEnv(CA);
        const wh = await createWarehouse();
        const [row] = await wh.query<{ one: number }>('SELECT 1 AS one');
        expect(row.one).toBe(1);
        await wh.close();
    });
    it('REFUSES the same server when the CA is not trusted', async () => {
        setEnv(undefined);
        const wh = await createWarehouse();
        const err = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        await expect(wh.query('SELECT 1')).rejects.toThrow();
        err.mockRestore();
        await wh.close();
    });
    it('throws (does not silently go insecure) if the CA file is unreadable', async () => {
        setEnv('/nonexistent/ca.crt');
        await expect(createWarehouse()).rejects.toThrow();
    });
});
