/**
 * CarShine Red Sea - Website Chatbot Widget
 * 
 * A floating chat widget that can be embedded in any page.
 * Connects to the service-agent's /api/public/chat endpoint.
 * 
 * Usage:
 *   <script src="https://your-domain.com/chatbot-widget.js"></script>
 *   <script>CarShineChat.init({ apiUrl: 'https://api.your-domain.com', position: 'bottom-left' });</script>
 */

(function() {
  'use strict';
  
  const DEFAULT_CONFIG = {
    apiUrl: 'http://localhost:5000',
    position: 'bottom-left',  // 'bottom-left' | 'bottom-right'
    title: 'CarShine Assistant',
    subtitle: 'Online - AI-powered booking',
    primaryColor: '#061425',
    accentColor: '#00b894',
    launcherLabel: 'Chat with Layla',
    placeholder: 'Type your message...',
    welcomeMessage: 'Hi! Welcome to CarShine Red Sea. I can help you book a car wash in El Gouna, Hurghada, or Sahl Hasheesh. What is your name?',
    autoOpen: false,
    showTimestamp: true
  };
  
  let config = { ...DEFAULT_CONFIG };
  let sessionId = null;
  let visitorName = '';
  let visitorPhone = '';
  let isOpen = false;
  let isTyping = false;
  const STORAGE_KEY = 'carshine_chat_state_v1';
  
  // Inject styles
  const STYLES = `
    .cs-chat-launcher {
      position: fixed;
      bottom: 24px;
      left: 24px;
      min-width: 168px;
      height: 62px;
      padding: 0 22px 0 18px;
      border-radius: 999px;
      /* WhatsApp-style green pill */
      background: #25D366;
      color: #ffffff;
      border: none;
      cursor: pointer;
      box-shadow: 0 6px 20px rgba(37,211,102,.45);
      z-index: 999999;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      transition: transform .2s ease, box-shadow .2s ease;
    }
    .cs-chat-launcher:hover {
      transform: scale(1.08);
      box-shadow: 0 6px 20px rgba(0,0,0,.35);
    }
    .cs-chat-launcher svg {
      width: 27px;
      height: 27px;
      flex: 0 0 auto;
    }
    .cs-launcher-label {
      font-size: 14px;
      font-weight: 800;
      letter-spacing: 0;
      white-space: nowrap;
    }
    .cs-chat-launcher .cs-badge {
      position: absolute;
      top: -2px;
      right: -2px;
      background: #ff4757;
      color: white;
      font-size: 10px;
      font-weight: bold;
      border-radius: 10px;
      padding: 2px 5px;
      display: none;
    }
    
    .cs-chat-window {
      position: fixed;
      bottom: 100px;
      left: 24px;
      width: 380px;
      max-width: calc(100vw - 48px);
      height: 560px;
      max-height: calc(100vh - 140px);
      background: #ffffff;
      border-radius: 16px;
      box-shadow: 0 12px 40px rgba(0,0,0,.18);
      z-index: 999998;
      display: none;
      flex-direction: column;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      overflow: hidden;
      animation: cs-slide-up .3s ease;
    }
    .cs-chat-window.cs-open { display: flex; }
    .cs-chat-window.cs-right { left: auto; right: 24px; }
    
    @keyframes cs-slide-up {
      from { transform: translateY(20px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
    
    .cs-header {
      background: var(--cs-primary, #061425);
      color: white;
      padding: 18px 20px;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .cs-avatar {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: var(--cs-accent, #00b894);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      font-size: 18px;
    }
    .cs-header-text { flex: 1; }
    .cs-title {
      font-size: 15px;
      font-weight: 600;
      margin: 0;
    }
    .cs-subtitle {
      font-size: 12px;
      opacity: 0.85;
      margin: 2px 0 0 0;
    }
    .cs-close {
      background: transparent;
      border: none;
      color: white;
      cursor: pointer;
      font-size: 22px;
      padding: 0;
      line-height: 1;
      opacity: 0.8;
    }
    .cs-close:hover { opacity: 1; }
    
    .cs-messages {
      flex: 1;
      overflow-y: auto;
      padding: 20px 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      background: #f8f9fa;
    }
    
    .cs-msg {
      max-width: 80%;
      padding: 10px 14px;
      border-radius: 18px;
      font-size: 14px;
      line-height: 1.45;
      word-wrap: break-word;
      white-space: pre-wrap;
    }
    .cs-msg.cs-bot {
      align-self: flex-start;
      background: white;
      color: #061425;
      border-bottom-left-radius: 4px;
      box-shadow: 0 1px 2px rgba(0,0,0,.08);
    }
    .cs-msg.cs-user {
      align-self: flex-end;
      background: var(--cs-primary, #061425);
      color: white;
      border-bottom-right-radius: 4px;
    }
    .cs-msg.cs-system {
      align-self: center;
      background: transparent;
      color: #888;
      font-size: 12px;
      font-style: italic;
    }
    .cs-msg.cs-booking {
      background: var(--cs-accent, #00b894);
      color: white;
      align-self: flex-start;
      border-bottom-left-radius: 4px;
    }
    
    .cs-typing {
      align-self: flex-start;
      background: white;
      padding: 12px 16px;
      border-radius: 18px;
      border-bottom-left-radius: 4px;
      display: flex;
      gap: 4px;
    }
    .cs-typing span {
      width: 6px;
      height: 6px;
      background: #aaa;
      border-radius: 50%;
      animation: cs-bounce 1.4s infinite ease-in-out;
    }
    .cs-typing span:nth-child(2) { animation-delay: .2s; }
    .cs-typing span:nth-child(3) { animation-delay: .4s; }
    @keyframes cs-bounce {
      0%, 80%, 100% { transform: scale(0); }
      40% { transform: scale(1); }
    }
    
    .cs-input-area {
      padding: 12px 16px;
      border-top: 1px solid #e9ecef;
      background: white;
      display: flex;
      gap: 8px;
    }
    .cs-identity-form {
      padding: 14px 16px;
      border-top: 1px solid #e9ecef;
      background: #ffffff;
      display: grid;
      gap: 8px;
    }
    .cs-identity-label {
      font-size: 12px;
      font-weight: 800;
      color: #061425;
    }
    .cs-identity-row {
      display: grid;
      grid-template-columns: 1fr;
      gap: 8px;
    }
    .cs-identity-input {
      width: 100%;
      border: 1px solid #e9ecef;
      border-radius: 14px;
      padding: 10px 12px;
      font-size: 13px;
      font-family: inherit;
      outline: none;
    }
    .cs-identity-input:focus {
      border-color: var(--cs-primary, #061425);
    }
    .cs-start {
      border: 0;
      border-radius: 14px;
      min-height: 40px;
      background: var(--cs-primary, #061425);
      color: white;
      font-weight: 800;
      cursor: pointer;
    }
    .cs-start:disabled {
      opacity: .5;
      cursor: not-allowed;
    }
    .cs-input {
      flex: 1;
      border: 1px solid #e9ecef;
      border-radius: 22px;
      padding: 10px 16px;
      font-size: 14px;
      font-family: inherit;
      outline: none;
      transition: border-color .2s;
    }
    .cs-input:focus {
      border-color: var(--cs-primary, #061425);
    }
    .cs-send {
      background: var(--cs-primary, #061425);
      color: white;
      border: none;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform .15s;
    }
    .cs-send:hover:not(:disabled) {
      transform: scale(1.05);
    }
    .cs-send:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .cs-send svg {
      width: 18px;
      height: 18px;
    }
    
    .cs-footer {
      padding: 8px;
      text-align: center;
      background: white;
      border-top: 1px solid #f0f0f0;
    }
    .cs-footer a {
      color: #888;
      font-size: 11px;
      text-decoration: none;
    }
    .cs-footer a:hover { color: #061425; }
    
    @media (max-width: 480px) {
      .cs-chat-window {
        width: calc(100vw - 32px);
        left: 16px;
        right: 16px;
        bottom: 90px;
        height: calc(100vh - 120px);
      }
      .cs-chat-launcher {
        left: 16px;
        bottom: 16px;
        min-width: 74px;
        height: 32px;
        padding: 0 9px;
        gap: 6px;
        border-radius: 10px;
        box-shadow: 0 8px 20px rgba(0,0,0,.2);
      }
      .cs-chat-launcher svg {
        width: 14px;
        height: 14px;
      }
      .cs-launcher-label {
        font-size: 10px;
      }
    }
  `;
  
  function injectStyles() {
    if (document.getElementById('cs-chat-styles')) return;
    const style = document.createElement('style');
    style.id = 'cs-chat-styles';
    style.textContent = STYLES;
    document.head.appendChild(style);
  }
  
  function createWidget() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      sessionId = saved.sessionId || null;
      visitorName = saved.visitorName || '';
      visitorPhone = saved.visitorPhone || '';
    } catch (err) {
      sessionId = null;
      visitorName = '';
      visitorPhone = '';
    }
    // Position
    const isRight = config.position === 'bottom-right';
    const posClass = isRight ? 'cs-right' : '';
    
    // Launcher button
    const launcher = document.createElement('button');
    launcher.className = 'cs-chat-launcher';
    if (isRight) launcher.style.right = '24px';
    launcher.style.cssText += `--cs-primary: ${config.primaryColor}; --cs-accent: ${config.accentColor}; ${isRight ? 'right: 24px; left: auto;' : ''}`;
    launcher.setAttribute('aria-label', 'Open chat');
    launcher.innerHTML = `
      <svg viewBox="0 0 32 32" fill="currentColor" aria-hidden="true">
        <path d="M16.04 3C9.4 3 4 8.4 4 15.04c0 2.12.55 4.17 1.6 5.98L4 29l8.18-1.55c1.2.43 2.5.66 3.86.66h.01c6.64 0 12.04-5.4 12.04-12.04C28.09 8.4 22.68 3 16.04 3zm5.44 14.5c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51l-.57-.01c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.49 0 1.47 1.07 2.89 1.22 3.09.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.62.71.23 1.36.2 1.87.12.57-.08 1.76-.72 2-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35z"/>
      </svg>
      <span class="cs-launcher-label">${escapeHtml(config.launcherLabel)}</span>
      <span class="cs-badge">1</span>
    `;
    launcher.addEventListener('click', toggleChat);
    document.body.appendChild(launcher);
    
    // Chat window
    const window_ = document.createElement('div');
    window_.className = `cs-chat-window ${posClass}`;
    window_.style.cssText = `--cs-primary: ${config.primaryColor}; --cs-accent: ${config.accentColor};`;
    window_.innerHTML = `
      <div class="cs-header">
        <div class="cs-avatar">CS</div>
        <div class="cs-header-text">
          <p class="cs-title">${escapeHtml(config.title)}</p>
          <p class="cs-subtitle">${escapeHtml(config.subtitle)}</p>
        </div>
        <button class="cs-close" aria-label="Close chat">&times;</button>
      </div>
      <div class="cs-messages" id="cs-messages"></div>
      <div class="cs-identity-form" id="cs-identity-form">
        <div class="cs-identity-label">Start with your details</div>
        <div class="cs-identity-row">
          <input type="text" class="cs-identity-input" id="cs-name" placeholder="Full name" autocomplete="name" />
          <input type="tel" class="cs-identity-input" id="cs-phone" placeholder="WhatsApp phone" autocomplete="tel" />
        </div>
        <button class="cs-start" id="cs-start" type="button">Start chat</button>
      </div>
      <div class="cs-input-area">
        <input type="text" class="cs-input" id="cs-input" placeholder="${escapeHtml(config.placeholder)}" maxlength="2000" />
        <button class="cs-send" id="cs-send" aria-label="Send">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
          </svg>
        </button>
      </div>
      <div class="cs-footer">
        <a href="https://carshineredsea.com" target="_blank" rel="noopener">Powered by CarShine</a>
      </div>
    `;
    document.body.appendChild(window_);
    
    // Event handlers
    window_.querySelector('.cs-close').addEventListener('click', toggleChat);
    const input = window_.querySelector('#cs-input');
    const sendBtn = window_.querySelector('#cs-send');
    const nameInput = window_.querySelector('#cs-name');
    const phoneInput = window_.querySelector('#cs-phone');
    const startBtn = window_.querySelector('#cs-start');
    nameInput.value = visitorName;
    phoneInput.value = visitorPhone;
    const hasIdentity = Boolean(visitorName && visitorPhone);
    if (hasIdentity) {
      window_.querySelector('#cs-identity-form').style.display = 'none';
      input.disabled = false;
      sendBtn.disabled = false;
    } else {
      input.disabled = true;
      sendBtn.disabled = true;
    }
    startBtn.addEventListener('click', () => {
      visitorName = nameInput.value.trim();
      visitorPhone = phoneInput.value.trim();
      if (!visitorName || !visitorPhone) {
        addMessage('system', 'Please add your name and WhatsApp number first.');
        return;
      }
      persistChatState();
      window_.querySelector('#cs-identity-form').style.display = 'none';
      input.disabled = false;
      sendBtn.disabled = false;
      addMessage('bot', `Thanks ${visitorName}. Ask me anything or tell me if you want to book.`);
      input.focus();
    });
    sendBtn.addEventListener('click', () => sendMessage(input));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage(input);
      }
    });
    
    // Show welcome message
    if (config.welcomeMessage) {
      addMessage('bot', config.welcomeMessage);
    }
    
    if (config.autoOpen) {
      setTimeout(toggleChat, 500);
    }
  }
  
  function toggleChat() {
    const window_ = document.querySelector('.cs-chat-window');
    isOpen = !isOpen;
    if (isOpen) {
      window_.classList.add('cs-open');
      // Hide badge
      const badge = document.querySelector('.cs-badge');
      if (badge) badge.style.display = 'none';
      // Focus input
      setTimeout(() => document.getElementById('cs-input')?.focus(), 100);
    } else {
      window_.classList.remove('cs-open');
    }
  }
  
  function addMessage(type, text) {
    const messages = document.getElementById('cs-messages');
    if (!messages) return;
    
    const msg = document.createElement('div');
    msg.className = `cs-msg cs-${type}`;
    msg.textContent = text;
    messages.appendChild(msg);
    messages.scrollTop = messages.scrollHeight;
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
    const typing = document.getElementById('cs-typing');
    if (typing) typing.remove();
  }
  
  async function sendMessage(input) {
    const text = input.value.trim();
    if (!text || isTyping) return;
    
    // Add user message
    addMessage('user', text);
    input.value = '';
    
    // Disable input while processing
    isTyping = true;
    input.disabled = true;
    document.getElementById('cs-send').disabled = true;
    showTyping();
    
    try {
      const res = await fetch(config.apiUrl + '/api/public/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, message: text, name: visitorName, phone: visitorPhone })
      });
      
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        hideTyping();
        addMessage('system', errData.reply || errData.error || `Chat service error (${res.status}). Please try again or contact us on WhatsApp.`);
        return;
      }
      
      const data = await res.json();
      sessionId = data.sessionId;
      persistChatState();
      
      // Simulate typing delay for natural feel
      await new Promise(r => setTimeout(r, 400 + Math.random() * 400));
      hideTyping();
      
      addMessage('bot', data.reply);
      
      if (data.bookingCreated) {
        setTimeout(() => {
          addMessage('booking', 'Booking request submitted! Our team will confirm on WhatsApp shortly.');
        }, 500);
      }
      
      if (data.humanNeeded) {
        setTimeout(() => {
          addMessage('system', 'A team member will reach out to you soon.');
        }, 500);
      }
    } catch (err) {
      console.error('Chat error:', err);
      hideTyping();
      addMessage('system', 'Connection error. Please try again or contact us on WhatsApp.');
    } finally {
      isTyping = false;
      input.disabled = false;
      document.getElementById('cs-send').disabled = false;
      input.focus();
    }
  }
  
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function persistChatState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ sessionId, visitorName, visitorPhone }));
    } catch (err) {
      // Storage can be blocked in private browsers; chat still works for the current page session.
    }
  }

  function openChat() {
    if (!isOpen) toggleChat();
  }

  function closeChat() {
    if (isOpen) toggleChat();
  }
  
  // Public API
  window.CarShineChat = {
    init: function(userConfig = {}) {
      config = { ...DEFAULT_CONFIG, ...userConfig };
      injectStyles();
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createWidget);
      } else {
        createWidget();
      }
    },
    open: openChat,
    close: closeChat,
    toggle: toggleChat
  };
})();
