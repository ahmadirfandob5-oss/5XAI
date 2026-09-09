 require("dotenv").config();

const express = require("express");
const path = require("path");
const OpenAI = require("openai");

const app = express();
const PORT = process.env.PORT || 3000;

const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

app.use(express.json({ limit: "12mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/status", (req, res) => {
    res.json({
        name: "5XAI",
        status: "online"
    });
});

app.post("/api/chat", async (req, res) => {
    try {
        const messages = req.body.messages;
        const image = req.body.image;

        if (!Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({
                error: "Messages are required."
            });
        }

        let input = messages;

        // When an image is attached, send the latest user message
        // together with the image.
        if (image) {
            const latestUserMessage =
                messages[messages.length - 1];

            input = [
                ...messages.slice(0, -1),
                {
                    role: "user",
                    content: [
                        {
                            type: "input_text",
                            text: latestUserMessage.content
                        },
                        {
                            type: "input_image",
                            image_url: image
                        }
                    ]
                }
            ];
        }

        const response = await client.responses.create({
            model: "gpt-5.6-luna",
            instructions:
                "You are 5XAI, a helpful, intelligent and friendly AI assistant. Your name is 5XAI. Never call yourself Aria.",
            input
        });

        res.json({
            reply: response.output_text
        });

    } catch (error) {
        console.error("AI error:", error);

        res.status(500).json({
            error: "5XAI could not get an AI response."
        });
    }
});

app.listen(PORT, () => {
    console.log(`5XAI is running at http://localhost:${PORT}`);
});