import OpenAI from "openai";

/**
 * One shared client. Lives in its own module so both the agent loop and the
 * sprite generator can reach it without importing each other.
 */
let client: OpenAI | null = null;

export function geminiApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error("No Gemini API key configured. Add GEMINI_API_KEY to .env and restart the server.");
  }
  return key;
}

export function gemini(): OpenAI {
  const key = geminiApiKey();
  client ??= new OpenAI({
    apiKey: key,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
  });
  return client;
}
