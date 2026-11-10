
import pandas as pd

# 1. Read Excel file
file_path = r"C:\Users\prasa\Downloads\student_attendance_2000_records.xlsx"

df = pd.read_excel(file_path)

# 2. Convert date column into datetime format
df["Attendance_Date"] = pd.to_datetime(
    df["Attendance_Date"],
    errors="coerce"
)

# 3. Select the date you want to check
selected_date = "2026-10-08"

selected_date = pd.to_datetime(selected_date)

# 4. Filter rows for the selected date
filtered_rows = df[
    df["Attendance_Date"].dt.date == selected_date.date()
]

# 5. Display selected rows
print("\nRows for selected date:")
print(filtered_rows.to_string(index=False))

# 6. Display total number of matching rows
print("\nTotal matching rows:", len(filtered_rows))

# 7. Save selected rows into a new Excel file
filtered_rows.to_excel(
    "Selected_Date_Rows.xlsx",
    index=False
)

print("\nFiltered rows saved successfully!")
