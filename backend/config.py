import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

# Storage root — all projects live here
OUTPUT_DIR = Path(__file__).parent / "output"
OUTPUT_DIR.mkdir(exist_ok=True)

# Mock mode — no real API calls, copies test fixtures instead
MOCK_MODE = os.getenv("MOCK_MODE", "true").lower() == "true"

# Test fixtures (used in mock mode)
TEST_DIR = Path(__file__).parent.parent.parent / "test"
TEST_STORY_DATA = TEST_DIR / "story_data.json"
TEST_ASSETS_DIR = TEST_DIR / "assets"

# Gemini models
MODEL_STORY = "gemini-2.5-pro-preview-06-05"
MODEL_SPRITE = "gemini-2.0-flash-preview-image-generation"
MODEL_VIDEO = "veo-2.0-generate-001"
MODEL_TTS = "gemini-2.5-flash-preview-tts"


def project_dir(project_id: str) -> Path:
    return OUTPUT_DIR / project_id


def assets_dir(project_id: str) -> Path:
    return project_dir(project_id) / "assets"
