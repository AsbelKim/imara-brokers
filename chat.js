// IMARA Support Bot — FTMO-style floating widget (Home → New conversation form → Chat)
(function () {
  'use strict';

  const widget   = document.getElementById('cfw');
  const bubble   = document.getElementById('cfw-bubble');
  const unread   = document.getElementById('cfw-unread');

  const homeScr  = document.getElementById('cfw-home');
  const formScr  = document.getElementById('cfw-form-screen');
  const chatScr  = document.getElementById('cfw-chat-screen');

  const newConvBtn = document.getElementById('cfw-new-conv');
  const qtopicBtns = document.querySelectorAll('.cfw-qtopic');
  const xHome    = document.getElementById('cfw-x-home');
  const xForm    = document.getElementById('cfw-x-form');
  const backBtn  = document.getElementById('cfw-back');
  const startBtn = document.getElementById('cfw-start-btn');
  const toHomeBtn = document.getElementById('cfw-to-home');
  const minBtn   = document.getElementById('cfw-min');

  const langSel  = document.getElementById('cfw-lang');
  const ctypeSel = document.getElementById('cfw-ctype');
  const nameInp  = document.getElementById('cfw-fname');
  const emailInp = document.getElementById('cfw-femail');

  const msgArea  = document.getElementById('chat-messages');
  const qrArea   = document.getElementById('chat-qr');
  const input    = document.getElementById('chat-input');
  const sendBtn  = document.getElementById('chat-send');

  if (!widget || !msgArea) return;

  // ── Screen navigation ────────────────────────────────────────
  const SCREENS = { home: homeScr, form: formScr, chat: chatScr };
  let visitor = null; // { lang, challenge, name, email }

  function showScreen(name) {
    Object.entries(SCREENS).forEach(([key, el]) => {
      if (!el) return;
      el.classList.toggle('cfw-hidden', key !== name);
    });
  }

  function openWidget() {
    widget.classList.add('open');
    if (unread) unread.style.display = 'none';
  }
  function closeWidget() { widget.classList.remove('open'); }

  if (bubble) bubble.addEventListener('click', () => {
    if (!widget.classList.contains('open')) {
      openWidget();
      showScreen('home');
    } else {
      closeWidget();
    }
  });

  // "Support Chat" links in the navbar / footer open the widget directly
  document.querySelectorAll('.js-open-chat').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      openWidget();
      showScreen('home');
      widget.scrollIntoView({ behavior: 'smooth', block: 'end' });
    });
  });
  if (xHome)    xHome.addEventListener('click', closeWidget);
  if (xForm)    xForm.addEventListener('click', closeWidget);
  if (minBtn)   minBtn.addEventListener('click', closeWidget);
  if (backBtn)  backBtn.addEventListener('click', () => showScreen('home'));
  if (toHomeBtn) toHomeBtn.addEventListener('click', () => showScreen('home'));

  if (newConvBtn) newConvBtn.addEventListener('click', () => showScreen('form'));

  const CHALLENGE_LABELS = {
    starter:  'Starter — $10K ($99)',
    standard: 'Standard — $25K ($199)',
    advanced: 'Advanced — $50K ($299)',
    elite:    'Elite — $100K ($499)',
    pro:      'Pro — $200K ($799)',
  };

  if (startBtn) startBtn.addEventListener('click', () => {
    const name  = (nameInp  && nameInp.value.trim())  || '';
    const email = (emailInp && emailInp.value.trim()) || '';
    if (!name)  { nameInp.focus();  return; }
    if (!email || !email.includes('@')) { emailInp.focus(); return; }

    visitor = {
      lang: langSel  ? langSel.value  : 'en',
      challenge: ctypeSel ? ctypeSel.value : '',
      name, email,
    };

    showScreen('chat');
    startConversation();
  });

  // ── Quick-topic shortcuts straight into chat ─────────────────
  const TOPIC_PROMPTS = {
    challenge: 'How does the IMARA Challenge work?',
    pricing: 'What are the pricing and fees for the challenge plans?',
    payouts: 'How and when do payouts work?',
    rules: 'What are the trading rules I need to follow?',
  };
  qtopicBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const topic = btn.dataset.topic;
      showScreen('chat');
      send(TOPIC_PROMPTS[topic] || btn.textContent.trim());
    });
  });

  // ── Conversation bootstrap ───────────────────────────────────
  let conversationStarted = false;

  function startConversation(opts) {
    opts = opts || {};
    if (conversationStarted) return;
    conversationStarted = true;
    msgArea.innerHTML = '';
    qrArea.innerHTML = '';
    history = [];

    if (opts.skipGreeting) return;

    const firstName = visitor && visitor.name ? visitor.name.split(' ')[0] : '';
    const greetName = firstName ? `, ${firstName}` : '';
    let intro = `Hi there${greetName} 👋 I'm <strong>IMARA Support Bot</strong>.`;

    if (visitor && visitor.challenge && CHALLENGE_LABELS[visitor.challenge]) {
      intro += ` Thanks for your interest in the <strong>${esc(CHALLENGE_LABELS[visitor.challenge])}</strong> plan — happy to answer anything about it or the IMARA Challenge in general.`;
    } else {
      intro += ` Ask me anything about prop trading, payouts, or our challenge!`;
    }

    addBotMsg(intro);
    setTimeout(() => setQR(['How the challenge works','Pricing & fees','Payouts','How to sign up']), 400);
  }

  // ── AI-powered replies (any topic, any language incl. Swahili) ─
  const API_BASE = '/api';
  let history = []; // [{ role: 'user'|'assistant', content }]

  const FALLBACK_REPLY = 'Sorry, I\'m having trouble connecting right now 🤔 Please reach our team directly:\n\n📧 info@imaralogic.co.ke\n💬 <a href="https://wa.me/254701940964" target="_blank">WhatsApp +254 701 940 964</a>';

  async function fetchAIReply(text) {
    history.push({ role: 'user', content: text });

    const res = await fetch(`${API_BASE}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: history.slice(-12),
        lang: visitor ? visitor.lang : 'en',
        visitor: visitor ? { name: visitor.name, challenge: visitor.challenge } : null,
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.reply) throw new Error(data.error || 'Chat request failed');

    history.push({ role: 'assistant', content: data.reply });
    return data.reply;
  }

  // ── Helpers ─────────────────────────────────────────────────
  let botTyping = false;

  function addMsg(html, role) {
    const d = document.createElement('div');
    d.className = `chat-msg ${role}`;
    d.innerHTML = html.replace(/\n/g, '<br>');
    msgArea.appendChild(d);
    msgArea.scrollTop = msgArea.scrollHeight;
  }
  function addBotMsg(html)  { addMsg(html, 'bot'); }
  function addUserMsg(text) { addMsg(esc(text), 'user'); }
  function esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  function showTyping() {
    const t = document.createElement('div');
    t.className = 'chat-typing'; t.id = 'cfwTyping';
    t.innerHTML = '<span></span><span></span><span></span>';
    msgArea.appendChild(t);
    msgArea.scrollTop = msgArea.scrollHeight;
  }
  function hideTyping() { const t = document.getElementById('cfwTyping'); if (t) t.remove(); }

  function setQR(labels) {
    qrArea.innerHTML = '';
    labels.forEach(label => {
      const b = document.createElement('button');
      b.className = 'chat-qr-btn';
      b.textContent = label;
      b.addEventListener('click', () => send(label));
      qrArea.appendChild(b);
    });
  }

  function respond(text) {
    if (botTyping) return;
    botTyping = true;
    qrArea.innerHTML = '';
    showTyping();

    fetchAIReply(text)
      .then(reply => {
        hideTyping();
        addBotMsg(reply);
        botTyping = false;
      })
      .catch(() => {
        hideTyping();
        addBotMsg(FALLBACK_REPLY);
        botTyping = false;
      });
  }

  function send(text) {
    text = text.trim(); if (!text) return;
    if (!conversationStarted) startConversation({ skipGreeting: true });
    addUserMsg(text);
    if (input) input.value = '';
    respond(text);
  }

  if (sendBtn) sendBtn.addEventListener('click', () => send(input.value));
  if (input)   input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); send(input.value); } });
})();
