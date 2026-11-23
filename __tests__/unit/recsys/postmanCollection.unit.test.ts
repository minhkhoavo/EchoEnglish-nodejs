/**
 * Keeps the Postman collection (docs/recommendation/postman) in step with the recsys router:
 * a route added without a request, or a request left behind for a removed route, fails here.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import recsysRouter from '~/recsys/http/routes.js';

const DIR = path.join(process.cwd(), 'docs/recommendation/postman');
const readJson = (file: string) =>
    JSON.parse(readFileSync(path.join(DIR, file), 'utf8'));

interface PmScript {
    listen: string;
    script: { exec: string[] };
}
interface PmItem {
    name: string;
    item?: PmItem[];
    event?: PmScript[];
    request?: { method: string; url: { path: string[] } };
}

const collection = readJson('recsys.postman_collection.json') as {
    item: PmItem[];
};
const requests: PmItem[] = [];
const walk = (items: PmItem[]) =>
    items.forEach((i) => (i.item ? walk(i.item) : requests.push(i)));
walk(collection.item);

const routeKey = (method: string, p: string) => `${method.toUpperCase()} ${p}`;
const collectionRoutes = new Set(
    requests.map((r) =>
        routeKey(r.request!.method, '/' + r.request!.url.path.join('/'))
    )
);

/** Requests that exist only outside the recsys router: the app login and the sandbox helpers. */
const OUTSIDE_ROUTER = new Map([
    ['POST /auth/login', 'src/routes/auth.ts'],
    ['POST /sandbox/tick', 'scripts/ops/recsys-sandbox.ts'],
    ['POST /sandbox/learner/:userId/practice', 'scripts/ops/recsys-sandbox.ts'],
]);

const routerRoutes = (): string[] => {
    const stack = (
        recsysRouter as unknown as {
            stack: Array<{
                route?: { path: string; methods: Record<string, boolean> };
            }>;
        }
    ).stack;
    return stack.flatMap((layer) =>
        layer.route
            ? Object.keys(layer.route.methods)
                  .filter((m) => m !== '_all')
                  .map((m) => routeKey(m, layer.route!.path))
            : []
    );
};

describe('Postman collection', () => {
    it('has a request for every recsys route', () => {
        const routes = routerRoutes();
        expect(routes.length).toBeGreaterThanOrEqual(16);
        expect(routes.filter((r) => !collectionRoutes.has(r))).toEqual([]);
    });

    it('has no request for a route that does not exist', () => {
        const known = new Set([...routerRoutes(), ...OUTSIDE_ROUTER.keys()]);
        expect([...collectionRoutes].filter((r) => !known.has(r))).toEqual([]);
    });

    it('the routes outside the recsys router are still where the collection expects them', () => {
        for (const [key, file] of OUTSIDE_ROUTER) {
            const routePath = key.split(' ')[1].replace('/auth', '');
            expect(readFileSync(file, 'utf8')).toContain(`'${routePath}'`);
        }
    });

    it('every request asserts something', () => {
        const untested = requests
            .filter(
                (r) =>
                    !r.event?.some(
                        (e) =>
                            e.listen === 'test' &&
                            e.script.exec.join('\n').includes('pm.test(')
                    )
            )
            .map((r) => r.name);
        expect(untested).toEqual([]);
    });

    it('environments ship without credentials and never point at a deployed server', () => {
        for (const file of [
            'recsys-sandbox.postman_environment.json',
            'recsys-local-app.postman_environment.json',
        ]) {
            const env = readJson(file) as {
                values: Array<{ key: string; value: string; type: string }>;
            };
            const value = (k: string) =>
                env.values.find((v) => v.key === k)?.value;
            expect(value('baseUrl')).toMatch(
                /^http:\/\/(localhost|127\.0\.0\.1):\d+$/
            );
            for (const v of env.values) {
                if (/token|password|email/i.test(v.key))
                    expect({ [v.key]: v.value }).toEqual({ [v.key]: '' });
            }
        }
    });
});
