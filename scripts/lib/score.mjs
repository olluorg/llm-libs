/**
 * Эвристический скоринг кандидатов, найденных в реестрах.
 * Задача — отделить «библиотека для работы с LLM» от мусора,
 * который находится тем же поиском (CLI-обёртки, плагины, коллекции, курсы).
 */

export const LLM_TERMS = [
  'llm', 'large language model', 'gpt', 'chatgpt', 'openai', 'anthropic', 'claude', 'gemini', 'mistral',
  'cohere', 'groq', 'ollama', 'langchain', 'llamaindex', 'llama index', 'transformers', 'huggingface',
  'prompt', 'chat completion', 'chat completions', 'embeddings', 'embedding', 'rag', 'agent', 'agents',
  'fine-tun', 'tokenizer', 'inference', 'vllm', 'langgraph', 'function calling', 'tool use',
  'multimodal', 'speech to text', 'text to speech', 'diffusion', 'stable diffusion', 'text generation',
];

export const NEGATIVE_TERMS = [
  'course', 'tutorial', 'awesome', 'roadmap', 'interview', 'cheat sheet', 'cheatsheet', 'book',
  'interview questions', 'leetcode', 'memes', 'collection of links', 'notes for', 'cloning',
  'ui kit', 'icon set', 'theme', 'wordpress theme', 'boilerplate template', 'job queue',
  'message broker', 'key-value store', 'orm ', 'cms', 'starter template', 'clone of',
  'claude.md', 'agents.md', 'cursor rules', 'system prompt', 'prompt collection', 'prompt library',
  'prompt engineering guide', 'skills for', 'a single file', 'wallpaper', 'wallpapers',
];

const GENERIC_TERMS = ['sdk', 'client', 'api', 'wrapper', 'bindings', 'lib', 'library', 'toolkit'];

function lower(value = '') {
  return String(value).toLowerCase();
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/**
 * @param {object} candidate { name, description, downloads, repo, query }
 * @param {object} providers карта провайдеров из providers.json
 * @returns {{ score: number, reasons: string[], providers: string[], matchedTerms: string[] }}
 */
export function scoreCandidate(candidate, providers) {
  const name = lower(candidate.name);
  const description = lower(candidate.description);
  const text = `${name} ${description} ${lower(candidate.keywords ?? '')}`;
  const query = lower(candidate.query ?? '');

  let score = 0;
  const reasons = [];
  const matchedProviders = new Set();
  const matchedTerms = new Set();

  for (const provider of Object.values(providers)) {
    let providerScore = 0;
    for (const keyword of provider.keywords ?? []) {
      const needle = lower(keyword);
      if (name === needle) {
        providerScore = Math.max(providerScore, 5);
        reasons.push(`имя == ключевое слово провайдера «${provider.name}»`);
      } else if (name.includes(needle) && needle.length >= 4) {
        providerScore = Math.max(providerScore, 3.5);
      } else if (description.includes(needle)) {
        providerScore = Math.max(providerScore, 2);
      }
    }
    if (providerScore > 0) {
      matchedProviders.add(provider.id);
      score += providerScore;
    }
  }

  let termScore = 0;
  for (const term of LLM_TERMS) {
    if (name.includes(term)) {
      termScore = Math.max(termScore, 3);
      matchedTerms.add(term);
    } else if (countOccurrences(description, term) > 0) {
      termScore = Math.max(termScore, 1.6);
      matchedTerms.add(term);
    }
  }
  if (termScore > 0) {
    score += termScore;
    reasons.push(`LLM-признаки в описании (${[...matchedTerms].slice(0, 4).join(', ')})`);
  } else if (!description) {
    // Совпадение только по имени и без описания — почти всегда мусор или заглушка.
    score -= 2.5;
    reasons.push('нет описания, совпадение только по имени');
  } else if (name.length <= 3) {
    // Короткое имя вроде «LLM» или «AI» почти всегда совпадает случайно.
    score -= 2;
    reasons.push('слишком короткое имя без LLM-признаков в описании');
  }

  for (const term of GENERIC_TERMS) {
    if (name.includes(term)) score += 0.6;
  }

  if (query) {
    if (name === query) {
      score += 3;
      reasons.push('точное совпадение с поисковым запросом');
    } else if (name.includes(query) || query.includes(name)) {
      score += 1.4;
    }
  }

  for (const term of NEGATIVE_TERMS) {
    if (description.includes(term) || name.includes(term)) {
      score -= 4;
      reasons.push(`похоже на коллекцию/туториал («${term}»)`);
    }
  }

  // Известный шум: пакеты не про LLM, а про что-то другое с совпадением в имени.
  if (/^(django|flask|rails|express|react|vue|webpack|babel)/.test(name) && termScore === 0) {
    score -= 6;
    reasons.push('похоже на несвязанный пакет');
  }

  const downloads = Number(candidate.downloads ?? 0);
  if (downloads > 0) {
    const popularity = Math.log10(downloads + 1);
    score += Math.min(popularity, 4);
  }

  if (candidate.repo && /github\.com/i.test(candidate.repo)) score += 0.4;
  if (candidate.repo && !/github\.com/i.test(candidate.repo) && !/gitlab|bitbucket|codeberg/i.test(candidate.repo)) {
    score -= 1.5;
  }

  return {
    score: Number(score.toFixed(2)),
    reasons,
    providers: [...matchedProviders],
    matchedTerms: [...matchedTerms],
  };
}

export function tierFromScore(score, downloads) {
  if (score >= 9 && (downloads ?? 0) > 50_000) return 'A';
  if (score >= 7) return 'A';
  if (score >= 5.2) return 'B';
  if (score >= 3.6) return 'C';
  return null;
}

export function confidenceFromScore(score) {
  if (score >= 8) return 0.75;
  if (score >= 6) return 0.6;
  if (score >= 4.5) return 0.45;
  return 0.3;
}
