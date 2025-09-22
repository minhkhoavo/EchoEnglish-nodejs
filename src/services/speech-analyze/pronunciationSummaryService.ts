import fs from 'fs';
import path from 'path';

type WordMistake = { word: string; phoneticTranscription: string };
type ResourceLink = { name: string; url: string };

type ChartItem = { sound: string; errorRate: number };
type TopMistake = {
  sound: string;
  errorRate: number;
  mistakeSummary: string;
  wordsWithMistakes: WordMistake[];
  howToImprove: string;
  skillsData?: Array<{
    title: string;
    level: string;
    resources: Array<{ title: string; url: string; type?: string }>;
  }>;
};

// Simplified training tips database for IPA phonemes
const PhonemeSuggestionDB: Record<string, string> = {
  // Consonants
  p: ' /p/ voiceless bilabial stop. Close lips, build pressure, release with a puff; no voicing. Drill: pat–bat, cap–cab.',
  b: ' /b/ voiced bilabial stop. Same place as /p/ but with voicing; softer burst. Drill: ban–pan, robe–rope.',
  t: ' /t/ voiceless alveolar stop. Tongue tip to alveolar ridge; release cleanly. Drill: ten–den, tight–dye.',
  d: ' /d/ voiced alveolar stop. Like /t/ with voicing; keep closure crisp. Drill: do–to, ladder–latter.',
  k: ' /k/ voiceless velar stop. Back of tongue to soft palate; release with air. Drill: coat–goat, back–bag.',
  ɡ: ' /ɡ/ voiced velar stop. Like /k/ with voicing; avoid devoicing. Drill: got–cot, bag–back.',
  f: ' /f/ voiceless labiodental fricative. Upper teeth on lower lip; blow air; no voicing. Drill: fan–van, leaf–leave.',
  v: ' /v/ voiced labiodental fricative. Same as /f/ with voicing. Drill: van–fan, save–safe.',
  θ: ' /θ/ voiceless dental fricative (think). Tongue tip lightly between teeth; blow air. Drill: think–sink, thin–tin.',
  ð: ' /ð/ voiced dental fricative (they). Same place as /θ/ with voicing. Drill: this–dis, though–dough.',
  s: ' /s/ voiceless alveolar fricative. Narrow air channel; no voicing. Drill: sip–zip, see–she.',
  z: ' /z/ voiced alveolar fricative. Like /s/ but voiced. Drill: zoo–Sue, busy–bussy.',
  ʃ: ' /ʃ/ voiceless postalveolar fricative (sh). Tongue slightly retracted; hushy air. Drill: ship–sip, she–see.',
  ʒ: ' /ʒ/ voiced postalveolar fricative (vision). Voiced pair of /ʃ/. Drill: measure vs pressure.',
  h: ' /h/ voiceless glottal fricative. Breath through open folds; don’t drop /h/. Drill: hat–at, heat–eat.',
  tʃ: ' /tʃ/ voiceless postalveolar affricate (ch). Stop + fricative release. Drill: cheap–jeep, chips–ships.',
  dʒ: ' /dʒ/ voiced postalveolar affricate (j). Voiced counterpart of /tʃ/. Drill: jam–yam, jet–yet.',
  m: ' /m/ bilabial nasal. Lips closed; air through nose; voiced. Drill: sum–sun, ram–ran.',
  n: ' /n/ alveolar nasal. Tongue tip at alveolar ridge; nasal airflow. Drill: ton–tong, ran–rang.',
  ŋ: ' /ŋ/ velar nasal (sing). Back of tongue to velum; no following /g/. Drill: sing–sig, thing–thin.',
  l: ' /l/ alveolar lateral approximant. Tongue tip at alveolar ridge; let air pass sides. Drill: light–right, feel–fill.',
  ɹ: ' /ɹ/ alveolar approximant (American r). Slight curl/bunch; no tongue contact with palate. Drill: rock–lock, right–light.',
  j: ' /j/ palatal approximant (y). Front of tongue near hard palate; voiced glide. Drill: year–dear, use–ooze.',
  w: ' /w/ labio-velar approximant. Rounded lips; back of tongue raised. Drill: wine–vine, west–vest.',
  // Vowels
  i: ' /i/ high front tense vowel (fleece). Keep tense, unrounded; don’t lax into /ɪ/. Drill: sheep–ship.',
  ɪ: ' /ɪ/ near-high front lax (kit). Shorter, laxer than /i/. Drill: live–leave.',
  ɛ: ' /ɛ/ mid front lax (dress). Don’t open too far toward /æ/. Drill: pen–pan.',
  æ: ' /æ/ near-open front (trap). Open, front; avoid raising. Drill: bad–bed.',
  ɑ: ' /ɑ/ open back unrounded (father). Don’t round like /ɔ/. Drill: cot–caught.',
  ɔ: ' /ɔ/ mid back rounded (thought). Keep rounding; don’t merge with /ɑ/.',
  ʊ: ' /ʊ/ near-high back lax (foot). Shorter, laxer than /u/. Drill: pull–pool.',
  u: ' /u/ high back tense rounded (goose). Keep tense; avoid shortening to /ʊ/. Drill: food–foot.',
  ʌ: ' /ʌ/ mid central stressed (strut). Don’t reduce to /ə/.',
  ə: ' /ə/ mid central unstressed (schwa). Very brief; use in weak syllables (about, ago).',
  ɝ: ' /ɝ/ stressed r-colored vowel (bird). Central with rhoticity. Drill: bird, nurse.',
  // Diphthongs
  eɪ: ' /eɪ/ (face). Start mid-front, glide to /ɪ/. Drill: late–let.',
  aɪ: ' /aɪ/ (price). Start open /a/, glide to /ɪ/. Drill: ride–rod.',
  ɔɪ: ' /ɔɪ/ (choice). Start rounded /ɔ/, glide to /ɪ/. Drill: boy–bough.',
  aʊ: ' /aʊ/ (mouth). Start /a/, glide to /ʊ/. Drill: cow–car.',
  oʊ: ' /oʊ/ (goat). Start mid-back rounded, glide to /ʊ/. Don’t reduce to /o/.',
};

const ERROR_THRESHOLD = 60; // AccuracyScore < threshold => error

function resolveResourceIndexPath(): string | null {
  // Try dist path first, then src
  const candidates = [
    path.join(
      process.cwd(),
      'dist',
      'resources',
      'data',
      'ipa_resource_index.json'
    ),
    path.join(
      process.cwd(),
      'src',
      'resources',
      'data',
      'ipa_resource_index.json'
    ),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      // Ignore errors when parsing resource index
    }
  }
  return null;
}

function loadResourceIndex(): Record<string, ResourceLink[]> {
  try {
    const p = resolveResourceIndexPath();
    if (!p) return {};
    const raw = fs.readFileSync(p, 'utf-8');
    const obj = JSON.parse(raw);
    return obj || {};
  } catch {
    return {};
  }
}

function normalizeForResourceMatch(sym: string): string {
  const map: Record<string, string> = {
    g: 'ɡ',
    ɜ: 'ɝ',
    ɜː: 'ɝ',
    o: 'oʊ',
  };
  return map[sym] || sym;
}

class PronunciationSummaryService {
  summarize(azureResponseArray: unknown[]): {
    chartData: ChartItem[];
    topMistakes: TopMistake[];
  } {
    const totalMap: Map<string, number> = new Map();
    const errorMap: Map<
      string,
      {
        count: number;
        substitutions: Map<string, number>;
        wordsWithMistakes: WordMistake[];
      }
    > = new Map();

    for (const segment of azureResponseArray || []) {
      const segmentData = segment as Record<string, unknown>;
      const NBest = segmentData?.NBest as Array<Record<string, unknown>>;
      const words = (NBest?.[0]?.Words as Array<Record<string, unknown>>) || [];
      for (const word of words) {
        const wordData = word as Record<string, unknown>;
        const phonemes =
          (wordData?.Phonemes as Array<Record<string, unknown>>) || [];
        const syllables = (
          (wordData?.Syllables as Array<Record<string, unknown>>) || []
        )
          .map((s: unknown) => (s as Record<string, unknown>)?.Syllable)
          .join('');
        for (const ph of phonemes) {
          const phonemeData = ph as Record<string, unknown>;
          const expected = phonemeData?.Phoneme as string;
          if (!expected) continue;
          totalMap.set(expected, (totalMap.get(expected) || 0) + 1);

          const pronAssessment = phonemeData?.PronunciationAssessment as Record<
            string,
            unknown
          >;
          const acc = (pronAssessment?.AccuracyScore as number) ?? 100;
          if (acc < ERROR_THRESHOLD) {
            const nbestPhonemes = pronAssessment?.NBestPhonemes as Array<
              Record<string, unknown>
            >;
            const actual = (nbestPhonemes?.[0]?.Phoneme as string) || 'omitted';
            if (!errorMap.has(expected))
              errorMap.set(expected, {
                count: 0,
                substitutions: new Map(),
                wordsWithMistakes: [],
              });
            const e = errorMap.get(expected)!;
            e.count += 1;
            e.substitutions.set(actual, (e.substitutions.get(actual) || 0) + 1);
            const w = String(wordData?.Word || '');
            if (w && !e.wordsWithMistakes.some((x) => x.word === w)) {
              e.wordsWithMistakes.push({
                word: w,
                phoneticTranscription: `/${syllables}/`,
              });
            }
          }
        }
      }
    }

    // Build chart data using errorRate = errors/total * 100
    const chartData: ChartItem[] = [];
    for (const [phoneme, totals] of totalMap.entries()) {
      const errors = errorMap.get(phoneme)?.count || 0;
      const rate = totals > 0 ? Math.round((errors / totals) * 100) : 0;
      chartData.push({ sound: `/${phoneme}/`, errorRate: rate });
    }
    chartData.sort(
      (a, b) => b.errorRate - a.errorRate || a.sound.localeCompare(b.sound)
    );

    // Keep only Top 5 for chartData
    const topFiveChart = chartData.filter((x) => x.errorRate > 0).slice(0, 5);

    // Top 3 details (from top 5)
    const resourceIndex = loadResourceIndex();
    const topSounds = topFiveChart.slice(0, 3);
    const topMistakes: TopMistake[] = topSounds.map((item) => {
      const key = normalizeForResourceMatch(item.sound.replace(/\//g, ''));
      const details = errorMap.get(key);
      const mostCommonSub = details
        ? [...details.substitutions.entries()].sort((a, b) => b[1] - a[1])[0]
        : undefined;
      const actual = mostCommonSub ? mostCommonSub[0] : null;

      let mistakeSummary = `You had trouble with the ${item.sound} sound.`;
      if (actual && actual !== 'omitted')
        mistakeSummary = `You sometimes said /${actual}/ instead of ${item.sound}.`;
      if (actual === 'omitted')
        mistakeSummary = `You sometimes forgot to pronounce ${item.sound}.`;

      const help =
        PhonemeSuggestionDB[key] ||
        'Practice this sound by listening and repeating.';
      const resources = Array.isArray(
        (resourceIndex as Record<string, unknown>)[key]
      )
        ? ((resourceIndex as Record<string, unknown>)[key] as unknown[]).slice(
            0,
            3
          )
        : [];

      const determineLevel = (rate: number) => {
        if (rate >= 70) return 'Needs Improvement';
        if (rate >= 40) return 'Good';
        return 'Correct';
      };

      const skillsData = resources.length
        ? [
            {
              title: `Skill ${item.sound}`,
              level: determineLevel(item.errorRate),
              resources: resources.map((r: unknown) => {
                const resource = r as Record<string, unknown>;
                const url = resource.url;
                const isYouTube = /(?:youtube\.com|youtu\.be)/i.test(
                  url as string
                );
                return {
                  title: resource.name as string,
                  url: url as string,
                  type: isYouTube ? 'video' : 'article',
                };
              }),
            },
          ]
        : [];

      return {
        sound: item.sound,
        errorRate: item.errorRate,
        mistakeSummary,
        wordsWithMistakes: details?.wordsWithMistakes || [],
        howToImprove: help,
        skillsData,
      };
    });

    return { chartData: topFiveChart, topMistakes };
  }
}

export default new PronunciationSummaryService();
