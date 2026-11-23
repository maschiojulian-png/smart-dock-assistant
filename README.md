# Smart Dock — Assistente Pessoal por Voz (PWA)

Web App progressivo (PWA) em **HTML, CSS e JavaScript puro**, com visual escuro minimalista estilo *Smart Dock*, otimizado para **Desktop (Windows/Mac)** e **iPhone Safari em tela cheia (modo Standalone)**.

## Funcionalidades

- **Relógio Digital & Modo Dock**: Tema escuro OLED, relógio grande (`tabular-nums`), data em português, saudação dinâmica e botão **Manter Tela Ligada** usando a **Screen Wake Lock API** (com reativação automática ao voltar para o app).
- **Google Agenda (OAuth Client-Side)**: Integração via **Google Identity Services** (`calendar.readonly`) exibindo os **próximos 5 eventos de hoje**, com destaque para o compromisso atual (`Agora`), tempo restante, atualização automática a cada 5 minutos e modo demonstração opcional.
- **Assistente de Voz com Gemini 2.5 Flash**: Reconhecimento de voz em português (`webkitSpeechRecognition` / `SpeechRecognition`), envio da pergunta + eventos de hoje para a API REST do **`gemini-2.5-flash`** e leitura natural da resposta em voz alta com `speechSynthesis`.
- **Configurações Seguras (`localStorage`)**: Ícone de engrenagem no canto superior direito para salvar `GEMINI_API_KEY`, `Google OAuth Client ID` e preferências de voz/relógio localmente no navegador.
- **Compatibilidade iOS Safari**: Meta tags `apple-mobile-web-app-capable`, `viewport-fit=cover` com `env(safe-area-inset-*)`, ícone `apple-touch-icon` e desbloqueio automático de áudio (`AudioContext` + `speechSynthesis`) no primeiro toque na tela.

## Como rodar localmente

Por requisitos de segurança do navegador (Google OAuth, Wake Lock API, Microfone e Service Worker), sirva a pasta via `http://localhost` ou **HTTPS** (evite abrir diretamente com `file://`):

```bash
# Usando Python 3
python -m http.server 8080

# Ou usando Node.js
npx serve -l 8080 .
```

Acesse `http://localhost:8080` no navegador.

## Como instalar em tela cheia no iPhone (iOS Safari)

1. Hospede os arquivos estáticos em um endereço **HTTPS** (ex.: GitHub Pages, Netlify, Vercel ou Cloudflare Pages — sem precisar de build).
2. Abra a URL no **Safari** do iPhone.
3. Toque em **Compartilhar** → **Adicionar à Tela de Início** → **Adicionar**.
4. Abra o app pelo ícone na tela inicial (ele abrirá em modo tela cheia sem barra de endereço).
5. Toque em qualquer ponto da tela ou no microfone para desbloquear o áudio do iOS.

## Como obter as credenciais

1. **GEMINI_API_KEY**: Crie gratuitamente no [Google AI Studio](https://aistudio.google.com/apikey).
2. **Google OAuth Client ID**:
   - Acesse o [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
   - Ative a **Google Calendar API** em *APIs & Services → Library*.
   - Em *Credentials*, crie um **OAuth client ID** do tipo **Web application**.
   - Adicione a origem do seu app em **Authorized JavaScript origins** (ex.: `http://localhost:8080` e/ou `https://seu-dominio.com`).
   - Copie o Client ID gerado e cole no menu de Configurações (⚙️) do Smart Dock.
