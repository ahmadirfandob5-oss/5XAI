const form = document.getElementById("chat-form");
const input = document.getElementById("message");
const chat = document.getElementById("chat");

function addMessage(text, type) {
    const message = document.createElement("div");
    message.className = `message ${type}`;
    message.textContent = text;

    const welcome = document.querySelector(".welcome");
    if (welcome) {
        welcome.remove();
    }

    chat.appendChild(message);
    chat.scrollTop = chat.scrollHeight;
}

form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const text = input.value.trim();

    if (!text) return;

    addMessage(text, "user");
    input.value = "";

    addMessage("5XAI is thinking...", "ai");

    try {
        const response = await fetch("/api/chat", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                message: text
            })
        });

        const data = await response.json();

        const messages = document.querySelectorAll(".message.ai");
        const thinking = messages[messages.length - 1];

        if (data.reply) {
            thinking.textContent = data.reply;
        } else {
            thinking.textContent = "I couldn't get a response.";
        }
    } catch (error) {
        const messages = document.querySelectorAll(".message.ai");
        const thinking = messages[messages.length - 1];

        thinking.textContent =
            "5XAI couldn't connect to the local AI server.";
    }
}); 