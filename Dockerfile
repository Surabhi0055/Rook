FROM python:3.10-slim

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y gcc default-libmysqlclient-dev && rm -rf /var/lib/apt/lists/*

# Copy backend requirements and install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy all project files into the container
COPY . .

# Set environment variable so the backend knows where it is
ENV PYTHONPATH=/app/backend

# Hugging Face strictly exposes port 7860
ENV PORT=7860

# Start FastAPI exactly from the backend folder using uvicorn
CMD uvicorn backend.main:app --host 0.0.0.0 --port $PORT
