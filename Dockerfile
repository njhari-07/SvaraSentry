FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_DEFAULT_TIMEOUT=120 \
    PIP_RETRIES=10

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
RUN python -m pip install --no-cache-dir --no-deps . \
    && find backend data_pipeline training -type f -name '*.py' -exec chmod 0644 {} + \
    && rm -rf build

RUN useradd --create-home --uid 10001 appuser \
    && mkdir -p /app/data /app/training/checkpoints \
    && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
  CMD curl --fail --silent http://127.0.0.1:8000/health || exit 1

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]

FROM runtime AS ml-runtime
USER root
ARG PYTORCH_VERSION=2.11.0
COPY requirements-ml.txt ./
RUN python -m pip install --no-cache-dir \
        --index-url https://download.pytorch.org/whl/cpu \
        "torch==${PYTORCH_VERSION}+cpu" "torchaudio==${PYTORCH_VERSION}+cpu" \
    && python -m pip install --no-cache-dir -r requirements-ml.txt \
    && python -m pip check
USER appuser

FROM ml-runtime AS development
USER root
COPY requirements-dev.txt ./
RUN python -m pip install --no-cache-dir -r requirements-dev.txt \
    && python -m pip check
COPY tests ./tests
RUN find tests -type f -name '*.py' -exec chmod 0644 {} + \
    && chown -R appuser:appuser /app/tests
USER appuser
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

FROM node:24-alpine AS frontend-dependencies
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

FROM frontend-dependencies AS frontend-development
COPY frontend ./
EXPOSE 3000
CMD ["npm", "run", "dev", "--", "--hostname", "0.0.0.0"]

FROM frontend-dependencies AS frontend-build
COPY frontend ./
ARG NEXT_PUBLIC_API_BASE=http://localhost:8000
ARG NEXT_PUBLIC_PUBLIC_ORIGIN=http://localhost:3000
ENV NEXT_PUBLIC_API_BASE=$NEXT_PUBLIC_API_BASE \
    NEXT_PUBLIC_PUBLIC_ORIGIN=$NEXT_PUBLIC_PUBLIC_ORIGIN
RUN npm run build

FROM node:24-alpine AS frontend-runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=frontend-build /app/frontend/.next/standalone ./
COPY --from=frontend-build /app/frontend/.next/static ./.next/static
COPY --from=frontend-build /app/frontend/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
