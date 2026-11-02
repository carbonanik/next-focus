from datetime import date as DateType, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class APIModel(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="ignore")


class AuthRequest(APIModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class UserResponse(APIModel):
    id: str
    email: str
    created_at: datetime


class TokenResponse(APIModel):
    access_token: str
    refresh_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int
    user: UserResponse


class RefreshRequest(APIModel):
    refresh_token: str = Field(min_length=20)


class GoalInput(APIModel):
    id: str | None = None
    title: str = Field(min_length=1, max_length=500)
    description: str = ""
    deadline: str = ""
    notes: str = ""
    status: Literal["ACTIVE", "INACTIVE", "DONE"] = "INACTIVE"
    priority: Literal["PRIMARY", "SECONDARY", "NORMAL"] = "NORMAL"
    collapsed: bool = False
    createdAt: datetime | None = None
    startedAt: datetime | None = None
    completedAt: datetime | None = None


class GoalResponse(APIModel):
    id: str
    title: str
    description: str
    deadline: str
    notes: str
    status: str
    priority: str
    collapsed: bool
    createdAt: datetime
    startedAt: datetime | None
    completedAt: datetime | None


class TaskInput(APIModel):
    id: str | None = None
    goalId: str | None = None
    title: str = Field(min_length=1, max_length=500)
    notes: str = ""
    status: Literal["BACKLOG", "READY", "NEXT", "TODAY", "IN_PROGRESS", "DONE", "DROPPED", "BLOCKED"] = "BACKLOG"
    estimatedMinutes: int | None = Field(default=None, ge=1, le=24 * 60)
    dependencyIds: list[str] = Field(default_factory=list)
    blockedReason: str = ""
    createdAt: datetime | None = None
    completedAt: datetime | None = None
    startedAt: datetime | None = None


class TaskResponse(APIModel):
    id: str
    goalId: str | None
    title: str
    notes: str
    status: str
    estimatedMinutes: int | None
    dependencyIds: list[str]
    blockedReason: str
    createdAt: datetime
    completedAt: datetime | None
    startedAt: datetime | None


class PlanInput(APIModel):
    date: DateType | None = None
    mainTaskId: str | None = None
    quickTaskIds: list[str] = Field(default_factory=list)

    @field_validator("quickTaskIds")
    @classmethod
    def max_quick_tasks(cls, value: list[str]) -> list[str]:
        if len(value) > 3:
            raise ValueError("TODAY can contain at most 3 quick tasks.")
        return list(dict.fromkeys(value))


class PlanResponse(APIModel):
    date: DateType
    mainTaskId: str | None
    quickTaskIds: list[str]


class JournalInput(APIModel):
    id: str | None = None
    date: DateType
    content: str = ""


class JournalResponse(APIModel):
    id: str
    date: DateType
    content: str
    createdAt: datetime
    updatedAt: datetime


class HabitInput(APIModel):
    id: str | None = None
    goalId: str | None = None
    name: str = Field(min_length=1, max_length=500)
    type: Literal["DO", "AVOID"]
    normal: str = ""
    minimum: str = ""
    schedule: dict[str, Any] = Field(default_factory=lambda: {"type": "DAILY", "days": [], "targetPerWeek": 1})
    status: Literal["ACTIVE", "PAUSED", "ARCHIVED"] = "ACTIVE"
    createdAt: datetime | None = None
    startedAt: datetime | None = None
    logs: dict[str, str] = Field(default_factory=dict)


class HabitResponse(APIModel):
    id: str
    goalId: str | None
    name: str
    type: str
    normal: str
    minimum: str
    schedule: dict[str, Any]
    status: str
    createdAt: datetime
    startedAt: datetime
    logs: dict[str, str]


class WorkspaceResponse(APIModel):
    goals: list[GoalResponse]
    tasks: list[TaskResponse]
    plans: dict[str, PlanResponse]
    journal: dict[str, JournalResponse]
    habits: list[HabitResponse]


class WorkspaceInput(APIModel):
    goals: list[GoalInput] = Field(default_factory=list)
    tasks: list[TaskInput] = Field(default_factory=list)
    plans: dict[str, PlanInput] = Field(default_factory=dict)
    journal: dict[str, JournalInput] = Field(default_factory=dict)
    habits: list[HabitInput] = Field(default_factory=list)
