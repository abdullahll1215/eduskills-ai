// Generative AI for the browser demo: Google AI Studio (Gemini API) called directly from the page,
// or any OpenAI-compatible endpoint. The key is entered by the admin and stays on that device.
import type { DemoDB } from "./store";
import { setting } from "./logic";

export interface AICfg {
  key: string;
  model: string;
  baseUrl: string;
  usable: boolean;
}

export const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

export function aiConfig(db: DemoDB): AICfg {
  const key = setting(db, "ai_api_key");
  return { key, model: setting(db, "ai_model"), baseUrl: setting(db, "ai_base_url").replace(/\/+$/, ""), usable: setting(db, "ai_enabled") === "true" && !!key };
}

const isGemini = (c: AICfg) => c.baseUrl.includes("generativelanguage.googleapis.com");
type Msg = { role: "user" | "assistant"; content: string };

export async function chatCompletion(c: AICfg, system: string, messages: Msg[], json = false, maxTokens = 900): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    if (isGemini(c)) {
      // Native Gemini endpoint (supports calls from the browser).
      const model = c.model.replace(/^models\//, "");
      const res = await fetch(`${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json", "x-goog-api-key": c.key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
          generationConfig: { temperature: 0.4, maxOutputTokens: maxTokens, ...(json ? { responseMimeType: "application/json" } : {}) },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message ?? `Gemini API error ${res.status}`);
      const text = (data?.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("");
      if (!text) throw new Error("Gemini returned an empty answer");
      return text;
    }
    const res = await fetch(`${c.baseUrl}/chat/completions`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${c.key}` },
      body: JSON.stringify({
        model: c.model,
        temperature: 0.4,
        max_tokens: maxTokens,
        messages: [{ role: "system", content: system }, ...messages],
        ...(json ? { response_format: { type: "json_object" } } : {}),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message ?? `AI API error ${res.status}`);
    return data.choices[0].message.content;
  } finally {
    clearTimeout(timer);
  }
}

export function parseJson(text: string) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "");
  return JSON.parse(cleaned);
}
