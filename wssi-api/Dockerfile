FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY main.py .
COPY data/ ./data/

# Create data directory if not exists
RUN mkdir -p /app/data

# Expose default port (Railway will override with PORT env var)
EXPOSE 8000

# Run with uvicorn (respect Railway PORT when present)
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
