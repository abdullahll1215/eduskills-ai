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

const modelLists: Record<string, string[]> = {};
const BUSY = new Set([429, 500, 503, 504]);

async function geminiModels(c: AICfg, signal: AbortSignal): Promise<string[]> {
  if (modelLists[c.key]) return modelLists[c.key];
  const res = await fetch(`${GEMINI_BASE}/models?pageSize=200`, { headers: { "x-goog-api-key": c.key }, signal });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gemini API error ${res.status}: ${data?.error?.message ?? "could not list models"}`);
  const names: string[] = (data.models ?? [])
    .filter((m: { supportedGenerationMethods?: string[] }) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m: { name: string }) => m.name.replace(/^models\//, ""));
  const bad = ["image", "tts", "live", "audio", "embedding", "vision", "learnlm", "gemma", "thinking", "exp", "preview"];
  const version = (n: string) => Number(n.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] ?? 0);
  const ranked: string[] = [];
  for (const re of [/^gemini-[\d.]+-flash$/, /^gemini-[\d.]+-flash-lite$/, /^gemini-[\d.]+-pro$/, /^gemini-[\d.]+-flash/, /^gemini/]) {
    ranked.push(...names.filter((n) => re.test(n) && !bad.some((x) => n.includes(x)) && !ranked.includes(n)).sort((x, y) => version(y) - version(x)));
  }
  modelLists[c.key] = ranked.length ? ranked : names;
  return modelLists[c.key];
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
      const tried: string[] = [];
      let lastError = "";
      for (let attempt = 0; attempt < 4; attempt++) {
        const res = await fetch(`${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
          method: "POST", signal: ctrl.signal, headers: { "Content-Type": "application/json", "x-goog-api-key": c.key }, body,
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          const parts = data?.candidates?.[0]?.content?.parts ?? [];
          const text = parts.filter((p: { thought?: boolean }) => !p.thought).map((p: { text?: string }) => p.text ?? "").join("");
          if (!text) throw new Error(`Gemini returned an empty answer (${data?.candidates?.[0]?.finishReason ?? "no text"})`);
          if (model !== c.model) resolved[c.model] = model;
          return text;
        }
        lastError = `Gemini API error ${res.status}: ${data?.error?.message ?? "request failed"}`;
        if (!BUSY.has(res.status) && res.status !== 404) throw new Error(lastError);
        tried.push(model);
        if (BUSY.has(res.status) && attempt === 0) {
          await new Promise((r) => setTimeout(r, 1500)); // short spike in demand: retry once
          continue;
        }
        const next = (await geminiModels(c, ctrl.signal)).find((m) => !tried.includes(m));
        if (!next) break;
        model = next;
      }
      throw new Error(lastError || "Gemini model could not be resolved");
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
