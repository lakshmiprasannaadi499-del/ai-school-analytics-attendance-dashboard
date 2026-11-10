"""
Attendance analytics.

Reads a CSV / Excel attendance file, renames the columns to the names the
React dashboard expects, cleans the values and builds student-level data.

Attendance % = (Present + Late) / Total records * 100
(the same formula the React dashboard uses).
"""
from io import BytesIO
import re

import pandas as pd


# canonical column name -> accepted names in the uploaded file
ALIASES = {
    "Student_ID": [
        "student id", "studentid", "student no", "student number",
        "admission number", "admission no", "admission id", "id",
    ],
    "Student_Full_Name": [
        "student full name", "student name", "full name", "name",
        "student", "pupil name",
    ],
    "First_Name": ["first name", "firstname", "given name"],
    "Last_Name": ["last name", "lastname", "surname", "family name"],
    "Roll_Number": ["roll number", "roll no", "roll", "roll num"],
    "Gender": ["gender", "sex"],
    "Class": ["class", "grade", "standard", "std", "class name"],
    "Section": ["section", "sec", "division"],
    "Subject": ["subject", "subject name", "course"],
    "Attendance_Date": [
        "attendance date", "date", "day", "attendance day",
    ],
    "Attendance_Status": [
        "attendance status", "status", "attendance", "present absent",
    ],
    "Period": ["period", "period no", "lecture"],
    "Teacher_Name": ["teacher name", "teacher", "faculty", "faculty name"],
}

STATUS_MAP = {
    "present": "Present", "p": "Present", "presented": "Present",
    "pr": "Present", "yes": "Present", "1": "Present",
    "absent": "Absent", "a": "Absent", "absence": "Absent",
    "not present": "Absent", "ab": "Absent", "no": "Absent", "0": "Absent",
    "late": "Late", "l": "Late", "tardy": "Late",
}

RECORD_COLUMNS = [
    "Student_ID", "Student_Full_Name", "Roll_Number", "Gender", "Class",
    "Section", "Subject", "Attendance_Date", "Attendance_Status",
    "Period", "Teacher_Name",
]


def normalize_name(value):
    return re.sub(r"[^a-z0-9]+", " ", str(value).strip().lower()).strip()


def _records(frame):
    """DataFrame -> JSON-safe list of dicts."""
    if frame is None or frame.empty:
        return []
    out = frame.astype(object).where(pd.notna(frame), None)
    rows = out.to_dict(orient="records")
    for row in rows:
        for key, value in row.items():
            if hasattr(value, "item"):
                row[key] = value.item()
    return rows


def _read_file(file_bytes, filename):
    name = filename.lower()
    try:
        if name.endswith(".csv"):
            try:
                return pd.read_csv(BytesIO(file_bytes))
            except UnicodeDecodeError:
                return pd.read_csv(BytesIO(file_bytes), encoding="latin-1")
        if name.endswith(".xlsx"):
            return pd.read_excel(BytesIO(file_bytes), engine="openpyxl")
    except Exception as exc:
        raise ValueError(f"Could not read the uploaded file: {exc}") from exc
    raise ValueError("Please upload a .csv or .xlsx file.")


def _map_columns(df):
    """Return {canonical_name: actual_column_in_file}."""
    lookup = {}
    for col in df.columns:
        lookup.setdefault(normalize_name(col), col)

    mapping = {}
    for canonical, aliases in ALIASES.items():
        # the canonical name itself (Student_ID, Attendance_Date, ...) counts
        for candidate in [canonical] + aliases:
            key = normalize_name(candidate)
            if key in lookup and lookup[key] not in mapping.values():
                mapping[canonical] = lookup[key]
                break
    return mapping


def _clean_text(series):
    return (
        series.astype("string").str.strip()
        .replace({"": pd.NA, "nan": pd.NA, "None": pd.NA})
    )


def _parse_dates(series):
    """Excel dates stay as they are; text dates are read day-first (India)."""
    if pd.api.types.is_datetime64_any_dtype(series):
        return series
    parsed = pd.to_datetime(series, errors="coerce", dayfirst=True)
    # ISO strings (2026-11-01) must not be flipped by dayfirst
    iso = series.astype("string").str.match(r"^\d{4}-\d{2}-\d{2}")
    if iso.any():
        parsed = parsed.where(
            ~iso.fillna(False),
            pd.to_datetime(series, errors="coerce"),
        )
    return parsed


def _risk_label(rate):
    if rate >= 85:
        return "Good"
    if rate >= 75:
        return "Watch"
    return "At risk"


def load_and_analyse(file_bytes: bytes, filename: str):
    df = _read_file(file_bytes, filename)

    if df.empty:
        raise ValueError("The file has no data rows.")

    df.columns = [str(c).strip() for c in df.columns]
    if any(not c for c in df.columns):
        raise ValueError("Every column must have a column name.")
    if df.columns.duplicated().any():
        raise ValueError("The file has duplicate column names. Please rename them.")

    original_rows = len(df)
    df = df.dropna(how="all").copy()
    if df.empty:
        raise ValueError("The file has no non-empty data rows.")

    mapping = _map_columns(df)

    # ---- required columns -------------------------------------------------
    if "Attendance_Status" not in mapping:
        raise ValueError(
            "No attendance status column found. Add a column named "
            "'Attendance_Status' (or 'Status') with Present / Absent / Late. "
            f"Columns in your file: {', '.join(df.columns)}"
        )

    work = pd.DataFrame(index=df.index)
    for canonical, source in mapping.items():
        work[canonical] = df[source]

    # full name from first + last name when needed
    if "Student_Full_Name" not in work.columns:
        if "First_Name" in work.columns:
            last = work["Last_Name"] if "Last_Name" in work.columns else ""
            work["Student_Full_Name"] = (
                work["First_Name"].astype("string").fillna("")
                + " "
                + (last.astype("string").fillna("") if not isinstance(last, str) else last)
            ).str.strip()
    work = work.drop(columns=["First_Name", "Last_Name"], errors="ignore")

    # student identity
    if "Student_ID" not in work.columns:
        fallback = (
            "Roll_Number" if "Roll_Number" in work.columns
            else "Student_Full_Name" if "Student_Full_Name" in work.columns
            else None
        )
        if fallback is None:
            raise ValueError(
                "No student column found. Add 'Student_ID' or 'Student_Name'."
            )
        work["Student_ID"] = work[fallback]
    if "Student_Full_Name" not in work.columns:
        work["Student_Full_Name"] = work["Student_ID"]

    # make sure every dashboard column exists
    for col in RECORD_COLUMNS:
        if col not in work.columns:
            work[col] = pd.NA

    # ---- clean values -----------------------------------------------------
    for col in RECORD_COLUMNS:
        if col != "Attendance_Date":
            work[col] = _clean_text(work[col])

    work["Attendance_Status"] = (
        work["Attendance_Status"].str.lower().map(STATUS_MAP)
        .fillna(work["Attendance_Status"].str.title())
    )
    work["Student_ID"] = work["Student_ID"].str.replace(r"\.0$", "", regex=True)
    work["Roll_Number"] = work["Roll_Number"].str.replace(r"\.0$", "", regex=True)

    work["Attendance_Date"] = _parse_dates(work["Attendance_Date"])

    # rows without a student or a status cannot be analysed
    work = work.dropna(subset=["Student_ID", "Attendance_Status"]).copy()
    if work.empty:
        raise ValueError("No usable attendance rows (student + status) were found.")

    dropped_rows = original_rows - len(work)

    work["Attendance_Date"] = work["Attendance_Date"].dt.strftime("%Y-%m-%d")
    work = work[RECORD_COLUMNS]

    # ---- numbers ----------------------------------------------------------
    status = work["Attendance_Status"]
    present = int((status == "Present").sum())
    absent = int((status == "Absent").sum())
    late = int((status == "Late").sum())
    total = int(len(work))
    other = total - present - absent - late

    work["_p"] = (status == "Present").astype(int)
    work["_a"] = (status == "Absent").astype(int)
    work["_l"] = (status == "Late").astype(int)

    students = []
    for sid, grp in work.groupby("Student_ID", sort=False):
        first = grp.iloc[0]
        n = len(grp)
        p, a, l = int(grp["_p"].sum()), int(grp["_a"].sum()), int(grp["_l"].sum())
        rate = round((p + l) / n * 100, 1) if n else 0.0
        students.append({
            "Student_ID": sid,
            "Student_Full_Name": first["Student_Full_Name"],
            "Roll_Number": first["Roll_Number"],
            "Gender": first["Gender"],
            "Class": first["Class"],
            "Section": first["Section"],
            "Total_Records": n,
            "Present": p,
            "Absent": a,
            "Late": l,
            "Attendance_Percentage": rate,
            "Status_Label": _risk_label(rate),
        })
    students.sort(key=lambda s: s["Attendance_Percentage"])

    dates = work["Attendance_Date"].dropna()

    def uniq(col):
        return sorted(work[col].dropna().astype(str).unique().tolist())

    records = _records(work.drop(columns=["_p", "_a", "_l"]))

    summary = {
        "row_count": total,
        "dropped_rows": int(dropped_rows),
        "student_count": len(students),
        "present": present,
        "absent": absent,
        "late": late,
        "other": other,
        "attendance_rate": round((present + late) / total * 100, 2),
        "absence_rate": round(absent / total * 100, 2),
        "date_start": dates.min() if len(dates) else None,
        "date_end": dates.max() if len(dates) else None,
        "classes": uniq("Class"),
        "sections": uniq("Section"),
        "subjects": uniq("Subject"),
        "columns": [str(c) for c in df.columns],
        "detected_columns": mapping,
    }

    clean_csv = work.drop(columns=["_p", "_a", "_l"]).to_csv(index=False)

    return {
        "summary": summary,
        "dataset_type": "attendance",
        "attendance_available": True,
        "student_columns": mapping,
        "student_summary": students,
        "records": records,
        "cleaned_csv": clean_csv,
    }