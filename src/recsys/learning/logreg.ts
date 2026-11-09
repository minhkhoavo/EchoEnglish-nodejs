/** Minimal, dependency-free, deterministic logistic regression (full-batch gradient descent + L2). */
export interface LabelledRow {
    x: number[];
    y: 0 | 1;
}
export interface LogReg {
    w: number[];
    b: number;
}
export interface TrainOptions {
    /** Ridge strength (applied to weights, not the intercept). */
    l2?: number;
    maxIter?: number;
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

const YIELD_EVERY = 2048;
const yieldToEventLoop = () => new Promise<void>((r) => setImmediate(r));

/** Solve A x = b (A symmetric positive definite, small) by Gaussian elimination with pivoting. */
function solve(A: number[][], b: number[]): number[] {
    const n = b.length;
    const M = A.map((row, i) => [...row, b[i]]);
    for (let c = 0; c < n; c++) {
        let p = c;
        for (let r = c + 1; r < n; r++)
            if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
        [M[c], M[p]] = [M[p], M[c]];
        for (let r = c + 1; r < n; r++) {
            const f = M[r][c] / M[c][c];
            for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
        }
    }
    const x = new Array<number>(n).fill(0);
    for (let r = n - 1; r >= 0; r--) {
        let acc = M[r][n];
        for (let k = r + 1; k < n; k++) acc -= M[r][k] * x[k];
        x[r] = acc / M[r][r];
    }
    return x;
}

/**
 * Ridge-regularised logistic regression by Newton's method (IRLS). Used instead of gradient
 * descent because ranking signals are strongly correlated with position, and Newton separates
 * collinear effects reliably in a handful of iterations (dimension is < 12).
 */
export async function trainLogReg(
    rows: LabelledRow[],
    opts: TrainOptions = {}
): Promise<LogReg> {
    if (rows.length === 0) throw new Error('no training rows');
    const d = rows[0].x.length;
    const { l2 = 1e-2, maxIter = 30 } = opts;
    const dim = d + 1; // last entry = intercept
    let beta = new Array<number>(dim).fill(0);
    for (let it = 0; it < maxIter; it++) {
        const g = new Array<number>(dim).fill(0);
        const H = Array.from({ length: dim }, () =>
            new Array<number>(dim).fill(0)
        );
        for (let ri = 0; ri < rows.length; ri++) {
            // Yield to the event loop every chunk: training runs inside the API process.
            if (ri > 0 && ri % YIELD_EVERY === 0) await yieldToEventLoop();
            const r = rows[ri];
            let z = beta[d];
            for (let j = 0; j < d; j++) z += beta[j] * r.x[j];
            const p = sigmoid(z);
            const err = p - r.y;
            const wgt = Math.max(p * (1 - p), 1e-6);
            for (let j = 0; j < dim; j++) {
                const xj = j < d ? r.x[j] : 1;
                g[j] += err * xj;
                for (let k = j; k < dim; k++)
                    H[j][k] += wgt * xj * (k < d ? r.x[k] : 1);
            }
        }
        for (let j = 0; j < dim; j++) {
            for (let k = 0; k < j; k++) H[j][k] = H[k][j];
            if (j < d) {
                g[j] += l2 * beta[j];
                H[j][j] += l2;
            }
            H[j][j] += 1e-9;
        }
        const step = solve(H, g);
        let maxStep = 0;
        beta = beta.map((v, j) => {
            maxStep = Math.max(maxStep, Math.abs(step[j]));
            return v - step[j];
        });
        if (maxStep < 1e-6) break;
    }
    return { w: beta.slice(0, d), b: beta[d] };
}

/** Area under the ROC curve (rank-sum form, ties averaged). null if only one class present. */
export function auc(scores: number[], labels: Array<0 | 1>): number | null {
    const pos = labels.filter((l) => l === 1).length;
    const neg = labels.length - pos;
    if (pos === 0 || neg === 0) return null;
    const idx = scores.map((s, i) => i).sort((a, b) => scores[a] - scores[b]);
    let rankSumPos = 0;
    let i = 0;
    while (i < idx.length) {
        let j = i;
        while (j + 1 < idx.length && scores[idx[j + 1]] === scores[idx[i]]) j++;
        const avgRank = (i + j) / 2 + 1;
        for (let k = i; k <= j; k++)
            if (labels[idx[k]] === 1) rankSumPos += avgRank;
        i = j + 1;
    }
    return (rankSumPos - (pos * (pos + 1)) / 2) / (pos * neg);
}
