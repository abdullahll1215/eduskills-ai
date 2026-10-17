"""Seeds the taxonomy, the learning-resources repository and a realistic demo cohort.

Run manually with:  python -m app.seed  (the API also seeds automatically on first start).
All demo accounts use the password: Password123!
"""
import random
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from .database import Base, SessionLocal, engine
from .models import (
    Artifact,
    Competency,
    Enrollment,
    Evaluation,
    EvalType,
    LearningResource,
    Milestone,
    Moderation,
    Project,
    Role,
    SkillRating,
    Team,
    User,
    utcnow,
)
from .security import encrypt, hash_password, reviewer_hash
from .services import ai_engine, artifacts, nlp

DEMO_PASSWORD = "Password123!"

COMPETENCIES = [
    ("COMMUNICATION", "Communication", "Clarity, frequency and effectiveness in exchanging information with the team.", {
        "1": "Rarely shares information; messages are unclear or missing.",
        "2": "Shares information when asked; clarity is inconsistent.",
        "3": "Communicates adequately in meetings and channels.",
        "4": "Communicates clearly and proactively; listens actively.",
        "5": "Exemplary: keeps everyone aligned, adapts message to audience, listens and confirms understanding.",
    }),
    ("LEADERSHIP", "Leadership", "Guiding colleagues, being proactive and helping resolve conflicts.", {
        "1": "Does not take initiative; avoids responsibility.",
        "2": "Takes initiative occasionally or tends to control rather than guide.",
        "3": "Leads tasks when needed and supports decisions.",
        "4": "Takes initiative, delegates fairly and motivates others.",
        "5": "Empowers the team, delegates effectively and resolves conflicts constructively.",
    }),
    ("ADAPTABILITY", "Adaptability", "Resilience and flexibility to changing requirements, critical feedback or unexpected challenges.", {
        "1": "Resists change and reacts defensively to feedback.",
        "2": "Accepts change slowly; struggles with critical feedback.",
        "3": "Adjusts to change with some support.",
        "4": "Adapts quickly and uses feedback to improve.",
        "5": "Thrives on change, seeks feedback and helps others adapt.",
    }),
    ("COLLABORATION", "Collaboration", "Teamwork, fair contribution and a positive, inclusive group dynamic.", {
        "1": "Works in isolation; contribution is minimal.",
        "2": "Contributes unevenly; limited support for teammates.",
        "3": "Contributes a fair share and cooperates.",
        "4": "Actively supports teammates and shares workload.",
        "5": "Builds an inclusive team culture and lifts everyone's work.",
    }),
    ("PROBLEM_SOLVING", "Problem Solving", "Recognizing challenges, critical thinking and producing effective solutions.", {
        "1": "Struggles to identify problems; depends on others for solutions.",
        "2": "Identifies problems but solutions are incomplete.",
        "3": "Solves routine problems independently.",
        "4": "Analyzes problems well and proposes effective solutions.",
        "5": "Solves complex problems creatively and anticipates issues.",
    }),
]

RESOURCES = {
    "COMMUNICATION": [
        ("Improving Communication Skills", "Coursera", "https://www.coursera.org/search?query=communication%20skills", "course", "~10 hours"),
        ("Active Listening techniques", "MindTools", "https://www.mindtools.com/search?q=active%20listening", "article", "Article read"),
        ("How to speak so that people want to listen", "TED", "https://www.ted.com/search?q=how+to+speak+so+that+people+want+to+listen", "video", "10 min"),
    ],
    "LEADERSHIP": [
        ("Agile Leadership", "Coursera", "https://www.coursera.org/search?query=agile%20leadership", "course", "Estimated time: 2 hours"),
        ("The Art of Delegation", "Harvard Business Review", "https://hbr.org/search?term=delegation", "article", "Article read"),
        ("Leading without micromanaging", "MindTools", "https://www.mindtools.com/search?q=micromanagement", "article", "Article read"),
    ],
    "ADAPTABILITY": [
        ("Developing a Growth Mindset", "Coursera", "https://www.coursera.org/search?query=growth%20mindset", "course", "~4 hours"),
        ("How to receive feedback well", "Harvard Business Review", "https://hbr.org/search?term=receiving+feedback", "article", "Article read"),
    ],
    "COLLABORATION": [
        ("Teamwork Skills: Communicating Effectively in Groups", "Coursera", "https://www.coursera.org/search?query=teamwork%20skills", "course", "~12 hours"),
        ("Psychological safety in teams", "Harvard Business Review", "https://hbr.org/search?term=psychological+safety", "article", "Article read"),
    ],
    "PROBLEM_SOLVING": [
        ("Creative Problem Solving", "Coursera", "https://www.coursera.org/search?query=creative%20problem%20solving", "course", "~8 hours"),
        ("5 Whys root-cause analysis", "MindTools", "https://www.mindtools.com/search?q=5%20whys", "exercise", "30 min exercise"),
    ],
}

SKILLS = [c[0] for c in COMPETENCIES]

# true (externally observed) level per skill, self-bias per skill and growth per milestone
STUDENTS = {
    "Team Alpha": [
        ("Khalid S.", "khalid@student.kfu.edu.sa", "222435057", [4.0, 3.0, 3.6, 3.4, 4.2], [0.5, 2.2, 0.6, 1.0, 0.4], 0.35),
        ("Nasser M.", "nasser@student.kfu.edu.sa", "222447260", [2.6, 2.3, 2.6, 2.4, 2.8], [1.4, 1.6, 1.3, 1.9, 1.2], 0.25),
        ("Saad R.", "saad@student.kfu.edu.sa", "222433529", [2.0, 1.6, 2.0, 1.7, 2.2], [2.4, 2.6, 2.2, 2.6, 2.0], 0.15),
        ("Ali H.", "ali@student.kfu.edu.sa", "221427792", [4.4, 4.0, 4.3, 4.6, 4.2], [0.1, 0.4, -0.2, 0.0, 0.3], 0.1),
    ],
    "Team Beta": [
        ("Fahad A.", "fahad@student.kfu.edu.sa", "222401118", [3.6, 3.8, 3.2, 3.9, 3.4], [-1.6, -1.8, -0.4, -1.0, -0.6], 0.2),
        ("Omar K.", "omar@student.kfu.edu.sa", "222401119", [3.2, 2.6, 3.4, 3.0, 3.8], [0.4, 1.2, 0.2, 0.6, 0.3], 0.3),
        ("Yousef T.", "yousef@student.kfu.edu.sa", "222401120", [3.8, 3.4, 4.0, 3.6, 3.2], [0.2, 0.5, 0.0, 0.3, 1.0], 0.2),
        ("Majed B.", "majed@student.kfu.edu.sa", "222401121", [3.0, 3.2, 2.8, 3.4, 3.0], [0.8, 0.6, 1.8, 0.4, 0.5], 0.3),
    ],
}

POSITIVE_COMMENTS = {
    "COMMUNICATION": ["{n} explains technical ideas clearly in our meetings.", "{n} always sends clear updates on the group chat."],
    "LEADERSHIP": ["{n} takes initiative and keeps the team organized.", "{n} coordinates tasks well and motivates everyone."],
    "ADAPTABILITY": ["{n} adapts quickly when requirements change.", "{n} accepts feedback and adjusts the work fast."],
    "COLLABORATION": ["{n} is supportive and helps teammates with their tasks.", "{n} shares the workload fairly with the team."],
    "PROBLEM_SOLVING": ["{n} finds creative solutions when we are stuck.", "{n} analyzes problems carefully before coding."],
}
NEGATIVE_COMMENTS = {
    "COMMUNICATION": ["{n} rarely replies to messages, so we often wait for updates.", "{n}'s updates are unclear and we miss information."],
    "LEADERSHIP": ["{n} takes over tasks without asking the team.", "It is hard to contribute when decisions are already made by {n}."],
    "ADAPTABILITY": ["{n} struggles to accept alternative ideas and gets defensive with feedback.", "{n} finds it difficult when the plan changes."],
    "COLLABORATION": ["{n} works alone and does not share progress with the team.", "{n} missed several team meetings this milestone."],
    "PROBLEM_SOLVING": ["{n} needs help to break problems into steps.", "{n} gets stuck on issues and does not ask for help early."],
}


def _clip(x: float) -> int:
    return max(1, min(5, round(x)))


def seed_reference(db: Session) -> dict[str, Competency]:
    comps = {c.code: c for c in db.scalars(select(Competency))}
    for i, (code, name, desc, rubric) in enumerate(COMPETENCIES):
        if code not in comps:
            comps[code] = Competency(code=code, skill_name=name, description=desc, rubric=rubric, sort_order=i)
            db.add(comps[code])
    db.flush()
    if not db.scalar(select(LearningResource.id)):
        for code, items in RESOURCES.items():
            for title, provider, url, kind, duration in items:
                db.add(LearningResource(competency_id=comps[code].id, title=title, provider=provider, url=url, kind=kind, duration=duration))
    return comps


def _user(db, name, email, role, **kw) -> User:
    u = User(full_name=name, email=email, role=role, password_hash=hash_password(DEMO_PASSWORD), **kw)
    db.add(u)
    return u


def _evaluation(db, project, m, target, eval_type, key, scores, comps, when, evaluator=None, comment=None, notes=None):
    ev = Evaluation(
        project_id=project.id, milestone_id=m.id, evaluator_id=evaluator, target_id=target.id, eval_type=eval_type,
        reviewer_key=key, comment_enc=encrypt(comment), notes_enc=encrypt(notes), created_at=when,
        sentiment=nlp.sentiment(comment) if comment and eval_type == EvalType.PEER.value else None,
    )
    ev.ratings = [SkillRating(competency_id=comps[code].id, score=scores[i]) for i, code in enumerate(SKILLS)]
    db.add(ev)
    return ev


def _peer_comment(rng: random.Random, name: str, true_levels: list[float]) -> str:
    first = name.split()[0]
    order = sorted(range(len(SKILLS)), key=lambda i: true_levels[i])
    weak, strong = SKILLS[order[0]], SKILLS[order[-1]]
    parts = [rng.choice(POSITIVE_COMMENTS[strong]).format(n=first)]
    if true_levels[order[0]] < 3.6:
        parts.append(rng.choice(NEGATIVE_COMMENTS[weak]).format(n=first))
    return " ".join(parts)


def seed_demo(db: Session):
    comps = seed_reference(db)
    rng = random.Random(2026)

    _user(db, "System Admin", "admin@kfu.edu.sa", Role.ADMIN.value, department="IT Services")
    instructor = _user(db, "Dr. Ahmed Alyahya", "ahmed@kfu.edu.sa", Role.INSTRUCTOR.value, department="Information Systems")
    _user(db, "Dr. Abdullah Alaulamie", "abdullah@kfu.edu.sa", Role.INSTRUCTOR.value, department="Information Systems")
    _user(db, "Ms. Noura Advisor", "advisor@kfu.edu.sa", Role.ADVISOR.value, department="Student Affairs")
    db.flush()

    now = utcnow()
    project = Project(
        title="Graduation Project - IS 2026",
        description="Undergraduate capstone project (CCSIT, King Faisal University). 360° soft-skills assessment per milestone.",
        instructor_id=instructor.id,
    )
    db.add(project)
    db.flush()
    milestones = [
        Milestone(project_id=project.id, number=1, name="Requirements", description="Proposal & requirements analysis", due_date=now - timedelta(days=70), status="closed"),
        Milestone(project_id=project.id, number=2, name="Design", description="System design & diagrams", due_date=now - timedelta(days=21), status="closed"),
        Milestone(project_id=project.id, number=3, name="Implementation", description="Implementation & testing", due_date=now + timedelta(days=24), status="active"),
    ]
    db.add_all(milestones)
    db.flush()

    roster: list[tuple[User, list[float], list[float], float, str]] = []
    for team_name, members in STUDENTS.items():
        team = Team(project_id=project.id, team_name=team_name)
        db.add(team)
        db.flush()
        for name, email, number, true, bias, growth in members:
            u = _user(db, name, email, Role.STUDENT.value, student_number=number, level="Level 8", department="Information Systems", mobile="05" + number[-8:])
            db.flush()
            db.add(Enrollment(user_id=u.id, project_id=project.id, team_id=team.id))
            roster.append((u, true, bias, growth, team_name))
    db.flush()

    def levels(true, growth, idx):
        return [t + growth * idx for t in true]

    def self_scores(true, bias, growth, idx):
        # bias shrinks as students become more self-aware
        return [_clip(t + growth * idx + b * (1 - 0.18 * idx)) for t, b in zip(true, bias)]

    # Milestones 1 and 2: complete 360° cycle for everyone
    for idx, m in enumerate(milestones[:2]):
        when = m.due_date + timedelta(days=2)
        for u, true, bias, growth, team_name in roster:
            lv = levels(true, growth, idx)
            _evaluation(db, project, m, u, EvalType.SELF.value, EvalType.SELF.value, self_scores(true, bias, growth, idx), comps, when,
                        evaluator=u.id, comment="I contributed to the requirements and coordinated several tasks." if idx == 0 else "I led parts of the design and helped teammates.")
            mates = [r for r in roster if r[4] == team_name and r[0].id != u.id]
            for reviewer, *_ in mates:
                scores = [_clip(x + rng.choice([-0.6, -0.3, 0, 0, 0.3, 0.6])) for x in lv]
                _evaluation(db, project, m, u, EvalType.PEER.value, reviewer_hash(reviewer.id, project.id), scores, comps,
                            when + timedelta(hours=rng.randint(1, 30)), comment=_peer_comment(rng, u.full_name, lv))
            inst = [_clip(x + rng.choice([-0.3, 0, 0, 0.3])) for x in lv]
            _evaluation(db, project, m, u, EvalType.INSTRUCTOR.value, EvalType.INSTRUCTOR.value, inst, comps, when + timedelta(days=3),
                        evaluator=instructor.id, notes="Reviewed commit history and meeting minutes for this milestone.")
        db.flush()
        for u, *_ in roster:
            rep = ai_engine.generate_report(db, u.id, m.id)
            if rep:
                rep.generated_at = when + timedelta(days=3, hours=1)
        db.flush()

    # Milestone 3 (active): partially completed so every workflow can be demonstrated
    m3 = milestones[2]
    when = now - timedelta(days=2)
    alpha = [r for r in roster if r[4] == "Team Alpha"]
    beta = [r for r in roster if r[4] == "Team Beta"]
    for u, true, bias, growth, _ in alpha[1:] + beta:  # Khalid has NOT done the M3 self-assessment yet
        _evaluation(db, project, m3, u, EvalType.SELF.value, EvalType.SELF.value, self_scores(true, bias, growth, 2), comps, when, evaluator=u.id,
                    comment="Implemented my modules and supported integration.")
    # Team Beta: full peer coverage -> ready for instructor evaluation
    for u, true, bias, growth, _ in beta:
        lv = levels(true, growth, 2)
        for reviewer, *_ in [r for r in beta if r[0].id != u.id]:
            scores = [_clip(x + rng.choice([-0.3, 0, 0, 0.3])) for x in lv]
            _evaluation(db, project, m3, u, EvalType.PEER.value, reviewer_hash(reviewer.id, project.id), scores, comps, when + timedelta(hours=5),
                        comment=_peer_comment(rng, u.full_name, lv))
    # Instructor already evaluated two Team Beta students
    for u, true, bias, growth, _ in beta[:2]:
        lv = levels(true, growth, 2)
        _evaluation(db, project, m3, u, EvalType.INSTRUCTOR.value, EvalType.INSTRUCTOR.value, [_clip(x) for x in lv], comps, when + timedelta(days=1),
                    evaluator=instructor.id, notes="Consistent contribution in the implementation sprint.")
    # Team Alpha: some peer evaluations, including one comment flagged by the AI content filter
    nasser, saad, ali = alpha[1][0], alpha[2][0], alpha[3][0]
    for target, reviewer in ((saad, ali), (nasser, ali), (ali, nasser)):
        t = next(r for r in alpha if r[0].id == target.id)
        lv = levels(t[1], t[3], 2)
        _evaluation(db, project, m3, target, EvalType.PEER.value, reviewer_hash(reviewer.id, project.id), [_clip(x) for x in lv], comps, when + timedelta(hours=8),
                    comment=_peer_comment(rng, target.full_name, lv))
    flagged_text = "Saad is completely useless and ruined our database schema intentionally."
    verdict = nlp.content_filter(flagged_text)
    t = next(r for r in alpha if r[0].id == saad.id)
    ev = _evaluation(db, project, m3, saad, EvalType.PEER.value, reviewer_hash(nasser.id, project.id), [2, 1, 2, 2, 2], comps, when + timedelta(hours=9), comment=flagged_text)
    ev.is_flagged, ev.flag_reason, ev.moderation_status = True, verdict.reason or "Unconstructive / Personal Attack", Moderation.PENDING.value
    db.flush()
    for u, *_ in beta[:2]:
        ai_engine.generate_report(db, u.id, m3.id)

    # Artifact-informed behavioral markers for Khalid
    khalid = alpha[0][0]
    for m, offset in ((milestones[0], 0), (milestones[1], 0)):
        start = m.due_date - timedelta(days=20)
        stamps = sorted(start + timedelta(days=rng.uniform(0, 20 if offset == 0 else 19), hours=rng.randint(8, 22)) for _ in range(rng.randint(14, 26)))
        log = "\n".join(f"{rng.getrandbits(40):010x}|Khalid S.|{s.isoformat()}|Update module" for s in stamps)
        db.add(Artifact(student_id=khalid.id, project_id=project.id, milestone_id=m.id, kind="git_log", title=f"GitHub commits M{m.number}",
                        url="https://github.com/", metrics=artifacts.commit_indicators(artifacts.parse_git_log(log), m.due_date)))
        db.add(Artifact(student_id=khalid.id, project_id=project.id, milestone_id=m.id, kind="submission", title=f"M{m.number} deliverable",
                        metrics=artifacts.submission_indicators(m.due_date - timedelta(hours=rng.randint(2, 40)), m.due_date)))
    db.flush()
    return project


def run(db: Session | None = None) -> bool:
    """Idempotent: seeds reference data always and the demo cohort only on an empty database."""
    own = db is None
    db = db or SessionLocal()
    try:
        if db.scalar(select(User.id).limit(1)):
            seed_reference(db)
            db.commit()
            return False
        seed_demo(db)
        db.commit()
        return True
    finally:
        if own:
            db.close()


if __name__ == "__main__":
    Base.metadata.create_all(engine)
    created = run()
    print("Demo data created." if created else "Database already contains data; reference data verified.")
