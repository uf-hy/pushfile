FROM python:3.12-slim

WORKDIR /app
COPY pyproject.toml /app/
RUN pip install --no-cache-dir fastapi uvicorn[standard] python-multipart jinja2 aiofiles geoip2 && \
    mkdir -p /app/data && \
    python - <<'PY'
import urllib.request

urls = [
    "https://git.io/GeoLite2-City.mmdb",
    "https://github.com/P3TERX/GeoLite.mmdb/raw/download/GeoLite2-City.mmdb",
]
dst = "/app/data/GeoLite2-City.mmdb"

for u in urls:
    try:
        urllib.request.urlretrieve(u, dst)
        print("Downloaded GeoLite2-City.mmdb from", u)
        break
    except Exception as e:
        print("GeoLite2 download failed:", u, e)
else:
    print("GeoLite2-City.mmdb not downloaded; analytics will run without city lookup")
PY

COPY app /app/app
COPY frontend /app/frontend
ENV PYTHONUNBUFFERED=1

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
