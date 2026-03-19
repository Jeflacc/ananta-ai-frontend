document.addEventListener('DOMContentLoaded', () => {
    // Configure Marked.js
    if (typeof marked !== 'undefined') {
        marked.setOptions({
            breaks: true,
            gfm: true
        });
    }

    // DOM Elements
    const chatWindow = document.getElementById('chat-window');
    const messageList = document.getElementById('message-list');
    const welcomeSection = document.getElementById('welcome-section');
    const chatForm = document.getElementById('chat-form');
    const messageInput = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');

    // Settings Elements
    const settingsBtn = document.getElementById('settings-btn');
    const settingsModal = document.getElementById('settings-modal');
    const closeModalBtn = document.getElementById('close-modal-btn');
    const saveSettingsBtn = document.getElementById('save-settings-btn');
    const modelNameInput = document.getElementById('model-name');

    // State
    let config = {
        apiUrl: localStorage.getItem('semar_api_url') || 'https://subjects-prospective-statewide-solid.trycloudflare.com',
        modelName: localStorage.getItem('semar_model_name') || 'semar:latest'
    };
    let chatHistory = [];

    // UI State for smart scrolling and generation
    let isGenerating = false;
    let currentAbortController = null;
    let isUserScrolledUp = false;

    // Detect if user scrolled up
    chatWindow.addEventListener('scroll', () => {
        // If the user's scroll position is > 50px away from the bottom, consider them scrolled up
        const maxScrollTop = chatWindow.scrollHeight - chatWindow.clientHeight;
        isUserScrolledUp = (maxScrollTop - chatWindow.scrollTop) > 50;
    });

    function setGeneratingState(generating) {
        isGenerating = generating;
        if (generating) {
            sendBtn.innerHTML = "<i class='bx bx-stop'></i>";
            sendBtn.classList.add('stop-btn');
            sendBtn.disabled = false; // Ensure click works to stop
        } else {
            sendBtn.innerHTML = "<i class='bx bx-send'></i>";
            sendBtn.classList.remove('stop-btn');
            sendBtn.disabled = messageInput.value.trim() === '';
        }
    }

    // Auto-resize textarea
    messageInput.addEventListener('input', function () {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
        if (this.value.trim() === '') {
            if (!isGenerating) sendBtn.disabled = true;
        } else {
            sendBtn.disabled = false;
        }
    });

    // Handle Enter key to send (Shift+Enter for temp new line)
    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (messageInput.value.trim() !== '') {
                chatForm.dispatchEvent(new Event('submit'));
            }
        }
    });

    // Fetch Models Logic
    async function fetchModels(apiUrl) {
        if (!apiUrl) return;

        let endpoint = apiUrl;
        if (endpoint.endsWith('/api/chat')) endpoint = endpoint.replace('/api/chat', '');
        else if (endpoint.endsWith('/api/generate')) endpoint = endpoint.replace('/api/generate', '');
        else if (endpoint.endsWith('/')) endpoint = endpoint.slice(0, -1);

        const tagsEndpoint = `${endpoint}/api/tags`;

        try {
            modelNameInput.innerHTML = '<option value="">Loading models...</option>';
            const response = await fetch(tagsEndpoint);
            if (!response.ok) throw new Error('Failed to load models');
            const data = await response.json();

            if (data.models && data.models.length > 0) {
                modelNameInput.innerHTML = '';
                let foundConfigModel = false;
                data.models.forEach(m => {
                    const opt = document.createElement('option');
                    opt.value = m.name;
                    opt.textContent = m.name;
                    if (m.name === config.modelName) {
                        opt.selected = true;
                        foundConfigModel = true;
                    }
                    modelNameInput.appendChild(opt);
                });

                // If no model was selected, or selected model is missing, pick the first one
                if (!foundConfigModel) {
                    config.modelName = data.models[0].name;
                    localStorage.setItem('semar_model_name', config.modelName);
                    modelNameInput.value = config.modelName;
                }
            } else {
                modelNameInput.innerHTML = '<option value="">No models found</option>';
            }
        } catch (e) {
            console.error('Fetch Models Error:', e);
            modelNameInput.innerHTML = '<option value="">Error fetching models</option>';
        }
    }

    // Modal Logic
    const openModal = () => {
        settingsModal.classList.remove('hidden');
        if (config.apiUrl) {
            fetchModels(config.apiUrl);
        }
    };
    const closeModal = () => settingsModal.classList.add('hidden');

    settingsBtn.addEventListener('click', openModal);

    // Initial fetch if we have an API URL
    if (config.apiUrl) {
        fetchModels(config.apiUrl);
    }
    closeModalBtn.addEventListener('click', closeModal);

    // Close modal if clicking outside
    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) closeModal();
    });

    saveSettingsBtn.addEventListener('click', () => {
        const model = modelNameInput.value;

        if (!model) {
            alert('Please select a model.');
            return;
        }

        config.modelName = model;
        localStorage.setItem('semar_model_name', model);

        closeModal();
    });

    // Ensure initial check
    if (!config.apiUrl) {
        // Automatically open settings if no API URL is configured initially
        setTimeout(() => openModal(), 1000);
    }

    // Chat Logic
    chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        if (isGenerating) {
            if (currentAbortController) {
                currentAbortController.abort();
            }
            return;
        }

        const text = messageInput.value.trim();
        if (!text) return;

        // Make background focus out after the first message
        if (!document.body.classList.contains('chat-active')) {
            document.body.classList.add('chat-active');
        }

        if (!config.apiUrl) {
            alert('Please configure the API URL in settings first.');
            openModal();
            return;
        }

        // Add chat-started class to document container to trigger CSS animations
        const appContainer = document.querySelector('.app-container');
        if (!appContainer.classList.contains('chat-started')) {
            appContainer.classList.add('chat-started');
        }

        // Reset input
        messageInput.value = '';
        messageInput.style.height = 'auto';
        sendBtn.disabled = true;

        // Add user message
        addMessage(text, 'user');
        chatHistory.push({ role: 'user', content: text });

        // Add loading indicator
        const loadingId = addLoadingIndicator();
        
        // Always force scroll at the start of a new message
        isUserScrolledUp = false; 
        
        currentAbortController = new AbortController();
        setGeneratingState(true);

        try {
            // Call Ollama API
            let aiMsgBox = null;
            let currentAiText = '';

            const responseText = await fetchOllama(chatHistory, (chunkText) => {
                // Remove loading indicator on first chunk
                const loadingEl = document.getElementById(loadingId);
                if (loadingEl) {
                    loadingEl.remove();
                    // create empty message box
                    aiMsgBox = addMessage('', 'ai', false, true); 
                }
                if (aiMsgBox) {
                    currentAiText += chunkText;
                    // Parse markdown to HTML
                    aiMsgBox.contentDiv.innerHTML = marked.parse(currentAiText);
                    scrollToBottom();
                }
            }, currentAbortController.signal);

            if (!aiMsgBox) {
                // fallback if no chunks streamed
                document.getElementById(loadingId).remove();
                addMessage(marked.parse(responseText), 'ai', false, true);
            }

            chatHistory.push({ role: 'assistant', content: responseText });

        } catch (error) {
            console.error('API Error:', error);
            const loadEl = document.getElementById(loadingId);
            if (loadEl) loadEl.remove();
            
            if (error.name === 'AbortError') {
                addMessage('*(Generation Stopped)*', 'ai', false, true);
            } else {
                addMessage('Error connecting to the API: ' + error.message, 'ai', true);
                // Optionally remove the last user message from history if it failed
                chatHistory.pop();
            }
        } finally {
            setGeneratingState(false);
            currentAbortController = null;
            messageInput.focus();
        }
    });

    function addMessage(text, sender, isError = false, isHtml = false) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${sender}`;

        const avatarDiv = document.createElement('div');
        avatarDiv.className = 'msg-avatar';
        avatarDiv.innerHTML = sender === 'user' ? "<i class='bx bx-user'></i>" : "<i class='bx bx-brain'></i>";

        const contentDiv = document.createElement('div');
        contentDiv.className = `msg-content ${isError ? 'error' : ''}`;
        
        if (isHtml) {
            contentDiv.innerHTML = text;
        } else {
            contentDiv.textContent = text;
        }

        msgDiv.appendChild(avatarDiv);
        msgDiv.appendChild(contentDiv);

        messageList.appendChild(msgDiv);
        scrollToBottom(true); // force scroll slightly on new main message adding

        return { msgDiv, contentDiv };
    }

    function addLoadingIndicator() {
        const id = 'loading-' + Date.now();
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ai`;
        msgDiv.id = id;

        const avatarDiv = document.createElement('div');
        avatarDiv.className = 'msg-avatar';
        avatarDiv.innerHTML = "<i class='bx bx-brain'></i>";

        const contentDiv = document.createElement('div');
        contentDiv.className = 'msg-content';
        contentDiv.innerHTML = `
            <div class="typing-indicator">
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
            </div>
        `;

        msgDiv.appendChild(avatarDiv);
        msgDiv.appendChild(contentDiv);

        messageList.appendChild(msgDiv);
        scrollToBottom();
        return id;
    }

    function scrollToBottom(force = false) {
        if (!isUserScrolledUp || force) {
            chatWindow.scrollTo({
                top: chatWindow.scrollHeight,
                behavior: force ? 'smooth' : 'auto'
            });
        }
    }

    // Connect to Ollama API
    async function fetchOllama(messages, onChunk, signal) {
        // Construct the chat endpoint. 
        // Some users might input 'https://xyz.ngrok.app' or 'https://xyz.ngrok.app/api'
        let endpoint = config.apiUrl;
        if (!endpoint.endsWith('/api/chat') && !endpoint.endsWith('/api/generate')) {
            // Assume base URL was provided, append /api/chat
            endpoint = `${endpoint}/api/chat`;
        }

        const payload = {
            model: config.modelName,
            messages: messages,
            stream: true // Using streaming
        };

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload),
            signal: signal
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let fullResponse = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');

            for (const line of lines) {
                if (line.trim() !== '') {
                    try {
                        const parsed = JSON.parse(line);
                        let textStr = '';
                        // Ollama /api/chat returns { message: { role: 'assistant', content: '...' } }
                        if (parsed.message && parsed.message.content) {
                            textStr = parsed.message.content;
                        } else if (parsed.response) { // fallback for /api/generate
                            textStr = parsed.response;
                        }

                        if (textStr) {
                            fullResponse += textStr;
                            onChunk(textStr);
                        }
                    } catch (e) {
                        // Some chunks might be split, or just keep going
                        console.error('Error parsing stream line:', line);
                    }
                }
            }
        }

        return fullResponse;
    }

    // Restore user session
    function restoreUserSession() {
        const savedName = localStorage.getItem('semar_user_name');
        const savedPic = localStorage.getItem('semar_user_pic');
        if (savedName && savedPic) {
            const welcomeText = document.getElementById('welcome-text');
            if (welcomeText) welcomeText.textContent = 'Welcome back, ' + savedName + '!';
            
            const profileImg = document.getElementById('user-profile-img');
            if (profileImg) {
                profileImg.src = savedPic;
                profileImg.classList.remove('hidden');
            }
            
            const loginContainer = document.getElementById('google-login-container');
            if (loginContainer) loginContainer.classList.add('hidden');
        }
    }

    restoreUserSession();

    // Logout logic
    const profileImg = document.getElementById('user-profile-img');
    const logoutMenu = document.getElementById('logout-menu');
    const logoutBtn = document.getElementById('logout-btn');

    if (profileImg && logoutMenu) {
        profileImg.addEventListener('click', (e) => {
            e.stopPropagation();
            logoutMenu.classList.toggle('hidden');
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            localStorage.removeItem('semar_user_name');
            localStorage.removeItem('semar_user_pic');
            location.reload();
        });
    }

    // Hide dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (logoutMenu && !logoutMenu.classList.contains('hidden')) {
            if (!logoutMenu.contains(e.target) && !profileImg.contains(e.target)) {
                logoutMenu.classList.add('hidden');
            }
        }
    });

});

// Google Identity Services - JWT Decoder
function decodeJwtResponse(token) {
    var base64Url = token.split('.')[1];
    var base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    var jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    return JSON.parse(jsonPayload);
}

// Global callback for Google Login
window.handleCredentialResponse = function(response) {
    const responsePayload = decodeJwtResponse(response.credential);
    const userName = responsePayload.name;
    const userPicture = responsePayload.picture;
    
    // Save to local storage
    localStorage.setItem('semar_user_name', userName);
    localStorage.setItem('semar_user_pic', userPicture);
    
    // Update welcome message
    const welcomeText = document.getElementById('welcome-text');
    if (welcomeText) {
        welcomeText.textContent = 'Welcome back, ' + userName + '!';
    }
    
    // Update profile image
    const profileImg = document.getElementById('user-profile-img');
    if (profileImg) {
        profileImg.src = userPicture;
        profileImg.classList.remove('hidden');
    }
    
    // Hide login button
    const loginContainer = document.getElementById('google-login-container');
    if (loginContainer) {
        loginContainer.classList.add('hidden');
    }
};

// Global initializer called when Google Identity script loads
window.onload = function () {
    google.accounts.id.initialize({
        client_id: "884444108567-k7n8527kckobjcdj1fdr8kob4d961qnl.apps.googleusercontent.com",
        callback: window.handleCredentialResponse
    });
    
    const loginContainer = document.getElementById('google-login-container');
    if (loginContainer && !localStorage.getItem('semar_user_name')) {
        google.accounts.id.renderButton(
            loginContainer,
            { theme: "outline", size: "large", type: "standard", shape: "rectangular", text: "signin_with", logo_alignment: "left" }
        );
    }

    // Only prompt One Tap if the user is NOT already continuously logged in via our local session
    if (!localStorage.getItem('semar_user_name')) {
        // Wait briefly for the UI to settle before throwing the popup
        setTimeout(() => {
            google.accounts.id.prompt();
        }, 300);
    }
};
