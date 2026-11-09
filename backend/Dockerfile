FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN useradd -m saathi && mkdir -p /data && chown -R saathi /app /data
USER saathi
EXPOSE 8000
# Migrate, train the (optional, synthetic) ML advisory if absent, then serve.
CMD ["sh", "-c", "alembic upgrade head && ([ -f models/ml_advisory.joblib ] || python -m scripts.train_model >/dev/null) && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
