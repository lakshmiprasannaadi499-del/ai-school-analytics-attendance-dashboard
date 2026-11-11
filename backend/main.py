from pathlib import Path

from dotenv import load_dotenv

# Works no matter which folder you start uvicorn from.
load_dotenv(Path(__file__).resolve().parent / ".env")

import json
from typing import List, Optional

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .analytics import load_and_analyse
from .database import Base, engine, get_db
from .llm import answer_question, llm_status
from .models import AttendanceUpload

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Scholarly Attendance Analytics API", version="3.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://192.168.0.3:5173",
        "https://ai-school-analytics-attendance-dash.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Most recently uploaded dataset (kept in memory, resets on restart)
active_analysis = None

MAX_UPLOAD_BYTES = 10 * 1024 * 1024


class ChatTurn(BaseModel):
    role: str
    content: str = Field(max_length=2000)


class AskRequest(BaseModel):
    question: str = Field(min_length=2, max_length=1000)
    history: Optional[List[ChatTurn]] = None


def require_attendance():
    if not active_analysis:
        raise HTTPException(status_code=400, detail="Upload a dataset first.")
    return active_analysis


@app.get("/")
def root():
    return {"message": "Scholarly Attendance API is running", "docs": "/docs"}


@app.get("/api/health")
def health():
    return {"status": "ok", "dataset_loaded": active_analysis is not None}


@app.get("/api/llm/status")
def ai_status():
    """Open this in the browser to check that Ollama and your model are ready."""
    return llm_status()


@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...), db: Session = Depends(get_db)):
    global active_analysis

    filename = file.filename or "uploaded_file"
    if not filename.lower().endswith((".csv", ".xlsx")):
        raise HTTPException(status_code=400, detail="Upload a CSV or .xlsx Excel file.")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File too large; maximum size is 10 MB.")

    try:
        result = load_and_analyse(content, filename)
    except Exception as exc:
        raise HTTPException(
            status_code=400, detail=f"Could not analyse the uploaded file: {exc}"
        ) from exc

    summary = result["summary"]

    try:
        record = AttendanceUpload(
            filename=filename,
            row_count=summary["row_count"],
            student_count=summary["student_count"],
            present_count=summary["present"],
            absent_count=summary["absent"],
            late_count=summary["late"],
            attendance_rate=summary["attendance_rate"],
            summary_json=json.dumps(summary, default=str),
        )
        db.add(record)
        db.commit()
        db.refresh(record)
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="The dataset was analysed, but upload history could not be saved.",
        ) from exc

    # Only replace the active dataset after everything succeeded.
    active_analysis = result

    return {
        "upload_id": record.id,
        "filename": filename,
        "dataset_type": "attendance",
        "summary": summary,
        "columns": summary["columns"],
        "detected_columns": summary["detected_columns"],
        "attendance_available": True,
        "student_columns": result["student_columns"],
        "student_summary": result["student_summary"],
        "records": result["records"],
        "dropped_rows": summary["dropped_rows"],
    }


@app.get("/api/students")
def get_students():
    analysis = require_attendance()
    students = analysis["student_summary"]
    return {"total_students": len(students), "students": students}


@app.get("/api/students/{student_id}/attendance")
def get_student_attendance(student_id: str):
    analysis = require_attendance()
    wanted = student_id.strip().lower()

    student = next(
        (
            s for s in analysis["student_summary"]
            if str(s.get("Student_ID", "")).strip().lower() == wanted
            or str(s.get("Student_Full_Name", "")).strip().lower() == wanted
        ),
        None,
    )
    if student is None:
        raise HTTPException(status_code=404, detail="Student not found.")

    sid = str(student["Student_ID"])
    history = [r for r in analysis["records"] if str(r.get("Student_ID")) == sid]
    return {
        "student": student,
        "total_records": len(history),
        "attendance_history": history,
    }


@app.get("/api/history")
def upload_history(db: Session = Depends(get_db)):
    rows = db.query(AttendanceUpload).order_by(AttendanceUpload.id.desc()).limit(20).all()
    return [
        {
            "id": r.id,
            "filename": r.filename,
            "row_count": r.row_count,
            "student_count": r.student_count,
            "present": r.present_count,
            "absent": r.absent_count,
            "late": r.late_count,
            "attendance_rate": r.attendance_rate,
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]


@app.post("/api/ask")
def ask(body: AskRequest):
    """Chat endpoint used by the floating Ask AI popup."""
    try:
        answer = answer_question(
            body.question,
            active_analysis,  # may be None: project questions still work
            [t.model_dump() for t in body.history] if body.history else None,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail="Could not answer the question. Please try again."
        ) from exc

    return {
        "question": body.question,
        "answer": answer,
        "dataset_loaded": active_analysis is not None,
    }


@app.get("/api/download")
def download():
    analysis = require_attendance()
    return Response(
        content=analysis["cleaned_csv"],
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="attendance_cleaned.csv"'},
    )
