/**
 * CarShine Red Sea — Layla chatbot widget
 *
 * Black + white design, WhatsApp-style button, markdown rendering for Layla's
 * replies (**bold**, *italic*, lists, links). Trilingual-aware. Built on the
 * service-agent /api/public/chat endpoint.
 *
 * Footer credit: "Powered by CarShine · webdrift.io"
 *
 * Usage:
 *   <script src="https://your-domain.com/chatbot-widget.js"></script>
 *   <script>
 *     CarShineChat.init({
 *       apiUrl: 'https://api.your-domain.com',
 *       position: 'bottom-right',
 *       language: 'en' // 'en' | 'ar' | 'de'
 *     });
 *   </script>
 */

(function () {
  'use strict';

  const I18N = {
    en: {
      title: 'Layla — CarShine Concierge',
      subtitle: 'Online · typically replies in seconds',
      launcher: 'Chat with Layla',
      placeholder: 'Message Layla…',
      startLabel: 'Start chat',
      namePlaceholder: 'Full name',
      phonePlaceholder: 'WhatsApp phone',
      welcome: "👋 Hi! I'm Layla, CarShine's booking concierge. I can book a wash for you in El Gouna, Hurghada, or Sahl Hasheesh — what is your name?",
      bookingCreated: '✅ Booking request submitted! Our team will confirm on WhatsApp shortly.',
      humanNeeded: '👤 A team member will reach out to you personally on WhatsApp.',
      connectionError: '⚠️ Connection error. Please try again or contact us on WhatsApp +20 155 556 7205.',
      earlierLabel: 'Earlier conversation',
      poweredBy: 'Powered by CarShine · webdrift.io',
      sendAria: 'Send message',
      closeAria: 'Close chat',
      openAria: 'Open chat with Layla',
      sendFailed: "Sorry, I couldn't reach the booking service. Please try again or message us directly on WhatsApp."
    },
    ar: {
      title: 'ليلى — حجز كارشاين',
      subtitle: 'متاحة الآن · بيرد عادة في ثواني',
      launcher: 'كلّم ليلى',
      placeholder: 'اكتب رسالة لليلى…',
      startLabel: 'ابدأ المحادثة',
      namePlaceholder: 'الاسم بالكامل',
      phonePlaceholder: 'رقم واتساب',
      welcome: "👋 أهلاً بيك! أنا ليلى، مساعدة الحجز في كارشاين. أقدر أحجزلك غسيل في الجونة، الغردقة، أو سهل حشيش — إيه اسمك؟",
      bookingCreated: '✅ تم إرسال طلب الحجز! فريقنا هيأكدلك على واتساب خلال دقايق.',
      humanNeeded: '👤 حد من الفريق هيتواصل معاك شخصياً على واتساب.',
      connectionError: '⚠️ مشكلة في الاتصال. حاول تاني أو كلمنا على واتساب ٠١٠٠٥٥٥٦٧٢٠٥.',
      earlierLabel: 'محادثة سابقة',
      poweredBy: 'مدعوم من كارشاين · webdrift.io',
      sendAria: 'إرسال الرسالة',
      closeAria: 'إغلاق المحادثة',
      openAria: 'افتح المحادثة مع ليلى',
      sendFailed: 'آسفين، مقدرتش أوصل لسيرفر الحجز. حاول تاني أو ابعتلنا واتساب.'
    },
    de: {
      title: 'Layla — CarShine Concierge',
      subtitle: 'Online · antwortet meist in Sekunden',
      launcher: 'Mit Layla chatten',
      placeholder: 'Nachricht an Layla…',
      startLabel: 'Chat starten',
      namePlaceholder: 'Vollständiger Name',
      phonePlaceholder: 'WhatsApp-Nummer',
      welcome: "👋 Hallo! Ich bin Layla, CarShine's Buchungs-Concierge. Ich kann Ihnen eine Wäsche in El Gouna, Hurghada oder Sahl Hasheesh buchen — wie ist Ihr Name?",
      bookingCreated: '✅ Buchungsanfrage gesendet! Unser Team bestätigt in Kürze auf WhatsApp.',
      humanNeeded: '👤 Ein Teammitglied wird sich persönlich bei Ihnen auf WhatsApp melden.',
      connectionError: '⚠️ Verbindungsfehler. Bitte erneut versuchen oder uns auf WhatsApp +20 155 556 7205 kontaktieren.',
      earlierLabel: 'Frühere Konversation',
      poweredBy: 'Bereitgestellt von CarShine · webdrift.io',
      sendAria: 'Nachricht senden',
      closeAria: 'Chat schließen',
      openAria: 'Chat mit Layla öffnen',
      sendFailed: 'Entschuldigung, der Buchungsdienst ist nicht erreichbar. Bitte erneut versuchen oder direkt WhatsApp schreiben.'
    }
  };

  const DEFAULT_CONFIG = {
    apiUrl: 'http://localhost:5000',
    position: 'bottom-right',
    language: 'en',
    primaryColor: '#0a0a0a',  // black
    accentColor: '#ffffff',   // white
    autoOpen: false,
    showTimestamp: true,
    persistHistory: true
  };

  let config = { ...DEFAULT_CONFIG };
  let t = I18N[config.language] || I18N.en;
  let sessionId = null;
  let visitorName = '';
  let visitorPhone = '';
  let isOpen = false;
  let isTyping = false;
  let pollTimer = null;
  let pollInterval = 3500;
  let pollIdleMs = 0;
  const POLL_MAX_IDLE_MS = 600000;
  let lastKnownAgentMsgCount = 0;
  const STORAGE_KEY = 'carshine_chat_state_v3';

  // ─────────────────────────────────────────────────────────────────────────
  // Styles — black + white, WhatsApp-style launcher
  // ─────────────────────────────────────────────────────────────────────────
  const STYLES = `
    .cs-chat-launcher {
      position: fixed;
      bottom: 24px;
      right: 24px;
      min-width: 180px;
      height: 56px;
      padding: 0 18px;
      border-radius: 10px;  /* webdrift: square corners, exactly 10px per spec */
      background: #0a0a0a;
      color: #ffffff;
      border: 1px solid rgba(255,255,255,0.08);
      cursor: pointer;
      box-shadow: 0 10px 32px rgba(0,0,0,0.35), 0 2px 8px rgba(0,0,0,0.25);
      z-index: 999999;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      font-family: 'Geist', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      transition: transform .15s ease, box-shadow .15s ease;
    }
    .cs-chat-launcher:hover {
      transform: scale(1.04);
      box-shadow: 0 14px 40px rgba(0,0,0,0.45);
    }
    .cs-chat-launcher:active { transform: scale(0.98); }
    .cs-chat-launcher svg { width: 26px; height: 26px; flex: 0 0 auto; }
    .cs-launcher-label {
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 0.1px;
      white-space: nowrap;
    }
    .cs-launcher-pulse {
      position: absolute;
      top: 6px;
      right: 10px;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #ffffff;
      box-shadow: 0 0 0 0 rgba(255,255,255,0.6);
      animation: csPulse 1.6s ease-in-out infinite;
    }
    @keyframes csPulse {
      0%   { box-shadow: 0 0 0 0 rgba(255,255,255,0.55); }
      70%  { box-shadow: 0 0 0 10px rgba(255,255,255,0); }
      100% { box-shadow: 0 0 0 0 rgba(255,255,255,0); }
    }
    .cs-chat-launcher.cs-right { right: 24px; left: auto; }
    .cs-chat-launcher.cs-left  { left: 24px;  right: auto; }
    .cs-chat-launcher.cs-hidden { transform: scale(0); opacity: 0; pointer-events: none; }

    .cs-chat-window {
      position: fixed;
      bottom: 96px;
      right: 24px;
      width: 380px;
      max-width: calc(100vw - 32px);
      height: 580px;
      max-height: calc(100vh - 140px);
      background: #ffffff;
      border-radius: 16px;  /* webdrift: card-level rounded-2xl */
      box-shadow: 0 24px 60px rgba(0,0,0,0.28), 0 2px 8px rgba(0,0,0,0.12);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      z-index: 999998;
      transform: scale(0.96) translateY(8px);
      opacity: 0;
      pointer-events: none;
      transform-origin: bottom right;
      transition: transform .18s ease, opacity .18s ease;
      font-family: 'Geist', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    .cs-chat-window.cs-right { right: 24px; left: auto; transform-origin: bottom right; }
    .cs-chat-window.cs-left  { left: 24px;  right: auto; transform-origin: bottom left; }
    .cs-chat-window.cs-open { transform: scale(1) translateY(0); opacity: 1; pointer-events: auto; }

    .cs-header {
      background: linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 100%);
      color: #ffffff;
      padding: 16px 18px;
      display: flex;
      align-items: center;
      gap: 12px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    .cs-avatar {
      width: 42px; height: 42px;
      border-radius: 50%;
      background: #ffffff;
      color: #0a0a0a;
      display: flex; align-items: center; justify-content: center;
      font-weight: 800;
      font-size: 16px;
      letter-spacing: 0.3px;
      flex-shrink: 0;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    }
    .cs-avatar-ring {
      position: absolute;
      width: 12px; height: 12px;
      border-radius: 50%;
      background: #22c55e;
      border: 2px solid #0a0a0a;
      bottom: -2px; right: -2px;
    }
    .cs-avatar-wrap { position: relative; }
    .cs-header-text { flex: 1; min-width: 0; }
    .cs-title { font-weight: 700; font-size: 15px; line-height: 1.2; }
    .cs-subtitle {
      font-size: 12px;
      opacity: 0.75;
      margin-top: 2px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .cs-online-dot {
      width: 7px; height: 7px;
      border-radius: 50%;
      background: #22c55e;
      box-shadow: 0 0 4px #22c55e;
    }
    .cs-close {
      background: transparent;
      border: 0;
      color: #ffffff;
      width: 32px; height: 32px;
      border-radius: 50%;
      cursor: pointer;
      font-size: 22px;
      line-height: 1;
      display: flex; align-items: center; justify-content: center;
      transition: background .15s;
    }
    .cs-close:hover { background: rgba(255,255,255,0.12); }

    .cs-messages {
      flex: 1;
      overflow-y: auto;
      padding: 18px 16px 12px;
      background: #f5f5f5;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .cs-messages::-webkit-scrollbar { width: 6px; }
    .cs-messages::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.15); border-radius: 3px; }

    .cs-day-divider {
      align-self: center;
      font-size: 11px;
      color: rgba(0,0,0,0.45);
      background: rgba(255,255,255,0.85);
      padding: 4px 12px;
      border-radius: 6px;
      margin: 4px 0 8px;
      font-weight: 500;
      letter-spacing: 0.2px;
    }

    .cs-msg {
      max-width: 78%;
      padding: 10px 14px;
      border-radius: 12px;  /* webdrift: rounded-xl bubble */
      font-size: 14px;
      line-height: 1.5;
      word-wrap: break-word;
      white-space: pre-wrap;
      animation: csMsgIn .18s ease-out;
    }
    @keyframes csMsgIn {
      from { opacity: 0; transform: translateY(4px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .cs-msg p { margin: 0 0 6px; }
    .cs-msg p:last-child { margin-bottom: 0; }
    .cs-msg strong { font-weight: 700; }
    .cs-msg em { font-style: italic; }
    .cs-msg ul, .cs-msg ol { margin: 4px 0 4px 18px; padding: 0; }
    .cs-msg li { margin-bottom: 2px; }
    .cs-msg a { color: inherit; text-decoration: underline; }

    .cs-bot {
      align-self: flex-start;
      background: #ffffff;
      color: #0a0a0a;
      border-bottom-left-radius: 6px;
      box-shadow: 0 1px 2px rgba(0,0,0,0.08);
    }
    .cs-user {
      align-self: flex-end;
      background: #0a0a0a;
      color: #ffffff;
      border-bottom-right-radius: 6px;
    }
    .cs-system {
      align-self: center;
      background: rgba(0,0,0,0.06);
      color: rgba(0,0,0,0.55);
      font-size: 12px;
      padding: 6px 12px;
      border-radius: 999px;
    }
    .cs-booking {
      align-self: center;
      background: #ecfdf5;
      color: #065f46;
      border: 1px solid #a7f3d0;
      font-size: 13px;
      padding: 10px 14px;
      border-radius: 12px;
      font-weight: 600;
    }

    .cs-typing {
      align-self: flex-start;
      background: #ffffff;
      padding: 10px 14px;
      border-radius: 12px;
      display: flex;
      gap: 4px;
      box-shadow: 0 1px 2px rgba(0,0,0,0.08);
    }
    .cs-typing span {
      width: 6px; height: 6px;
      border-radius: 50%;
      background: rgba(0,0,0,0.35);
      animation: csDot 1.2s ease-in-out infinite;
    }
    .cs-typing span:nth-child(2) { animation-delay: 0.15s; }
    .cs-typing span:nth-child(3) { animation-delay: 0.3s; }
    @keyframes csDot {
      0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
      30% { transform: translateY(-3px); opacity: 1; }
    }

    .cs-identity-form {
      padding: 14px 16px;
      background: #ffffff;
      border-top: 1px solid rgba(0,0,0,0.06);
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .cs-identity-label {
      font-size: 13px;
      color: rgba(0,0,0,0.65);
      font-weight: 500;
    }
    .cs-identity-row {
      display: grid;
      grid-template-columns: 1fr;
      gap: 8px;
    }
    .cs-identity-input {
      width: 100%;
      border: 1px solid rgba(0,0,0,0.12);
      border-radius: 10px;
      padding: 9px 12px;
      font-size: 13px;
      font-family: inherit;
      outline: none;
      background: #fafafa;
      transition: border-color .15s, background .15s;
    }
    .cs-identity-input:focus {
      border-color: #0a0a0a;
      background: #ffffff;
    }
    .cs-start {
      border: 0;
      border-radius: 10px;
      min-height: 38px;
      background: #0a0a0a;
      color: #ffffff;
      font-weight: 700;
      font-size: 13px;
      cursor: pointer;
      transition: opacity .15s;
    }
    .cs-start:hover { opacity: 0.88; }
    .cs-start:disabled { opacity: 0.5; cursor: not-allowed; }

    .cs-input-area {
      display: flex;
      align-items: flex-end;
      gap: 8px;
      padding: 10px 12px 12px;
      background: #ffffff;
      border-top: 1px solid rgba(0,0,0,0.06);
    }
    .cs-input {
      flex: 1;
      border: 1px solid rgba(0,0,0,0.12);
      border-radius: 10px;
      padding: 9px 13px;
      font-size: 14px;
      font-family: inherit;
      outline: none;
      resize: none;
      max-height: 100px;
      min-height: 38px;
      line-height: 1.4;
      background: #fafafa;
      transition: border-color .15s, background .15s;
    }
    .cs-input:focus {
      border-color: #0a0a0a;
      background: #ffffff;
    }
    .cs-input:disabled { opacity: 0.6; cursor: not-allowed; }
    .cs-send {
      background: #0a0a0a;
      color: #ffffff;
      border: none;
      width: 38px;
      height: 38px;
      border-radius: 10px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform .15s, opacity .15s;
      flex-shrink: 0;
    }
    .cs-send:hover:not(:disabled) { transform: scale(1.06); }
    .cs-send:disabled { opacity: 0.35; cursor: not-allowed; }
    .cs-send svg { width: 18px; height: 18px; }

    .cs-footer {
      padding: 6px 12px 8px;
      text-align: center;
      background: #ffffff;
      border-top: 1px solid rgba(0,0,0,0.04);
    }
    .cs-footer a {
      color: rgba(0,0,0,0.45);
      font-size: 10px;
      text-decoration: none;
      letter-spacing: 0.2px;
      transition: color .15s;
    }
    .cs-footer a:hover { color: #0a0a0a; }
    .cs-footer .cs-footer-sep { color: rgba(0,0,0,0.25); margin: 0 6px; }

    .cs-unread-dot {
      position: absolute;
      top: 4px; right: 4px;
      width: 10px; height: 10px;
      border-radius: 50%;
      background: #ef4444;
      border: 2px solid #ffffff;
    }

    @media (max-width: 480px) {
      .cs-chat-window {
        width: calc(100vw - 32px);
        right: 16px; left: 16px;
        bottom: 90px;
        height: calc(100vh - 120px);
      }
      .cs-chat-launcher {
        right: 16px; bottom: 16px;
        left: auto;
        min-width: 64px;
        height: 56px;
        padding: 0 14px;
        gap: 6px;
        border-radius: 28px;
      }
      .cs-chat-launcher.cs-left { left: 16px; right: auto; }
      .cs-chat-launcher svg { width: 22px; height: 22px; }
      .cs-launcher-label { font-size: 13px; }
    }
  `;

  function injectStyles() {
    if (document.getElementById('cs-chat-styles-v3')) return;
    const style = document.createElement('style');
    style.id = 'cs-chat-styles-v3';
    style.textContent = STYLES;
    document.head.appendChild(style);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Markdown rendering — handles **bold**, *italic*, lists, and links.
  // We do this safely via DOM construction (no innerHTML on user data).
  // ─────────────────────────────────────────────────────────────────────────
  function renderInline(text) {
    // returns a DocumentFragment with bold/italic/links applied safely
    const frag = document.createDocumentFragment();
    // Pattern order matters: bold (**) before italic (*).
    // Splits on **...**, *...*, plain text. Handles emoji + RTL fine.
    const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*|https?:\/\/[^\s)]+)/g;
    let last = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      if (m[2] !== undefined) {
        const b = document.createElement('strong');
        b.textContent = m[2];
        frag.appendChild(b);
      } else if (m[3] !== undefined) {
        const em = document.createElement('em');
        em.textContent = m[3];
        frag.appendChild(em);
      } else if (m[0].startsWith('http')) {
        const a = document.createElement('a');
        a.href = m[0];
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = m[0];
        frag.appendChild(a);
      }
      last = m.index + m[0].length;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    return frag;
  }

  function renderRichText(container, text) {
    // Splits on blank-line paragraph breaks and list markers (- or * at line start).
    const lines = String(text || '').split('\n');
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      // List block
      if (/^\s*[-*]\s+/.test(line)) {
        const ul = document.createElement('ul');
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
          const li = document.createElement('li');
          li.appendChild(renderInline(lines[i].replace(/^\s*[-*]\s+/, '')));
          ul.appendChild(li);
          i++;
        }
        container.appendChild(ul);
        continue;
      }
      // Empty line → break
      if (line.trim() === '') { i++; continue; }
      // Paragraph (consume consecutive non-empty lines)
      const p = document.createElement('p');
      const paraLines = [];
      while (i < lines.length && lines[i].trim() !== '' && !/^\s*[-*]\s+/.test(lines[i])) {
        paraLines.push(lines[i]);
        i++;
      }
      p.appendChild(renderInline(paraLines.join(' ')));
      container.appendChild(p);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Persistence
  // ─────────────────────────────────────────────────────────────────────────
  function persistChatState() {
    if (!config.persistHistory) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        sessionId, visitorName, visitorPhone, language: config.language
      }));
    } catch (_e) { /* ignore */ }
  }

  function restoreChatState() {
    if (!config.persistHistory) return;
    try {
      const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      sessionId = s.sessionId || null;
      visitorName = s.visitorName || '';
      visitorPhone = s.visitorPhone || '';
      if (s.language && I18N[s.language]) config.language = s.language;
    } catch (_e) { /* ignore */ }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Widget construction
  // ─────────────────────────────────────────────────────────────────────────
  function createWidget() {
    injectStyles();
    restoreChatState();
    t = I18N[config.language] || I18N.en;

    const isRight = config.position !== 'bottom-left';
    const posClass = isRight ? 'cs-right' : 'cs-left';

    // ── Launcher
    const launcher = document.createElement('button');
    launcher.className = `cs-chat-launcher ${posClass}`;
    launcher.setAttribute('aria-label', t.openAria);
    launcher.innerHTML = `
      <svg viewBox="0 0 32 32" fill="currentColor" aria-hidden="true">
        <path d="M16.04 3C9.4 3 4 8.4 4 15.04c0 2.12.55 4.17 1.6 5.98L4 29l8.18-1.55c1.2.43 2.5.66 3.86.66h.01c6.64 0 12.04-5.4 12.04-12.04C28.09 8.4 22.68 3 16.04 3zm5.44 14.5c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51l-.57-.01c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.49 0 1.47 1.07 2.89 1.22 3.09.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.62.71.23 1.36.2 1.87.12.57-.08 1.76-.72 2-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35z"/>
      </svg>
      <span class="cs-launcher-label">${escapeHtml(t.launcher)}</span>
      <span class="cs-launcher-pulse"></span>
    `;
    launcher.addEventListener('click', toggleChat);
    document.body.appendChild(launcher);

    // ── Chat window
    const window_ = document.createElement('div');
    window_.className = `cs-chat-window ${posClass}`;
    window_.setAttribute('role', 'dialog');
    window_.setAttribute('aria-label', t.title);
    window_.innerHTML = `
      <div class="cs-header">
        <div class="cs-avatar-wrap">
          <div class="cs-avatar">L</div>
          <div class="cs-avatar-ring"></div>
        </div>
        <div class="cs-header-text">
          <p class="cs-title">${escapeHtml(t.title)}</p>
          <p class="cs-subtitle"><span class="cs-online-dot"></span> ${escapeHtml(t.subtitle)}</p>
        </div>
        <button class="cs-close" aria-label="${escapeHtml(t.closeAria)}">&times;</button>
      </div>
      <div class="cs-messages" id="cs-messages"></div>
      <div class="cs-identity-form" id="cs-identity-form">
        <div class="cs-identity-label">${escapeHtml(t.welcome)}</div>
        <div class="cs-identity-row">
          <input type="text" class="cs-identity-input" id="cs-name" placeholder="${escapeHtml(t.namePlaceholder)}" autocomplete="name" />
          <input type="tel" class="cs-identity-input" id="cs-phone" placeholder="${escapeHtml(t.phonePlaceholder)}" autocomplete="tel" />
        </div>
        <button class="cs-start" id="cs-start" type="button">${escapeHtml(t.startLabel)}</button>
      </div>
      <div class="cs-input-area" style="display:none;" id="cs-input-area">
        <textarea class="cs-input" id="cs-input" placeholder="${escapeHtml(t.placeholder)}" maxlength="2000" rows="1"></textarea>
        <button class="cs-send" id="cs-send" aria-label="${escapeHtml(t.sendAria)}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
          </svg>
        </button>
      </div>
      <div class="cs-footer">
        <a href="https://carshineredsea.com" target="_blank" rel="noopener">${escapeHtml(t.poweredBy)}</a>
      </div>
    `;
    document.body.appendChild(window_);

    // ── Event wiring
    window_.querySelector('.cs-close').addEventListener('click', toggleChat);
    const input = window_.querySelector('#cs-input');
    const sendBtn = window_.querySelector('#cs-send');
    const nameInput = window_.querySelector('#cs-name');
    const phoneInput = window_.querySelector('#cs-phone');
    const startBtn = window_.querySelector('#cs-start');
    const identityForm = window_.querySelector('#cs-identity-form');
    const inputArea = window_.querySelector('#cs-input-area');

    nameInput.value = visitorName;
    phoneInput.value = visitorPhone;

    // Auto-grow textarea
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 100) + 'px';
    });

    const hasIdentity = Boolean(visitorName && visitorPhone);
    if (hasIdentity) {
      identityForm.style.display = 'none';
      inputArea.style.display = 'flex';
    }

    startBtn.addEventListener('click', () => {
      const name = (nameInput.value || '').trim();
      const phone = (phoneInput.value || '').trim();
      if (!name || !phone) { nameInput.focus(); return; }
      visitorName = name;
      visitorPhone = phone;
      persistChatState();
      identityForm.style.display = 'none';
      inputArea.style.display = 'flex';
      // Send a greeting message from Layla now that we know who they are
      addMessage('bot', t.welcome);
      input.focus();
    });

    const submitInput = () => sendMessage(input);
    sendBtn.addEventListener('click', submitInput);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submitInput();
      }
    });

    // Restore conversation history if any
    if (sessionId) restoreHistory();
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = String(str == null ? '' : str);
    return div.innerHTML;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Messages
  // ─────────────────────────────────────────────────────────────────────────
  function addMessage(type, text) {
    const messages = document.getElementById('cs-messages');
    if (!messages) return;
    const msg = document.createElement('div');
    msg.className = `cs-msg cs-${type}`;
    if (type === 'user' || type === 'system' || type === 'booking') {
      // Plain text rendering for these types — safe
      msg.textContent = text;
    } else {
      // Bot replies: render markdown to DOM
      renderRichText(msg, text);
    }
    messages.appendChild(msg);
    messages.scrollTop = messages.scrollHeight;
  }

  function addDayDivider(label) {
    const messages = document.getElementById('cs-messages');
    if (!messages) return;
    const div = document.createElement('div');
    div.className = 'cs-day-divider';
    div.textContent = label;
    messages.appendChild(div);
  }

  function showTyping() {
    const messages = document.getElementById('cs-messages');
    if (!messages || document.getElementById('cs-typing')) return;
    const typing = document.createElement('div');
    typing.className = 'cs-typing';
    typing.id = 'cs-typing';
    typing.innerHTML = '<span></span><span></span><span></span>';
    messages.appendChild(typing);
    messages.scrollTop = messages.scrollHeight;
  }

  function hideTyping() {
    document.getElementById('cs-typing')?.remove();
  }

  async function sendMessage(input) {
    const text = input.value.trim();
    if (!text || isTyping) return;

    addMessage('user', text);
    input.value = '';
    input.style.height = 'auto';

    isTyping = true;
    input.disabled = true;
    document.getElementById('cs-send').disabled = true;
    showTyping();

    try {
      const res = await fetch(config.apiUrl.replace(/\/$/, '') + '/api/public/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, message: text, name: visitorName, phone: visitorPhone, language: config.language })
      });

      if (!res.ok) {
        hideTyping();
        let msg = t.sendFailed;
        try {
          const err = await res.json();
          if (err && (err.reply || err.error)) msg = String(err.reply || err.error);
        } catch (_e) { /* ignore */ }
        addMessage('system', msg);
        return;
      }

      const data = await res.json();
      sessionId = data.sessionId;
      persistChatState();
      startPolling();

      // Subtle natural-feel delay (only when reply is short)
      const delay = 350 + Math.min(900, (data.reply || '').length * 6);
      await new Promise(r => setTimeout(r, delay));
      hideTyping();
      addMessage('bot', data.reply);

      if (data.bookingCreated) {
        setTimeout(() => addMessage('booking', t.bookingCreated), 400);
      }
      if (data.humanNeeded) {
        setTimeout(() => addMessage('system', t.humanNeeded), 400);
      }
    } catch (err) {
      console.error('Chat error:', err);
      hideTyping();
      addMessage('system', t.connectionError);
    } finally {
      isTyping = false;
      input.disabled = false;
      document.getElementById('cs-send').disabled = false;
      input.focus();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Polling for admin replies
  // ─────────────────────────────────────────────────────────────────────────
  function startPolling() {
    if (pollTimer || !sessionId) return;
    pollTimer = setTimeout(_doPoll, pollInterval);
  }

  function stopPolling() {
    clearTimeout(pollTimer);
    pollTimer = null;
  }

  async function _doPoll() {
    pollTimer = null;
    if (!sessionId) return;
    try {
      const res = await fetch(config.apiUrl.replace(/\/$/, '') + '/api/public/chat/' + encodeURIComponent(sessionId));
      if (res.ok) {
        const data = await res.json();
        const agentMsgs = (data.messages || []).filter(m => m.sender === 'agent');
        if (agentMsgs.length > lastKnownAgentMsgCount) {
          agentMsgs.slice(lastKnownAgentMsgCount).forEach(m => addMessage('bot', m.text));
          lastKnownAgentMsgCount = agentMsgs.length;
          pollIdleMs = 0;
          pollInterval = 3500;
          if (!isOpen) _showUnreadDot();
        } else {
          pollIdleMs += pollInterval;
          if (pollIdleMs > 180000) pollInterval = 15000;
          else if (pollIdleMs > 60000) pollInterval = 8000;
        }
      }
    } catch (_e) { /* ignore */ }
    if (pollIdleMs < POLL_MAX_IDLE_MS) pollTimer = setTimeout(_doPoll, pollInterval);
  }

  async function restoreHistory() {
    if (!sessionId) return;
    try {
      const res = await fetch(config.apiUrl.replace(/\/$/, '') + '/api/public/chat/' + encodeURIComponent(sessionId));
      if (!res.ok) return;
      const data = await res.json();
      const msgs = data.messages || [];
      if (msgs.length === 0) return;
      addDayDivider(t.earlierLabel);
      msgs.forEach(m => {
        if (m.sender === 'bot') addMessage('bot', m.text);
        else if (m.sender === 'customer') addMessage('user', m.text);
        else if (m.sender === 'agent') addMessage('bot', m.text);
      });
      lastKnownAgentMsgCount = msgs.filter(m => m.sender === 'agent').length;
    } catch (_e) { /* ignore */ }
  }

  function _showUnreadDot() {
    const launcher = document.querySelector('.cs-chat-launcher');
    if (launcher && !launcher.querySelector('.cs-unread-dot')) {
      const dot = document.createElement('span');
      dot.className = 'cs-unread-dot';
      launcher.style.position = 'relative';
      launcher.appendChild(dot);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Open / close
  // ─────────────────────────────────────────────────────────────────────────
  function toggleChat() {
    const window_ = document.querySelector('.cs-chat-window');
    const launcher = document.querySelector('.cs-chat-launcher');
    if (!window_) return;
    isOpen = !isOpen;
    window_.classList.toggle('cs-open', isOpen);
    launcher?.classList.toggle('cs-hidden', isOpen);
    launcher?.querySelector('.cs-unread-dot')?.remove();
    if (isOpen) {
      const input = document.getElementById('cs-input');
      setTimeout(() => input && input.focus(), 100);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────
  window.CarShineChat = {
    init: function (userConfig = {}) {
      config = { ...DEFAULT_CONFIG, ...userConfig };
      t = I18N[config.language] || I18N.en;
      injectStyles();
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createWidget);
      } else {
        createWidget();
      }
    },
    open: () => { if (!isOpen) toggleChat(); },
    close: () => { if (isOpen) toggleChat(); },
    toggle: toggleChat,
    setLanguage: (lang) => {
      if (I18N[lang]) {
        config.language = lang;
        t = I18N[lang];
        // Re-render static labels
        const win = document.querySelector('.cs-chat-window');
        if (win) {
          win.querySelector('.cs-title').textContent = t.title;
          win.querySelector('.cs-subtitle').innerHTML = `<span class="cs-online-dot"></span> ${t.subtitle}`;
          win.querySelector('.cs-close').setAttribute('aria-label', t.closeAria);
          win.querySelector('#cs-input').setAttribute('placeholder', t.placeholder);
          win.querySelector('#cs-send').setAttribute('aria-label', t.sendAria);
          win.querySelector('.cs-footer a').textContent = t.poweredBy;
        }
      }
    }
  };
})();