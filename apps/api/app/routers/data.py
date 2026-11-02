from datetime import date, datetime, timezone
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..dependencies import current_user
from ..models import DailyPlan, Goal, Habit, JournalEntry, Task, User
from ..schemas import (
    GoalInput,
    GoalResponse,
    HabitInput,
    HabitResponse,
    JournalInput,
    JournalResponse,
    PlanInput,
    PlanResponse,
    TaskInput,
    TaskResponse,
    WorkspaceInput,
    WorkspaceResponse,
)

router = APIRouter(prefix="/api/v1", tags=["workspace"])


def now() -> datetime:
    return datetime.now(timezone.utc)


def goal_dict(goal: Goal) -> dict:
    return {
        "id": goal.id, "title": goal.title, "description": goal.description, "deadline": goal.deadline,
        "notes": goal.notes, "status": goal.status, "priority": goal.priority, "collapsed": goal.collapsed,
        "createdAt": goal.created_at, "startedAt": goal.started_at, "completedAt": goal.completed_at,
    }


def task_dict(task: Task) -> dict:
    return {
        "id": task.id, "goalId": task.goal_id, "title": task.title, "notes": task.notes,
        "status": task.status, "estimatedMinutes": task.estimated_minutes,
        "dependencyIds": task.dependency_ids or [], "blockedReason": task.blocked_reason,
        "createdAt": task.created_at, "completedAt": task.completed_at, "startedAt": task.started_at,
    }


def habit_dict(habit: Habit) -> dict:
    return {
        "id": habit.id, "goalId": habit.goal_id, "name": habit.name, "type": habit.type,
        "normal": habit.normal, "minimum": habit.minimum, "schedule": habit.schedule,
        "status": habit.status, "createdAt": habit.created_at, "startedAt": habit.started_at,
        "logs": habit.logs or {},
    }


async def get_workspace(db: AsyncSession, user: User) -> WorkspaceResponse:
    goals = (await db.execute(select(Goal).where(Goal.user_id == user.id))).scalars().all()
    tasks = (await db.execute(select(Task).where(Task.user_id == user.id))).scalars().all()
    plans = (await db.execute(select(DailyPlan).where(DailyPlan.user_id == user.id))).scalars().all()
    journal = (await db.execute(select(JournalEntry).where(JournalEntry.user_id == user.id))).scalars().all()
    habits = (await db.execute(select(Habit).where(Habit.user_id == user.id))).scalars().all()

    plan_map = {plan.date.isoformat(): PlanResponse(
        date=plan.date, mainTaskId=plan.main_task_id, quickTaskIds=plan.quick_task_ids or []
    ) for plan in plans}
    journal_map = {entry.date.isoformat(): JournalResponse(
        id=entry.id, date=entry.date, content=entry.content, createdAt=entry.created_at, updatedAt=entry.updated_at
    ) for entry in journal}

    return WorkspaceResponse(
        goals=[GoalResponse(**goal_dict(goal)) for goal in goals],
        tasks=[TaskResponse(**task_dict(task)) for task in tasks],
        plans=plan_map,
        journal=journal_map,
        habits=[HabitResponse(**habit_dict(habit)) for habit in habits],
    )


@router.get("/workspace", response_model=WorkspaceResponse)
async def read_workspace(db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    return await get_workspace(db, user)


@router.put("/workspace", response_model=WorkspaceResponse)
async def replace_workspace(
    payload: WorkspaceInput,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
):
    for model in (DailyPlan, Habit, JournalEntry, Task, Goal):
        await db.execute(delete(model).where(model.user_id == user.id))

    goal_ids = {item.id for item in payload.goals if item.id}
    for item in payload.goals:
        item_id = item.id or f"goal_{uuid4().hex}"
        goal_ids.add(item_id)
        db.add(Goal(
            id=item_id, user_id=user.id, title=item.title.strip(), description=item.description.strip(),
            deadline=item.deadline, notes=item.notes.strip(), status=item.status, priority=item.priority,
            collapsed=item.collapsed, created_at=item.createdAt or now(),
            started_at=item.startedAt, completed_at=item.completedAt,
        ))
    await db.flush()

    for item in payload.tasks:
        item_id = item.id or f"task_{uuid4().hex}"
        if item.goalId and item.goalId not in goal_ids:
            raise HTTPException(status_code=422, detail=f"Unknown goalId: {item.goalId}")
        db.add(Task(
            id=item_id, user_id=user.id, goal_id=item.goalId, title=item.title.strip(), notes=item.notes.strip(),
            status=item.status, estimated_minutes=item.estimatedMinutes, dependency_ids=item.dependencyIds,
            blocked_reason=item.blockedReason, created_at=item.createdAt or now(),
            completed_at=item.completedAt, started_at=item.startedAt,
        ))
    await db.flush()

    task_ids = set(payload.tasks[i].id or f"task_{i}" for i in range(len(payload.tasks)))
    for item in payload.tasks:
        if item.id is None:
            continue
        task_ids.add(item.id)

    for plan_date, item in payload.plans.items():
        parsed_date = date.fromisoformat(plan_date)
        db.add(DailyPlan(
            user_id=user.id, date=parsed_date, main_task_id=item.mainTaskId,
            quick_task_ids=item.quickTaskIds,
        ))

    for entry_date, item in payload.journal.items():
        parsed_date = date.fromisoformat(entry_date)
        db.add(JournalEntry(
            id=item.id or f"journal_{uuid4().hex}", user_id=user.id, date=parsed_date or item.date,
            content=item.content, created_at=now(), updated_at=now(),
        ))

    habit_ids = set()
    for item in payload.habits:
        item_id = item.id or f"habit_{uuid4().hex}"
        habit_ids.add(item_id)
        db.add(Habit(
            id=item_id, user_id=user.id, goal_id=item.goalId, name=item.name.strip(),
            type=item.type, normal=item.normal.strip(), minimum=item.minimum.strip(),
            schedule=item.schedule, status=item.status, created_at=item.createdAt or now(),
            started_at=item.startedAt or now(), logs=item.logs,
        ))

    await db.commit()
    return await get_workspace(db, user)


@router.get("/goals", response_model=list[GoalResponse])
async def list_goals(db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    rows = (await db.execute(select(Goal).where(Goal.user_id == user.id).order_by(Goal.created_at))).scalars().all()
    return [GoalResponse(**goal_dict(row)) for row in rows]


@router.post("/goals", response_model=GoalResponse, status_code=201)
async def create_goal(payload: GoalInput, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    if not payload.title.strip():
        raise HTTPException(422, "Goal title is required.")
    if payload.priority != "NORMAL":
        existing = await db.execute(select(Goal).where(Goal.user_id == user.id, Goal.priority == payload.priority))
        for goal in existing.scalars().all():
            goal.priority = "NORMAL"
    goal = Goal(
        id=payload.id or f"goal_{uuid4().hex}", user_id=user.id, title=payload.title.strip(),
        description=payload.description.strip(), deadline=payload.deadline, notes=payload.notes.strip(),
        status=payload.status, priority=payload.priority, collapsed=payload.collapsed,
        created_at=payload.createdAt or now(), started_at=payload.startedAt or (now() if payload.status == "ACTIVE" else None),
        completed_at=payload.completedAt,
    )
    db.add(goal)
    await db.commit()
    await db.refresh(goal)
    return GoalResponse(**goal_dict(goal))


@router.patch("/goals/{goal_id}", response_model=GoalResponse)
async def update_goal(goal_id: str, payload: GoalInput, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    result = await db.execute(select(Goal).where(Goal.id == goal_id, Goal.user_id == user.id))
    goal = result.scalar_one_or_none()
    if goal is None:
        raise HTTPException(404, "Goal not found.")
    if payload.priority != "NORMAL":
        existing = await db.execute(select(Goal).where(Goal.user_id == user.id, Goal.priority == payload.priority, Goal.id != goal_id))
        for other in existing.scalars().all():
            other.priority = "NORMAL"
    values = payload.model_dump(exclude={"id"}, exclude_none=False, by_alias=False)
    goal.title = values["title"].strip()
    goal.description = values["description"].strip()
    goal.deadline = values["deadline"]
    goal.notes = values["notes"].strip()
    goal.status = values["status"]
    goal.priority = values["priority"]
    goal.collapsed = values["collapsed"]
    if goal.status == "ACTIVE" and goal.started_at is None:
        goal.started_at = now()
    if goal.status == "DONE" and goal.completed_at is None:
        goal.completed_at = now()
    await db.commit()
    await db.refresh(goal)
    return GoalResponse(**goal_dict(goal))


@router.delete("/goals/{goal_id}", status_code=204)
async def delete_goal(goal_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    result = await db.execute(select(Goal).where(Goal.id == goal_id, Goal.user_id == user.id))
    goal = result.scalar_one_or_none()
    if goal is None:
        raise HTTPException(404, "Goal not found.")
    await db.execute(delete(Task).where(Task.goal_id == goal_id, Task.user_id == user.id))
    await db.execute(delete(Habit).where(Habit.goal_id == goal_id, Habit.user_id == user.id))
    await db.delete(goal)
    await db.commit()


@router.post("/goals/{goal_id}/complete", response_model=GoalResponse)
async def complete_goal(goal_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    result = await db.execute(select(Goal).where(Goal.id == goal_id, Goal.user_id == user.id))
    goal = result.scalar_one_or_none()
    if goal is None:
        raise HTTPException(404, "Goal not found.")
    goal.status = "DONE"
    goal.completed_at = now()
    task_result = await db.execute(select(Task).where(Task.goal_id == goal_id, Task.user_id == user.id))
    goal_tasks = task_result.scalars().all()
    task_ids = {task.id for task in goal_tasks}
    for task in goal_tasks:
        if task.status in {"NEXT", "TODAY", "IN_PROGRESS"}:
            task.status = "READY"
    plan_result = await db.execute(select(DailyPlan).where(DailyPlan.user_id == user.id))
    for plan in plan_result.scalars().all():
        if plan.main_task_id in task_ids:
            plan.main_task_id = None
        plan.quick_task_ids = [task_id for task_id in (plan.quick_task_ids or []) if task_id not in task_ids]
    await db.commit()
    await db.refresh(goal)
    return GoalResponse(**goal_dict(goal))


@router.get("/tasks", response_model=list[TaskResponse])
async def list_tasks(db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    rows = (await db.execute(select(Task).where(Task.user_id == user.id).order_by(Task.created_at))).scalars().all()
    return [TaskResponse(**task_dict(row)) for row in rows]


@router.post("/tasks", response_model=TaskResponse, status_code=201)
async def create_task(payload: TaskInput, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    if payload.goalId:
        result = await db.execute(select(Goal).where(Goal.id == payload.goalId, Goal.user_id == user.id))
        if result.scalar_one_or_none() is None:
            raise HTTPException(422, "Unknown goalId.")
    task = Task(
        id=payload.id or f"task_{uuid4().hex}", user_id=user.id, goal_id=payload.goalId,
        title=payload.title.strip(), notes=payload.notes.strip(), status=payload.status,
        estimated_minutes=payload.estimatedMinutes, dependency_ids=list(dict.fromkeys(payload.dependencyIds)),
        blocked_reason=payload.blockedReason, created_at=payload.createdAt or now(),
        completed_at=payload.completedAt, started_at=payload.startedAt,
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)
    return TaskResponse(**task_dict(task))


@router.patch("/tasks/{task_id}", response_model=TaskResponse)
async def update_task(task_id: str, payload: TaskInput, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    result = await db.execute(select(Task).where(Task.id == task_id, Task.user_id == user.id))
    task = result.scalar_one_or_none()
    if task is None:
        raise HTTPException(404, "Task not found.")
    task.title = payload.title.strip()
    task.notes = payload.notes.strip()
    task.status = payload.status
    task.goal_id = payload.goalId
    task.estimated_minutes = payload.estimatedMinutes
    task.dependency_ids = list(dict.fromkeys(payload.dependencyIds))
    task.blocked_reason = payload.blockedReason
    await db.commit()
    await db.refresh(task)
    return TaskResponse(**task_dict(task))


@router.delete("/tasks/{task_id}", status_code=204)
async def delete_task(task_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    result = await db.execute(select(Task).where(Task.id == task_id, Task.user_id == user.id))
    task = result.scalar_one_or_none()
    if task is None:
        raise HTTPException(404, "Task not found.")
    other_tasks = (await db.execute(select(Task).where(Task.user_id == user.id))).scalars().all()
    for other in other_tasks:
        if task_id in (other.dependency_ids or []):
            other.dependency_ids = [item for item in other.dependency_ids if item != task_id]
    plan_result = await db.execute(select(DailyPlan).where(DailyPlan.user_id == user.id))
    for plan in plan_result.scalars().all():
        if plan.main_task_id == task_id:
            plan.main_task_id = None
        plan.quick_task_ids = [item for item in (plan.quick_task_ids or []) if item != task_id]
    all_tasks = (await db.execute(select(Task).where(Task.user_id == user.id))).scalars().all()
    status_by_id = {item.id: item.status for item in all_tasks}
    for candidate in all_tasks:
        if candidate.status in {"BACKLOG", "READY"}:
            dependencies_done = all(status_by_id.get(dependency_id) == "DONE" for dependency_id in (candidate.dependency_ids or []))
            candidate.status = "READY" if dependencies_done else "BACKLOG"
    await db.delete(task)
    await db.commit()


@router.post("/tasks/{task_id}/next", response_model=TaskResponse)
async def promote_next(task_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    task = (await db.execute(select(Task).where(Task.id == task_id, Task.user_id == user.id))).scalar_one_or_none()
    if task is None:
        raise HTTPException(404, "Task not found.")
    if task.status == "BLOCKED":
        raise HTTPException(409, "Blocked tasks cannot enter NEXT.")
    if task.goal_id:
        goal = (await db.execute(select(Goal).where(Goal.id == task.goal_id, Goal.user_id == user.id))).scalar_one_or_none()
        if goal and goal.status == "DONE":
            raise HTTPException(409, "Reopen this goal before adding its tasks to NEXT.")
        if goal and goal.status == "INACTIVE":
            raise HTTPException(409, "Activate this goal before adding its tasks to NEXT.")
    next_count = len((await db.execute(select(Task).where(Task.user_id == user.id, Task.status == "NEXT"))).scalars().all())
    if next_count >= 7 and task.status != "NEXT":
        raise HTTPException(409, "NEXT already has 7 tasks.")
    if task.dependency_ids:
        dependencies = (await db.execute(select(Task).where(Task.user_id == user.id, Task.id.in_(task.dependency_ids)))).scalars().all()
        dependency_map = {dependency.id: dependency.status for dependency in dependencies}
        if any(dependency_map.get(dependency_id) != "DONE" for dependency_id in task.dependency_ids):
            raise HTTPException(409, "Complete this task's dependencies first.")
    task.status = "NEXT"
    await db.commit()
    await db.refresh(task)
    return TaskResponse(**task_dict(task))


@router.post("/tasks/{task_id}/today/{slot}", response_model=TaskResponse)
async def make_today(task_id: str, slot: Literal["main", "quick"], db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    task = (await db.execute(select(Task).where(Task.id == task_id, Task.user_id == user.id))).scalar_one_or_none()
    if task is None:
        raise HTTPException(404, "Task not found.")
    if task.status == "BLOCKED":
        raise HTTPException(409, "Blocked tasks cannot become TODAY.")
    today = date.today()
    plan_result = await db.execute(select(DailyPlan).where(DailyPlan.user_id == user.id, DailyPlan.date == today))
    plan = plan_result.scalar_one_or_none()
    if plan is None:
        plan = DailyPlan(user_id=user.id, date=today, main_task_id=None, quick_task_ids=[])
        db.add(plan)
    if slot == "main":
        if plan.main_task_id and plan.main_task_id != task_id:
            old = await db.get(Task, plan.main_task_id)
            if old and old.user_id == user.id and old.status != "DONE":
                old.status = "NEXT"
        plan.main_task_id = task_id
        plan.quick_task_ids = [item for item in (plan.quick_task_ids or []) if item != task_id]
        task.status = "TODAY"
    else:
        if plan.main_task_id == task_id:
            raise HTTPException(409, "The main task is already on TODAY.")
        quick_ids = list(plan.quick_task_ids or [])
        if len(quick_ids) >= 3:
            raise HTTPException(409, "TODAY can have at most 3 quick tasks.")
        if task_id not in quick_ids:
            quick_ids.append(task_id)
        plan.quick_task_ids = quick_ids
    await db.commit()
    await db.refresh(task)
    return TaskResponse(**task_dict(task))


@router.post("/tasks/{task_id}/start", response_model=TaskResponse)
async def start_task(task_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    task = (await db.execute(select(Task).where(Task.id == task_id, Task.user_id == user.id))).scalar_one_or_none()
    if task is None:
        raise HTTPException(404, "Task not found.")
    task.status = "IN_PROGRESS"
    task.started_at = task.started_at or now()
    await db.commit()
    await db.refresh(task)
    return TaskResponse(**task_dict(task))


@router.post("/tasks/{task_id}/complete", response_model=TaskResponse)
async def complete_task(task_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    task = (await db.execute(select(Task).where(Task.id == task_id, Task.user_id == user.id))).scalar_one_or_none()
    if task is None:
        raise HTTPException(404, "Task not found.")
    task.status = "DONE"
    task.completed_at = now()
    task.blocked_reason = ""
    plan_result = await db.execute(select(DailyPlan).where(DailyPlan.user_id == user.id))
    for plan in plan_result.scalars().all():
        if plan.main_task_id == task_id:
            plan.main_task_id = None
        plan.quick_task_ids = [item for item in (plan.quick_task_ids or []) if item != task_id]
    all_tasks = (await db.execute(select(Task).where(Task.user_id == user.id))).scalars().all()
    status_by_id = {item.id: item.status for item in all_tasks}
    status_by_id[task_id] = "DONE"
    for candidate in all_tasks:
        if candidate.status in {"BACKLOG", "READY"}:
            dependencies_done = all(status_by_id.get(dependency_id) == "DONE" for dependency_id in (candidate.dependency_ids or []))
            candidate.status = "READY" if dependencies_done else "BACKLOG"
    if task.goal_id:
        goal_tasks = (await db.execute(select(Task).where(Task.user_id == user.id, Task.goal_id == task.goal_id))).scalars().all()
        if goal_tasks and all(item.status == "DONE" for item in goal_tasks):
            goal = (await db.execute(select(Goal).where(Goal.id == task.goal_id, Goal.user_id == user.id))).scalar_one_or_none()
            if goal:
                goal.status = "DONE"
                goal.completed_at = now()
    await db.commit()
    await db.refresh(task)
    return TaskResponse(**task_dict(task))


@router.post("/tasks/{task_id}/block", response_model=TaskResponse)
async def block_task(task_id: str, reason: str = Query(min_length=1, max_length=500), db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    task = (await db.execute(select(Task).where(Task.id == task_id, Task.user_id == user.id))).scalar_one_or_none()
    if task is None:
        raise HTTPException(404, "Task not found.")
    task.status = "BLOCKED"
    task.blocked_reason = reason.strip()
    await db.commit()
    await db.refresh(task)
    return TaskResponse(**task_dict(task))


@router.post("/tasks/{task_id}/unblock", response_model=TaskResponse)
async def unblock_task(task_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    task = (await db.execute(select(Task).where(Task.id == task_id, Task.user_id == user.id))).scalar_one_or_none()
    if task is None:
        raise HTTPException(404, "Task not found.")
    task.blocked_reason = ""
    task.status = "READY"
    await db.commit()
    await db.refresh(task)
    return TaskResponse(**task_dict(task))


@router.post("/tasks/{task_id}/drop", response_model=TaskResponse)
async def drop_task(task_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    task = (await db.execute(select(Task).where(Task.id == task_id, Task.user_id == user.id))).scalar_one_or_none()
    if task is None:
        raise HTTPException(404, "Task not found.")
    task.status = "DROPPED"
    task.blocked_reason = ""
    plan_result = await db.execute(select(DailyPlan).where(DailyPlan.user_id == user.id))
    for plan in plan_result.scalars().all():
        if plan.main_task_id == task_id:
            plan.main_task_id = None
        plan.quick_task_ids = [item for item in (plan.quick_task_ids or []) if item != task_id]
    await db.commit()
    await db.refresh(task)
    return TaskResponse(**task_dict(task))


@router.post("/tasks/{task_id}/remove-next", response_model=TaskResponse)
async def remove_from_next(task_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    task = (await db.execute(select(Task).where(Task.id == task_id, Task.user_id == user.id))).scalar_one_or_none()
    if task is None:
        raise HTTPException(404, "Task not found.")
    task.status = "READY"
    await db.commit()
    await db.refresh(task)
    return TaskResponse(**task_dict(task))


@router.post("/tasks/{task_id}/remove-today", response_model=TaskResponse)
async def remove_from_today(task_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    task = (await db.execute(select(Task).where(Task.id == task_id, Task.user_id == user.id))).scalar_one_or_none()
    if task is None:
        raise HTTPException(404, "Task not found.")
    plan_result = await db.execute(select(DailyPlan).where(DailyPlan.user_id == user.id, DailyPlan.date == date.today()))
    plan = plan_result.scalar_one_or_none()
    if plan and plan.main_task_id == task_id:
        plan.main_task_id = None
        if task.status not in {"DONE", "BLOCKED"}:
            task.status = "NEXT"
    if plan:
        plan.quick_task_ids = [item for item in (plan.quick_task_ids or []) if item != task_id]
    await db.commit()
    await db.refresh(task)
    return TaskResponse(**task_dict(task))


@router.get("/plans", response_model=dict[str, PlanResponse])
async def list_plans(db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    rows = (await db.execute(select(DailyPlan).where(DailyPlan.user_id == user.id))).scalars().all()
    return {row.date.isoformat(): PlanResponse(date=row.date, mainTaskId=row.main_task_id, quickTaskIds=row.quick_task_ids or []) for row in rows}


@router.put("/plans/{plan_date}", response_model=PlanResponse)
async def upsert_plan(plan_date: date, payload: PlanInput, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    result = await db.execute(select(DailyPlan).where(DailyPlan.user_id == user.id, DailyPlan.date == plan_date))
    plan = result.scalar_one_or_none()
    if plan is None:
        plan = DailyPlan(user_id=user.id, date=plan_date, main_task_id=None, quick_task_ids=[])
        db.add(plan)
    plan.main_task_id = payload.mainTaskId
    plan.quick_task_ids = payload.quickTaskIds
    await db.commit()
    await db.refresh(plan)
    return PlanResponse(date=plan.date, mainTaskId=plan.main_task_id, quickTaskIds=plan.quick_task_ids or [])


@router.delete("/plans/{plan_date}", status_code=204)
async def delete_plan(plan_date: date, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    await db.execute(delete(DailyPlan).where(DailyPlan.user_id == user.id, DailyPlan.date == plan_date))
    await db.commit()


@router.get("/journal", response_model=dict[str, JournalResponse])
async def list_journal(db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    rows = (await db.execute(select(JournalEntry).where(JournalEntry.user_id == user.id))).scalars().all()
    return {row.date.isoformat(): JournalResponse(id=row.id, date=row.date, content=row.content, createdAt=row.created_at, updatedAt=row.updated_at) for row in rows}


@router.put("/journal/{entry_date}", response_model=JournalResponse)
async def upsert_journal(entry_date: date, payload: JournalInput, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    result = await db.execute(select(JournalEntry).where(JournalEntry.user_id == user.id, JournalEntry.date == entry_date))
    entry = result.scalar_one_or_none()
    timestamp = now()
    if entry is None:
        entry = JournalEntry(id=payload.id or f"journal_{uuid4().hex}", user_id=user.id, date=entry_date, content=payload.content, created_at=timestamp, updated_at=timestamp)
        db.add(entry)
    else:
        entry.content = payload.content
        entry.updated_at = timestamp
    await db.commit()
    await db.refresh(entry)
    return JournalResponse(id=entry.id, date=entry.date, content=entry.content, createdAt=entry.created_at, updatedAt=entry.updated_at)


@router.delete("/journal/{entry_date}", status_code=204)
async def delete_journal(entry_date: date, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    await db.execute(delete(JournalEntry).where(JournalEntry.user_id == user.id, JournalEntry.date == entry_date))
    await db.commit()


@router.get("/habits", response_model=list[HabitResponse])
async def list_habits(db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    rows = (await db.execute(select(Habit).where(Habit.user_id == user.id).order_by(Habit.created_at))).scalars().all()
    return [HabitResponse(**habit_dict(row)) for row in rows]


@router.post("/habits", response_model=HabitResponse, status_code=201)
async def create_habit(payload: HabitInput, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    if payload.type == "DO" and (not payload.normal.strip() or not payload.minimum.strip()):
        raise HTTPException(422, "DO habits require normal and minimum versions.")
    habit = Habit(
        id=payload.id or f"habit_{uuid4().hex}", user_id=user.id, goal_id=payload.goalId,
        name=payload.name.strip(), type=payload.type, normal=payload.normal.strip(),
        minimum=payload.minimum.strip(), schedule=payload.schedule, status=payload.status,
        created_at=payload.createdAt or now(), started_at=payload.startedAt or now(),
        logs=payload.logs,
    )
    db.add(habit)
    await db.commit()
    await db.refresh(habit)
    return HabitResponse(**habit_dict(habit))


@router.patch("/habits/{habit_id}", response_model=HabitResponse)
async def update_habit(habit_id: str, payload: HabitInput, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    result = await db.execute(select(Habit).where(Habit.id == habit_id, Habit.user_id == user.id))
    habit = result.scalar_one_or_none()
    if habit is None:
        raise HTTPException(404, "Habit not found.")
    if payload.type == "DO" and (not payload.normal.strip() or not payload.minimum.strip()):
        raise HTTPException(422, "DO habits require normal and minimum versions.")
    habit.goal_id = payload.goalId
    habit.name = payload.name.strip()
    habit.type = payload.type
    habit.normal = payload.normal.strip()
    habit.minimum = payload.minimum.strip()
    habit.schedule = payload.schedule
    habit.status = payload.status
    habit.logs = payload.logs
    await db.commit()
    await db.refresh(habit)
    return HabitResponse(**habit_dict(habit))


@router.delete("/habits/{habit_id}", status_code=204)
async def delete_habit(habit_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    result = await db.execute(select(Habit).where(Habit.id == habit_id, Habit.user_id == user.id))
    habit = result.scalar_one_or_none()
    if habit is None:
        raise HTTPException(404, "Habit not found.")
    await db.delete(habit)
    await db.commit()


@router.post("/habits/{habit_id}/check-in", response_model=HabitResponse)
async def check_in_habit(
    habit_id: str,
    value: Literal["done", "minimum", "kept", "broken"] | None = None,
    check_date: date | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
):
    result = await db.execute(select(Habit).where(Habit.id == habit_id, Habit.user_id == user.id))
    habit = result.scalar_one_or_none()
    if habit is None:
        raise HTTPException(404, "Habit not found.")
    if habit.status != "ACTIVE":
        raise HTTPException(409, "Only active habits can be checked in.")
    date_key = (check_date or date.today()).isoformat()
    logs = dict(habit.logs or {})
    if value is None:
        logs.pop(date_key, None)
    elif habit.type == "DO" and value not in {"done", "minimum"}:
        raise HTTPException(422, "That check-in does not match this DO habit.")
    elif habit.type == "AVOID" and value not in {"kept", "broken"}:
        raise HTTPException(422, "That check-in does not match this AVOID habit.")
    else:
        logs[date_key] = value
    habit.logs = logs
    await db.commit()
    await db.refresh(habit)
    return HabitResponse(**habit_dict(habit))
