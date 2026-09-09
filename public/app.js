const form = document.getElementById("chat-form");
const input = document.getElementById("message");
const chat = document.getElementById("chat");
const imageInput = document.getElementById("image-input");

const conversation = [];

let selectedImage = null;

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

    return message;
}

imageInput.addEventListener("change", async () => {
    const file = imageInput.files[0];

    if (!file) return;

    if (!file.type.startsWith("image/")) {
        alert("Please choose an image.");
        return;
    }

    const reader = new FileReader();

    reader.onload = () => {
        selectedImage = {
            name: file.name,
            data: reader.result
        };

        addMessage(`📷 ${file.name} selected`, "user");
    };

    reader.readAsDataURL(file);
});

form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const text = input.value.trim();

    if (!text && !selectedImage) return;

    const userText = text || "Please analyze this image.";

    addMessage(
        selectedImage
            ? `📷 ${userText}`
            : userText,
        "user"
    );

    input.value = "";

    const userMessage = {
        role: "user",
        content: userText
    };

    conversation.push(userMessage);

    const thinking = addMessage("5XAI is thinking...", "ai");

    try {
        const response = await fetch("/api/chat", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                messages: conversation,
                image: selectedImage ? selectedImage.data : null
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Request failed");
        }

        thinking.textContent = data.reply;

        conversation.push({
            role: "assistant",
            content: data.reply
        });

        selectedImage = null;
        imageInput.value = "";

    } catch (error) {
        console.error(error);

        thinking.textContent =
            "Sorry, 5XAI couldn't analyze the request.";

        conversation.pop();
    }
});