// Sales Assistant Chatbot for DAKIRO Agent Portal
// Vanilla JavaScript - No dependencies required

class SalesAssistant {
  constructor() {
    this.isOpen = false;
    this.messages = [];
    this.messageId = 0;
    this.init();
  }

  init() {
    this.createHTML();
    this.attachEventListeners();
    this.addWelcomeMessage();
  }

  createHTML() {
    // Create container
    const container = document.createElement('div');
    container.id = 'sales-assistant-container';
    container.innerHTML = `
      <!-- Chat Button -->
      <button id="sales-assistant-btn" class="sales-assistant-btn" title="Sales Assistant">
        💬
      </button>

      <!-- Chat Window -->
      <div id="sales-assistant-window" class="sales-assistant-window" style="display: none;">
        <div class="sales-assistant-header">
          <div class="sales-assistant-title">
            <h3>Sales Assistant 🤖</h3>
            <p>Always here to help</p>
          </div>
          <button id="sales-assistant-close" class="sales-assistant-close">✕</button>
        </div>

        <div id="sales-assistant-messages" class="sales-assistant-messages"></div>

        <div id="sales-assistant-quick-replies" class="sales-assistant-quick-replies">
          <p>Quick topics:</p>
          <div class="quick-replies-container">
            <button class="quick-reply-btn" data-reply="Sales tips">Sales tips</button>
            <button class="quick-reply-btn" data-reply="Customer scripts">Customer scripts</button>
            <button class="quick-reply-btn" data-reply="Commission calc">Commission calc</button>
            <button class="quick-reply-btn" data-reply="Lead strategies">Lead strategies</button>
            <button class="quick-reply-btn" data-reply="Financing terms">Financing terms</button>
          </div>
        </div>

        <div class="sales-assistant-input-area">
          <input
            type="text"
            id="sales-assistant-input"
            class="sales-assistant-input"
            placeholder="Ask me..."
          />
          <button id="sales-assistant-send" class="sales-assistant-send">Send</button>
        </div>
      </div>
    `;

    document.body.appendChild(container);
    this.addStyles();
  }

  addStyles() {
    const style = document.createElement('style');
    style.innerHTML = `
      #sales-assistant-container {
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 9999;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      }

      .sales-assistant-btn {
        width: 56px;
        height: 56px;
        border-radius: 50%;
        background: linear-gradient(135deg, #0d9488 0%, #14b8a6 100%);
        color: white;
        border: none;
        font-size: 28px;
        cursor: pointer;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        transition: all 0.3s ease;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .sales-assistant-btn:hover {
        transform: scale(1.1);
        box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2);
      }

      .sales-assistant-btn:active {
        transform: scale(0.95);
      }

      .sales-assistant-window {
        position: fixed;
        bottom: 80px;
        right: 20px;
        width: 320px;
        height: 500px;
        background: white;
        border-radius: 12px;
        box-shadow: 0 5px 40px rgba(0, 0, 0, 0.16);
        display: flex;
        flex-direction: column;
        border: 1px solid #e5e7eb;
        animation: slideUp 0.3s ease;
      }

      @keyframes slideUp {
        from {
          opacity: 0;
          transform: translateY(20px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      .sales-assistant-header {
        background: linear-gradient(135deg, #0d9488 0%, #14b8a6 100%);
        color: white;
        padding: 16px;
        border-radius: 12px 12px 0 0;
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
      }

      .sales-assistant-title h3 {
        margin: 0 0 4px 0;
        font-size: 14px;
        font-weight: 600;
      }

      .sales-assistant-title p {
        margin: 0;
        font-size: 12px;
        opacity: 0.9;
      }

      .sales-assistant-close {
        background: none;
        border: none;
        color: white;
        font-size: 20px;
        cursor: pointer;
        padding: 0;
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: opacity 0.2s;
      }

      .sales-assistant-close:hover {
        opacity: 0.8;
      }

      .sales-assistant-messages {
        flex: 1;
        overflow-y: auto;
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        background: #f9fafb;
      }

      .message {
        display: flex;
        gap: 8px;
        animation: fadeIn 0.3s ease;
      }

      @keyframes fadeIn {
        from {
          opacity: 0;
          transform: translateY(10px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      .message.user {
        justify-content: flex-end;
      }

      .message-content {
        max-width: 80%;
        padding: 10px 12px;
        border-radius: 8px;
        font-size: 13px;
        line-height: 1.4;
        word-wrap: break-word;
        white-space: pre-wrap;
      }

      .message.user .message-content {
        background: #0d9488;
        color: white;
        border-bottom-right-radius: 2px;
      }

      .message.bot .message-content {
        background: white;
        color: #1f2937;
        border: 1px solid #d1d5db;
        border-bottom-left-radius: 2px;
      }

      .sales-assistant-quick-replies {
        padding: 12px;
        border-top: 1px solid #e5e7eb;
        background: white;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .sales-assistant-quick-replies p {
        margin: 0;
        font-size: 12px;
        font-weight: 500;
        color: #6b7280;
      }

      .quick-replies-container {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      .quick-reply-btn {
        padding: 6px 10px;
        background: #eff6ff;
        color: #0369a1;
        border: 1px solid #bae6fd;
        border-radius: 6px;
        font-size: 12px;
        cursor: pointer;
        transition: all 0.2s;
      }

      .quick-reply-btn:hover {
        background: #dbeafe;
        border-color: #7dd3fc;
      }

      .sales-assistant-input-area {
        display: flex;
        gap: 8px;
        padding: 12px;
        border-top: 1px solid #e5e7eb;
        background: white;
        border-radius: 0 0 12px 12px;
      }

      .sales-assistant-input {
        flex: 1;
        padding: 8px 12px;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        font-size: 13px;
        font-family: inherit;
        transition: border-color 0.2s;
      }

      .sales-assistant-input:focus {
        outline: none;
        border-color: #0d9488;
        box-shadow: 0 0 0 2px rgba(13, 148, 136, 0.1);
      }

      .sales-assistant-send {
        padding: 8px 12px;
        background: #0d9488;
        color: white;
        border: none;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.2s;
      }

      .sales-assistant-send:hover:not(:disabled) {
        background: #0f766e;
      }

      .sales-assistant-send:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      /* Scrollbar styling */
      .sales-assistant-messages::-webkit-scrollbar {
        width: 6px;
      }

      .sales-assistant-messages::-webkit-scrollbar-track {
        background: #f3f4f6;
        border-radius: 3px;
      }

      .sales-assistant-messages::-webkit-scrollbar-thumb {
        background: #d1d5db;
        border-radius: 3px;
      }

      .sales-assistant-messages::-webkit-scrollbar-thumb:hover {
        background: #9ca3af;
      }

      @media (max-width: 480px) {
        .sales-assistant-window {
          width: 280px;
          height: 450px;
          right: 10px;
          bottom: 70px;
        }

        .message-content {
          max-width: 90%;
        }
      }
    `;
    document.head.appendChild(style);
  }

  attachEventListeners() {
    const btn = document.getElementById('sales-assistant-btn');
    const closeBtn = document.getElementById('sales-assistant-close');
    const sendBtn = document.getElementById('sales-assistant-send');
    const input = document.getElementById('sales-assistant-input');
    const quickReplyBtns = document.querySelectorAll('.quick-reply-btn');

    btn.addEventListener('click', () => this.toggle());
    closeBtn.addEventListener('click', () => this.close());
    sendBtn.addEventListener('click', () => this.sendMessage());
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.sendMessage();
    });

    quickReplyBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        input.value = e.target.dataset.reply;
        input.focus();
      });
    });
  }

  toggle() {
    this.isOpen ? this.close() : this.open();
  }

  open() {
    this.isOpen = true;
    const window = document.getElementById('sales-assistant-window');
    window.style.display = 'flex';
  }

  close() {
    this.isOpen = false;
    const window = document.getElementById('sales-assistant-window');
    window.style.display = 'none';
  }

  addWelcomeMessage() {
    this.addMessage('Hi there! 👋 I\'m your Sales Assistant. Ask me about sales tips, customer scripts, commission calculations, lead strategies, and more!', 'bot');
  }

  sendMessage() {
    const input = document.getElementById('sales-assistant-input');
    const text = input.value.trim();

    if (!text) return;

    this.addMessage(text, 'user');
    input.value = '';

    // Show thinking indicator
    setTimeout(() => {
      this.addMessage('Thinking...', 'bot', true);
    }, 100);

    // Get response
    setTimeout(() => {
      this.removeThinkingMessage();
      const response = this.getResponse(text);
      this.addMessage(response, 'bot');
    }, 600);
  }

  addMessage(text, sender, isThinking = false) {
    this.messageId++;
    const messagesDiv = document.getElementById('sales-assistant-messages');
    const messageEl = document.createElement('div');
    messageEl.className = `message ${sender}`;
    if (isThinking) messageEl.id = 'thinking-message';

    const contentEl = document.createElement('div');
    contentEl.className = 'message-content';
    contentEl.textContent = text;

    messageEl.appendChild(contentEl);
    messagesDiv.appendChild(messageEl);

    // Auto scroll
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }

  removeThinkingMessage() {
    const thinking = document.getElementById('thinking-message');
    if (thinking) thinking.remove();
  }

  getResponse(input) {
    const lower = input.toLowerCase();

    if (lower.includes('sales tips')) {
      return `🎯 **Top Sales Tips:**

1. **Build Rapport** - Start with genuine conversation
2. **Benefits Over Features** - "Only KES 4,167/month for a new phone"
3. **3-Tier Approach** - Budget (low), Popular (mid), Premium (high)
4. **Handle Objections** - "What payment works for you?"
5. **Close with Confidence** - Assume the sale

💡 Most customers buy the middle option!`;
    }

    if (lower.includes('customer scripts')) {
      return `📝 **Ready-to-Use Scripts:**

Opening: "Hi! I help people own phones without saving for months. What's your budget?"

Value: "Own it TODAY, pay just KES 4,167/month for 12 months!"

Objection: "That's smart! But think of it like 2 cups of coffee daily. Most earn that selling ONE phone."

Closing: "Let's get started! I need your ID and phone number."

✨ Sound genuine, adapt to each customer!`;
    }

    if (lower.includes('commission')) {
      return `💰 **Your Commissions:**

12% of EVERY sale!

Examples:
• KES 25,000 → KES 3,000 commission
• KES 50,000 → KES 6,000 commission
• KES 75,000 → KES 9,000 commission
• KES 100,000 → KES 12,000 commission

Monthly Target: KES 500,000 = KES 60,000 commission!

5 sales × KES 50k = KES 30,000
10 sales × KES 30k = KES 36,000`;
    }

    if (lower.includes('lead')) {
      return `🎯 **How to Find Leads:**

Best Places:
• Market centers & shops
• Office buildings & companies
• Referrals from customers
• WhatsApp status updates

Quick Qualification:
• Budget?
• Personal or resale?
• When needed?

Budget + Need = READY TO SELL!

Speed Matters: Close within 24 hours!`;
    }

    if (lower.includes('financing') || lower.includes('payment')) {
      return `📋 **Hire Purchase Explained:**

How it works:
1. Customer pays deposit (20-30%)
2. Then pays monthly installment
3. After final payment = owns the phone

Example: KES 50,000 iPhone
• Down payment: KES 10,000 (today)
• Monthly: KES 4,167 × 12 months
• Total cost: KES 60,000

Tell customers:
"No interest, convenient payment plan"
"Only KES 4,167/month for a brand new iPhone"
"Safe for both of us"`;
    }

    if (lower.includes('motivation')) {
      return `💪 **You've Got This!**

Remember:
✨ Each sale = KES 6,000+ commission
✨ You control your earnings
✨ Next customer could be biggest sale
✨ Hit monthly target = KES 60,000!

Affirmations:
"I am a great salesman"
"My customers love me"
"I will hit my target this month"

Keep pushing! 🚀`;
    }

    return `I can help with:
• Sales tips
• Customer scripts
• Commission calc
• Lead strategies
• Financing terms
• Motivation

Just ask! 😊`;
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new SalesAssistant();
  });
} else {
  new SalesAssistant();
}
