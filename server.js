require("dotenv").config();

const express = require("express");
const path = require("path");
const OpenAI = require("openai");

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.OPENAI_API_KEY) {
    console.warn("Warning: OPENAI_API_KEY is not set.");
}

const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

app.use(express.json({ limit: "25mb" }));
app.use(express.static(path.join(__dirname, "public")));

const SYSTEM_PROMPT = `
You are 5XAI, a helpful, accurate, friendly AI assistant.
Your name is 5XAI. Never call yourself Aria.
Answer directly and clearly.
When web search is enabled, use it for current or time-sensitive information.
When an image or file is attached, inspect it and answer the user's request about it.
Never claim you performed an action you did not perform.
`;

function cleanMessages(messages) {
    if (!Array.isArray(messages)) return [];
    return messages
        .filter((message) =>
            message &&
            ["user", "assistant"].includes(message.role) &&
            typeof message.content === "string" &&
            message.content.trim().length > 0
        )
        .slice(-40);
}

function parseDataUrl(dataUrl) {
    if (typeof dataUrl !== "string") return null;

    const match = dataUrl.match(
        /^data:([^,]+);base64,(.+)$/s
    );

    if (!match) return null;

    const header = match[1];
    const base64 = match[2];

    const mimeType = header
        .split(";")[0]
        .trim();

    if (!mimeType || !base64) {
        return null;
    }

    return {
        mimeType,
        base64
    };
}
function buildUserContent(message, attachments) {
    const content = [{ type: "input_text", text: message }];

    if (attachments?.image?.data) {
        content.push({
            type: "input_image",
            image_url: attachments.image.data,
            detail: "auto"
        });
    }

    if (attachments?.file?.data) {
        const parsed = parseDataUrl(attachments.file.data);
        if (parsed) {
            content.push({
                type: "input_file",
                filename: attachments.file.name || "attachment",
                file_data: parsed.base64
            });
        }
    }

    return content.length === 1 ? message : content;
}

app.get("/api/status", (req, res) => {
    res.json({
        name: "5XAI",
        status: "online",
        model: process.env.OPENAI_MODEL || "gpt-5.6-luna"
    });
});

app.post("/api/transcribe", async (req, res) => {
    try {
        if (!process.env.OPENAI_API_KEY) {
            return res.status(500).json({ error: "OPENAI_API_KEY is not configured on the server." });
        }

        const audio = parseDataUrl(req.body.audio);
        if (!audio) return res.status(400).json({ error: "Valid audio data is required." });

        const buffer = Buffer.from(audio.base64, "base64");
        if (buffer.length > 8 * 1024 * 1024) {
            return res.status(413).json({ error: "Audio is too large. Keep recordings under 8 MB." });
        }

        const extension = audio.mimeType.includes("mp4") ? "m4a"
            : audio.mimeType.includes("ogg") ? "ogg"
            : audio.mimeType.includes("wav") ? "wav"
            : "webm";

        const file = new File([buffer], `voice.${extension}`, { type: audio.mimeType });
        const result = await client.audio.transcriptions.create({
            file,
            model: "gpt-4o-transcribe"
        });

        res.json({ text: result.text || "" });
    } catch (error) {
        console.error("5XAI transcription error:", error);
        res.status(error?.status || 500).json({ error: error?.message || "Voice transcription failed." });
    }
});

app.post("/api/speak", async (req, res) => {
    try {
        const text = typeof req.body.text === "string" ? req.body.text.trim() : "";
        if (!text) return res.status(400).json({ error: "Text is required." });
        if (text.length > 4000) return res.status(400).json({ error: "Please keep spoken replies under 4,000 characters." });

        const speech = await client.audio.speech.create({
            model: "gpt-4o-mini-tts",
            voice: "alloy",
            input: text,
            format: "mp3"
        });

        const arrayBuffer = await speech.arrayBuffer();
        res.json({
            audio: Buffer.from(arrayBuffer).toString("base64"),
            mimeType: "audio/mpeg"
        });
    } catch (error) {
        console.error("5XAI speech error:", error);
        res.status(error?.status || 500).json({ error: error?.message || "Voice generation failed." });
    }
});

app.post("/api/chat", async (req, res) => {
    try {
        if (!process.env.OPENAI_API_KEY) {
            return res.status(500).json({ error: "OPENAI_API_KEY is not configured on the server." });
        }

        const messages = cleanMessages(req.body.messages);
        const webSearch = Boolean(req.body.webSearch);
        const attachments = req.body.attachments || null;
        const requestedModel = typeof req.body.model === "string" ? req.body.model : "";
        const allowedModels = new Set(["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"]);
        const model = allowedModels.has(requestedModel)
            ? requestedModel
            : (process.env.OPENAI_MODEL || "gpt-5.6-luna");

        if (!messages.length) return res.status(400).json({ error: "A conversation message is required." });

        const lastUserIndex = [...messages].map((m) => m.role).lastIndexOf("user");
        if (lastUserIndex < 0) return res.status(400).json({ error: "A user message is required." });

        const inputMessages = messages.map((message, index) => {
            if (index !== lastUserIndex || message.role !== "user") return message;
            return {
                role: "user",
                content: buildUserContent(message.content, attachments)
            };
        });

        const request = {
            model,
            instructions: SYSTEM_PROMPT,
            input: inputMessages
        };

        if (webSearch) request.tools = [{ type: "web_search" }];

        const response = await client.responses.create(request);
        const citations = [];

        for (const outputItem of response.output || []) {
            for (const contentItem of outputItem.content || []) {
                for (const annotation of contentItem.annotations || []) {
                    if (annotation.type === "url_citation" && annotation.url) {
                        citations.push({
                            title: annotation.title || annotation.url,
                            url: annotation.url
                        });
                    }
                }
            }
        }

        res.json({
            reply: response.output_text || "I couldn't generate a response.",
            citations: [...new Map(citations.map((citation) => [citation.url, citation])).values()]
        });
    } catch (error) {
        console.error("5XAI API error:", error);
        const message = error?.error?.message || error?.message || "The AI request failed.";
        res.status(error?.status || 500).json({ error: message });
    }
});

app.get("/{*splat}", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
    console.log(`5XAI is running at http://localhost:${PORT}`);
});
