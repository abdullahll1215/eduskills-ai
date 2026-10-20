from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator


class LoginIn(BaseModel):
    email: EmailStr
    password: str
    # Which sign-in page was used; a student account cannot use the staff page and vice versa.
    portal: Literal["student", "staff"] | None = None


class RegisterIn(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    student_number: str | None = Field(None, max_length=30)
    team_id: str | None = None


class ProfileIn(BaseModel):
    full_name: str | None = Field(None, min_length=2, max_length=120)
    mobile: str | None = Field(None, max_length=30)
    level: str | None = Field(None, max_length=30)
    department: str | None = Field(None, max_length=120)


class PasswordIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


class RatingsMixin(BaseModel):
    ratings: dict[str, int]

    @field_validator("ratings")
    @classmethod
    def check_scale(cls, v: dict[str, int]):
        for score in v.values():
            if not 1 <= int(score) <= 5:
                raise ValueError("Scores must be on the 1-5 Likert scale")
        return v


class SelfAssessmentIn(RatingsMixin):
    milestone_id: str
    evidence: str = Field("", max_length=4000)
    evidence_link: str | None = Field(None, max_length=500)


class PeerEvaluationIn(RatingsMixin):
    milestone_id: str | None = None  # defaults to the evaluated student's open evaluation period
    target_id: str
    comment: str = Field("", max_length=4000)  # optional: ratings alone are enough


class CommentCheckIn(BaseModel):
    comment: str = Field(max_length=4000)


class InstructorEvaluationIn(RatingsMixin):
    milestone_id: str
    target_id: str
    notes: str = Field("", max_length=4000)
    acknowledge_warnings: bool = False


class ModerationIn(BaseModel):
    action: str = Field(pattern="^(approve|remove)$")


class InterventionIn(BaseModel):
    student_id: str
    milestone_id: str | None = None
    reason: str = Field(min_length=5, max_length=2000)
    priority: str = Field("high", pattern="^(low|medium|high)$")


class InterventionUpdateIn(BaseModel):
    status: str = Field(pattern="^(open|acknowledged|resolved)$")
    advisor_notes: str | None = Field(None, max_length=4000)


class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=2000)


class WorkProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(None, max_length=5000)
    url: str | None = Field(None, max_length=500)
    stages: int = Field(1, ge=1, le=10)
    member_ids: list[str] = Field(default_factory=list, max_length=30)


class MembersIn(BaseModel):
    student_ids: list[str] = Field(min_length=1, max_length=30)


class ArtifactIn(BaseModel):
    milestone_id: str
    work_project_id: str | None = None
    stage: int | None = Field(None, ge=1, le=10)
    kind: str = Field(pattern="^(git_log|submission|link)$")
    title: str = Field(min_length=1, max_length=200)
    url: str | None = Field(None, max_length=500)
    git_log: str | None = Field(None, max_length=500_000)
    submitted_at: datetime | None = None


class UserIn(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    role: str = Field(pattern="^(student|instructor|advisor|admin)$")
    password: str | None = Field(None, min_length=8, max_length=128)
    student_number: str | None = None
    level: str | None = None
    mobile: str | None = None
    department: str | None = None
    is_active: bool = True


class ProjectIn(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    description: str | None = None
    # The course number students type to create a team in this course (4 to 10 digits).
    course_number: str | None = Field(None, pattern=r"^\d{4,10}$")
    instructor_id: str | None = None
    is_active: bool = True


class MilestoneIn(BaseModel):
    number: int = Field(ge=1, le=20)
    name: str = Field(min_length=1, max_length=120)
    description: str | None = None
    due_date: datetime | None = None
    status: str = Field("planned", pattern="^(planned|active|closed)$")


class TeamIn(BaseModel):
    team_name: str = Field(min_length=1, max_length=120)


class JoinTeamIn(BaseModel):
    code: str = Field(min_length=4, max_length=20)


class CreateTeamIn(BaseModel):
    course_code: str = Field(min_length=4, max_length=20)  # the course number
    team_name: str = Field(min_length=2, max_length=120)


class EnrollmentIn(BaseModel):
    user_id: str
    team_id: str | None = None


class ShowcaseIn(BaseModel):
    password: str | None = Field(None, min_length=8, max_length=128)


class SettingsIn(BaseModel):
    values: dict[str, str]


class CompetencyIn(BaseModel):
    skill_name: str = Field(min_length=2, max_length=80)
    description: str = ""
    rubric: dict[str, str] = {}


class ResourceIn(BaseModel):
    competency_id: str
    title: str = Field(min_length=2, max_length=200)
    provider: str = ""
    url: str = Field(min_length=4, max_length=500)
    kind: str = Field("article", pattern="^(article|video|course|exercise)$")
    duration: str = ""
