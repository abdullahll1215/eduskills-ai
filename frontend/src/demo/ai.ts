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

const resolved: Record<string, string> = {};
export const activeModel = (c: AICfg) => resolved[c.model] ?? c.model;

async function pickModel(c: AICfg, signal: AbortSignal): Promise<string | null> {
  const res = await fetch(`${GEMINI_BASE}/models?pageSize=200`, { headers: { "x-goog-api-key": c.key }, signal });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gemini API error ${res.status}: ${data?.error?.message ?? "could not list models"}`);
  const names: string[] = (data.models ?? [])
    .filter((m: { supportedGenerationMethods?: string[] }) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m: { name: string }) => m.name.replace(/^models\//, ""));
  const bad = ["lite", "image", "tts", "live", "audio", "embedding", "vision", "learnlm", "gemma", "thinking", "exp"];
  const version = (n: string) => Number(n.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] ?? 0);
  for (const re of [/^gemini-[\d.]+-flash$/, /^gemini-[\d.]+-flash/, /^gemini-[\d.]+-pro$/, /^gemini/]) {
    const found = names.filter((n) => re.test(n) && !bad.some((b) => n.includes(b)));
    if (found.length) return found.sort((a, b) => version(b) - version(a))[0];
  }
  return names[0] ?? null;
}

const isGemini = (c: AICfg) => c.baseUrl.includes("generativelanguage.googleapis.com");
type Msg = { role: "user" | "assistant"; content: string };

export async function chatCompletion(c: AICfg, system: string, messages: Msg[], json = false, maxTokens = 900): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    if (isGemini(c)) {
      // Native Gemini endpoint (supports calls from the browser).
      const body = JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
        // Gemini 2.5+ spends part of the output budget on thinking, so keep the limit generous.
        generationConfig: { temperature: 0.4, maxOutputTokens: Math.max(maxTokens, 1024), ...(json ? { responseMimeType: "application/json" } : {}) },
      });
      let model = (resolved[c.model] ?? c.model).replace(/^models\//, "");
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await fetch(`${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
          method: "POST", signal: ctrl.signal, headers: { "Content-Type": "application/json", "x-goog-api-key": c.key }, body,
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 404 && attempt === 0) {
          // The configured model is not available for this key: ask Google which models are.
          const replacement = await pickModel(c, ctrl.signal);
          if (replacement && replacement !== model) {
            resolved[c.model] = model = replacement;
            continue;
          }
        }
        if (!res.ok) throw new Error(`Gemini API error ${res.status}: ${data?.error?.message ?? "request failed"}`);
        const parts = data?.candidates?.[0]?.content?.parts ?? [];
        const text = parts.filter((p: { thought?: boolean }) => !p.thought).map((p: { text?: string }) => p.text ?? "").join("");
        if (!text) throw new Error(`Gemini returned an empty answer (${data?.candidates?.[0]?.finishReason ?? "no text"})`);
        return text;
      }
      throw new Error("Gemini model could not be resolved");
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
