# EduSkills AI — AI-Driven Soft Skills Assessment and Development System

نظام ذكي لتقييم وتطوير المهارات الناعمة لطلاب البكالوريوس — مشروع تخرج، كلية علوم الحاسب وتقنية المعلومات، جامعة الملك فيصل.

The system combines **self, anonymous peer and instructor evaluations (360°)**, computes a weighted
**Blind-Spot (Johari Window) model**, and uses **Generative AI** to produce personalized developmental reports,
longitudinal growth dashboards and a downloadable **Skills Passport**.

---

## التشغيل السريع (Quick start)

### المتطلبات
- Python 3.11+
- Node.js 18+

### 1) الخادم (Backend — FastAPI)
```bash
cd backend
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env               # optional: add AI_API_KEY here
uvicorn app.main:app --reload --port 8000
```
On first start the database is created (SQLite in `backend/data/`) and filled with a demo cohort.
API documentation (Swagger): http://localhost:8000/docs

### 2) الواجهة (Frontend — React)
```bash
cd frontend
npm install
npm run dev
```
Open http://localhost:5173

> Production mode: run `npm run build` in `frontend/`; the backend then serves the built app at http://localhost:8000.
> Docker: `docker compose up --build` (app + PostgreSQL).

### النشر على Vercel (Deploy to Vercel)
The repository is ready for Vercel (`vercel.json`, `api/index.py`, `requirements.txt`):
the React app is served as static files and the FastAPI backend runs as a Python serverless function at `/api/*`.

1. On vercel.com: **Add New → Project → Import** this GitHub repository → **Deploy** (no settings to change).
2. In the project: **Storage → Create Database → Neon (Postgres)** and connect it to the project
   (this sets `DATABASE_URL` automatically). Without it, data lives in a temporary SQLite file and resets.
3. **Settings → Environment Variables**: add `AI_API_KEY` = your Google AI Studio key (Gemini for all users).
   Optional: `SECRET_KEY`, `ANONYMIZATION_SALT` (otherwise derived privately from the database credentials).
4. **Deployments → Redeploy**. Every later push to `main` deploys automatically.

### الحسابات التجريبية (Demo accounts) — password: `Password123!`
| Role | Email |
|---|---|
| Student (Khalid S.) | khalid@student.kfu.edu.sa |
| Other students | nasser@, saad@, ali@, fahad@, omar@, yousef@, majed@ `student.kfu.edu.sa` |
| Instructor | ahmed@kfu.edu.sa |
| Student Advisor | advisor@kfu.edu.sa |
| System Admin | admin@kfu.edu.sa |

Demo scenario: M1 and M2 are complete (reports already generated). M3 is **open**: Khalid has not submitted his
self-assessment yet, Team Beta is ready for instructor evaluation, and a toxic peer comment is waiting in the moderation queue.

### تفعيل الذكاء الاصطناعي (Enabling Generative AI)
Without an API key the system runs fully with a **local fallback engine** (UC-05 E4a).
To enable GenAI narratives, either set `AI_API_KEY` in `backend/.env`, or log in as admin →
**Configuration & AI** → paste the key → **Test connection**. Any OpenAI-compatible endpoint works
(OpenAI, Azure OpenAI, local servers such as Ollama/LM Studio) by changing the base URL and model.

### الاختبارات (Tests)
```bash
cd backend && pytest -q        # 26 tests: scoring model, NLP filter, and UC-01..UC-08 end-to-end
```

---

## ربط المتطلبات بالتنفيذ (Proposal → implementation)

| Proposal item | Implementation |
|---|---|
| **UC-01** Submit Self-Assessment (5-skill rubric, validation, timestamp, lock, 360° check) | `routers/student.py` → `submit_self_assessment`; UI `pages/student/SelfAssessment.tsx` |
| **UC-02** Anonymous Peer Evaluation (same team, ≥3 peers, no self-review, salted SHA-256, AI toxicity filter, encryption) | `submit_peer_evaluation`, `security.reviewer_hash`, `services/nlp.content_filter`, `ai_engine.moderate`; UI `PeerEvaluation.tsx` |
| **UC-03** Instructor Evaluation (preconditions, 60% weight, warning if gap > 2.0, lock, trigger analytics) | `routers/instructor.py` → `submit_instructor_evaluation`; UI `StudentReview.tsx` |
| **UC-04** Blind-Spot Detection: `External = 0.6·Inst + 0.4·Peer`, `δ = |External − Self|`, ≤1.5 aligned / ≤2.0 moderate / >2.0 critical | `services/analytics.py` (stored in `delta_metrics`) |
| **UC-05** AI Developmental Report (NLP pipeline, prompt engineering, GenAI API, resources DB, JSON report, notification, fallback template) | `services/ai_engine.py`, `services/nlp.py`; UI `GrowthReport.tsx` |
| **UC-06** Longitudinal dashboard, radar chart, blind-spot trend line, Skills Passport PDF (CSV fallback) | `student.dashboard`, `services/passport.py`; UI `Dashboard.tsx` |
| **UC-07** Instructor Analytics Console (cohort status, at-risk groups, interventions for advisor, moderation, audit trail) | `instructor.overview`, `moderate`, `raise_intervention`; UI `Console.tsx`, `advisor/Interventions.tsx` |
| **UC-08** System configuration (rubric, AI keys & parameters, connection test, retention purge, backup + restore verification, usage & audit reports) | `routers/admin.py`, `services/backup.py`, `services/settings_store.py`; UI `pages/admin/*` |
| Artifact-informed behavioral markers (commit logs, submission timestamps) | `services/artifacts.py`; UI `Artifacts.tsx` |
| System chatbot (queries about feedback, real-time advice, archived history) | `/api/chat` in `routers/student.py`; UI `Coach.tsx` (Arabic & English) |
| Notifications (new feedback, AI insights, recommended resources) | `notifications` table, bell in `Layout.tsx` |
| Security NFRs: bcrypt passwords, JWT, RBAC, encrypted feedback (Fernet), anonymization | `security.py`, `deps.py` |
| Data dictionary (users, projects, teams, enrollments, competencies, evaluations, skill_ratings, ai_reports, delta_metrics) | `models.py` (same tables + supporting tables) |

## البنية (Architecture)
```
frontend/  React 18 + TypeScript + Tailwind + Recharts   (Presentation layer)
backend/
  app/routers/    REST API per role (student, instructor, advisor, admin, projects)
  app/services/   analytics (scoring), ai_engine (GenAI + fallback), nlp, artifacts,
                  passport (PDF/CSV), backup, settings_store, audit
  app/models.py   SQLAlchemy ORM (SQLite / PostgreSQL)
  tests/          pytest suite
```

### Design decisions worth noting
- **Thresholds:** the proposal text uses δ > 1.5 as "blind spot", and UC-04 splits it into Moderate (1.5–2.0) and Critical (> 2.0). The system follows UC-04; all thresholds and weights are editable by the admin.
- **Anonymity:** peer evaluations never store the reviewer id — only a salted, project-scoped SHA-256 hash (used to prevent duplicates). Students see comments only after ≥3 reviews.
- **Flagged comments:** the ratings are kept, but the comment is hidden from the student and from the AI until the instructor approves it.
- **Anchoring bias:** the instructor sees peer averages but not the student's self-ratings until the instructor's evaluation is submitted.
