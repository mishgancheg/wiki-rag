// Tab switching functionality
function switchTab(tabId) {
    // Hide all tab contents
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });

    // Remove active class from all tabs
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.remove('active');
    });

    // Show selected tab content
    document.getElementById(tabId).classList.add('active');

    // Add active class to clicked tab
    // Note: relies on inline onclick handler context providing `event`
    if (typeof event !== 'undefined' && event && event.target) {
        event.target.classList.add('active');
    }

    // Focus input for chat tab
    if (tabId === 'chat') {
        setTimeout(() => {
            const input = document.getElementById('input');
            if (input) input.focus();
        }, 100);
    }
}

// Chat functionality
const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('input');
const sendBtn = document.getElementById('sendBtn');
const clearBtn = document.getElementById('clearBtn');

/**
 * Chat history in OpenAI-like shape: { role, content }
 */
let history = [];

function render() {
    if (!messagesEl) return;
    messagesEl.innerHTML = '';
    for (const m of history) {
        const div = document.createElement('div');
        div.className = `msg ${m.role}`;
        div.textContent = m.content;
        messagesEl.appendChild(div);
        if (m.sources && m.sources.length) {
            const meta = document.createElement('div');
            meta.className = 'sources';
            meta.textContent = 'источники: ' + m.sources.map(s => `${s.wiki_id} (${(s.similarity*100).toFixed(0)}%)`).join(', ');
            messagesEl.appendChild(meta);
        }
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addLoader() {
    const wrap = document.createElement('div');
    wrap.className = 'msg assistant';
    wrap.style.display = 'inline-flex';
    wrap.style.alignItems = 'center';
    const loader = document.createElement('div');
    loader.className = 'loader';
    loader.innerHTML = '<div class="dot"></div><div class="dot"></div><div class="dot"></div>';
    wrap.appendChild(loader);
    messagesEl.appendChild(wrap);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return wrap;
}

async function sendMessage() {
    const text = (inputEl && inputEl.value || '').trim();
    if (!text) return;
    inputEl.value = '';

    history.push({ role: 'user', content: text });
    render();

    const loaderEl = addLoader();

    const payload = {
        messages: history.slice(-10), // client-side cap
        threshold: 0.65,
        chunksLimit: 6,
    };

    try {
        const resp = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!resp.ok) throw new Error('Network error');
        const data = await resp.json();

        loaderEl.remove();

        const assistantMsg = { role: 'assistant', content: data.reply || '' };
        if (Array.isArray(data.sources)) assistantMsg.sources = data.sources;
        history.push(assistantMsg);
        render();
    } catch (e) {
        loaderEl.remove();
        history.push({ role: 'assistant', content: 'Извините, произошла ошибка при получении ответа.' });
        render();
    }
}

// Chat events
if (sendBtn) {
    sendBtn.addEventListener('click', sendMessage);
}
if (inputEl) {
    inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
}
if (clearBtn) {
    clearBtn.addEventListener('click', () => {
        history = [];
        render();
        inputEl && inputEl.focus();
    });
}

// Welcome message for chat
if (messagesEl) {
    history.push({ role: 'assistant', content: 'Привет! Я чат Wiki-RAG. Задайте вопрос — я поищу ответ в базе знаний.' });
    render();
}
