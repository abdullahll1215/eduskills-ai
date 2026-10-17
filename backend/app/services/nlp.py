"""Lightweight local NLP pipeline (UC-05 step 2 and UC-02 step 5).

* sentiment scoring (lexicon based, English + Arabic)
* behavioral entity extraction: maps sentences to the five soft-skill dimensions
* AI content filter: toxicity / personal-attack detection and constructiveness check

It runs fully offline so the platform keeps working when the external GenAI API is unavailable.
When an API is configured, ai_engine.moderate() adds a model-based second opinion.
"""
import re
from dataclasses import dataclass, field

POSITIVE = {
    "great", "good", "excellent", "helpful", "clear", "organized", "organised", "reliable", "proactive",
    "supportive", "creative", "strong", "responsive", "punctual", "respectful", "collaborative", "efficient",
    "flexible", "patient", "motivated", "listens", "insightful", "thorough", "dedicated", "improved",
    "ممتاز", "رائع", "متعاون", "منظم", "واضح", "مبدع", "ملتزم", "مفيد", "جيد", "محترم",
}
NEGATIVE = {
    "late", "struggles", "struggle", "rarely", "never", "ignores", "ignored", "unclear", "confusing", "slow",
    "missed", "misses", "difficult", "rigid", "defensive", "interrupts", "dominates", "micromanages",
    "micromanagement", "absent", "unresponsive", "poor", "weak", "disorganized", "hard", "conflict",
    "takes over", "without asking", "doesn't", "does not", "didn't", "fails",
    "متأخر", "ضعيف", "غائب", "لا يتواصل", "يتجاهل", "صعب",
}
NEGATORS = {"not", "never", "no", "hardly", "لا", "ليس", "لم"}

SKILL_KEYWORDS: dict[str, list[str]] = {
    "COMMUNICATION": [
        "communicat", "explain", "present", "listen", "message", "reply", "respond", "update", "clear",
        "discuss", "meeting", "express", "write", "email", "تواصل", "شرح", "عرض", "يستمع",
    ],
    "LEADERSHIP": [
        "lead", "leader", "initiative", "decision", "delegat", "organiz", "organis", "coordinat", "guide",
        "motivat", "takes over", "manage", "direction", "قياد", "مبادر", "قرار", "ينظم",
    ],
    "ADAPTABILITY": [
        "adapt", "flexib", "change", "feedback", "criticism", "learn", "adjust", "resilien", "pressure",
        "new tool", "pivot", "مرون", "تكيف", "يتقبل", "تغيير",
    ],
    "COLLABORATION": [
        "team", "collaborat", "help", "support", "share", "contribut", "together", "cooperat", "workload",
        "pair", "inclusive", "فريق", "تعاون", "يساعد", "مشارك",
    ],
    "PROBLEM_SOLVING": [
        "problem", "solve", "solution", "debug", "fix", "analy", "creative", "idea", "issue", "logic",
        "critical think", "approach", "حل", "مشكل", "تحليل", "فكرة",
    ],
}

# Personal attacks, insults and hostile language (UC-02 E5a). Kept intentionally conservative.
TOXIC_TERMS = {
    "useless", "stupid", "idiot", "dumb", "lazy", "worthless", "incompetent", "pathetic", "hate", "moron",
    "loser", "trash", "garbage", "shut up", "disgusting", "ruined", "intentionally", "sabotag", "fool",
    "غبي", "فاشل", "كسول", "حمار", "تافه", "أكرهه", "اكرهه", "زبالة", "سخيف", "متخلف",
}
BIAS_PATTERNS = [
    r"\bbecause (he|she|they) (is|are) (a )?(girl|boy|woman|man|foreigner|saudi|non-saudi)\b",
    r"\b(all|those) (girls|boys|women|men|foreigners) (are|always)\b",
]

_SENT_SPLIT = re.compile(r"(?<=[.!?؟\n])\s+")
_WORD = re.compile(r"[\w']+", re.UNICODE)


@dataclass
class FilterResult:
    is_toxic: bool
    reason: str | None
    is_constructive: bool
    hints: list[str] = field(default_factory=list)


def sentiment(text: str) -> float:
    """Returns a score in [-1, 1]."""
    if not text:
        return 0.0
    low = text.lower()
    words = _WORD.findall(low)
    score = 0
    for i, w in enumerate(words):
        polarity = (w in POSITIVE) - (w in NEGATIVE)
        if polarity and i > 0 and words[i - 1] in NEGATORS:
            polarity = -polarity
        score += polarity
    for phrase in (p for p in NEGATIVE if " " in p):
        if phrase in low:
            score -= 1
    hits = sum(1 for w in words if w in POSITIVE or w in NEGATIVE) or 1
    return max(-1.0, min(1.0, score / hits))


def split_sentences(text: str) -> list[str]:
    return [s.strip() for s in _SENT_SPLIT.split(text or "") if len(s.strip()) > 3]


def map_skills(text: str) -> dict[str, list[str]]:
    """Behavioral entity extraction: sentence -> skill dimension(s)."""
    out: dict[str, list[str]] = {}
    for sentence in split_sentences(text):
        low = sentence.lower()
        for code, keys in SKILL_KEYWORDS.items():
            if any(k in low for k in keys):
                out.setdefault(code, []).append(sentence)
    return out


def analyze_comments(comments: list[str]) -> dict:
    """Aggregates a set of comments into themes per skill with sentiment."""
    themes: dict[str, dict] = {}
    for c in comments:
        for code, sentences in map_skills(c).items():
            t = themes.setdefault(code, {"mentions": 0, "positive": [], "negative": []})
            for s in sentences:
                t["mentions"] += 1
                (t["positive"] if sentiment(s) >= 0 else t["negative"]).append(s)
    overall = sum(sentiment(c) for c in comments) / len(comments) if comments else 0.0
    return {"overall_sentiment": round(overall, 2), "themes": themes}


def content_filter(text: str) -> FilterResult:
    """AI content filter for peer comments: toxicity, bias and constructiveness."""
    low = (text or "").lower()
    for term in TOXIC_TERMS:
        if term in low:
            return FilterResult(True, "Unconstructive / Personal Attack", False, [f"Avoid hostile wording ('{term}')."])
    for pat in BIAS_PATTERNS:
        if re.search(pat, low):
            return FilterResult(True, "Potential bias / Stereotyping", False, ["Focus on observable behavior, not identity."])
    hints = []
    words = _WORD.findall(low)
    if len(words) < 8:
        hints.append("Add a concrete example (at least one full sentence).")
    if not map_skills(text):
        hints.append("Mention a specific behavior (communication, leadership, teamwork...).")
    if sentiment(text) < -0.6 and not any(k in low for k in ("could", "should", "suggest", "try", "would", "يمكن", "أقترح")):
        hints.append("Balance criticism with a suggestion for improvement.")
    return FilterResult(False, None, not hints, hints)
