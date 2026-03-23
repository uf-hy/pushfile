#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
from email.utils import parsedate_to_datetime
from http.client import HTTPConnection, HTTPSConnection
from pathlib import Path
from typing import Literal, Protocol, TypedDict, cast
from urllib.parse import SplitResult, urljoin, urlsplit


SameSiteValue = Literal["Strict", "Lax", "None"]


class CookieState(TypedDict):
    name: str
    value: str
    domain: str
    path: str
    expires: float | int
    httpOnly: bool
    secure: bool
    sameSite: SameSiteValue


class LocalStorageEntry(TypedDict):
    name: str
    value: str


class OriginState(TypedDict):
    origin: str
    localStorage: list[LocalStorageEntry]


class StorageState(TypedDict):
    cookies: list[CookieState]
    origins: list[OriginState]


class ParsedArgs(Protocol):
    base_url: str
    state_file: str


def normalize_same_site(value: str | None) -> SameSiteValue:
    normalized = (value or "Lax").strip().lower()
    if normalized == "strict":
        return "Strict"
    if normalized == "none":
        return "None"
    return "Lax"


def parse_expires(value: str) -> float | int:
    if not value:
        return -1
    try:
        return parsedate_to_datetime(value).timestamp()
    except (TypeError, ValueError, OverflowError):
        return -1


def build_cookie_state(
    name: str,
    value: str,
    attributes: dict[str, str],
    flags: set[str],
    default_domain: str,
    default_secure: bool,
) -> CookieState:
    return {
        "name": name,
        "value": value,
        "domain": attributes.get("domain") or default_domain,
        "path": attributes.get("path") or "/",
        "expires": parse_expires(attributes.get("expires", "")),
        "httpOnly": "httponly" in flags,
        "secure": ("secure" in flags) or default_secure,
        "sameSite": normalize_same_site(attributes.get("samesite")),
    }


def parse_set_cookie_headers(headers: list[str], default_domain: str, default_secure: bool) -> list[CookieState]:
    cookies: list[CookieState] = []
    for header in headers:
        segments = [segment.strip() for segment in header.split(";") if segment.strip()]
        if not segments or "=" not in segments[0]:
            continue

        name, value = segments[0].split("=", 1)
        attributes: dict[str, str] = {}
        flags: set[str] = set()
        for segment in segments[1:]:
            if "=" in segment:
                key, raw_value = segment.split("=", 1)
                attributes[key.strip().lower()] = raw_value.strip()
            else:
                flags.add(segment.strip().lower())

        cookies.append(build_cookie_state(name, value, attributes, flags, default_domain, default_secure))
    return cookies


def build_storage_state(base_url: str, upload_secret: str, cookies: list[CookieState]) -> StorageState:
    origin_bits = urlsplit(base_url)
    origin = f"{origin_bits.scheme}://{origin_bits.netloc}"
    return {
        "cookies": cookies,
        "origins": [
            {
                "origin": origin,
                "localStorage": [
                    {"name": "pushfile_admin_key", "value": upload_secret},
                ],
            }
        ],
    }


def build_login_request_target(login_url: SplitResult) -> tuple[str, str, int | None, bool, str]:
    host = login_url.hostname or ""
    if not host:
        raise RuntimeError("无效的 base URL，无法解析登录主机。")

    path = login_url.path or "/"
    if login_url.query:
        path = f"{path}?{login_url.query}"

    is_https = login_url.scheme == "https"
    return host, path, login_url.port, is_https, login_url.netloc


def login_and_save_state(base_url: str, upload_secret: str, state_file: Path) -> None:
    login_url = urlsplit(urljoin(base_url.rstrip("/") + "/", "api/auth/login"))
    host, path, port, is_https, domain = build_login_request_target(login_url)
    payload = json.dumps({"key": upload_secret}).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "Content-Length": str(len(payload)),
    }

    connection_cls = HTTPSConnection if is_https else HTTPConnection
    connection = connection_cls(host, port=port, timeout=30)
    try:
        connection.request("POST", path, body=payload, headers=headers)
        response = connection.getresponse()
        body = response.read().decode("utf-8", errors="replace")
        if response.status >= 400:
            raise RuntimeError(f"登录失败: {response.status} {body}")
        set_cookie_headers = response.headers.get_all("Set-Cookie") or []
    finally:
        connection.close()

    cookies = parse_set_cookie_headers(set_cookie_headers, domain, is_https)
    if not cookies:
        raise RuntimeError("登录成功但未收到可用的会话 Cookie。")

    state_file.parent.mkdir(parents=True, exist_ok=True)
    state = build_storage_state(base_url, upload_secret, cookies)
    _ = state_file.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def parse_args() -> ParsedArgs:
    parser = argparse.ArgumentParser(description="为 Playwright 直连入口生成 storage state")
    _ = parser.add_argument("--base-url", required=True)
    _ = parser.add_argument("--state-file", required=True)
    return cast(ParsedArgs, cast(object, parser.parse_args()))


def main() -> int:
    args = parse_args()
    base_url = args.base_url
    state_file = Path(args.state_file)
    upload_secret = (os.environ.get("UPLOAD_SECRET") or "").strip()
    if not upload_secret:
        raise SystemExit("未提供 UPLOAD_SECRET，无法自动登录。")

    login_and_save_state(base_url, upload_secret, state_file)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
