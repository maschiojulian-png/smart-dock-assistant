const DEFAULT_MODEL = 'gemini-3.8-flash';
const ALLOWED_MODELS = new Set([
  'gemini-3.8-flash',
  'gemini-3.5-flash-lite',
  'gemini-flash-latest',
  'gemini-4-hydrogen',
]);
const FALLBACK_MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-flash-latest'];

async function callGeminiModel(model, apiKey, payload) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const upstream = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await upstream.json().catch(() => ({}));
  return { status: upstream.status, ok: upstream.ok, data, model };
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

    const safeMaxTokens = Math.min(Number(generationConfig?.maxOutputTokens) || 512, 1024);
    const payload = {
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
      const result = await callGeminiModel(candidateModel, apiKey, payload);
      lastResult = result;
      if (result.ok) {
        return res.status(200).json({ ...result.data, _modelUsed: candidateModel });
      }
      // Só tenta fallback se for erro de modelo indisponível/descontinuado (404 ou 400 de modelo)
      const errMsg = String(result.data?.error?.message || '').toLowerCase();
      const isModelIssue =
        result.status === 404 ||
        errMsg.includes('no longer available') ||
        errMsg.includes('not found') ||
        errMsg.includes('deprecated');
      if (!isModelIssue) {
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
