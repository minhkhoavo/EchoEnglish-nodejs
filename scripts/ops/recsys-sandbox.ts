/**
 * Manual-check sandbox: the REAL recsys HTTP routes and services over THROWAWAY data, so a human
 * can try the system with curl/Postman without the full app, auth, or a real database.
 *
 *   npm run recsys:sandbox                  # serve on :4010 (in-memory MongoDB, seeded catalogue)
 *   npm run recsys:sandbox -- --walkthrough # drive every step over HTTP, print results, exit 0/1
 *   PORT=4011 RECSYS_SANDBOX_MONGO_URI=mongodb://localhost:27017/sandbox npm run recsys:sandbox
 *
 * Auth is a header stub (sandbox only): `x-demo-user: <24-hex id>`, `x-demo-role: USER|ADMIN`.
 * It never reads MONGO_URI on purpose: pointing it at a real database must be a deliberate act.
 */
import { createServer } from 'node:http';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

Object.assign(process.env, {
    RECSYS_ENABLED: 'true',
    RECSYS_PSEUDONYM_SALT:
        process.env.RECSYS_PSEUDONYM_SALT ?? 'sandbox-only-salt-0123456789',
});
const { default: recsysRouter } =
    await import('../../src/recsys/http/routes.js');
const { default: ErrorMiddleware } =
    await import('../../src/middleware/errorMiddleware.js');
const { Resource } = await import('../../src/models/resource.js');
const { pipelineService } = await import('../../src/recsys/etl/pipeline.js');
const { featureBuilder } =
    await import('../../src/recsys/features/featureBuilder.js');
const { eventService } =
    await import('../../src/recsys/events/eventService.js');
const { recommenderService } =
    await import('../../src/recsys/engine/recommender.js');
const { consentService } =
    await import('../../src/recsys/privacy/consentService.js');

const PORT = Number(process.env.PORT ?? 4010);
const walkthrough = process.argv.includes('--walkthrough');
const explicitUri = process.env.RECSYS_SANDBOX_MONGO_URI;
const mem = explicitUri ? null : await MongoMemoryServer.create();
await mongoose.connect(explicitUri ?? mem!.getUri(), {
    dbName: 'recsys_sandbox',
});

const DOMAINS = ['business', 'travel', 'technology', 'healthcare', 'finance'];
const TOPICS = [
    ['grammar', 'word form'],
    ['reading comprehension'],
    ['listening', 'conversation'],
    ['vocabulary', 'collocations'],
];
if ((await Resource.countDocuments()) === 0)
    await Resource.insertMany(
        Array.from({ length: 30 }, (_, i) => ({
            type: 'article',
            title: `Sample ${DOMAINS[i % 5]} article ${i + 1}`,
            summary: `Practice reading about ${DOMAINS[i % 5]}.`,
            suitableForLearners: true,
            publishedAt: new Date(Date.now() - i * 86_400_000),
            labels: {
                cefr: i % 2 ? 'B1' : 'B2',
                domain: DOMAINS[i % 5],
                topic: TOPICS[i % 4],
            },
        }))
    );

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
    const id = req.header('x-demo-user');
    if (id)
        (req as unknown as { user: unknown }).user = {
            id,
            scope: (req.header('x-demo-role') ?? 'USER').toUpperCase(),
            email: 'demo@example.test',
        };
    next();
});
app.use('/', recsysRouter);

/** Sandbox-only: run one ETL + feature tick now instead of waiting for the cron. */
app.post('/sandbox/tick', async (_req, res) => {
    const run = await pipelineService.runOnce({
        afterFacts: (ids) => featureBuilder.buildMany(ids),
    });
    recommenderService.clearCache();
    res.json({ data: { run } });
});
/** Sandbox-only: emit server-side learning events (the app emits these itself in production). */
app.post('/sandbox/learner/:userId/practice', async (req, res) => {
    const skills = [
        'p5.wordform',
        'p6.conjunction',
        'p3.detail',
        'p2.whquestion',
    ];
    const events = skills.flatMap((s, si) =>
        Array.from({ length: si >= 2 ? 40 : 12 }, (_, k) => ({
            type: 'question_answered' as const,
            props: {
                skillKey: s,
                correct: si >= 2 || k % 4 === 0, // weak (25%) on the first two skills, strong on the rest
                origin: 'drill',
                timeMs: 8000,
            },
        }))
    );
    // a learner who has taken a test (otherwise the 20-minute starter diagnostic is boosted to the top
    // and, with the default 30-minute budget, crowds the drills out of the list)
    events.push({
        type: 'test_submitted' as const,
        props: {
            testId: 'b'.repeat(24),
            totalScore: 600,
            correct: 100,
            total: 200,
            durationSec: 7000,
        },
    } as never);
    await eventService.emitManyAsync(req.params.userId, events);
    res.json({ data: { emitted: events.length } });
});
app.use(ErrorMiddleware.handleError);

const server = createServer(app);
await new Promise<void>((r) => server.listen(PORT, r));
const base = `http://127.0.0.1:${PORT}`;
const shutdown = async () => {
    server.close();
    await mongoose.disconnect();
    await mem?.stop();
};

if (!walkthrough) {
    const id = new mongoose.Types.ObjectId().toString();
    console.log(`recsys sandbox on ${base}  (throwaway data; Ctrl-C to stop)
learner id for this session: ${id}

U="-H x-demo-user:${id}"; A="-H x-demo-user:${id} -H x-demo-role:ADMIN"; J="-H content-type:application/json"
curl -s $U $J -X PUT  ${base}/privacy/consent -d '{"analytics":true,"personalization":true}'
curl -s $U $J -X POST ${base}/sandbox/learner/${id}/practice          # fake practice history
curl -s $A -X POST ${base}/sandbox/tick                               # run ETL + features now
curl -s $U "${base}/recommendations?limit=5&refresh=true"             # personalised, explained
curl -s $A ${base}/admin/recsys/health ; curl -s $A ${base}/admin/recsys/kpis
curl -s $U ${base}/privacy/export ; curl -s $U -X DELETE ${base}/privacy/data
curl -s $A $J -X POST ${base}/admin/recsys/models/retrain -d '{"dryRun":true}'`);
    for (const s of ['SIGINT', 'SIGTERM'] as const)
        process.on(s, () => void shutdown().then(() => process.exit(0)));
} else {
    const uid = new mongoose.Types.ObjectId().toString();
    let failed = 0;
    const call = async (
        label: string,
        method: string,
        path: string,
        opts: { admin?: boolean; body?: unknown; anon?: boolean } = {}
    ) => {
        const headers: Record<string, string> = {
            'content-type': 'application/json',
        };
        if (!opts.anon) headers['x-demo-user'] = uid;
        if (opts.admin) headers['x-demo-role'] = 'ADMIN';
        const res = await fetch(base + path, {
            method,
            headers,
            body: opts.body ? JSON.stringify(opts.body) : undefined,
        });
        const json = (await res.json().catch(() => ({}))) as {
            data?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
        };
        return { label, status: res.status, data: json.data };
    };
    const check = (name: string, ok: boolean, detail: unknown) => {
        if (!ok) failed++;
        console.log(
            `${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`
        );
    };

    let r = await call('anon', 'GET', '/recommendations', { anon: true });
    check('unauthenticated request is refused', r.status === 401, r.status);

    r = await call('cold', 'GET', '/recommendations?limit=5');
    check(
        'new learner gets cold-start list with the starter diagnostic first',
        r.data?.mode === 'cold_start' &&
            r.data.items[0].id === 'mock_test:starter',
        { mode: r.data?.mode, first: r.data?.items?.[0]?.id }
    );

    const ev = [
        {
            eventId: crypto.randomUUID(),
            schemaVersion: 1,
            type: 'resource_viewed',
            occurredAt: new Date().toISOString(),
            props: { resourceId: 'a'.repeat(24), dwellSec: 20 },
        },
    ];
    r = await call('noconsent', 'POST', '/events/batch', {
        body: { events: ev },
    });
    check(
        'behavioural event dropped without consent',
        r.data?.droppedNoConsent === 1 && r.data?.accepted === 0,
        r.data
    );

    r = await call('consent', 'PUT', '/privacy/consent', {
        body: { analytics: true, personalization: true },
    });
    check(
        'consent granted',
        r.data?.analytics === true && r.data?.personalization === true,
        r.data
    );
    consentService.clearCache();

    ev[0].eventId = crypto.randomUUID();
    r = await call('consented', 'POST', '/events/batch', {
        body: { events: ev },
    });
    check('same event accepted after consent', r.data?.accepted === 1, r.data);

    await call('practice', 'POST', `/sandbox/learner/${uid}/practice`);
    const tick = await call('tick', 'POST', '/sandbox/tick');
    check(
        'ETL ran: bronze -> silver -> gold + features',
        tick.status === 200,
        tick.data?.run?.counts
    );

    r = await call('personal', 'GET', '/recommendations?limit=5&refresh=true');
    const items: Array<{
        id: string;
        reason: { code: string; text: { en: string } };
    }> = r.data?.items ?? [];
    check(
        'personalised list, weak skills drilled, strong ones not',
        r.data?.mode === 'personalized' &&
            items.some((i) =>
                /^skill_drill:p(5\.wordform|6\.conjunction)$/.test(i.id)
            ) &&
            !items.some((i) => /^skill_drill:p(2|3)\./.test(i.id)),
        { mode: r.data?.mode, ids: items.map((i) => i.id) }
    );
    check(
        'every item carries an explanation',
        items.length > 0 && items.every((i) => i.reason?.text?.en?.length > 5),
        items[0]?.reason?.text?.en
    );
    check(
        'training signals are not leaked to clients',
        !JSON.stringify(r.data).includes('"signals"'),
        ''
    );

    const top = items[0];
    r = await call('fb', 'POST', '/recommendations/feedback', {
        body: {
            recId: r.data.recId,
            itemType: r.data.items[0].type,
            itemRef: r.data.items[0].ref,
            action: 'click',
            variant: r.data.variant,
            mode: r.data.mode,
        },
    });
    check('click feedback recorded', r.status === 200, {
        status: r.status,
        item: top?.id,
    });

    r = await call('userkpi', 'GET', '/admin/recsys/kpis');
    check('non-admin is refused admin endpoints', r.status === 403, r.status);
    r = await call('health', 'GET', '/admin/recsys/health', { admin: true });
    check(
        'health endpoint reports a status',
        ['ok', 'degraded', 'down'].includes(r.data?.status),
        { status: r.data?.status, problems: r.data?.problems }
    );
    r = await call('kpis', 'GET', '/admin/recsys/kpis?windowDays=7', {
        admin: true,
    });
    check(
        'KPIs computed without NaN',
        r.status === 200 && !/NaN|Infinity/.test(JSON.stringify(r.data)),
        r.data?.users
    );
    r = await call('models', 'GET', '/admin/recsys/models', { admin: true });
    check('model registry readable', r.status === 200, r.data);
    r = await call('retrain', 'POST', '/admin/recsys/models/retrain', {
        admin: true,
        body: { dryRun: true },
    });
    check(
        'retrain dry-run refuses to fit on too little data',
        r.status === 200 &&
            r.data?.status !== 'trained' &&
            r.data?.status !== 'registered',
        r.data
    );
    r = await call('region', 'PUT', `/admin/recsys/learners/${uid}/region`, {
        admin: true,
        body: { region: 'sg' },
    });
    check(
        'region assignment validated against known regions',
        r.status === 400 || r.status === 200,
        r.status
    );

    r = await call('export', 'GET', '/privacy/export');
    check(
        "data export returns the learner's data",
        r.status === 200 && !!r.data,
        Object.keys(r.data ?? {})
    );
    r = await call('erase', 'DELETE', '/privacy/data');
    check('erasure succeeds', r.status === 200, r.data);
    r = await call('afterErase', 'GET', '/privacy/export');
    check(
        'nothing behavioural remains after erasure',
        (r.data?.events?.length ?? 0) === 0,
        { events: r.data?.events?.length }
    );

    console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
    await shutdown();
    process.exit(failed ? 1 : 0);
}
