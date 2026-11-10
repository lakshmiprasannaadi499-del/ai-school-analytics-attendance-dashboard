# InsightIQ – School Attendance Dashboard update

## Files in this patch

- `frontend/src/App.jsx` – school-level and class-level dashboard views.
- `frontend/src/styles.css` – matching InsightIQ theme and responsive layout.

## Apply to your existing project

1. Make a backup of your existing `frontend/src/App.jsx` and `frontend/src/styles.css`.
2. Replace those two files with the files in this patch.
3. Keep your existing `frontend/src/main.jsx`, `index.html`, `package.json`, backend files and project folders.
4. Ensure these frontend packages are installed:
   ```bash
   npm install axios react-plotly.js plotly.js
   ```
5. Start the backend in terminal 1:
   ```powershell
   .\.venv\Scripts\Activate.ps1
   uvicorn backend.main:app --reload
   ```
6. Start the frontend in terminal 2:
   ```bash
   cd frontend
   npm run dev
   ```
7. Upload `Student_Attendance_2000_Records.xlsx`.

## Backend contract expected by this frontend

The existing `POST /api/upload` endpoint should accept a multipart field named `file`, read the first Excel sheet (the workbook's first sheet is `Attendance_Data`), and return JSON with at least:

```json
{
  "filename": "Student_Attendance_2000_Records.xlsx",
  "records": [
    {
      "Student_ID": "STU0001",
      "Student_Full_Name": "Example Name",
      "Class": "Class 6",
      "Section": "A",
      "Subject": "Mathematics",
      "Gender": "Boy",
      "Attendance_Date": "2026-10-01",
      "Attendance_Status": "Present"
    }
  ]
}
```

The frontend uses the existing `/api/upload` endpoint and expects `records` to contain the rows from `Attendance_Data`. The other backend endpoints are not changed by this patch. If your current API returns a different response shape, adjust only the response mapping in `upload()` after checking the actual response in the browser Network tab.

## School-level filters

- Class
- Section
- Subject
- Gender
- Attendance status
- Attendance mode
- From date
- To date

All filters update the KPI cards, charts and class summary table together.

## Dashboard navigation

Use the `Go to dashboard` dropdown to switch between:
- School-Level Dashboard
- Class-Level Dashboard

The class table also has a `View class` action. The class view includes subject-wise attendance, section-wise attendance, daily trend and a low-attendance student watchlist.

## Attendance formula

Attendance rate = (Present records + Late records) / Total attendance records × 100.

Late is counted as attended. This is a session-based percentage, not a count of unique calendar days.

## Important dataset note

The workbook has 2,000 attendance rows for 200 unique synthetic students, with 10 records per student. It covers Class 6 through Class 10 only. The dashboard should not be labelled LKG–10 because the workbook has no LKG–Class 5 data.
