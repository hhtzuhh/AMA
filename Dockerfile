FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 libgl1 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-editable

COPY backend/ .

# frontend/dist is pre-built by deploy.sh with VITE_API_URL baked in
COPY frontend/dist/ /app/frontend_dist/

# Pre-bake rembg ONNX model into image (~87MB) to avoid cold-start download
ENV U2NET_HOME=/app/.u2net
RUN uv run python -c "from rembg import remove; from PIL import Image; import io; buf = io.BytesIO(); Image.new('RGB', (10,10), (128,128,128)).save(buf, format='PNG'); remove(buf.getvalue()); print('rembg pre-baked')"

RUN mkdir -p /app/output
RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

ENV PORT=8080
EXPOSE 8080
CMD [".venv/bin/uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
