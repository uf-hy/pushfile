from typing import List
from pydantic import BaseModel


class RenamePayload(BaseModel):
    oldName: str
    newName: str


class DeletePayload(BaseModel):
    name: str


class BatchDeletePayload(BaseModel):
    names: List[str]


class BatchRenamePayload(BaseModel):
    names: List[str]
    prefix: str
    start: int = 1
    padding: int = 3


class CreateTokenPayload(BaseModel):
    token: str


class RemoveTokenPayload(BaseModel):
    mode: str = "archive"


class OrderPayload(BaseModel):
    names: List[str]


class TokenMetaPayload(BaseModel):
    title: str = ""
