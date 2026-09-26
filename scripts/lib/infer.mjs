/**
 * Эвристический разбор: по названию/описанию пакета восстанавливаем
 * тип (kind), роль по отношению к провайдерам (role), поддерживаемые
 * сценарии (features), тип API и статус.
 */

import { ROLE_BY_KIND } from './record.mjs';

const KIND_RULES = [
  // Сопутствующее: хранилища, наблюдаемость, eval, UI, утилиты.
  ['retrieval', ['chroma', 'chromadb', 'qdrant', 'pinecone', 'weaviate', 'milvus', 'lancedb', 'pgvector', 'faiss', 'embedchain', 'txtai', 'vespa', 'marqo', 'revect', 'unstructured', 'docling', 'elasticsearch', 'opensearch', 'redis', 'tair', 'photon', 'vald', 'langchain-community']],
  ['util', ['tiktoken', 'tokenizer', 'tokenizers', 'tokenize', 'count-token', 'bpe', 'guidance', 'huggingface_hub', 'huggingface-hub', 'hf-hub', 'modelscope']],
  ['eval', ['promptfoo', 'deepeval', 'ragas', 'langsmith', 'braintrust', 'phoenix', 'inspect-ai', 'promptlab', 'geval', 'openai-evals', 'evals', 'eval', 'patronus', 'ragbench', 'agenta']],
  ['ui', ['chatgpt', 'chat-ui', 'nextchat', 'chatbot', 'lobe-chat', 'lobehub', 'librechat', 'open-webui', 'dify', 'flowise', 'botpress', 'langflow', 'gradio', 'streamlit', 'chainlit', 'openui', 'chatbox']],
  // Локальный запуск моделей. Сюда же — библиотеки локальных моделей
  // (whisper, diffusers, sentence-transformers): провайдеру они не звонят.
  ['local-runtime', [
    'ollama', 'vllm', 'llama-cpp', 'llama.cpp', 'llamacpp', 'transformers', 'candle', 'tch', 'gguf', 'ggml',
    'mlx', 'mlx-lm', 'whisper.cpp', 'whisper', 'localai', 'lmstudio', 'sglang', 'text-generation-webui',
    'fastembed', 'onnxruntime', 'koboldcpp', 'text-gen-webui', 'torch', 'diffusers', 'accelerate', 'peft',
    'sentence-transformers', 'sentencepiece', 'safetensors', 'optimum', 'bitsandbytes', 'deepspeed',
    'xformers', 'ctransformers', 'tabby', 'text-generation', 'openvino', 'gguf-python', 'outlines',
  ]],
  // Прокси к провайдерам.
  ['gateway', ['litellm', 'portkey', 'helicone', 'openrouter', 'langfuse', 'openlit', 'braintrust', 'aigate', 'oneapi', 'new-api', 'uni-api', 'anyrouter', 'openai-proxy', 'ai-gateway', 'truefoundry', 'openllmetry', 'arize', 'phoenix', 'traceloop', 'weave', 'literalai', 'prompt-layer', 'vcr', 'mock-llm']],
  // Абстракции поверх SDK.
  ['framework', ['langchain', 'langgraph', 'llama-index', 'llamaindex', 'semantic-kernel', 'semantickernel', 'autogen', 'crewai', 'dspy', 'pydantic-ai', 'smolagents', 'haystack', 'marvin', 'instructor', 'agno', 'atomic-agents', 'letta', 'rasa', 'n8n', 'camel', 'microsoft-agent-framework', 'swarms', 'openai-agents', 'langchain4j', 'langchain4s', 'ruby_llm', 'llphant', 'prism', 'ellmer', 'langchainrb', 'kotlin-openai', 'openai-swift', 'instructor_ex', 'req_llm']],
  ['orchestration', ['langserve', 'temporal', 'conductor', 'prefect', 'dagster', 'airflow']],
];

const FEATURE_RULES = [
  ['agents', ['agent', 'agents', 'multi-agent', 'autonomous', 'tool calling', 'tool use', 'function calling']],
  ['rag', ['rag', 'retrieval', 'vector store', 'vector database', 'knowledge base', 'grounding']],
  ['structured-output', ['structured output', 'json schema', 'json mode', 'pydantic model', 'zod schema', 'schema validation', 'typed output', 'grammar']],
  ['tools', ['function calling', 'tool calling', 'tool use', 'tools parameter', 'function tool']],
  ['streaming', ['streaming', 'stream response', 'sse', 'server-sent events', 'websocket', 'live api']],
  ['vision', ['vision', 'image input', 'multimodal', 'vision-language', 'vlm', 'ocr', 'screenshot']],
  ['embeddings', ['embedding', 'embeddings', 'vectorize', 'semantic search']],
  ['audio', ['speech', 'whisper', 'text-to-speech', 'tts', 'stt', 'audio', 'voice', 'transcription']],
  ['image', ['image generation', 'dall-e', 'stable diffusion', 'flux', 'midjourney', 'text-to-image', 'sdxl']],
  ['video', ['video generation', 'text-to-video', 'veo', 'sora', 'wan 2']],
  ['batch', ['batch api', 'batches', 'batch processing', 'async batch']],
  ['finetune', ['fine-tune', 'finetune', 'fine tuning', 'lora', 'peft', 'distillation']],
  ['evals', ['evaluation', 'evals', 'benchmark', 'leaderboard', 'graders']],
  ['caching', ['prompt caching', 'cache', 'caching', 'kv cache', 'semantic cache']],
  ['tokenizers', ['tokenizer', 'token counting', 'tiktoken', 'bpe']],
  ['moderation', ['moderation', 'content filter', 'safety']],
  ['prompt-engineering', ['prompt engineering', 'prompt template', 'jinja', 'system prompt', 'few-shot']],
  ['observability', ['tracing', 'observability', 'telemetry', 'logging', 'monitoring', 'otel']],
];

const DEPRECATED_HINTS = [
  'deprecated', 'no longer maintained', 'unmaintained', 'archived by', 'obsolete',
  'this project is dead', 'use openai instead', 'superseded by',
];

const SDK_BY_PROVIDER = {
  openai: 'openai',
  'azure-openai': 'azure-openai',
  anthropic: 'anthropic-messages',
  'google-gemini': 'gemini',
  'vertex-ai': 'vertex',
  'aws-bedrock': 'bedrock',
  cohere: 'cohere-v2',
  mistral: 'mistral',
  jina: 'jina',
  ai21: 'ai21',
  replicate: 'replicate',
  ibm: 'watsonx',
  qwen: 'dashscope',
  'openai-compatible': 'openai-compatible',
};

function lower(value = '') {
  return String(value).toLowerCase();
}

export function inferKind(name, description = '', providers = []) {
  const text = `${lower(name)} ${lower(description)}`;
  for (const [kind, needles] of KIND_RULES) {
    if (needles.some((needle) => lower(name).includes(needle))) return kind;
  }
  // Клиент Hugging Face, который тянет модели и пайплайны инференса, — локальный
  // рантайм; сам клиент Hub (скачивание моделей) — сопутствующий инструмент.
  if (
    providers.includes('huggingface') &&
    /transformers|inference|diffusers|pipeline|torch|numpy/.test(lower(name))
  ) {
    return 'local-runtime';
  }
  if (providers.includes('aws-bedrock') || providers.includes('azure-openai')) return 'official-sdk';
  if (providers.includes('openai') || providers.includes('anthropic')) return 'client';
  if (providers.includes('openai-compatible')) return 'client';
  return 'client';
}

export function inferFeatures(name, description = '') {
  const nameText = lower(name);
  const text = `${nameText} ${lower(description)}`;
  const features = [];
  for (const [feature, needles] of FEATURE_RULES) {
    if (needles.some((needle) => nameText.includes(needle) || text.includes(needle))) features.push(feature);
  }
  return [...new Set(features)];
}

export function inferSdkApi(providers = []) {
  const ranked = [
    'openai', 'anthropic', 'aws-bedrock', 'azure-openai', 'google-gemini', 'cohere', 'mistral',
    'vertex-ai', 'qwen', 'jina', 'ai21', 'replicate', 'ibm', 'openai-compatible',
  ].filter((id) => providers.includes(id));
  return ranked.map((id) => SDK_BY_PROVIDER[id]).find(Boolean) ?? 'n/a';
}

export function inferStatus({ description = '', updatedAt, license } = {}) {
  const text = lower(description);
  if (DEPRECATED_HINTS.some((hint) => text.includes(hint))) return 'deprecated';
  if (license === 'GPL-3.0' && text.includes('legacy')) return 'deprecated';
  if (updatedAt) {
    const ageDays = (Date.now() - new Date(`${updatedAt}T00:00:00Z`).getTime()) / 86_400_000;
    if (ageDays > 730) return 'deprecated';
    if (ageDays > 400) return 'unknown';
    return 'active';
  }
  return 'unknown';
}

export function inferEnvVars(providers = [], providerMap = {}) {
  const envVars = new Set();
  for (const id of providers) {
    for (const key of providerMap[id]?.envVars ?? []) envVars.add(key);
  }
  return [...envVars].slice(0, 6);
}

/** Роль по отношению к провайдерам: выводится из kind, но может быть задана явно. */
export function roleForKind(kind) {
  return ROLE_BY_KIND[kind] ?? 'sdk';
}
