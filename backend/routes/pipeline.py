from fastapi import APIRouter, HTTPException

import jobs
import storage
from pipeline import story, assets, background, tts

router = APIRouter(prefix="/api/projects/{project_id}/pipeline", tags=["pipeline"])

STEPS = {
    "story": story.run,
    "assets": assets.run,
    "background": background.run,
    "tts": tts.run,
}


@router.post("/{step}")
async def run_step(project_id: str, step: str):
    if step not in STEPS:
        raise HTTPException(400, f"Unknown step '{step}'. Valid: {list(STEPS)}")
    if not storage.get_project(project_id):
        raise HTTPException(404, "Project not found")

    job = jobs.create_job(project_id, step)
    storage.update_pipeline_status(project_id, step, "running")

    async def _fn(j):
        await STEPS[step](j, project_id)

    await jobs.run_job(job, _fn)
    return {"job_id": job.job_id, "status": job.status}


@router.get("/jobs/{job_id}")
async def get_job(project_id: str, job_id: str):
    job = jobs.get_job(job_id)
    if not job or job.project_id != project_id:
        raise HTTPException(404, "Job not found")
    return job.to_dict()
