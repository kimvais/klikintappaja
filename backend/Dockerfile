# Two-stage uv build, same shape as the uutis image this service borrows its
# tech choices from.

FROM ghcr.io/astral-sh/uv:python3.14-trixie-slim AS build

WORKDIR /app
COPY pyproject.toml ./
COPY src/ ./src/
RUN uv build -o /wheels

FROM ghcr.io/astral-sh/uv:python3.14-trixie-slim AS runtime

WORKDIR /app
COPY --from=build /wheels/*.whl /wheels/
RUN uv venv /runtime
ENV PATH=/runtime/bin:$PATH
RUN uv pip install --find-links /wheels/ "klikintappaja-api[server]"

# Cloud Run injects PORT and expects the container to honour it, so this is the
# shell form on purpose — exec form would pass the literal string.
ENV PORT=8080
CMD gunicorn --bind ":$PORT" --workers 1 --threads 8 --timeout 0 \
    -k uvicorn.workers.UvicornWorker "klikintappaja_api:create_app()"
