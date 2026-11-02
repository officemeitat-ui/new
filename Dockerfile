FROM python:3.12-slim

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 MEIT_HOST=0.0.0.0 MEIT_PORT=8080 MEIT_DB=/data/meit.db

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY meit ./meit
COPY docs ./docs

VOLUME ["/data"]
EXPOSE 8080
CMD ["python", "-m", "meit"]
