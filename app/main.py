import mimetypes
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import PlainTextResponse
from app.logging_config import setup_logging, access_log_middleware
from app.routes import tokens, manage, upload, pages, folders, stats, health, files, api, grid, auth
from app.config import BASE_PATH, FRONTEND_DIR

setup_logging()


class StripBasePathMiddleware:
    def __init__(self, app, base_path: str):
        self.app = app
        self.base_path = (base_path or "").rstrip("/")

    async def __call__(self, scope, receive, send):
        if scope.get("type") in {"http", "websocket"} and self.base_path:
            prefix = self.base_path + "/"
            path = scope.get("path") or ""
            if path.startswith(prefix):
                new_scope = dict(scope)
                new_path = path[len(self.base_path) :]
                new_scope["path"] = new_path if new_path else "/"
                raw_path = scope.get("raw_path")
                if isinstance(raw_path, (bytes, bytearray)):
                    bp = self.base_path.encode("utf-8")
                    if raw_path.startswith(bp + b"/"):
                        new_scope["raw_path"] = raw_path[len(bp) :]
                return await self.app(new_scope, receive, send)

        return await self.app(scope, receive, send)


mimetypes.add_type("image/webp", ".webp")
mimetypes.add_type("image/avif", ".avif")

app = FastAPI(title="photo-uploader-b", docs_url=None, redoc_url=None, openapi_url=None)

if BASE_PATH:
    app.add_middleware(StripBasePathMiddleware, base_path=BASE_PATH)


@app.middleware("http")
async def referrer_policy_middleware(request, call_next):
    response = await call_next(request)
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


app.middleware("http")(access_log_middleware)


@app.get("/robots.txt", include_in_schema=False)
def robots_txt():
    return PlainTextResponse(
        "User-agent: *\nDisallow: /d/\nDisallow: /f/\n",
        media_type="text/plain; charset=utf-8",
    )

app.include_router(health.router)
app.include_router(auth.router)
app.include_router(files.router)
app.include_router(pages.router)
app.include_router(tokens.router)
app.include_router(manage.router)
app.include_router(upload.router)
app.include_router(folders.router)
app.include_router(stats.router)
app.include_router(api.router)
app.include_router(grid.router)

app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")
