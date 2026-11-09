import { ReasonFact, RecommendationItem, ScoredCandidate } from './types.js';

type Params = Record<string, string | number>;
type Template = { en: (p: Params) => string; vi: (p: Params) => string };

const days = (p: Params) => (p.days === undefined ? '30+' : String(p.days));

/**
 * Template-based explanations (no LLM on the request path: free, instant, deterministic).
 * Vietnamese strings need review by a native speaker before launch (see README §4).
 */
const TEMPLATES: Record<ReasonFact['code'], Template> = {
    weak_skill: {
        en: (p) =>
            `Your accuracy on ${p.skill} is about ${p.pct}% over ${p.n} questions — the biggest opportunity to gain points.`,
        vi: (p) =>
            `Độ chính xác của bạn ở ${p.skill} khoảng ${p.pct}% trong ${p.n} câu — đây là phần có thể tăng điểm nhiều nhất.`,
    },
    srs_due: {
        en: (p) =>
            `${p.count} flashcards are due. Reviewing now keeps recall high (about ${p.minutes} min).`,
        vi: (p) =>
            `Có ${p.count} thẻ cần ôn. Ôn ngay giúp bạn nhớ lâu hơn (khoảng ${p.minutes} phút).`,
    },
    explore_skill: {
        en: (p) =>
            `We have little data on ${p.skill}. A short drill will sharpen your plan.`,
        vi: (p) =>
            `Chúng tôi chưa có nhiều dữ liệu về ${p.skill}. Một bài luyện ngắn sẽ giúp lộ trình chính xác hơn.`,
    },
    interest_match: {
        en: (p) =>
            `Matches your interest in ${String(p.domain).replace(/_/g, ' ')}${p.cefr ? ` at level ${p.cefr}` : ''}.`,
        vi: (p) =>
            `Phù hợp với chủ đề bạn quan tâm (${String(p.domain).replace(/_/g, ' ')})${p.cefr ? `, trình độ ${p.cefr}` : ''}.`,
    },
    level_fit: {
        en: (p) =>
            `Well matched to your current level${p.cefr ? ` (${p.cefr})` : ''}.`,
        vi: (p) =>
            `Phù hợp với trình độ hiện tại của bạn${p.cefr ? ` (${p.cefr})` : ''}.`,
    },
    habit_test: {
        en: (p) =>
            `It has been ${days(p)} days since your last test. A mini test tracks your progress.`,
        vi: (p) =>
            `Đã ${days(p)} ngày kể từ bài test gần nhất. Một bài test ngắn giúp theo dõi tiến bộ.`,
    },
    habit_pronunciation: {
        en: (p) =>
            `You have not practised pronunciation for ${days(p)} days. A short session keeps it sharp.`,
        vi: (p) =>
            `Bạn chưa luyện phát âm ${days(p)} ngày. Một buổi ngắn sẽ giúp giữ phong độ.`,
    },
    habit_vocab: {
        en: (p) =>
            `No new words captured for ${days(p)} days. Point your camera at something nearby.`,
        vi: (p) =>
            `Đã ${days(p)} ngày bạn chưa thêm từ mới. Thử chụp một vật xung quanh nhé.`,
    },
    starter_diagnostic: {
        en: () => 'Take a short diagnostic so we can personalise your plan.',
        vi: () =>
            'Làm một bài chẩn đoán ngắn để chúng tôi cá nhân hoá lộ trình cho bạn.',
    },
    popular_for_level: {
        en: (p) =>
            `Popular with learners at your level${p.cefr ? ` (${p.cefr})` : ''}.`,
        vi: (p) =>
            `Được nhiều học viên cùng trình độ${p.cefr ? ` (${p.cefr})` : ''} yêu thích.`,
    },
    welcome_back: {
        en: (p) =>
            `Welcome back! Start with a quick review of ${p.count} cards to refresh what you learned.`,
        vi: (p) =>
            `Chào mừng bạn quay lại! Hãy bắt đầu bằng việc ôn nhanh ${p.count} thẻ.`,
    },
};

export function explain(c: ScoredCandidate): RecommendationItem['reason'] {
    const t = TEMPLATES[c.reason.code];
    return {
        code: c.reason.code,
        text: { en: t.en(c.reason.params), vi: t.vi(c.reason.params) },
        evidence: c.reason.params,
    };
}
