"""
In-memory job store + background task runner.
"""
import asyncio
import traceback
import uuid
from datetime import datetime
from enum import Enum
from typing import Any, Callable, Coroutine


class JobStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"


class Job:
    def __init__(self, job_id: str, project_id: str, step: str):
        self.job_id = job_id
        self.project_id = project_id
        self.step = step
        self.status = JobStatus.PENDING
        self.progress: str = ""
        self.current: dict | None = None   # what's generating right now
        self.events: list[dict] = []       # structured completion events
        self.result: Any = None
        self.error: str | None = None
        self.created_at = datetime.utcnow().isoformat()
        self.updated_at = self.created_at

    def emit(self, event: dict) -> None:
        """Append a structured completion event."""
        event["timestamp"] = datetime.utcnow().isoformat()
        self.events.append(event)
        self.updated_at = event["timestamp"]

    def to_dict(self) -> dict:
        return {
            "job_id": self.job_id,
            "project_id": self.project_id,
            "step": self.step,
            "status": self.status,
            "progress": self.progress,
            "current": self.current,
            "events": self.events,
            "result": self.result,
            "error": self.error,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


_store: dict[str, Job] = {}


def create_job(project_id: str, step: str) -> Job:
    job_id = str(uuid.uuid4())
    job = Job(job_id, project_id, step)
    _store[job_id] = job
    return job


def get_job(job_id: str) -> Job | None:
    return _store.get(job_id)


def list_jobs(project_id: str) -> list[Job]:
    return [j for j in _store.values() if j.project_id == project_id]


async def run_job(job: Job, fn: Callable[[Job], Coroutine]) -> None:
    async def _run():
        job.status = JobStatus.RUNNING
        job.updated_at = datetime.utcnow().isoformat()
        try:
            await fn(job)
            job.status = JobStatus.DONE
        except Exception:
            job.status = JobStatus.FAILED
            job.error = traceback.format_exc()
        finally:
            job.current = None
            job.updated_at = datetime.utcnow().isoformat()

    asyncio.create_task(_run())
