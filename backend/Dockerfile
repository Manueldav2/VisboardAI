FROM python:3.13-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .
COPY agents/ agents/
COPY services/ services/
COPY models/ models/

ENV PORT=8080
EXPOSE ${PORT}

CMD uvicorn main:app --host 0.0.0.0 --port ${PORT} --timeout-keep-alive 600
