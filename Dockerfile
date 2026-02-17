FROM python:3.12-slim

WORKDIR /app
COPY pyproject.toml /app/
RUN pip install --no-cache-dir fastapi uvicorn[standard] python-multipart jinja2 aiofiles && \
    mkdir -p /app/data && \
    python - <<'PY'
import urllib.request, os

# ip2region v4 — 中国 IP 精确到市+运营商，11MB
urls = [
    "https://raw.githubusercontent.com/lionsoul2014/ip2region/master/data/ip2region_v4.xdb",
    "https://mirror.ghproxy.com/https://raw.githubusercontent.com/lionsoul2014/ip2region/master/data/ip2region_v4.xdb",
]
dst = "/app/data/ip2region.xdb"

for u in urls:
    try:
        urllib.request.urlretrieve(u, dst)
        sz = os.path.getsize(dst)
        if sz > 1_000_000:  # sanity check: should be ~11MB
            print(f"Downloaded ip2region.xdb ({sz/1024/1024:.1f}MB) from {u}")
            break
        else:
            os.remove(dst)
            print(f"ip2region download too small ({sz}B), trying next: {u}")
    except Exception as e:
        print(f"ip2region download failed: {u} {e}")
else:
    print("ip2region.xdb not downloaded; analytics will run without city lookup")
PY

COPY app /app/app
COPY frontend /app/frontend
COPY ip2region /app/ip2region
ENV PYTHONUNBUFFERED=1

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
