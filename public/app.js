const $ = (selector) => document.querySelector(selector);

const chat = $("#chat");
const form = $("#chat-form");
const input = $("#message");
const imageInput = $("#image-input");
const fileInput = $("#file-input");
const attachmentPreview = $("#attachment-preview");
const historyList = $("#history-list");
const currentTitle = $("#current-title");
const statusText = $("#status-text");
const sendButton = $("#send-button");
const webSearchButton = $("#web-search-button");
const micButton = $("#mic-button");
const sidebar = $("#sidebar");
const settingsOverlay = $("#settings-overlay");

const STORAGE_KEY = "5xai_chats_v3";
const SETTINGS_KEY = "5xai_settings_v3";

let conversation = [];
let currentChatId = makeId();
let selectedAttachment = null;
let useWebSearch = false;
let activeController = null;
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;
let speechRecognition = null;
let usingSpeechRecognition = false;

function makeId() {
    return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function safeParse(value, fallback) {
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

function loadChats() {
    const current = safeParse(localStorage.getItem(STORAGE_KEY) || "[]", []);
    const oldV2 = safeParse(localStorage.getItem("5xai_chats_v2") || "[]", []);
    const oldV1 = safeParse(localStorage.getItem("5xai_chats") || "[]", []);
    const combined = [...current, ...oldV2, ...oldV1];
    const unique = new Map();

    for (const item of combined) {
        if (!item || !item.id || !Array.isArray(item.messages)) continue;
        if (!unique.has(item.id)) unique.set(item.id, item);
    }

    const chats = [...unique.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    if (chats.length && !current.length) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(chats));
    }

    return chats;
}

function saveChats(chats) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(chats));
}

function loadSettings() {
    const defaults = {
        model: "gpt-5.6-luna",
        enterToSend: true,
        autoSpeak: false
    };
    return { ...defaults, ...safeParse(localStorage.getItem(SETTINGS_KEY) || "{}", {}) };
}

function saveSettingsValue() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

let settings = loadSettings();

function chatTitle(messages = conversation) {
    const first = messages.find((m) => m.role === "user");
    if (!first) return "New chat";
    const title = String(first.content || "").trim();
    return title.length > 42 ? `${title.slice(0, 42)}…` : title;
}

function persistCurrentChat() {
    if (!conversation.length) return;

    const chats = loadChats();
    const saved = {
        id: currentChatId,
        title: chatTitle(),
        messages: conversation,
        updatedAt: Date.now()
    };

    const index = chats.findIndex((item) => item.id === currentChatId);
    if (index >= 0) chats[index] = saved;
    else chats.unshift(saved);

    saveChats(chats.sort((a, b) => b.updatedAt - a.updatedAt));
    currentTitle.textContent = saved.title;
    renderHistory();
}

function renderHistory() {
    const chats = loadChats();
    historyList.innerHTML = "";

    if (!chats.length) {
        historyList.innerHTML = `<div class="history-empty">No saved chats yet.</div>`;
        return;
    }

    for (const saved of chats) {
        const row = document.createElement("div");
        row.className = "history-item";

        const open = document.createElement("button");
        open.type = "button";
        open.className = `history-open${saved.id === currentChatId ? " active" : ""}`;
        open.textContent = saved.title || "Untitled chat";
        open.addEventListener("click", () => openChat(saved.id));

        const del = document.createElement("button");
        del.type = "button";
        del.className = "history-delete";
        del.textContent = "🗑";
        del.title = "Delete chat";
        del.addEventListener("click", (event) => {
            event.stopPropagation();
            deleteChat(saved.id);
        });

        row.append(open, del);
        historyList.appendChild(row);
    }
}

function renderWelcome() {
    chat.innerHTML = "";
    const template = $("#welcome-template");
    chat.appendChild(template.content.cloneNode(true));

    chat.querySelectorAll("[data-prompt]").forEach((button) => {
        button.addEventListener("click", () => {
            input.value = button.dataset.prompt;
            autoGrow();
            input.focus();
        });
    });
}

function renderConversation() {
    chat.innerHTML = "";
    if (!conversation.length) {
        renderWelcome();
        return;
    }

    for (const message of conversation) {
        renderMessage(message.role, message.content, message.citations || []);
    }
    chat.scrollTop = chat.scrollHeight;
}

function renderMessage(role, text, citations = []) {
    const wrapper = document.createElement("div");
    wrapper.className = `message-wrap ${role === "user" ? "user" : "ai"}`;

    const block = document.createElement("div");
    const label = document.createElement("div");
    label.className = "message-label";
    label.textContent = role === "user" ? "You" : "5XAI";

    const bubble = document.createElement("div");
    bubble.className = `message ${role === "user" ? "user" : "ai"}`;
    bubble.textContent = text;
    block.append(label, bubble);

    if (role === "assistant" && citations.length) {
        const citationList = document.createElement("div");
        citationList.className = "citation-list";
        citations.forEach((citation) => {
            const link = document.createElement("a");
            link.href = citation.url;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.textContent = `↗ ${citation.title || citation.url}`;
            citationList.appendChild(link);
        });
        block.appendChild(citationList);
    }

    if (role === "assistant") {
        const actions = document.createElement("div");
        actions.className = "message-actions";

        const copyButton = document.createElement("button");
        copyButton.type = "button";
        copyButton.textContent = "Copy";
        copyButton.addEventListener("click", async () => {
            try {
                await navigator.clipboard.writeText(text);
                copyButton.textContent = "Copied";
                setTimeout(() => (copyButton.textContent = "Copy"), 1200);
            } catch {
                alert("Copy is not available in this browser.");
            }
        });
        actions.appendChild(copyButton);

        const speakButton = document.createElement("button");
        speakButton.type = "button";
        speakButton.textContent = "Speak";
        speakButton.addEventListener("click", () => speakText(text, speakButton));
        actions.appendChild(speakButton);

        block.appendChild(actions);
    }

    wrapper.appendChild(block);
    chat.appendChild(wrapper);
    return bubble;
}

function newChat() {
    persistCurrentChat();
    currentChatId = makeId();
    conversation = [];
    clearAttachment();
    currentTitle.textContent = "New chat";
    renderConversation();
    renderHistory();
    sidebar.classList.remove("open");
    input.focus();
}

function openChat(id) {
    const saved = loadChats().find((item) => item.id === id);
    if (!saved) return;

    currentChatId = saved.id;
    conversation = Array.isArray(saved.messages) ? saved.messages : [];
    clearAttachment();
    currentTitle.textContent = saved.title || "New chat";
    renderConversation();
    renderHistory();
    sidebar.classList.remove("open");
    input.focus();
}

function deleteChat(id) {
    const chats = loadChats().filter((item) => item.id !== id);
    saveChats(chats);
    if (id === currentChatId) {
        currentChatId = makeId();
        conversation = [];
        currentTitle.textContent = "New chat";
        renderConversation();
    }
    renderHistory();
}

function clearAttachment() {
    selectedAttachment = null;
    attachmentPreview.classList.add("hidden");
    attachmentPreview.innerHTML = "";
    imageInput.value = "";
    fileInput.value = "";
}

function formatBytes(bytes) {
    if (!bytes) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function showAttachmentPreview() {
    if (!selectedAttachment) return clearAttachment();
    attachmentPreview.classList.remove("hidden");
    attachmentPreview.innerHTML = "";

    const main = document.createElement("div");
    main.className = "attachment-preview-main";

    if (selectedAttachment.kind === "image") {
        const img = document.createElement("img");
        img.src = selectedAttachment.data;
        img.alt = "Selected image";
        main.appendChild(img);
    }

    const name = document.createElement("div");
    name.className = "attachment-preview-name";
    name.textContent = `${selectedAttachment.name} • ${formatBytes(selectedAttachment.size)}`;
    main.appendChild(name);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-attachment";
    remove.textContent = "✕";
    remove.addEventListener("click", clearAttachment);

    attachmentPreview.append(main, remove);
}

function readFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("Could not read the file."));
        reader.readAsDataURL(file);
    });
}

async function chooseImage(file) {
    if (!file || !file.type.startsWith("image/")) return;
    if (file.size > 8 * 1024 * 1024) return alert("Please choose an image smaller than 8 MB.");
    selectedAttachment = { kind: "image", name: file.name || "image.jpg", size: file.size, data: await readFile(file) };
    showAttachmentPreview();
}

async function chooseFile(file) {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) return alert("Please choose a file smaller than 8 MB.");
    selectedAttachment = { kind: "file", name: file.name, size: file.size, data: await readFile(file) };
    showAttachmentPreview();
}

function setStatus(text) {
    statusText.textContent = text;
}

function autoGrow() {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 150)}px`;
}

function openSettings() {
    $("#model-setting").value = settings.model;
    $("#enter-setting").checked = settings.enterToSend;
    $("#auto-speak-setting").checked = settings.autoSpeak;
    settingsOverlay.classList.remove("hidden");
    document.body.classList.add("modal-open");
}

function closeSettings() {
    settingsOverlay.classList.add("hidden");
    document.body.classList.remove("modal-open");
}

async function startVoiceRecording() {
    if (isRecording) return;

    // Prefer real audio recording + server transcription. This is more reliable
    // across Chrome, Edge, Safari, iPhone, and Android than browser speech APIs.
    if (navigator.mediaDevices?.getUserMedia && window.MediaRecorder) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mimeCandidates = [
                "audio/webm;codecs=opus",
                "audio/webm",
                "audio/mp4",
                "audio/ogg;codecs=opus"
            ];
            const mimeType = mimeCandidates.find((type) => {
                try { return MediaRecorder.isTypeSupported(type); }
                catch { return false; }
            }) || "";

            recordedChunks = [];
            mediaRecorder = mimeType
                ? new MediaRecorder(stream, { mimeType })
                : new MediaRecorder(stream);

            isRecording = true;
            micButton.classList.add("recording");
            micButton.textContent = "⏹️";
            setStatus("Recording… click again to stop");

            mediaRecorder.addEventListener("dataavailable", (event) => {
                if (event.data && event.data.size > 0) {
                    recordedChunks.push(event.data);
                }
            });

            mediaRecorder.addEventListener("stop", async () => {
                stream.getTracks().forEach((track) => track.stop());
                finishVoiceUI();

                if (!recordedChunks.length) {
                    setStatus("Ready");
                    return;
                }

                const blob = new Blob(recordedChunks, {
                    type: mediaRecorder.mimeType || "audio/webm"
                });

                recordedChunks = [];

                if (!blob.size) {
                    alert("No audio was recorded. Please try again.");
                    return;
                }

                if (blob.size > 8 * 1024 * 1024) {
                    alert("Please record a shorter voice message (under 8 MB).");
                    return;
                }

                try {
                    setStatus("Transcribing…");
                    micButton.disabled = true;

                    const response = await fetch("/api/transcribe", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            audio: await blobToDataUrl(blob)
                        })
                    });

                    const raw = await response.text();
                    let data;
                    try { data = JSON.parse(raw); }
                    catch { data = { error: raw || "Transcription failed." }; }

                    if (!response.ok) {
                        throw new Error(data.error || `Transcription failed (HTTP ${response.status}).`);
                    }

                    const transcript = (data.text || "").trim();
                    if (!transcript) {
                        throw new Error("No speech was detected. Try speaking a little louder or closer to the microphone.");
                    }

                    input.value = transcript;
                    autoGrow();
                    input.focus();
                    setStatus("Ready");
                } catch (error) {
                    console.error("Voice transcription error:", error);
                    alert(`Voice input failed: ${error.message}`);
                    setStatus("Ready");
                } finally {
                    micButton.disabled = false;
                }
            }, { once: true });

            mediaRecorder.addEventListener("error", (event) => {
                console.error("MediaRecorder error:", event.error);
                stream.getTracks().forEach((track) => track.stop());
                recordedChunks = [];
                finishVoiceUI();
                alert("The microphone recording failed. Please try again.");
            }, { once: true });

            mediaRecorder.start(250);
            return;
        } catch (error) {
            console.error("Media microphone error:", error);
        }
    }

    // Last-resort browser speech recognition fallback.
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (Recognition) {
        try {
            usingSpeechRecognition = true;
            speechRecognition = new Recognition();
            speechRecognition.lang = "en-US";
            speechRecognition.continuous = false;
            speechRecognition.interimResults = false;

            speechRecognition.onstart = () => {
                isRecording = true;
                micButton.classList.add("recording");
                micButton.textContent = "⏹️";
                setStatus("Listening…");
            };

            speechRecognition.onresult = (event) => {
                const transcript = event.results?.[0]?.[0]?.transcript || "";
                input.value = transcript;
                autoGrow();
                input.focus();
            };

            speechRecognition.onerror = (event) => {
                console.error("Speech recognition error:", event.error);
                finishVoiceUI();
                alert(`Voice input failed: ${event.error || "speech recognition error"}`);
            };

            speechRecognition.onend = () => finishVoiceUI();
            speechRecognition.start();
            return;
        } catch (error) {
            console.error("Speech recognition start error:", error);
        }
    }

    alert("Microphone input is not available in this browser. Try the latest Chrome, Edge, or Safari and allow microphone access for 5XAI.");
}

function finishVoiceUI() {
    isRecording = false;
    micButton.classList.remove("recording");
    micButton.textContent = "🎤";
    setStatus("Ready");
}

function stopVoiceRecording() {
    if (usingSpeechRecognition && speechRecognition) {
        speechRecognition.stop();
        return;
    }
    if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
}

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

async function speakText(text, button) {
    if (!text || button.disabled) return;
    try {
        button.disabled = true;
        const original = button.textContent;
        button.textContent = "Speaking…";

        const response = await fetch("/api/speak", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Speech generation failed");

        const binary = Uint8Array.from(atob(data.audio), (char) => char.charCodeAt(0));
        const audio = new Audio(URL.createObjectURL(new Blob([binary], { type: data.mimeType || "audio/mpeg" })));
        audio.onended = () => {
            button.disabled = false;
            button.textContent = original;
        };
        audio.onerror = () => {
            button.disabled = false;
            button.textContent = original;
            alert("Your browser could not play the voice response.");
        };
        await audio.play();
    } catch (error) {
        console.error(error);
        alert(`Voice reply failed: ${error.message}`);
        button.disabled = false;
        button.textContent = "Speak";
    }
}

async function sendMessage() {
    const text = input.value.trim();
    if (!text && !selectedAttachment) return;
    if (activeController) return;

    const userContent = text || (selectedAttachment?.kind === "image"
        ? "Please analyze this image."
        : `Please analyze the attached file: ${selectedAttachment?.name}`);

    conversation.push({ role: "user", content: userContent });
    const sentAttachment = selectedAttachment ? { ...selectedAttachment } : null;

    input.value = "";
    autoGrow();
    persistCurrentChat();
    renderConversation();

    const thinkingWrap = document.createElement("div");
    thinkingWrap.className = "message-wrap ai";
    const thinkingBlock = document.createElement("div");
    const thinkingLabel = document.createElement("div");
    thinkingLabel.className = "message-label";
    thinkingLabel.textContent = "5XAI";
    const thinking = document.createElement("div");
    thinking.className = "message ai";
    thinking.textContent = "5XAI is thinking…";
    thinkingBlock.append(thinkingLabel, thinking);
    thinkingWrap.appendChild(thinkingBlock);
    chat.appendChild(thinkingWrap);
    chat.scrollTop = chat.scrollHeight;

    setStatus(useWebSearch ? "Searching the web…" : "Thinking…");
    sendButton.disabled = true;
    activeController = new AbortController();

    try {
        const response = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: activeController.signal,
            body: JSON.stringify({
                model: settings.model,
                webSearch: useWebSearch,
                messages: conversation,
                attachments: sentAttachment ? {
                    image: sentAttachment.kind === "image" ? sentAttachment : null,
                    file: sentAttachment.kind === "file" ? sentAttachment : null
                } : null
            })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Request failed");

        thinking.textContent = data.reply;
        conversation.push({ role: "assistant", content: data.reply, citations: data.citations || [] });
        persistCurrentChat();
        clearAttachment();
        setStatus("Ready");

        if (settings.autoSpeak) {
            const temp = document.createElement("button");
            speakText(data.reply, temp).catch(console.error);
        }
    } catch (error) {
        if (error.name === "AbortError") {
            thinking.textContent = "Stopped.";
        } else {
            console.error(error);
            thinking.textContent = `5XAI couldn't respond: ${error.message}`;
            setStatus("Error");
            conversation.pop();
            persistCurrentChat();
        }
    } finally {
        activeController = null;
        sendButton.disabled = false;
        if (statusText.textContent !== "Error") setStatus("Ready");
    }
}

form.addEventListener("submit", (event) => {
    event.preventDefault();
    sendMessage();
});

input.addEventListener("input", autoGrow);
input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && settings.enterToSend) {
        event.preventDefault();
        form.requestSubmit();
    }
});

imageInput.addEventListener("change", () => chooseImage(imageInput.files[0]).catch((error) => alert(error.message)));
fileInput.addEventListener("change", () => chooseFile(fileInput.files[0]).catch((error) => alert(error.message)));

micButton.addEventListener("click", () => {
    if (isRecording) stopVoiceRecording();
    else startVoiceRecording();
});

webSearchButton.addEventListener("click", () => {
    useWebSearch = !useWebSearch;
    webSearchButton.classList.toggle("active", useWebSearch);
    webSearchButton.setAttribute("aria-pressed", String(useWebSearch));
    webSearchButton.title = useWebSearch ? "Web search ON" : "Web search";
});

$("#new-chat").addEventListener("click", newChat);
$("#open-sidebar").addEventListener("click", () => sidebar.classList.add("open"));
$("#close-sidebar").addEventListener("click", () => sidebar.classList.remove("open"));

$("#clear-history").addEventListener("click", () => {
    if (!confirm("Delete all saved chats from this browser?")) return;
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem("5xai_chats_v2");
    localStorage.removeItem("5xai_chats");
    currentChatId = makeId();
    conversation = [];
    currentTitle.textContent = "New chat";
    renderConversation();
    renderHistory();
});

$("#export-all").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(loadChats(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "5xai-chats.json";
    a.click();
    URL.revokeObjectURL(url);
});

$("#settings-button").addEventListener("click", openSettings);
$("#close-settings").addEventListener("click", closeSettings);
settingsOverlay.addEventListener("click", (event) => {
    if (event.target === settingsOverlay) closeSettings();
});
document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !settingsOverlay.classList.contains("hidden")) closeSettings();
});

$("#model-setting").addEventListener("change", () => {
    settings.model = $("#model-setting").value;
    saveSettingsValue();
});
$("#enter-setting").addEventListener("change", () => {
    settings.enterToSend = $("#enter-setting").checked;
    saveSettingsValue();
});
$("#auto-speak-setting").addEventListener("change", () => {
    settings.autoSpeak = $("#auto-speak-setting").checked;
    saveSettingsValue();
});

window.addEventListener("beforeunload", persistCurrentChat);

renderHistory();
renderConversation();
autoGrow();
