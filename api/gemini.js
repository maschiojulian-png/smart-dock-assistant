const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const ALLOWED_MODELS = new Set([
  'gemini-3.5-flash-lite',
  'gemini-3.8-flash',
  'gemini-flash-latest',
  'gemini-4-hydrogen',
  'gemini-2.5-flash',
]);
const FALLBACK_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-flash-latest'];
const MODEL_TIMEOUT_MS = 9500;

function getThinkingConfigForModel(model) {
  if (model === 'gemini-3.5-flash-lite') {
    return { thinkingLevel: 'minimal' };
  }
  if (model === 'gemini-3.8-flash' || model === 'gemini-4-hydrogen') {
    return { thinkingLevel: 'low' };
  }
  return null;
}

function hasVisibleReply(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts.some((p) => !p.thought && typeof p.text === 'string' && p.text.trim().length > 0);
}

function isRetryableStatus(status, errMsg) {
  if ([404, 429, 500, 502, 503, 504].includes(status)) return true;
  const lower = String(errMsg || '').toLowerCase();
  return (
    lower.includes('no longer available') ||
    lower.includes('not found') ||
    lower.includes('deprecated') ||
    lower.includes('not supported') ||
    lower.includes('overloaded') ||
    lower.includes('unavailable') ||
    lower.includes('quota') ||
    lower.includes('rate limit')
  );
}

async function callGeminiModel(model, apiKey, basePayload, includeThinking = true) {
  const thinkingConfig = includeThinking ? getThinkingConfigForModel(model) : null;
  const payload = {
    ...basePayload,
    generationConfig: {
      ...basePayload.generationConfig,
      ...(thinkingConfig ? { thinkingConfig } : {}),
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);

  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify(payload),
    });
    const data = await upstream.json().catch(() => ({}));
    return { status: upstream.status, ok: upstream.ok, data, model, timedOut: false };
  } catch (err) {
    const timedOut = err && err.name === 'AbortError';
    return {
      status: timedOut ? 504 : 502,
      ok: false,
      data: {
        error: {
          message: timedOut
            ? `Tempo limite excedido no modelo ${model}.`
            : `Falha de conexão com o modelo ${model}.`,
        },
      },
      model,
      timedOut,
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    return res.status(200).json({
      configured: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()),
      googleClientId: (process.env.GOOGLE_CLIENT_ID || '').trim(),
      defaultModel: DEFAULT_MODEL,
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: { message: 'Method not allowed' } });
  }

  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    return res.status(503).json({
      error: {
        message: 'GEMINI_API_KEY não configurada nas variáveis de ambiente da Vercel.',
      },
    });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const { systemInstruction, contents, generationConfig, model } = body;

    if (!Array.isArray(contents) || contents.length === 0) {
      return res.status(400).json({ error: { message: 'Conteúdo da pergunta ausente.' } });
    }

    const requestedModel = ALLOWED_MODELS.has(model) ? model : DEFAULT_MODEL;
    const modelsToTry = [
      requestedModel,
      ...FALLBACK_MODELS.filter((m) => m !== requestedModel),
    ];

    const safeMaxTokens = Math.min(Number(generationConfig?.maxOutputTokens) || 1024, 2048);
    const basePayload = {
      systemInstruction,
      contents: contents.slice(-10),
      generationConfig: {
        temperature:
          typeof generationConfig?.temperature === 'number'
            ? generationConfig.temperature
            : 0.7,
        maxOutputTokens: safeMaxTokens,
      },
    };

    let lastResult = null;
    for (const candidateModel of modelsToTry) {
      let result = await callGeminiModel(candidateModel, apiKey, basePayload, true);

      if (
        !result.ok &&
        result.status === 400 &&
        /thinking/i.test(result.data?.error?.message || '')
      ) {
        result = await callGeminiModel(candidateModel, apiKey, basePayload, false);
      }

      lastResult = result;
      if (result.ok && hasVisibleReply(result.data)) {
        return res.status(200).json({ ...result.data, _modelUsed: candidateModel });
      }

      if (result.ok && !hasVisibleReply(result.data)) {
        lastResult = {
          status: 502,
          data: { error: { message: 'O Gemini retornou uma resposta vazia.' } },
        };
        continue;
      }

      const errMsg = String(result.data?.error?.message || '');
      if (!result.timedOut && !isRetryableStatus(result.status, errMsg)) {
        return res.status(result.status).json(result.data);
      }
    }

    return res.status(lastResult?.status || 502).json(
      lastResult?.data || { error: { message: 'Nenhum modelo Gemini disponível respondeu.' } }
    );
  } catch (err) {
    console.error('Erro na rota /api/gemini:', err);
    return res.status(500).json({
      error: { message: 'Falha interna ao consultar a API do Gemini.' },
    });
  }
};
