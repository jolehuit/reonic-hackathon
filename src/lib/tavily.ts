// Tavily search wrapper — looks up local solar-panel incentives, subsidies
// and grants for a given address. Used by /api/export to enrich the PDF
// "Quick Offer" with location-specific funding information.
//
// We hit Tavily's REST endpoint directly rather than pulling in @tavily/core
// — one POST, no SDK weight. If TAVILY_API_KEY is missing or the request
// fails, the function returns an empty array and the PDF skips the section.

interface TavilyResult {
  title: string;
  url: string;
  content: string;
}

interface TavilyResponse {
  answer?: string;
  results?: Array<{
    title?: string;
    url?: string;
    content?: string;
  }>;
}

export interface IncentiveLookup {
  /** AI-generated 1-2 sentence summary of the funding landscape. */
  answer: string | null;
  /** Top-N source links + snippets. */
  results: TavilyResult[];
}

/** Search Tavily for solar incentives at a location. Country is required;
 *  region/city refine the query but aren't strictly necessary. */
export async function searchSolarIncentives(opts: {
  country: string;
  region?: string;
  city?: string;
}): Promise<IncentiveLookup> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return { answer: null, results: [] };

  // Build a tight query — Tavily ranks better with concrete keywords than
  // with a vague natural-language sentence.
  const locationBits = [opts.city, opts.region, opts.country]
    .filter(Boolean)
    .join(' ');
  const year = new Date().getFullYear();
  const query =
    `solar panel photovoltaic installation incentives subsidies grants tax credits ${locationBits} ${year}`;

  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query,
        search_depth: 'basic',
        include_answer: 'basic',
        max_results: 5,
      }),
      // Tavily basic-depth replies in ~1-2 s. Cap at 8 s so a slow lookup
      // doesn't block the PDF for a minute.
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      console.warn(`[tavily] HTTP ${res.status}`);
      return { answer: null, results: [] };
    }

    const data = (await res.json()) as TavilyResponse;
    return {
      answer: typeof data.answer === 'string' ? data.answer : null,
      results: (data.results ?? [])
        .filter((r): r is { title: string; url: string; content: string } =>
          !!r.title && !!r.url && !!r.content,
        )
        .slice(0, 5)
        .map((r) => ({
          title: r.title,
          url: r.url,
          content: r.content,
        })),
    };
  } catch (err) {
    console.warn('[tavily] search failed:', err);
    return { answer: null, results: [] };
  }
}
