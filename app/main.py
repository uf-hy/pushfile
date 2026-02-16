from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import PlainTextResponse
from app.routes import tokens, manage, upload, pages, folders, stats, health, files
from app.config import FRONTEND_DIR

app = FastAPI(title="photo-uploader-b", docs_url=None, redoc_url=None, openapi_url=None)

@app.middleware("http")
async def referrer_policy_middleware(request, call_next):
    response = await call_next(request)
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


@app.get("/robots.txt", include_in_schema=False)
def robots_txt():
    return PlainTextResponse(
        "User-agent: *\nDisallow: /d/\nDisallow: /f/\n",
        media_type="text/plain; charset=utf-8",
    )

app.include_router(health.router)
app.include_router(files.router)
app.include_router(pages.router)
app.include_router(tokens.router)
app.include_router(manage.router)
app.include_router(upload.router)
app.include_router(folders.router)
app.include_router(stats.router)

app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")
