FROM python:3.13-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

RUN apt-get update \
    && apt-get install --no-install-recommends -y libsndfile1 curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements-base.txt ./
RUN python -m pip install --no-cache-dir -r requirements-base.txt

COPY pyproject.toml README.md ./
COPY backend ./backend
COPY data_pipeline ./data_pipeline
COPY training ./training
RUN python -m pip install --no-cache-dir --no-deps . && rm -rf build

COPY frontend ./frontend
RUN useradd --create-home --uid 10001 appuser \
    && mkdir -p /app/data /app/training/checkpoints \
    && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
  CMD curl --fail --silent http://127.0.0.1:8000/health || exit 1

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]

FROM runtime AS development
USER root
COPY requirements-dev.txt ./
COPY tests ./tests
RUN python -m pip install --no-cache-dir -r requirements-dev.txt
USER appuser
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

FROM runtime AS ml-runtime
USER root
COPY requirements-ml.txt ./
RUN python -m pip install --no-cache-dir -r requirements-ml.txt
USER appuser
