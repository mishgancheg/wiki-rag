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
    const target = document.getElementById(tabId);
    if (target) target.classList.add('active');

    // Persist active tab id
    try { localStorage.setItem('activeTabId', tabId); } catch (_) {}

    // Add active class to the correct tab button
    // 1) If we came from a click, prefer the clicked button (or its closest .tab ancestor)
    if (typeof event !== 'undefined' && event && event.target) {
        const btn = event.target.closest ? event.target.closest('.tab') : event.target;
        if (btn && btn.classList) btn.classList.add('active');
    } else {
        // 2) No event: find the button by its inline onclick attribute
        const tabs = document.querySelectorAll('.tab');
        tabs.forEach(btn => {
            const on = btn.getAttribute('onclick') || '';
            if (on.includes("'" + tabId + "'") || on.includes('"' + tabId + '"')) {
                btn.classList.add('active');
            }
        });
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

// Restore active tab on load (after DOM is ready enough for elements to exist)
(function restoreActiveTab() {
    try {
        const saved = localStorage.getItem('activeTabId');
        if (saved && document.getElementById(saved)) {
            // Activate the saved tab
            switchTab(saved);
        }
    } catch (_) {}
})();

// Persist and restore chat input
(function initChatInputPersistence() {
    if (!inputEl) return;
    try {
        const saved = localStorage.getItem('chatInput') || '';
        if (saved) {
            inputEl.value = saved;
        }
    } catch (_) {}

    inputEl.addEventListener('input', () => {
        try { localStorage.setItem('chatInput', inputEl.value); } catch (_) {}
    });
})();

/**
 * Chat history in OpenAI-like shape: { role, content }
 */
let history = [];

function render() {
    if (!messagesEl) return;
    messagesEl.innerHTML = '';

    const getWikiUrl = (id) => {
        const base = (window.CONFLUENCE_BASE_URL || localStorage.getItem('CONFLUENCE_BASE_URL') || process.env.CONFLUENCE_BASE_URL || '').toString();
        const cleanBase = base.replace(/\/$/, '');
        if (cleanBase) return `${cleanBase}/pages/viewpage.action?pageId=${encodeURIComponent(id)}`;
        // Fallback if no base URL is configured
        return `/pages/viewpage.action?pageId=${encodeURIComponent(id)}`;
    };

    for (const m of history) {
        const div = document.createElement('div');
        div.className = `msg ${m.role}`;
        div.textContent = m.content;
        messagesEl.appendChild(div);
        if (m.sources && m.sources.length) {
            const meta = document.createElement('div');
            meta.className = 'sources';

            // Label
            const label = document.createElement('span');
            label.textContent = 'источники: ';
            meta.appendChild(label);

            // Build grouped list of links by wiki_id with chunk_ids and CS
            const groups = [];
            const map = new Map(); // wiki_id -> group
            m.sources.forEach((s) => {
                const key = String(s.wiki_id);
                let group = map.get(key);
                if (!group) {
                    group = { wiki_id: s.wiki_id, items: [] };
                    map.set(key, group);
                    groups.push(group);
                }
                group.items.push({ chunk_id: s.chunk_id, similarity: s.similarity });
            });

            groups.forEach((g, idx) => {
                const span = document.createElement('span');
                const a = document.createElement('a');
                a.href = getWikiUrl(g.wiki_id);
                a.textContent = String(g.wiki_id);
                a.target = '_blank';
                a.rel = 'noopener noreferrer';
                span.appendChild(a);

                const details = document.createElement('span');
                if (g.items.length === 1) {
                    // Single chunk: show only CS like before
                    const cs = Number(g.items[0].similarity).toFixed(3);
                    details.textContent = ` (CS=${cs})`;
                } else {
                    // Multiple chunks: list chunk_id - CS pairs
                    const parts = g.items.map(it => `${it.chunk_id} - CS=${Number(it.similarity).toFixed(3)}`);
                    details.textContent = ` (${parts.join(', ')})`;
                }
                span.appendChild(details);
                meta.appendChild(span);
                if (idx < groups.length - 1) {
                    meta.appendChild(document.createTextNode(', '));
                }
            });

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
    try { localStorage.removeItem('chatInput'); } catch (_) {}

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
    const doClear = () => {
        history = [];
        render();
        inputEl && inputEl.focus();
    };
    clearBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        doClear();
    });
    clearBtn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            doClear();
        }
    });
}

// Welcome message for chat
if (messagesEl) {
    history.push({ role: 'assistant', content: 'Привет! Я чат Wiki-RAG. Задайте вопрос — я поищу ответ в базе знаний.' });
    render();
}
