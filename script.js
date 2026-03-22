document.addEventListener('DOMContentLoaded', () => {
    // Configure Marked.js
    if (typeof marked !== 'undefined') {
        marked.setOptions({ breaks: true, gfm: true });
    }

    // ── Markdown + Math Renderer ────────────────────────────────────────────
    function renderMarkdownWithMath(text) {
        if (!text) return '';
        let mathBlocks = [];
        let processed = text.replace(/(\$\$|\\\[)([\s\S]*?)(\$\$|\\\])/g, (_, open, math) => {
            mathBlocks.push({ math, display: true });
            return `@@MATH_BLOCK_${mathBlocks.length - 1}@@`;
        });
        processed = processed.replace(/(\$|\\\()([\s\S]*?)(\$|\\\))/g, (_, open, math) => {
            mathBlocks.push({ math, display: false });
            return `@@MATH_BLOCK_${mathBlocks.length - 1}@@`;
        });
        let html = typeof marked !== 'undefined' ? marked.parse(processed) : processed;
        mathBlocks.forEach((block, i) => {
            let rendered = '';
            if (window.katex) {
                try {
                    rendered = katex.renderToString(block.math, { displayMode: block.display, throwOnError: false });
                } catch (e) {
                    rendered = block.display ? `$$${block.math}$$` : `$${block.math}$`;
                }
            } else {
                rendered = block.display ? `$$${block.math}$$` : `$${block.math}$`;
            }
            html = html.replace(`@@MATH_BLOCK_${i}@@`, rendered);
        });
        return html;
    }

    // ── DOM References ──────────────────────────────────────────────────────
    const dom = {
        chatWindow: document.getElementById('chat-window'),
        messageList: document.getElementById('message-list'),
        welcomeSection: document.getElementById('welcome-section'),
        sidebar: document.getElementById('sidebar'),
        sidebarToggle: document.getElementById('sidebar-toggle'),
        sidebarToggleClose: document.getElementById('sidebar-toggle-close'),
        newChatBtn: document.getElementById('new-chat-btn'),
        conversationList: document.getElementById('conversation-list'),
        userInfoSidebar: document.getElementById('user-info-sidebar'),
        userAvatarSidebar: document.getElementById('user-avatar-sidebar'),
        usernameSidebar: document.getElementById('username-sidebar'),
        chatForm: document.getElementById('chat-form'),
        messageInput: document.getElementById('message-input'),
        sendBtn: document.getElementById('send-btn'),
        settingsBtn: document.getElementById('settings-btn'),
        settingsModal: document.getElementById('settings-modal'),
        closeModalBtn: document.getElementById('close-modal-btn'),
        saveSettingsBtn: document.getElementById('save-settings-btn'),
        providerSelect: document.getElementById('provider-select'),
        semarGroup: document.getElementById('semar-card-list'),
        cerebrasGroup: document.getElementById('cerebras-card-list'),
        userProfileImg: document.getElementById('user-profile-img'),
        loginContainer: document.getElementById('login-container'),
        logoutMenu: document.getElementById('logout-menu'),
        logoutBtn: document.getElementById('logout-btn'),
        profileDropdownWrapper: document.querySelector('.profile-dropdown-wrapper'),
        appContainer: document.querySelector('.app-container')
    };

    // ── Config ──────────────────────────────────────────────────────────────
    const config = {
        dbApiUrl:       (typeof CONFIG !== 'undefined' && CONFIG.DB_API_URL)       ? CONFIG.DB_API_URL       : 'http://localhost:3000',
        modelName:      localStorage.getItem('ananta_model_name') || 'semar:latest'
    };

    // ── State ───────────────────────────────────────────────────────────────
    let conversationId = null;
    let isSidebarOpen  = true;
    let chatHistory    = [];
    let isGenerating   = false;
    let currentAbortController = null;
    let isUserScrolledUp       = false;

    // activeProvider holds the currently selected model
    let activeProvider = localStorage.getItem('ananta_active_provider') || 'cerebras::llama3.1-8b';

    // ── Settings: populate model cards on open ──────────────────────────────
    let pendingProviderSelection = activeProvider;

    function renderModelCard(container, icon, name, value) {
        const card = document.createElement('div');
        card.className = `model-card ${pendingProviderSelection === value ? 'selected' : ''}`;
        card.dataset.value = value;
        card.innerHTML = `
            <div style="display: flex; align-items: center; gap: 0.6rem;">
                <span>${icon}</span>
                <span>${name}</span>
            </div>
            <div class="mc-dot"></div>
        `;
        card.addEventListener('click', () => {
            pendingProviderSelection = value;
            // Update UI selection state within the modal
            document.querySelectorAll('.model-card').forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
        });
        container.appendChild(card);
    }

    async function populateProviderSelect() {
        if (!dom.semarGroup) return;

        pendingProviderSelection = activeProvider; // reset to actual active when opening modal
        dom.semarGroup.innerHTML = '';
        dom.cerebrasGroup.innerHTML = '';

        try {
            const [tagsRes, modelsRes] = await Promise.all([
                fetch(`${config.dbApiUrl}/api/tags`).catch(() => ({ json: () => ({ models: [] }) })),
                fetch(`${config.dbApiUrl}/api/models`).catch(() => ({ json: () => ({ cerebras: [], gemini: [] }) }))
            ]);
            
            const data = await tagsRes.json();
            const semarModels = (data.models || []).filter(m => m.name.toLowerCase().includes('semar'));
            if (semarModels.length > 0) {
                semarModels.forEach(m => {
                    const label = m.name.replace(':latest','').split('-').map(p => p[0].toUpperCase()+p.slice(1)).join(' ');
                    renderModelCard(dom.semarGroup, '🤖', label, `ollama::${m.name}`);
                });
            } else {
                renderModelCard(dom.semarGroup, '🤖', 'SEMAR AI', 'ollama::semar:latest');
            }

            const extraModels = await modelsRes.json();
            
            // Fill Cerebras group
            if (extraModels.cerebras && extraModels.cerebras.length > 0) {
                extraModels.cerebras.forEach(m => {
                    renderModelCard(dom.cerebrasGroup, '⚡', m.name, `cerebras::${m.id}`);
                });
            }
        } catch {
            renderModelCard(dom.semarGroup, '🤖', 'SEMAR AI (offline)', 'ollama::semar:latest');
        }
    }

    dom.settingsBtn.addEventListener('click', () => {
        dom.settingsModal.classList.remove('hidden');
        populateProviderSelect();
    });
    dom.closeModalBtn.addEventListener('click', () => dom.settingsModal.classList.add('hidden'));
    dom.settingsModal.addEventListener('click', (e) => { if (e.target === dom.settingsModal) dom.settingsModal.classList.add('hidden'); });
    
    dom.saveSettingsBtn.addEventListener('click', () => {
        activeProvider = pendingProviderSelection;
        localStorage.setItem('ananta_active_provider', activeProvider);
        dom.settingsModal.classList.add('hidden');
    });


    // ── Auto-scroll ─────────────────────────────────────────────────────────
    dom.chatWindow.addEventListener('scroll', () => {
        const maxScrollTop = dom.chatWindow.scrollHeight - dom.chatWindow.clientHeight;
        isUserScrolledUp = (maxScrollTop - dom.chatWindow.scrollTop) > 50;
    });

    function scrollToBottom(force = false) {
        if (!isUserScrolledUp || force) {
            dom.chatWindow.scrollTo({ top: dom.chatWindow.scrollHeight, behavior: force ? 'smooth' : 'auto' });
        }
    }

    // ── Generate State ──────────────────────────────────────────────────────
    function setGeneratingState(generating) {
        isGenerating = generating;
        if (generating) {
            dom.sendBtn.innerHTML = "<i class='bx bx-stop'></i>";
            dom.sendBtn.classList.add('stop-btn');
            dom.sendBtn.disabled = false;
        } else {
            dom.sendBtn.innerHTML = "<i class='bx bx-send'></i>";
            dom.sendBtn.classList.remove('stop-btn');
            dom.sendBtn.disabled = dom.messageInput.value.trim() === '';
        }
    }

    // ── Input resize ────────────────────────────────────────────────────────
    dom.messageInput.addEventListener('input', function () {
        this.style.height = 'auto';
        const maxH = window.innerWidth <= 768 ? 120 : 200;
        this.style.height = Math.min(this.scrollHeight, maxH) + 'px';
        this.style.overflowY = this.scrollHeight > maxH ? 'auto' : 'hidden';
        dom.sendBtn.disabled = this.value.trim() === '' && !isGenerating;
    });

    // Scroll input into view when keyboard opens on mobile
    dom.messageInput.addEventListener('focus', () => {
        if (window.innerWidth <= 768) {
            setTimeout(() => {
                dom.messageInput.scrollIntoView({ behavior: 'smooth', block: 'end' });
            }, 350); // delay lets the keyboard fully open first
        }
    });

    // Also react to keyboard closing/opening (causes window resize on Android)
    window.addEventListener('resize', () => {
        if (window.innerWidth <= 768 && document.activeElement === dom.messageInput) {
            setTimeout(() => {
                dom.messageInput.scrollIntoView({ behavior: 'smooth', block: 'end' });
            }, 100);
        }
    });

    dom.messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (dom.messageInput.value.trim() !== '') dom.chatForm.dispatchEvent(new Event('submit'));
        }
    });

    

    // ── Chat Submit ─────────────────────────────────────────────────────────
    dom.chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        if (isGenerating) {
            currentAbortController && currentAbortController.abort();
            return;
        }

        const text = dom.messageInput.value.trim();
        if (!text) return;

        // First message — lock in the provider and hide the picker
        document.body.classList.add('chat-active');
        dom.appContainer.classList.add('chat-started');

        dom.messageInput.value = '';
        dom.messageInput.style.height = 'auto';
        dom.sendBtn.disabled = true;

        appendMessage('user', text, false, false);
        chatHistory.push({ role: 'user', content: text });
        saveChatMessage('user', text);

        setGeneratingState(true);
        const loadingId = addLoadingIndicator();
        currentAbortController = new AbortController();

        let aiMsgBox = null;
        let currentAiText = '';
        let responseText = '';

        try {
            // Determine provider from value format: "prefix::id"
            const [providerType, modelId] = activeProvider.split('::');
            const isCerebras = providerType === 'cerebras';

            if (providerType === 'ollama') {
                // Temporarily set the Ollama model name
                config.modelName = modelId || config.modelName;
                responseText = await fetchOllama(chatHistory, (chunkText) => {
                    if (document.getElementById(loadingId)) {
                        document.getElementById(loadingId).remove();
                        aiMsgBox = appendMessage('assistant', '', false, true);
                    }
                    if (aiMsgBox) {
                        currentAiText += chunkText;
                        aiMsgBox.contentDiv.innerHTML = renderMarkdownWithMath(currentAiText);
                        scrollToBottom();
                    }
                }, currentAbortController.signal);
            } else if (isCerebras) {
                responseText = await fetchCerebras(modelId, chatHistory, (chunkText) => {
                    if (!aiMsgBox) {
                        if (document.getElementById(loadingId)) document.getElementById(loadingId).remove();
                        aiMsgBox = appendMessage('assistant', '', false, true);
                    }
                    if (aiMsgBox) {
                        currentAiText += chunkText;
                        aiMsgBox.contentDiv.innerHTML = renderMarkdownWithMath(currentAiText);
                        scrollToBottom();
                    }
                }, currentAbortController.signal);
            }

            if (!aiMsgBox) {
                const fallback = document.getElementById(loadingId);
                if (fallback) fallback.remove();
                appendMessage('assistant', renderMarkdownWithMath(responseText), false, true);
            }

            chatHistory.push({ role: 'assistant', content: responseText });
            saveChatMessage('assistant', responseText);
        } catch (error) {
            console.error('API Error:', error);
            const loadEl = document.getElementById(loadingId);
            if (loadEl) loadEl.remove();
            if (error.name === 'AbortError') {
                appendMessage('assistant', '*(Generation Stopped)*', false, true);
            } else if (error.message === 'login_required') {
                chatHistory.pop(); // silently discard — popup already shown
            } else {
                appendMessage('assistant', '⚠️ Error: ' + error.message, true, false);
                chatHistory.pop();
            }
        } finally {
            setGeneratingState(false);
            currentAbortController = null;
            if (window.innerWidth > 768) dom.messageInput.focus();
        }
    });

    // ── Login Required Popup ────────────────────────────────────────────────
    function showLoginRequiredPopup() {
        const existing = document.getElementById('login-required-popup');
        if (existing) existing.remove();

        const popup = document.createElement('div');
        popup.id = 'login-required-popup';
        popup.style.cssText = `
            position: fixed; inset: 0; z-index: 9999;
            display: flex; align-items: center; justify-content: center;
            background: rgba(0,0,0,0.55); backdrop-filter: blur(6px);
            animation: fadeIn 0.2s ease;
        `;
        popup.innerHTML = `
            <div style="
                background: var(--glass-bg, rgba(20,20,30,0.95));
                border: 1px solid var(--border-color, rgba(255,255,255,0.12));
                border-radius: 20px; padding: 32px 28px;
                max-width: 380px; width: 90%; text-align: center;
                box-shadow: 0 25px 60px rgba(0,0,0,0.5);
            ">
                <div style="font-size:2.5rem; margin-bottom:12px;">🔐</div>
                <h3 style="font-family:'Outfit',sans-serif; font-size:1.3rem; font-weight:700; color:var(--text-primary,#fff); margin:0 0 10px;">Login Required</h3>
                <p style="color:var(--text-secondary,#aaa); font-size:0.9rem; margin:0 0 24px; line-height:1.5;">You need to be <strong style="color:var(--primary-color,#00e5ff);">signed in</strong> to use AI models. Please log in to continue.</p>
                <div style="display:flex; gap:10px; justify-content:center;">
                    <button onclick="document.getElementById('login-required-popup').remove()" style="
                        padding:10px 20px; border-radius:10px; border:1px solid var(--border-color,rgba(255,255,255,0.15));
                        background:transparent; color:var(--text-secondary,#aaa); cursor:pointer;
                        font-family:'Inter',sans-serif; font-size:0.9rem;
                    ">Dismiss</button>
                    <a href="login.html" style="
                        padding:10px 20px; border-radius:10px; border:none;
                        background:var(--primary-color,#00e5ff); color:#000; font-weight:700;
                        text-decoration:none; cursor:pointer; font-family:'Inter',sans-serif;
                        font-size:0.9rem; display:inline-flex; align-items:center;
                    ">Sign In →</a>
                </div>
            </div>
        `;
        popup.addEventListener('click', (e) => { if (e.target === popup) popup.remove(); });
        document.body.appendChild(popup);
    }

    // ── Message Rendering ───────────────────────────────────────────────────
    function appendMessage(sender, text, isError = false, isHtml = false) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${sender}`;

        const avatarDiv = document.createElement('div');
        avatarDiv.className = 'msg-avatar';
        avatarDiv.innerHTML = sender === 'user' ? "<i class='bx bx-user'></i>" : "<i class='bx bx-brain'></i>";

        const contentDiv = document.createElement('div');
        contentDiv.className = `msg-content ${isError ? 'error' : ''}`;
        if (isHtml) { contentDiv.innerHTML = text; } else { contentDiv.textContent = text; }

        msgDiv.appendChild(avatarDiv);
        msgDiv.appendChild(contentDiv);
        dom.messageList.appendChild(msgDiv);
        scrollToBottom(true);
        return { msgDiv, contentDiv };
    }

    function addLoadingIndicator() {
        const id = 'loading-' + Date.now();
        const msgDiv = document.createElement('div');
        msgDiv.className = 'message ai';
        msgDiv.id = id;
        const avatarDiv = document.createElement('div');
        avatarDiv.className = 'msg-avatar';
        avatarDiv.innerHTML = "<i class='bx bx-brain'></i>";
        const contentDiv = document.createElement('div');
        contentDiv.className = 'msg-content';
        contentDiv.innerHTML = `<div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>`;
        msgDiv.appendChild(avatarDiv);
        msgDiv.appendChild(contentDiv);
        dom.messageList.appendChild(msgDiv);
        scrollToBottom();
        return id;
    }

    // ── Ollama API ──────────────────────────────────────────────────────────
    async function fetchOllama(messages, onChunk, signal) {
        let endpoint = `${config.dbApiUrl}/api/chat/ollama`;
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('ananta_token') || ''}` },
            body: JSON.stringify({ model: config.modelName, messages, stream: true }),
            signal
        });
        if (!response.ok) {
            if (response.status === 401) { showLoginRequiredPopup(); throw new Error('login_required'); }
            throw new Error(`Ollama error: ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let fullResponse = '', buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();
            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const parsed = JSON.parse(line);
                    const textStr = (parsed.message && parsed.message.content) ? parsed.message.content : (parsed.response || '');
                    if (textStr) { fullResponse += textStr; onChunk(textStr); }
                } catch (e) { /* fragmented line, skip */ }
            }
        }
        if (buffer.trim()) {
            try {
                const parsed = JSON.parse(buffer);
                const textStr = (parsed.message && parsed.message.content) ? parsed.message.content : (parsed.response || '');
                if (textStr) { fullResponse += textStr; onChunk(textStr); }
            } catch (e) { /* ignore */ }
        }
        return fullResponse;
    }

    // ── Cerebras API (OpenAI-compatible) ────────────────────────────────────
    async function fetchCerebras(modelId, messages, onChunk, signal) {
        const url = `${config.dbApiUrl}/api/chat/cerebras`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('ananta_token') || ''}` },
            body: JSON.stringify({
                model: modelId,
                messages: messages.map(m => ({ role: m.role, content: m.content })),
                stream: true
            }),
            signal
        });
        if (!response.ok) {
            if (response.status === 401) { showLoginRequiredPopup(); throw new Error('login_required'); }
            const err = await response.json().catch(() => ({}));
            throw new Error(err?.error?.message || `Cerebras error ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let fullResponse = '';
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop(); // keep the last incomplete line
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed === 'data: [DONE]') continue;
                if (trimmed.startsWith('data: ')) {
                    try {
                        const parsed = JSON.parse(trimmed.slice(6));
                        const content = parsed.choices?.[0]?.delta?.content || '';
                        if (content) {
                            fullResponse += content;
                            onChunk(content);
                        }
                    } catch (e) { /* partially formed JSON, skip */ }
                }
            }
        }
        return fullResponse;
    }

    // ── Chat History Save ───────────────────────────────────────────────────
    async function saveChatMessage(role, content) {
        const token = localStorage.getItem('ananta_token');
        if (!token) return;
        try {
            const response = await fetch(`${config.dbApiUrl}/api/history/add`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ role, content, conversation_id: conversationId })
            });
            const data = await response.json();
            if (data.conversation_id && !conversationId) {
                conversationId = data.conversation_id;
                loadConversations();
            }
        } catch (e) {
            console.error('Failed to save message to history:', e);
        }
    }

    // ── Session Restore ─────────────────────────────────────────────────────
    async function generateDynamicWelcomeMessage(username) {
        const welcomeEl = document.getElementById('welcome-text');
        if (!welcomeEl) return;
        
        let dots = 0;
        let isConnecting = true;
        let fetchingComplete = false;
        let bufferedChars = [];
        let displayedText = '';
        
        const connectingInterval = setInterval(() => {
            dots = (dots + 1) % 4;
            welcomeEl.innerHTML = `<span style="color:var(--text-secondary);font-size:0.8em;font-weight:400;">Waking up Qwen${'.'.repeat(dots)}</span><span class="cursor-blink"></span>`;
        }, 400);

        const typeCharInterval = setInterval(() => {
            if (bufferedChars.length > 0) {
                if (isConnecting) {
                    clearInterval(connectingInterval);
                    isConnecting = false;
                }
                displayedText += bufferedChars.shift();
                welcomeEl.innerHTML = displayedText + '<span class="cursor-blink"></span>';
            } else if (fetchingComplete) {
                clearInterval(typeCharInterval);
                setTimeout(() => {
                    welcomeEl.innerHTML = displayedText;
                }, 2000);
            }
        }, 45); // 45ms per character creates a realistic typing cadence

        try {
            await fetchCerebras('qwen-3-235b-a22b-instruct-2507', [
                { role: 'system', content: `You are Ananta, a helpful AI teacher. Greet the user named ${username} with a very short (max 5 words), friendly, welcoming sentence. Do not use quotes.` }
            ], (chunk) => {
                for (let char of chunk) {
                    bufferedChars.push(char);
                }
            });
            if (isConnecting) clearInterval(connectingInterval);
            fetchingComplete = true;
        } catch (e) {
            clearInterval(connectingInterval);
            clearInterval(typeCharInterval);
            welcomeEl.innerHTML = `Welcome back, ${username}!`;
        }
    }

    function restoreUserSession() {
        const token = localStorage.getItem('ananta_token');
        if (token) {
            const username = localStorage.getItem('ananta_username') || 'User';
            const avatar   = localStorage.getItem('ananta_avatar');
            // Ananta cyan fallback avatar
            const avatarSrc = avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=00e5ff&color=000&bold=true`;

            if (dom.userProfileImg) { 
                dom.userProfileImg.src = avatarSrc; 
                dom.userProfileImg.classList.remove('hidden'); 
            }
            if (dom.userInfoSidebar) { 
                dom.userAvatarSidebar.src = avatarSrc; 
                dom.usernameSidebar.textContent = username; 
                dom.userInfoSidebar.classList.remove('hidden'); 
            }
            if (dom.loginContainer) dom.loginContainer.classList.add('hidden');
            
            generateDynamicWelcomeMessage(username);
            loadConversations();
        } else {
            if (dom.loginContainer) dom.loginContainer.classList.remove('hidden');
            if (dom.userInfoSidebar) dom.userInfoSidebar.classList.add('hidden');
            if (dom.userProfileImg)  dom.userProfileImg.classList.add('hidden');
        }
    }

    // ── Conversations ───────────────────────────────────────────────────────
    async function loadConversations() {
        const token = localStorage.getItem('ananta_token');
        if (!token) return;
        try {
            const response = await fetch(`${config.dbApiUrl}/api/conversations`, { headers: { 'Authorization': `Bearer ${token}` } });
            const data = await response.json();
            if (data.conversations) renderConversationList(data.conversations);
        } catch (error) { console.error('Error loading conversations:', error); }
    }

    function renderConversationList(conversations) {
        dom.conversationList.innerHTML = '';
        conversations.forEach(conv => {
            const item = document.createElement('div');
            item.className = `conversation-item ${conversationId == conv.id ? 'active' : ''}`;
            item.innerHTML = `<i class='bx bx-message-detail'></i><span>${conv.title}</span><button class="icon-btn delete-conv-btn" data-id="${conv.id}"><i class='bx bx-trash'></i></button>`;
            item.addEventListener('click', (e) => { if (!e.target.closest('.delete-conv-btn')) loadChatHistory(conv.id); });
            item.querySelector('.delete-conv-btn').addEventListener('click', async (e) => {
                e.stopPropagation();
                if (confirm('Delete this chat?')) await deleteConversation(conv.id);
            });
            dom.conversationList.appendChild(item);
        });
    }

    async function deleteConversation(id) {
        const token = localStorage.getItem('ananta_token');
        try {
            await fetch(`${config.dbApiUrl}/api/conversations/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
            if (id === conversationId) startNewChat();
            loadConversations();
        } catch (error) { console.error('Error deleting conversation:', error); }
    }

    async function loadChatHistory(id) {
        const token = localStorage.getItem('ananta_token');
        if (!token || !id) return;
        conversationId = id;
        try {
            const response = await fetch(`${config.dbApiUrl}/api/history/${id}`, { headers: { 'Authorization': `Bearer ${token}` } });
            const data = await response.json();
            if (data.history) {
                chatHistory = data.history.map(m => ({ role: m.role, content: m.content }));
                dom.messageList.innerHTML = '';
                data.history.forEach(msg => {
                    const isAi = msg.role === 'assistant';
                    appendMessage(msg.role, isAi ? renderMarkdownWithMath(msg.content) : msg.content, false, isAi);
                });
                dom.appContainer.classList.add('chat-started');
                document.body.classList.add('chat-active');
                loadConversations();
            }
        } catch (error) { console.error('Error loading history:', error); }
        if (window.innerWidth <= 768) toggleSidebar(false);
    }

    // ── Sidebar ─────────────────────────────────────────────────────────────
    function toggleSidebar(forcedState) {
        isSidebarOpen = (forcedState !== undefined) ? forcedState : !isSidebarOpen;
        if (window.innerWidth <= 768) {
            dom.sidebar.classList.toggle('mobile-open', isSidebarOpen);
        } else {
            dom.sidebar.classList.toggle('collapsed', !isSidebarOpen);
        }
    }

    function startNewChat() {
        conversationId = null;
        chatHistory    = [];
        dom.messageList.innerHTML = '';
        dom.appContainer.classList.remove('chat-started');
        document.body.classList.remove('chat-active');
        document.querySelectorAll('.conversation-item').forEach(item => item.classList.remove('active'));
        if (window.innerWidth <= 768) toggleSidebar(false);
    }

    // ── Bind Events ─────────────────────────────────────────────────────────
    dom.sidebarToggle.addEventListener('click', () => toggleSidebar());
    if (dom.sidebarToggleClose) dom.sidebarToggleClose.addEventListener('click', () => toggleSidebar(false));
    dom.newChatBtn.addEventListener('click', startNewChat);

    if (dom.userProfileImg) dom.userProfileImg.addEventListener('click', (e) => {
        e.stopPropagation();
        dom.logoutMenu.classList.toggle('hidden');
    });

    if (dom.logoutBtn) dom.logoutBtn.addEventListener('click', () => {
        localStorage.removeItem('ananta_token');
        localStorage.removeItem('ananta_username');
        localStorage.removeItem('ananta_avatar');
        location.reload();
    });

    document.addEventListener('click', (e) => {
        if (dom.logoutMenu && !dom.logoutMenu.classList.contains('hidden')) {
            if (!dom.profileDropdownWrapper || !dom.profileDropdownWrapper.contains(e.target)) {
                dom.logoutMenu.classList.add('hidden');
            }
        }
    });

    // ── Init ────────────────────────────────────────────────────────────────
    restoreUserSession();
});
