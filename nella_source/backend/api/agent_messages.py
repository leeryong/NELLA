"""
Agent chat message persistence API.
Stores chat messages in DB so any browser tab can see the same conversation.
"""
from typing import List, Optional
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from pydantic import BaseModel

from backend.database import get_db, AgentChatMessage

router = APIRouter(prefix="/agent-messages", tags=["agent-messages"])


class MessageIn(BaseModel):
    session_id: str = "default"
    role: str
    content: str
    metadata: Optional[dict] = None


class MessageOut(BaseModel):
    id: int
    session_id: str
    role: str
    content: str
    metadata: Optional[dict] = None
    created_at: str

    class Config:
        from_attributes = True


@router.get("/{session_id}", response_model=List[MessageOut])
async def get_messages(session_id: str = "default", db: AsyncSession = Depends(get_db)):
    stmt = select(AgentChatMessage).where(
        AgentChatMessage.session_id == session_id
    ).order_by(AgentChatMessage.created_at)
    result = await db.execute(stmt)
    rows = result.scalars().all()
    return [
        MessageOut(
            id=r.id,
            session_id=r.session_id,
            role=r.role,
            content=r.content,
            metadata=r.msg_metadata,
            created_at=r.created_at.isoformat() if r.created_at else "",
        )
        for r in rows
    ]


@router.post("", response_model=MessageOut)
async def add_message(msg: MessageIn, db: AsyncSession = Depends(get_db)):
    record = AgentChatMessage(
        session_id=msg.session_id,
        role=msg.role,
        content=msg.content,
        msg_metadata=msg.metadata,
    )
    db.add(record)
    await db.flush()
    await db.refresh(record)
    return MessageOut(
        id=record.id,
        session_id=record.session_id,
        role=record.role,
        content=record.content,
        metadata=record.msg_metadata,
        created_at=record.created_at.isoformat() if record.created_at else "",
    )


@router.post("/bulk", response_model=List[MessageOut])
async def add_messages_bulk(msgs: List[MessageIn], db: AsyncSession = Depends(get_db)):
    records = []
    for msg in msgs:
        record = AgentChatMessage(
            session_id=msg.session_id,
            role=msg.role,
            content=msg.content,
            msg_metadata=msg.metadata,
        )
        db.add(record)
        records.append(record)
    await db.flush()
    for r in records:
        await db.refresh(r)
    return [
        MessageOut(
            id=r.id,
            session_id=r.session_id,
            role=r.role,
            content=r.content,
            metadata=r.msg_metadata,
            created_at=r.created_at.isoformat() if r.created_at else "",
        )
        for r in records
    ]


@router.patch("/{msg_id}")
async def update_message(msg_id: int, body: dict, db: AsyncSession = Depends(get_db)):
    stmt = select(AgentChatMessage).where(AgentChatMessage.id == msg_id)
    result = await db.execute(stmt)
    record = result.scalar_one_or_none()
    if not record:
        from fastapi import HTTPException
        raise HTTPException(404, detail="Message not found")
    if "content" in body:
        record.content = body["content"]
    if "metadata" in body:
        record.msg_metadata = body["metadata"]
    await db.flush()
    await db.refresh(record)
    return MessageOut(
        id=record.id,
        session_id=record.session_id,
        role=record.role,
        content=record.content,
        metadata=record.msg_metadata,
        created_at=record.created_at.isoformat() if record.created_at else "",
    )


@router.delete("/{session_id}")
async def clear_messages(session_id: str = "default", db: AsyncSession = Depends(get_db)):
    stmt = delete(AgentChatMessage).where(AgentChatMessage.session_id == session_id)
    await db.execute(stmt)
    await db.commit()
    return {"status": "cleared", "session_id": session_id}
