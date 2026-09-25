FROM ghcr.io/astral-sh/uv:0.7.10 AS uv

FROM python:3.12-slim

ARG GIT_COMMIT=unknown
LABEL org.opencontainers.image.revision=$GIT_COMMIT

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app
COPY --from=uv /uv /uvx /bin/
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY manage.py ./
COPY config ./config
COPY web ./web
COPY templates ./templates
COPY static ./static

# collectstatic needs settings to load; the real values come from crema.env at run time.
RUN DJANGO_SECRET_KEY=build DATABASE_URL=postgres://build@localhost/build python manage.py collectstatic --noinput \
    && addgroup --system crema \
    && adduser --system --ingroup crema crema \
    && chown -R crema:crema /app

USER crema
EXPOSE 8000

CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "2", "--worker-class", "gthread", "--threads", "2", "--timeout", "30", "--access-logfile", "-", "--error-logfile", "-"]
