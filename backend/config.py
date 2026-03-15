import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

# Storage root — all projects live here (env-configurable for GCS FUSE mount)
OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", str(Path(__file__).parent / "output")))
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# Mock mode — no real API calls, copies test fixtures instead
MOCK_MODE = os.getenv("MOCK_MODE", "true").lower() == "true"

# Test fixtures (used in mock mode)
TEST_DIR = Path(__file__).parent.parent.parent / "test"
TEST_STORY_DATA = TEST_DIR / "story_data.json"
TEST_ASSETS_DIR = TEST_DIR / "assets"

# Gemini models
MODEL_STORY="gemini-3-flash-preview"
# MODEL_STORY = "gemini-3.1-pro-preview" //expensive
MODEL_SPRITE = "gemini-3-pro-image-preview"
MODEL_IMAGE_STORY = "gemini-3-pro-image-preview"
MODEL_VIDEO = "veo-3.1-generate-preview"
MODEL_TTS = "gemini-2.5-flash-preview-tts"


def make_genai_client():
    """Create a google-genai Client, using Vertex AI when GOOGLE_GENAI_USE_VERTEXAI=true."""
    from google import genai
    if os.getenv("GOOGLE_GENAI_USE_VERTEXAI", "").lower() == "true":
        return genai.Client(
            vertexai=True,
            project=os.getenv("GOOGLE_CLOUD_PROJECT"),
            location=os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1"),
        )
    return genai.Client(api_key=os.getenv("GEMINI_API_KEY"))


def project_dir(project_id: str) -> Path:
    return OUTPUT_DIR / project_id


def assets_dir(project_id: str) -> Path:
    return project_dir(project_id) / "assets"
