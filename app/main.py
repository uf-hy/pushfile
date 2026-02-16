from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from app.routes import tokens, manage, upload, pages, folders, stats, health
from app.config import FRONTEND_DIR

app = FastAPI(title="photo-uploader-b", docs_url=None, redoc_url=None, openapi_url=None)

app.include_router(health.router)
app.include_router(pages.router)
app.include_router(tokens.router)
app.include_router(manage.router)
app.include_router(upload.router)
app.include_router(folders.router)
app.include_router(stats.router)

app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")
