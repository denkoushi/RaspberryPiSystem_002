FROM python:3.11-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HF_HUB_DISABLE_TELEMETRY=1 DO_NOT_TRACK=1
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN python -c "from fastembed import TextEmbedding; TextEmbedding('sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2', cache_dir='/opt/models', threads=2)"
RUN chmod -R a+rX /opt/models
ENV HF_HUB_OFFLINE=1
RUN apt-get update && apt-get install -y --only-upgrade --no-install-recommends \
    gzip libpcre2-8-0 libsqlite3-0 perl-base \
    && rm -rf /var/lib/apt/lists/*
RUN python -m pip uninstall --yes pip setuptools wheel
RUN useradd --uid 10001 --create-home cache && mkdir /data && chown cache:cache /data
COPY server.py sources.py experience.py maintenance.py runtime.py facts.py .
USER cache
ENTRYPOINT ["python", "server.py", "--host", "0.0.0.0", "--catalogue", "/catalogue/reviewed.json", "--data-dir", "/data", "--model-dir", "/opt/models"]
