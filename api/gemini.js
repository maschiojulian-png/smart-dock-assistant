const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    return res.status(200).json({
      configured: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()),
      googleClientId: (process.env.GOOGLE_CLIENT_ID || '').trim(),
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
    const { systemInstruction, contents, generationConfig } = body;

    if (!Array.isArray(contents) || contents.length === 0) {
      return res.status(400).json({ error: { message: 'Conteúdo da pergunta ausente.' } });
    }

    const safeMaxTokens = Math.min(
      Number(generationConfig?.maxOutputTokens) || 512,
      1024
    );

    const upstream = await fetch(`${GEMINI_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        systemInstruction,
        contents: contents.slice(-10),
        generationConfig: {
          temperature:
            typeof generationConfig?.temperature === 'number'
              ? generationConfig.temperature
              : 0.7,
          maxOutputTokens: safeMaxTokens,
        },
      }),
    });

    const data = await upstream.json().catch(() => ({}));
    return res.status(upstream.status).json(data);
  } catch (err) {
    console.error('Erro na rota /api/gemini:', err);
    return res.status(500).json({
      error: { message: 'Falha interna ao consultar a API do Gemini.' },
    });
  }
};
