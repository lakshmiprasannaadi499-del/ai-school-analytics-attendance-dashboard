import React, { useMemo, useState } from 'react'
import axios from 'axios'
import Plot from 'react-plotly.js'
import './styles.css'
import AIChatbot from './components/AIChatbot.jsx'

const API_HOST =
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1'
    ? 'http://127.0.0.1:8000'
    : 'http://192.168.0.3:8000';

const API = `${API_HOST}/api`;

const ALL = '__ALL__'
const REPEATED_ABSENCE_LIMIT = 3

const number = value =>
  new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: 1
  }).format(Number(value || 0))

const percent = value => `${number(value)}%`

const dateKey = value => {
  if (!value) return ''
  const raw = String(value).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : ''
}

// Normalize common attendance labels before calculating time-based charts.
const attendanceStatus = value => {
  const status = String(value ?? '').trim().toLowerCase().replace(/[ _-]+/g, ' ')
  if (['present', 'p', 'presented'].includes(status)) return 'present'
  if (['absent', 'a', 'absence', 'not present'].includes(status)) return 'absent'
  if (['late', 'l', 'tardy'].includes(status)) return 'late'
  return status
}

const monthLabel = monthKey => {
  const [year, month] = monthKey.split('-').map(Number)
  return new Date(year, month - 1, 1).toLocaleDateString('en-US', {
    month: 'short', year: 'numeric'
  })
}

const unique = (rows, field) =>
  [...new Set(
    rows.map(row => String(row[field] ?? '').trim()).filter(Boolean)
  )]

const classSort = (a, b) => {
  const na = Number(String(a).match(/\d+/)?.[0] || 0)
  const nb = Number(String(b).match(/\d+/)?.[0] || 0)
  return na - nb || String(a).localeCompare(String(b))
}

function KPI({ label, value, hint, tone = 'pink', icon }) {
  return (
    <section className={`kpi ${tone}`}>
      <div className="kpi-top">
        <span className="kpi-label">{label}</span>
        <span className="kpi-icon">{icon}</span>
      </div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-hint">{hint}</div>
    </section>
  )
}

function Panel({ title, subtitle, children, className = '' }) {
  return (
    <section className={`panel chart-panel ${className}`}>
      <div className="panel-heading">
        <div>
          <h3>{title}</h3>
          {subtitle && <p className="muted">{subtitle}</p>}
        </div>
      </div>
      {children}
    </section>
  )
}

function SelectFilter({ label, value, options, onChange }) {
  return (
    <label className="filter-control">
      <span>{label}</span>
      <select
        value={value}
        onChange={event => onChange(event.target.value)}
      >
        <option value={ALL}>All {label.toLowerCase()}</option>
        {options.map(option => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  )
}

function EmptyState({ children }) {
  return <div className="empty-state">{children}</div>
}

function App() {
  const [file, setFile] = useState(null)
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const [view, setView] = useState('school')
  const [classSelected, setClassSelected] = useState('')
  const [selectedStudentId, setSelectedStudentId] = useState('')
  const [studentSearch, setStudentSearch] = useState('')
  const [absenteeDate, setAbsenteeDate] = useState('')

  const [filters, setFilters] = useState({
    class: ALL,
    section: ALL,
    subject: ALL,
    gender: ALL,
    status: ALL,
    startDate: '',
    endDate: ''
  })

  const records = data?.records || []

  // Detect column names from the uploaded Excel file.
  const fields = useMemo(() => {
    if (!records.length) return {}

    const first = records[0]

    const find = (...names) =>
      names.find(name =>
        Object.prototype.hasOwnProperty.call(first, name)
      )

    return {
      studentId: find('Student_ID', 'student_id', 'Student ID'),
      studentName: find(
        'Student_Full_Name',
        'student_full_name',
        'Student Full Name',
        'Student_Name',
        'student_name'
      ),
      roll: find('Roll_Number', 'roll_number', 'Roll Number'),
      gender: find('Gender', 'gender'),
      className: find('Class', 'class'),
      section: find('Section', 'section'),
      subject: find('Subject', 'subject'),
      date: find(
        'Attendance_Date',
        'attendance_date',
        'Date',
        'date'
      ),
      status: find(
        'Attendance_Status',
        'attendance_status',
        'Status',
        'status'
      ),
      period: find('Period', 'period'),
      teacher: find('Teacher_Name', 'teacher_name')
    }
  }, [records])

  // Dropdown options.
  const classOptions = useMemo(
    () => unique(records, fields.className).sort(classSort),
    [records, fields.className]
  )

  const sectionOptions = useMemo(
    () => unique(records, fields.section).sort(),
    [records, fields.section]
  )

  const subjectOptions = useMemo(
    () => unique(records, fields.subject).sort(),
    [records, fields.subject]
  )

  const genderOptions = useMemo(
    () => unique(records, fields.gender).sort(),
    [records, fields.gender]
  )

  const dateRange = useMemo(() => {
    const dates = records
      .map(row => dateKey(row[fields.date]))
      .filter(Boolean)
      .sort()

    return {
      min: dates[0] || '',
      max: dates[dates.length - 1] || ''
    }
  }, [records, fields])

  // Apply all school-wide filters, including status.
  const filteredRows = useMemo(() => {
    return records.filter(row => {
      const rowDate = dateKey(row[fields.date])
      const status = String(row[fields.status] || '').toLowerCase()

      if (
        filters.class !== ALL &&
        String(row[fields.className]) !== filters.class
      ) return false

      if (
        filters.section !== ALL &&
        String(row[fields.section]) !== filters.section
      ) return false

      if (
        filters.subject !== ALL &&
        String(row[fields.subject]) !== filters.subject
      ) return false

      if (
        filters.gender !== ALL &&
        String(row[fields.gender]) !== filters.gender
      ) return false

      if (
        filters.status !== ALL &&
        status !== filters.status.toLowerCase()
      ) return false

      if (filters.startDate && rowDate && rowDate < filters.startDate)
        return false

      if (filters.endDate && rowDate && rowDate > filters.endDate)
        return false

      return true
    })
  }, [records, fields, filters])

  // Absentee filters deliberately ignore the general Status filter.
  // Otherwise selecting Present in the main filter would hide all absentees.
  const absenteeFilteredRows = useMemo(() => {
    return records.filter(row => {
      const rowDate = dateKey(row[fields.date])

      if (
        filters.class !== ALL &&
        String(row[fields.className]) !== filters.class
      ) return false

      if (
        filters.section !== ALL &&
        String(row[fields.section]) !== filters.section
      ) return false

      if (
        filters.subject !== ALL &&
        String(row[fields.subject]) !== filters.subject
      ) return false

      if (
        filters.gender !== ALL &&
        String(row[fields.gender]) !== filters.gender
      ) return false

      if (filters.startDate && rowDate && rowDate < filters.startDate)
        return false

      if (filters.endDate && rowDate && rowDate > filters.endDate)
        return false

      return true
    })
  }, [records, fields, filters])

  // School-level statistics.
  const stats = useMemo(() => {
    const present = filteredRows.filter(
      r => String(r[fields.status]).toLowerCase() === 'present'
    ).length

    const absent = filteredRows.filter(
      r => String(r[fields.status]).toLowerCase() === 'absent'
    ).length

    const late = filteredRows.filter(
      r => String(r[fields.status]).toLowerCase() === 'late'
    ).length

    const total = filteredRows.length
    const attended = present + late

    return {
      total,
      present,
      absent,
      late,
      students: new Set(
        filteredRows.map(r => r[fields.studentId]).filter(Boolean)
      ).size,
      attendanceRate: total ? attended / total * 100 : 0,
      absenceRate: total ? absent / total * 100 : 0
    }
  }, [filteredRows, fields])

  // Student-level aggregation.
  const studentSummary = useMemo(() => {
    const groups = new Map()

    filteredRows.forEach(row => {
      const id = String(row[fields.studentId] ?? '').trim()
      if (!id) return

      if (!groups.has(id)) {
        groups.set(id, {
          id,
          name: row[fields.studentName] || 'Unknown student',
          roll: row[fields.roll] || '—',
          gender: row[fields.gender] || '—',
          className: row[fields.className] || '—',
          section: row[fields.section] || '—',
          total: 0,
          present: 0,
          absent: 0,
          late: 0
        })
      }

      const item = groups.get(id)
      item.total += 1

      const status = String(row[fields.status] || '').toLowerCase()

      if (status === 'present') item.present++
      if (status === 'absent') item.absent++
      if (status === 'late') item.late++
    })

    return [...groups.values()]
      .map(item => ({
        ...item,
        rate: item.total
          ? (item.present + item.late) / item.total * 100
          : 0
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [filteredRows, fields])

  // Student search.
  const searchableStudents = useMemo(() => {
    const query = studentSearch.toLowerCase().trim()

    return studentSummary.filter(student =>
      !query ||
      student.name.toLowerCase().includes(query) ||
      student.id.toLowerCase().includes(query) ||
      String(student.roll).toLowerCase().includes(query)
    )
  }, [studentSummary, studentSearch])

  const selectedStudent = useMemo(
    () => studentSummary.find(
      student => student.id === selectedStudentId
    ),
    [studentSummary, selectedStudentId]
  )

  // Attendance history of the selected student.
  const studentHistory = useMemo(() => {
    if (!selectedStudent) return []

    return filteredRows
      .filter(row =>
        String(row[fields.studentId]) === selectedStudent.id
      )
      .sort((a, b) =>
        dateKey(b[fields.date]).localeCompare(dateKey(a[fields.date]))
      )
  }, [filteredRows, fields, selectedStudent])

  // Student subject-wise analytics.
  const studentSubjects = useMemo(() => {
    const groups = new Map()

    studentHistory.forEach(row => {
      const subject = String(row[fields.subject] || 'Unknown')

      if (!groups.has(subject)) {
        groups.set(subject, {
          subject,
          total: 0,
          present: 0,
          absent: 0,
          late: 0
        })
      }

      const item = groups.get(subject)
      item.total++

      const status = String(row[fields.status] || '').toLowerCase()

      if (status === 'present') item.present++
      if (status === 'absent') item.absent++
      if (status === 'late') item.late++
    })

    return [...groups.values()].map(item => ({
      ...item,
      rate: item.total
        ? (item.present + item.late) / item.total * 100
        : 0
    }))
  }, [studentHistory, fields])

  // ==========================================
  // FIFTH DASHBOARD: SUBJECT-WISE ANALYTICS
  // ==========================================

  const subjectSummary = useMemo(() => {
    const groups = new Map()

    filteredRows.forEach(row => {
      const subject = String(row[fields.subject] || 'Unknown')

      if (!groups.has(subject)) {
        groups.set(subject, {
          subject,
          total: 0,
          present: 0,
          absent: 0,
          late: 0,
          students: new Set()
        })
      }

      const item = groups.get(subject)
      item.total++

      if (row[fields.studentId]) {
        item.students.add(String(row[fields.studentId]))
      }

      const status = String(row[fields.status] || '').toLowerCase()

      if (status === 'present') item.present++
      if (status === 'absent') item.absent++
      if (status === 'late') item.late++
    })

    return [...groups.values()]
      .map(item => ({
        ...item,
        studentCount: item.students.size,
        attendanceRate: item.total
          ? (item.present + item.late) / item.total * 100
          : 0,
        absenceRate: item.total
          ? item.absent / item.total * 100
          : 0
      }))
      .sort((a, b) => a.subject.localeCompare(b.subject))
  }, [filteredRows, fields])

  const subjectStats = useMemo(() => {
    const total = subjectSummary.reduce(
      (sum, item) => sum + item.total, 0
    )

    const present = subjectSummary.reduce(
      (sum, item) => sum + item.present, 0
    )

    const absent = subjectSummary.reduce(
      (sum, item) => sum + item.absent, 0
    )

    const late = subjectSummary.reduce(
      (sum, item) => sum + item.late, 0
    )

    const attended = present + late

    return {
      totalSubjects: subjectSummary.length,
      total,
      present,
      absent,
      late,
      attendanceRate: total ? attended / total * 100 : 0
    }
  }, [subjectSummary])

  // Class-level aggregation.
  const classSummary = useMemo(() => {
    const groups = new Map()

    filteredRows.forEach(row => {
      const name = String(row[fields.className] || 'Unknown')

      if (!groups.has(name)) {
        groups.set(name, {
          className: name,
          students: new Set(),
          total: 0,
          present: 0,
          absent: 0,
          late: 0
        })
      }

      const item = groups.get(name)
      item.total++

      if (row[fields.studentId])
        item.students.add(row[fields.studentId])

      const status = String(row[fields.status] || '').toLowerCase()

      if (status === 'present') item.present++
      if (status === 'absent') item.absent++
      if (status === 'late') item.late++
    })

    return [...groups.values()]
      .map(item => ({
        ...item,
        studentCount: item.students.size,
        rate: item.total
          ? (item.present + item.late) / item.total * 100
          : 0
      }))
      .sort((a, b) => classSort(a.className, b.className))
  }, [filteredRows, fields])

  // Daily attendance trend.
  const dailyTrend = useMemo(() => {
    const groups = new Map()

    filteredRows.forEach(row => {
      const date = dateKey(row[fields.date])
      if (!date) return

      if (!groups.has(date))
        groups.set(date, { date, total: 0, attended: 0 })

      const item = groups.get(date)
      item.total++

      const status = String(row[fields.status] || '').toLowerCase()

      if (status === 'present' || status === 'late')
        item.attended++
    })

    return [...groups.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(item => ({
        ...item,
        rate: item.total ? item.attended / item.total * 100 : 0
      }))
  }, [filteredRows, fields])


  // ==========================================
  // SIXTH DASHBOARD: TIME-BASED ANALYTICS
  // This view ignores the general Status filter so all statuses
  // remain available when calculating attendance and absence rates.
  // ==========================================

  const timeFilteredRows = useMemo(() => {
    return records.filter(row => {
      const rowDate = dateKey(row[fields.date])

      if (filters.class !== ALL &&
          String(row[fields.className]) !== filters.class) return false
      if (filters.section !== ALL &&
          String(row[fields.section]) !== filters.section) return false
      if (filters.subject !== ALL &&
          String(row[fields.subject]) !== filters.subject) return false
      if (filters.gender !== ALL &&
          String(row[fields.gender]) !== filters.gender) return false
      if (filters.startDate && rowDate && rowDate < filters.startDate) return false
      if (filters.endDate && rowDate && rowDate > filters.endDate) return false

      return true
    })
  }, [records, fields, filters])

  const timeDailyTrend = useMemo(() => {
    const groups = new Map()

    timeFilteredRows.forEach(row => {
      const date = dateKey(row[fields.date])
      if (!date) return

      if (!groups.has(date)) {
        groups.set(date, {
          date, total: 0, present: 0, absent: 0, late: 0, attended: 0
        })
      }

      const item = groups.get(date)
      item.total++
      const status = attendanceStatus(row[fields.status])
      if (status === 'present') item.present++
      if (status === 'absent') item.absent++
      if (status === 'late') item.late++
      if (status === 'present' || status === 'late') item.attended++
    })

    return [...groups.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(item => ({
        ...item,
        attendanceRate: item.total ? item.attended / item.total * 100 : 0,
        absenceRate: item.total ? item.absent / item.total * 100 : 0
      }))
  }, [timeFilteredRows, fields])

  const weeklyTrend = useMemo(() => {
    const groups = new Map()

    timeDailyTrend.forEach(dayItem => {
      const dateObj = new Date(`${dayItem.date}T00:00:00`)
      const day = dateObj.getDay()
      const diff = day === 0 ? -6 : 1 - day
      dateObj.setDate(dateObj.getDate() + diff)
      const weekStart = [
        dateObj.getFullYear(),
        String(dateObj.getMonth() + 1).padStart(2, '0'),
        String(dateObj.getDate()).padStart(2, '0')
      ].join('-')

      if (!groups.has(weekStart)) {
        groups.set(weekStart, {
          weekStart, total: 0, present: 0, absent: 0, late: 0, attended: 0
        })
      }

      const item = groups.get(weekStart)
      item.total += dayItem.total
      item.present += dayItem.present
      item.absent += dayItem.absent
      item.late += dayItem.late
      item.attended += dayItem.attended
    })

    return [...groups.values()]
      .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
      .map(item => ({
        ...item,
        label: `Week of ${item.weekStart}`,
        attendanceRate: item.total ? item.attended / item.total * 100 : 0,
        absenceRate: item.total ? item.absent / item.total * 100 : 0
      }))
  }, [timeDailyTrend])

  const monthlyTrend = useMemo(() => {
    const groups = new Map()

    timeDailyTrend.forEach(dayItem => {
      const month = dayItem.date.slice(0, 7)
      if (!groups.has(month)) {
        groups.set(month, {
          month, label: monthLabel(month), total: 0, present: 0, absent: 0, late: 0, attended: 0
        })
      }

      const item = groups.get(month)
      item.total += dayItem.total
      item.present += dayItem.present
      item.absent += dayItem.absent
      item.late += dayItem.late
      item.attended += dayItem.attended
    })

    return [...groups.values()]
      .sort((a, b) => a.month.localeCompare(b.month))
      .map(item => ({
        ...item,
        attendanceRate: item.total ? item.attended / item.total * 100 : 0,
        absenceRate: item.total ? item.absent / item.total * 100 : 0
      }))
  }, [timeDailyTrend])

  const weekdaySummary = useMemo(() => {
    const names = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    const groups = names.map(day => ({
      day, total: 0, present: 0, absent: 0, late: 0, attended: 0
    }))

    timeFilteredRows.forEach(row => {
      const date = dateKey(row[fields.date])
      if (!date) return

      const jsDay = new Date(`${date}T00:00:00`).getDay()
      const index = jsDay === 0 ? 6 : jsDay - 1
      const item = groups[index]
      item.total++

      const status = attendanceStatus(row[fields.status])
      if (status === 'present') item.present++
      if (status === 'absent') item.absent++
      if (status === 'late') item.late++
      if (status === 'present' || status === 'late') item.attended++
    })

    return groups.map(item => ({
      ...item,
      attendanceRate: item.total ? item.attended / item.total * 100 : 0,
      absenceRate: item.total ? item.absent / item.total * 100 : 0
    }))
  }, [timeFilteredRows, fields])

  const mondayFridayComparison = useMemo(() => {
    const monday = weekdaySummary.find(item => item.day === 'Monday')
    const friday = weekdaySummary.find(item => item.day === 'Friday')
    return [monday, friday].filter(Boolean)
  }, [weekdaySummary])

  const averageRate = rows => rows.length
    ? rows.reduce((sum, item) => sum + item.attendanceRate, 0) / rows.length
    : 0

  const dailyAverage = averageRate(timeDailyTrend)
  const weeklyAverage = averageRate(weeklyTrend)
  const monthlyAverage = averageRate(monthlyTrend)

  const attendanceMovement = useMemo(() => {
    const midpoint = Math.floor(timeDailyTrend.length / 2)
    const firstHalf = timeDailyTrend.slice(0, midpoint)
    const secondHalf = timeDailyTrend.slice(midpoint)
    const average = rows => rows.length
      ? rows.reduce((sum, item) => sum + item.attendanceRate, 0) / rows.length
      : 0
    const earlierAverage = average(firstHalf)
    const laterAverage = average(secondHalf)
    const change = laterAverage - earlierAverage
    const status = timeDailyTrend.length < 2
      ? 'Insufficient data'
      : change > 0.1
        ? 'Improved'
        : change < -0.1
          ? 'Declined'
          : 'Stable'

    return { earlierAverage, laterAverage, change, status }
  }, [timeDailyTrend])

  // ==========================================
  // ABSENTEES DASHBOARD DATA
  // ==========================================

  // All available dates, newest first.
  const absenteeDates = useMemo(() => {
    return [...new Set(
      absenteeFilteredRows
        .map(row => dateKey(row[fields.date]))
        .filter(Boolean)
    )].sort((a, b) => b.localeCompare(a))
  }, [absenteeFilteredRows, fields])

  // Selected date, defaulting to the latest available date.
  const selectedAbsenteeDate =
    absenteeDates.includes(absenteeDate)
      ? absenteeDate
      : absenteeDates[0] || ''

  // Absent records on the selected date.
  const absentTodayRows = useMemo(() => {
    return absenteeFilteredRows.filter(row =>
      dateKey(row[fields.date]) === selectedAbsenteeDate &&
      String(row[fields.status] || '').trim().toLowerCase() === 'absent'
    )
  }, [absenteeFilteredRows, fields, selectedAbsenteeDate])

  // All absences grouped by student.
  const absenteeStudentSummary = useMemo(() => {
    const groups = new Map()

    absenteeFilteredRows.forEach(row => {
      const status = String(row[fields.status] || '').trim().toLowerCase()
      if (status !== 'absent') return

      const id = String(row[fields.studentId] ?? '').trim()
      if (!id) return

      if (!groups.has(id)) {
        groups.set(id, {
          id,
          name: row[fields.studentName] || 'Unknown student',
          roll: row[fields.roll] || '—',
          className: row[fields.className] || '—',
          section: row[fields.section] || '—',
          absences: 0,
          latestDate: ''
        })
      }

      const student = groups.get(id)
      student.absences++

      const date = dateKey(row[fields.date])
      if (date > student.latestDate) {
        student.latestDate = date
      }
    })

    return [...groups.values()]
      .sort((a, b) =>
        b.absences - a.absences || a.name.localeCompare(b.name)
      )
  }, [absenteeFilteredRows, fields])

  // Unique students absent on the selected date.
  const followUpStudents = useMemo(() => {
    const groups = new Map()

    absentTodayRows.forEach(row => {
      const id = String(row[fields.studentId] ?? '').trim()
      if (!id) return

      if (!groups.has(id)) {
        groups.set(id, {
          id,
          name: row[fields.studentName] || 'Unknown student',
          roll: row[fields.roll] || '—',
          className: row[fields.className] || '—',
          section: row[fields.section] || '—',
          subjects: new Set()
        })
      }

      const student = groups.get(id)

      if (row[fields.subject]) {
        student.subjects.add(String(row[fields.subject]))
      }
    })

    return [...groups.values()]
      .map(student => ({
        ...student,
        subjects: [...student.subjects].join(', ') || '—'
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [absentTodayRows, fields])

  // Repeated absentees: 3 or more absent records.
  const repeatedAbsentees = absenteeStudentSummary.filter(
    student => student.absences >= REPEATED_ABSENCE_LIMIT
  )

  // Top 10 students with the most absences.
  const mostAbsentStudents = absenteeStudentSummary.slice(0, 10)

  // Absentees grouped by class.
  const absenteesByClass = useMemo(() => {
    const groups = new Map()

    absenteeFilteredRows.forEach(row => {
      if (
        String(row[fields.status] || '').trim().toLowerCase() !== 'absent'
      ) return

      const className = String(row[fields.className] || 'Unknown')
      groups.set(className, (groups.get(className) || 0) + 1)
    })

    return [...groups.entries()]
      .map(([className, count]) => ({ className, count }))
      .sort((a, b) => classSort(a.className, b.className))
  }, [absenteeFilteredRows, fields])

  // Absentees grouped by subject.
  const absenteesBySubject = useMemo(() => {
    const groups = new Map()

    absenteeFilteredRows.forEach(row => {
      if (
        String(row[fields.status] || '').trim().toLowerCase() !== 'absent'
      ) return

      const subject = String(row[fields.subject] || 'Unknown')
      groups.set(subject, (groups.get(subject) || 0) + 1)
    })

    return [...groups.entries()]
      .map(([subject, count]) => ({ subject, count }))
      .sort((a, b) => b.count - a.count)
  }, [absenteeFilteredRows, fields])

  // Absentees grouped by date.
  const absenteesByDate = useMemo(() => {
    const groups = new Map()

    absenteeFilteredRows.forEach(row => {
      if (
        String(row[fields.status] || '').trim().toLowerCase() !== 'absent'
      ) return

      const date = dateKey(row[fields.date])
      if (!date) return

      groups.set(date, (groups.get(date) || 0) + 1)
    })

    return [...groups.entries()]
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date))
  }, [absenteeFilteredRows, fields])

  const totalAbsences = absenteeStudentSummary.reduce(
    (sum, student) => sum + student.absences,
    0
  )

  const chartLayout = {
    autosize: true,
    margin: { l: 45, r: 15, t: 20, b: 55 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: {
      family: 'DM Sans, sans-serif',
      color: '#77758D',
      size: 11
    },
    xaxis: { gridcolor: '#F3EAF0', automargin: true },
    yaxis: { gridcolor: '#F3EAF0', automargin: true },
    showlegend: false
  }

  const plotConfig = {
    responsive: true,
    displayModeBar: false
  }

  function updateFilter(key, value) {
    setFilters(old => ({ ...old, [key]: value }))
  }

  function resetFilters() {
    setFilters({
      class: ALL,
      section: ALL,
      subject: ALL,
      gender: ALL,
      status: ALL,
      startDate: '',
      endDate: ''
    })
  }

  async function upload() {
    if (!file) {
      setError('Please select your student attendance Excel file.')
      return
    }

    setBusy(true)
    setError('')

    const form = new FormData()
    form.append('file', file)

    try {
      const response = await axios.post(`${API}/upload`, form)
      const payload = response.data

      if (!payload.records?.length) {
        throw new Error(
          'No attendance records returned. Please check analytics.py.'
        )
      }

      setData(payload)
      setView('school')
      setStudentSearch('')
      setAbsenteeDate('')

      setFilters({
        class: ALL,
        section: ALL,
        subject: ALL,
        gender: ALL,
        status: ALL,
        startDate: '',
        endDate: ''
      })

      const first = payload.records[0]

      setSelectedStudentId(
        String(
          first.Student_ID ??
          first.student_id ??
          first['Student ID'] ??
          ''
        )
      )

      const classes = unique(payload.records, 'Class').sort(classSort)
      setClassSelected(classes[0] || '')

    } catch (err) {
      setError(
        err.response?.data?.detail ||
        err.message ||
        'Upload failed. Check the backend.'
      )
    } finally {
      setBusy(false)
    }
  }

  function downloadCSV() {
    if (!selectedStudent) return

    const headers = [
      'Student ID',
      'Student Name',
      'Class',
      'Section',
      'Subject',
      'Attendance Date',
      'Status'
    ]

    const rows = studentHistory.map(row => [
      row[fields.studentId],
      row[fields.studentName],
      row[fields.className],
      row[fields.section],
      row[fields.subject],
      row[fields.date],
      row[fields.status]
    ])

    const escapeCSV = value =>
      `"${String(value ?? '').replace(/"/g, '""')}"`

    const csv = [
      headers.map(escapeCSV).join(','),
      ...rows.map(row => row.map(escapeCSV).join(','))
    ].join('\n')

    const url = URL.createObjectURL(
      new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    )

    const link = document.createElement('a')
    link.href = url
    link.download = `${selectedStudent.id}_attendance.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  // Export absentee follow-up list.
  function downloadAbsenteeCSV() {
    const headers = [
      'Student ID',
      'Student Name',
      'Roll Number',
      'Class',
      'Section',
      'Absent Subjects',
      'Attendance Date'
    ]

    const rows = followUpStudents.map(student => [
      student.id,
      student.name,
      student.roll,
      student.className,
      student.section,
      student.subjects,
      selectedAbsenteeDate
    ])

    const escapeCSV = value =>
      `"${String(value ?? '').replace(/"/g, '""')}"`

    const csv = [
      headers.map(escapeCSV).join(','),
      ...rows.map(row => row.map(escapeCSV).join(','))
    ].join('\n')

    const url = URL.createObjectURL(
      new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    )

    const link = document.createElement('a')
    link.href = url
    link.download = `absentee_followup_${selectedAbsenteeDate || 'report'}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const rateClass = rate =>
    rate >= 85 ? 'good' : rate >= 75 ? 'medium' : 'low'

  return (
    <div className="app">

      {/* SIDEBAR */}
      <aside className="sidebar">
        <div className="brand">
          <div className="logo">S</div>
          <div>
            <h2>Scholarly</h2>
            <small>ATTENDANCE ANALYTICS</small>
          </div>
        </div>

        <p className="nav-label">WORKSPACE</p>

        <button
          className={`nav ${view === 'school' ? 'active' : ''}`}
          onClick={() => setView('school')}
        >
          <span>▦</span> School overview
        </button>

        <button
          className={`nav ${view === 'class' ? 'active' : ''}`}
          onClick={() => setView('class')}
          disabled={!data}
        >
          <span>▤</span> Class analytics
        </button>

        <button
          className={`nav ${view === 'student' ? 'active' : ''}`}
          onClick={() => setView('student')}
          disabled={!data}
        >
          <span>♙</span> Student analytics
        </button>

        <button
          className={`nav ${view === 'absentees' ? 'active' : ''}`}
          onClick={() => setView('absentees')}
          disabled={!data}
        >
          <span style={{ marginLeft: '3px', display: 'inline-block', width: '16px' }}>⚑</span> Absentees
        </button>

        {/* FIFTH SIDEBAR OPTION */}
        <button
          className={`nav ${view === 'subject' ? 'active' : ''}`}
          onClick={() => setView('subject')}
          disabled={!data}
        >
          <span>▥</span> Subject-wise analytics
        </button>

        {/* SIXTH SIDEBAR OPTION */}
        <button
          className={`nav ${view === 'time' ? 'active' : ''}`}
          onClick={() => setView('time')}
          disabled={!data}
        >
          <span>◷</span> Time-Based Analytics
        </button>

        <div className="sidebar-bottom">
          <div className="status-dot" />
          System online
          <p>Education Intelligence Platform</p>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main className="main">

        <header className="page-header">
          <div>
            <small className="eyebrow">
              EDUCATION / ATTENDANCE MANAGEMENT
            </small>
            <h1>Attendance Dashboard</h1>
            <p className="muted">
              Monitor student performance and attendance patterns.
            </p>
          </div>

          <span className="pill">✦ Academic analytics</span>
        </header>

        {/* UPLOAD */}
        <section className="panel uploader">
          <div className="upload-info">
            <div className="upload-icon">↑</div>
            <div>
              <h3>Upload attendance workbook</h3>
              <p className="muted">
                Import your Excel or CSV attendance dataset.
              </p>
            </div>
          </div>

          <div className="uploadrow">
            <input
              type="file"
              accept=".xlsx,.csv"
              onChange={event => {
                setFile(event.target.files?.[0] || null)
                setError('')
              }}
            />

            <button
              className="primary-button"
              onClick={upload}
              disabled={busy}
            >
              {busy ? 'Analysing...' : 'Upload & analyse'}
            </button>
          </div>

          {error && <p className="error">{error}</p>}

          {data && (
            <p className="success">
              ✓ {data.filename} — {number(records.length)} records loaded.
            </p>
          )}
        </section>

        {!data ? (
          <section className="panel welcome">
            <div className="welcomeicon">▥</div>
            <h2>Your attendance insights start here</h2>
            <p>
              Upload your student attendance workbook to explore
              school-wide, class-wise and individual student analytics.
            </p>
            <button
              className="primary-button"
              onClick={() =>
                document.querySelector('input[type=file]')?.click()
              }
            >
              Choose Excel file
            </button>
            <div className="tags">
              <span>Student analytics</span>
              <span>Attendance trends</span>
              <span>Class comparison</span>
              <span>Attendance history</span>
              <span>Absentee tracking</span>
            </div>
          </section>
        ) : (
          <>
            {/* DASHBOARD TITLE AND NAVIGATION */}
            <div className="dashboard-toolbar">
              <div>
                <small className="eyebrow">DASHBOARD VIEW</small>
                <h2>
                  {view === 'school' && 'School overview'}
                  {view === 'class' && 'Class analytics'}
                  {view === 'student' && 'Individual student analytics'}
                  {view === 'absentees' && 'Absentees dashboard'}
                  {view === 'subject' && 'Subject-wise analytics'}
                  {view === 'time' && 'Time-Based Analytics'}
                </h2>
              </div>

              <span className="record-pill">
                ● {number(
                  view === 'absentees'
                    ? absenteeFilteredRows.length
                    : view === 'time'
                      ? timeFilteredRows.length
                      : filteredRows.length
                )} records
              </span>
            </div>

            {/* FILTERS */}
            <section className="panel filter-panel">
              <div className="section-title">
                <div>
                  <h3>Filter attendance data</h3>
                  <p className="muted">
                    Select your requirements to update the dashboard.
                  </p>
                </div>

                <button
                  className="light reset-button"
                  onClick={resetFilters}
                >
                  ↺ Reset
                </button>
              </div>

              <div className="filter-grid">
                <SelectFilter
                  label="Class"
                  value={filters.class}
                  options={classOptions}
                  onChange={v => updateFilter('class', v)}
                />

                <SelectFilter
                  label="Section"
                  value={filters.section}
                  options={sectionOptions}
                  onChange={v => updateFilter('section', v)}
                />

                <SelectFilter
                  label="Subject"
                  value={filters.subject}
                  options={subjectOptions}
                  onChange={v => updateFilter('subject', v)}
                />

                <SelectFilter
                  label="Gender"
                  value={filters.gender}
                  options={genderOptions}
                  onChange={v => updateFilter('gender', v)}
                />

                <SelectFilter
                  label="Status"
                  value={filters.status}
                  options={['Present', 'Absent', 'Late']}
                  onChange={v => updateFilter('status', v)}
                />

                <label className="filter-control">
                  <span>From date</span>
                  <input
                    type="date"
                    min={dateRange.min}
                    max={dateRange.max}
                    value={filters.startDate}
                    onChange={e =>
                      updateFilter('startDate', e.target.value)
                    }
                  />
                </label>

                <label className="filter-control">
                  <span>To date</span>
                  <input
                    type="date"
                    min={filters.startDate || dateRange.min}
                    max={dateRange.max}
                    value={filters.endDate}
                    onChange={e =>
                      updateFilter('endDate', e.target.value)
                    }
                  />
                </label>
              </div>
            </section>

            {/* SCHOOL DASHBOARD */}
            {view === 'school' && (
              <>
                <div className="kpis">
                  <KPI
                    label="TOTAL STUDENTS"
                    value={number(stats.students)}
                    hint="Unique students"
                    icon="♙"
                    tone="pink"
                  />
                  <KPI
                    label="ATTENDANCE RATE"
                    value={percent(stats.attendanceRate)}
                    hint="Present + Late"
                    icon="↗"
                    tone="purple"
                  />
                  <KPI
                    label="PRESENT RECORDS"
                    value={number(stats.present)}
                    hint="Present attendance entries"
                    icon="✓"
                    tone="green"
                  />
                  <KPI
                    label="ABSENT RECORDS"
                    value={number(stats.absent)}
                    hint={`${percent(stats.absenceRate)} absence rate`}
                    icon="×"
                    tone="orange"
                  />
                  <KPI
                    label="LATE ARRIVALS"
                    value={number(stats.late)}
                    hint="Late attendance entries"
                    icon="◷"
                    tone="blue"
                  />
                  <KPI
                    label="TOTAL RECORDS"
                    value={number(stats.total)}
                    hint="Filtered attendance entries"
                    icon="▤"
                    tone="pink"
                  />
                </div>

                <div className="charts">
                  <Panel
                    title="Class-wise attendance"
                    subtitle="Compare attendance percentages."
                  >
                    {classSummary.length ? (
                      <Plot
                        data={[{
                          x: classSummary.map(x => x.className),
                          y: classSummary.map(x => x.rate),
                          type: 'bar',
                          marker: { color: '#D987B2' },
                          text: classSummary.map(x => percent(x.rate)),
                          textposition: 'outside',
                          cliponaxis: false
                        }]}
                        layout={{
                          ...chartLayout,
                          yaxis: {
                            ...chartLayout.yaxis,
                            title: 'Attendance %',
                            range: [0, 110]
                          }
                        }}
                        config={plotConfig}
                        style={{ width: '100%', height: 300 }}
                        useResizeHandler
                      />
                    ) : <EmptyState>No class data found.</EmptyState>}
                  </Panel>

                  <Panel
                    title="Attendance status distribution"
                    subtitle="Present, absent and late records."
                  >
                    {stats.total ? (
                      <Plot
                        data={[{
                          labels: ['Present', 'Absent', 'Late'],
                          values: [
                            stats.present,
                            stats.absent,
                            stats.late
                          ],
                          type: 'pie',
                          hole: 0.58,
                          textinfo: 'label+percent',
                          marker: {
                            colors: ['#71C7A5', '#E99AB8', '#F2C47D']
                          }
                        }]}
                        layout={{
                          ...chartLayout,
                          margin: { l: 10, r: 10, t: 10, b: 25 },
                          showlegend: true,
                          legend: { orientation: 'h', y: -0.1 }
                        }}
                        config={plotConfig}
                        style={{ width: '100%', height: 300 }}
                        useResizeHandler
                      />
                    ) : <EmptyState>No attendance records.</EmptyState>}
                  </Panel>

                  <Panel
                    title="Daily attendance trend"
                    subtitle="School attendance percentage over time."
                  >
                    {dailyTrend.length ? (
                      <Plot
                        data={[{
                          x: dailyTrend.map(x => x.date),
                          y: dailyTrend.map(x => x.rate),
                          type: 'scatter',
                          mode: 'lines+markers',
                          line: { color: '#9A86D8', width: 3 },
                          marker: { size: 7, color: '#D7B7EF' },
                          fill: 'tozeroy',
                          fillcolor: 'rgba(215,183,239,0.16)'
                        }]}
                        layout={{
                          ...chartLayout,
                          yaxis: {
                            ...chartLayout.yaxis,
                            title: 'Attendance %',
                            range: [0, 100]
                          }
                        }}
                        config={plotConfig}
                        style={{ width: '100%', height: 300 }}
                        useResizeHandler
                      />
                    ) : <EmptyState>No date data found.</EmptyState>}
                  </Panel>

                  <Panel
                    title="Subject-wise attendance"
                    subtitle="Attendance comparison by subject."
                  >
                    {(() => {
                      const subjects = [...new Set(
                        filteredRows.map(r => r[fields.subject]).filter(Boolean)
                      )]

                      const values = subjects.map(subject => {
                        const rows = filteredRows.filter(
                          r => r[fields.subject] === subject
                        )
                        const attended = rows.filter(r =>
                          ['present', 'late'].includes(
                            String(r[fields.status]).toLowerCase()
                          )
                        ).length

                        return rows.length ? attended / rows.length * 100 : 0
                      })

                      return subjects.length ? (
                        <Plot
                          data={[{
                            x: subjects,
                            y: values,
                            type: 'bar',
                            marker: { color: '#83CBB8' },
                            text: values.map(percent),
                            textposition: 'outside',
                            cliponaxis: false
                          }]}
                          layout={{
                            ...chartLayout,
                            yaxis: {
                              ...chartLayout.yaxis,
                              title: 'Attendance %',
                              range: [0, 110]
                            }
                          }}
                          config={plotConfig}
                          style={{ width: '100%', height: 300 }}
                          useResizeHandler
                        />
                      ) : <EmptyState>No subject data found.</EmptyState>
                    })()}
                  </Panel>
                </div>

                <Panel
                  title="Student attendance overview"
                  subtitle="Select a student to see their individual report."
                  className="table-panel"
                >
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Student ID</th>
                          <th>Student name</th>
                          <th>Class</th>
                          <th>Section</th>
                          <th>Gender</th>
                          <th>Present</th>
                          <th>Absent</th>
                          <th>Late</th>
                          <th>Attendance</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {studentSummary.map(student => (
                          <tr key={student.id}>
                            <td>{student.id}</td>
                            <td><strong>{student.name}</strong></td>
                            <td>{student.className}</td>
                            <td>{student.section}</td>
                            <td>{student.gender}</td>
                            <td>{student.present}</td>
                            <td>{student.absent}</td>
                            <td>{student.late}</td>
                            <td>
                              <span className={`rate-chip ${rateClass(student.rate)}`}>
                                {percent(student.rate)}
                              </span>
                            </td>
                            <td>
                              <button
                                className="table-action"
                                onClick={() => {
                                  setSelectedStudentId(student.id)
                                  setStudentSearch(student.name)
                                  setView('student')
                                }}
                              >
                                View profile →
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!studentSummary.length && (
                      <EmptyState>No student records found.</EmptyState>
                    )}
                  </div>
                </Panel>
              </>
            )}

            {/* CLASS DASHBOARD */}
            {view === 'class' && (
              <>
                <section className="panel class-controls">
                  <div>
                    <h3>Select classroom</h3>
                    <p className="muted">
                      View attendance statistics for a selected class.
                    </p>
                  </div>

                  <select
                    value={classSelected}
                    onChange={e => setClassSelected(e.target.value)}
                  >
                    {classOptions.map(item => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                  </select>
                </section>

                {(() => {
                  const rows = filteredRows.filter(
                    r => String(r[fields.className]) === classSelected
                  )

                  const present = rows.filter(
                    r => String(r[fields.status]).toLowerCase() === 'present'
                  ).length

                  const absent = rows.filter(
                    r => String(r[fields.status]).toLowerCase() === 'absent'
                  ).length

                  const late = rows.filter(
                    r => String(r[fields.status]).toLowerCase() === 'late'
                  ).length

                  const total = rows.length
                  const rate = total ? (present + late) / total * 100 : 0

                  const students = studentSummary.filter(
                    s => s.className === classSelected
                  )

                  return (
                    <>
                      <div className="kpis">
                        <KPI label="TOTAL STUDENTS" value={number(new Set(rows.map(r => r[fields.studentId])).size)} hint="Unique students" icon="♙" tone="pink" />
                        <KPI label="ATTENDANCE RATE" value={percent(rate)} hint="Present + Late" icon="↗" tone="purple" />
                        <KPI label="PRESENT RECORDS" value={number(present)} hint="Marked present" icon="✓" tone="green" />
                        <KPI label="ABSENT RECORDS" value={number(absent)} hint="Marked absent" icon="×" tone="orange" />
                        <KPI label="LATE ARRIVALS" value={number(late)} hint="Marked late" icon="◷" tone="blue" />
                        <KPI label="TOTAL RECORDS" value={number(total)} hint="Class attendance entries" icon="▤" tone="pink" />
                      </div>

                      <Panel
                        title={`${classSelected} student performance`}
                        subtitle="Individual attendance rates in this class."
                        className="table-panel"
                      >
                        <div className="table-wrap">
                          <table>
                            <thead>
                              <tr>
                                <th>Student ID</th>
                                <th>Student name</th>
                                <th>Roll number</th>
                                <th>Present</th>
                                <th>Absent</th>
                                <th>Late</th>
                                <th>Attendance</th>
                                <th>Action</th>
                              </tr>
                            </thead>
                            <tbody>
                              {students.map(student => (
                                <tr key={student.id}>
                                  <td>{student.id}</td>
                                  <td><strong>{student.name}</strong></td>
                                  <td>{student.roll}</td>
                                  <td>{student.present}</td>
                                  <td>{student.absent}</td>
                                  <td>{student.late}</td>
                                  <td>
                                    <span className={`rate-chip ${rateClass(student.rate)}`}>
                                      {percent(student.rate)}
                                    </span>
                                  </td>
                                  <td>
                                    <button
                                      className="table-action"
                                      onClick={() => {
                                        setSelectedStudentId(student.id)
                                        setStudentSearch(student.name)
                                        setView('student')
                                      }}
                                    >
                                      View student →
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {!students.length && (
                            <EmptyState>No students found in this class.</EmptyState>
                          )}
                        </div>
                      </Panel>
                    </>
                  )
                })()}
              </>
            )}

            {/* INDIVIDUAL STUDENT DASHBOARD */}
            {view === 'student' && (
              <>
                <section className="panel student-search-panel">
                  <div>
                    <h3>Find an individual student</h3>
                    <p className="muted">
                      Search by student name, student ID or roll number.
                    </p>
                  </div>

                  <input
                    type="search"
                    placeholder="Search student name or ID..."
                    value={studentSearch}
                    onChange={e => setStudentSearch(e.target.value)}
                    list="student-options"
                  />

                  <datalist id="student-options">
                    {searchableStudents.map(student => (
                      <option
                        key={student.id}
                        value={student.name}
                      />
                    ))}
                  </datalist>

                  <select
                    value={selectedStudentId}
                    onChange={e => {
                      setSelectedStudentId(e.target.value)
                      const match = studentSummary.find(
                        s => s.id === e.target.value
                      )
                      setStudentSearch(match?.name || '')
                    }}
                  >
                    <option value="">Select student</option>
                    {searchableStudents.map(student => (
                      <option key={student.id} value={student.id}>
                        {student.id} - {student.name}
                      </option>
                    ))}
                  </select>
                </section>

                {!selectedStudent ? (
                  <section className="panel welcome">
                    <div className="welcomeicon">♙</div>
                    <h2>Select a student to view their report</h2>
                    <p>Choose a student from the search results or dropdown.</p>
                  </section>
                ) : (
                  <>
                    <section className="panel student-profile">
                      <div className="avatar">
                        {String(selectedStudent.name).charAt(0).toUpperCase()}
                      </div>

                      <div className="student-info">
                        <small className="eyebrow">STUDENT PROFILE</small>
                        <h2>{selectedStudent.name}</h2>
                        <p className="muted">
                          Student ID: <strong>{selectedStudent.id}</strong>
                          {'  '} · {'  '}
                          Roll No: <strong>{selectedStudent.roll}</strong>
                        </p>
                      </div>

                      <div className="profile-details">
                        <div>
                          <small>GENDER</small>
                          <strong>{selectedStudent.gender}</strong>
                        </div>
                        <div>
                          <small>CLASS</small>
                          <strong>{selectedStudent.className}</strong>
                        </div>
                        <div>
                          <small>SECTION</small>
                          <strong>{selectedStudent.section}</strong>
                        </div>
                      </div>
                    </section>

                    <div className="kpis">
                      <KPI
                        label="ATTENDANCE RATE"
                        value={percent(selectedStudent.rate)}
                        hint="Individual attendance"
                        icon="↗"
                        tone="purple"
                      />
                      <KPI
                        label="TOTAL CLASSES"
                        value={number(selectedStudent.total)}
                        hint="Recorded attendance entries"
                        icon="▤"
                        tone="pink"
                      />
                      <KPI
                        label="PRESENT DAYS"
                        value={number(selectedStudent.present)}
                        hint="Marked present"
                        icon="✓"
                        tone="green"
                      />
                      <KPI
                        label="ABSENT DAYS"
                        value={number(selectedStudent.absent)}
                        hint="Marked absent"
                        icon="×"
                        tone="orange"
                      />
                      <KPI
                        label="LATE ARRIVALS"
                        value={number(selectedStudent.late)}
                        hint="Marked late"
                        icon="◷"
                        tone="blue"
                      />
                      <KPI
                        label="ATTENDANCE ENTRIES"
                        value={number(studentHistory.length)}
                        hint="Current filter selection"
                        icon="▣"
                        tone="pink"
                      />
                    </div>

                    <div className="charts">
                      <Panel
                        title="Student attendance distribution"
                        subtitle="Present, absent and late records."
                      >
                        <Plot
                          data={[{
                            labels: ['Present', 'Absent', 'Late'],
                            values: [
                              selectedStudent.present,
                              selectedStudent.absent,
                              selectedStudent.late
                            ],
                            type: 'pie',
                            hole: 0.6,
                            textinfo: 'label+percent',
                            marker: {
                              colors: ['#71C7A5', '#E99AB8', '#F2C47D']
                            }
                          }]}
                          layout={{
                            ...chartLayout,
                            margin: { l: 10, r: 10, t: 10, b: 20 }
                          }}
                          config={plotConfig}
                          style={{ width: '100%', height: 300 }}
                          useResizeHandler
                        />
                      </Panel>

                      <Panel
                        title="Subject-wise student attendance"
                        subtitle="Attendance percentage in each subject."
                      >
                        {studentSubjects.length ? (
                          <Plot
                            data={[{
                              x: studentSubjects.map(x => x.subject),
                              y: studentSubjects.map(x => x.rate),
                              type: 'bar',
                              marker: { color: '#D987B2' },
                              text: studentSubjects.map(x => percent(x.rate)),
                              textposition: 'outside',
                              cliponaxis: false
                            }]}
                            layout={{
                              ...chartLayout,
                              yaxis: {
                                ...chartLayout.yaxis,
                                title: 'Attendance %',
                                range: [0, 110]
                              }
                            }}
                            config={plotConfig}
                            style={{ width: '100%', height: 300 }}
                            useResizeHandler
                          />
                        ) : <EmptyState>No subject records.</EmptyState>}
                      </Panel>
                    </div>

                    <Panel
                      title="Individual attendance history"
                      subtitle="Complete date-wise attendance records for this student."
                      className="table-panel"
                    >
                      <div className="history-toolbar">
                        <span>
                          {number(studentHistory.length)} attendance entries
                        </span>
                        <button
                          className="primary-button"
                          onClick={downloadCSV}
                        >
                          ↓ Export student CSV
                        </button>
                      </div>

                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Attendance date</th>
                              <th>Student ID</th>
                              <th>Subject</th>
                              <th>Class</th>
                              <th>Section</th>
                              <th>Teacher</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {studentHistory.map((row, index) => {
                              const status = String(
                                row[fields.status] || ''
                              ).toLowerCase()

                              return (
                                <tr key={`${dateKey(row[fields.date])}-${index}`}>
                                  <td>{dateKey(row[fields.date]) || '—'}</td>
                                  <td>{row[fields.studentId]}</td>
                                  <td>{row[fields.subject] || '—'}</td>
                                  <td>{row[fields.className] || '—'}</td>
                                  <td>{row[fields.section] || '—'}</td>
                                  <td>{row[fields.teacher] || '—'}</td>
                                  <td>
                                    <span className={`status-chip ${status}`}>
                                      {status || 'Unknown'}
                                    </span>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>

                        {!studentHistory.length && (
                          <EmptyState>
                            No attendance history for the selected filters.
                          </EmptyState>
                        )}
                      </div>
                    </Panel>
                  </>
                )}
              </>
            )}

            {/* ==================================
                FOURTH DASHBOARD: ABSENTEES
            ================================== */}
            {view === 'absentees' && (
              <>
                {/* DATE PICKER */}
                <section className="panel absentee-date-panel">
                  <div>
                    <h3>Absentee monitoring</h3>
                    <p className="muted">
                      Monitor absent students and identify students who need follow-up.
                    </p>
                  </div>

                  <label className="filter-control">
                    <span>Attendance date</span>
                    <select
                      value={selectedAbsenteeDate}
                      onChange={e => setAbsenteeDate(e.target.value)}
                    >
                      {absenteeDates.map(date => (
                        <option key={date} value={date}>
                          {date}
                        </option>
                      ))}
                    </select>
                  </label>
                </section>

                {/* ABSENTEE KPI CARDS */}
                <div className="kpis">
                  <KPI
                    label="ABSENT STUDENTS"
                    value={number(followUpStudents.length)}
                    hint={`Absent on ${selectedAbsenteeDate || 'selected date'}`}
                    icon="×"
                    tone="pink"
                  />

                  <KPI
                    label="TOTAL ABSENCE RECORDS"
                    value={number(totalAbsences)}
                    hint="Across filtered attendance data"
                    icon="▤"
                    tone="orange"
                  />

                  <KPI
                    label="REPEATED ABSENTEES"
                    value={number(repeatedAbsentees.length)}
                    hint={`${REPEATED_ABSENCE_LIMIT}+ absent records`}
                    icon="↻"
                    tone="purple"
                  />

                  <KPI
                    label="FOLLOW-UP STUDENTS"
                    value={number(followUpStudents.length)}
                    hint="Unique students absent on selected date"
                    icon="♙"
                    tone="blue"
                  />
                </div>

                {/* 1. STUDENTS ABSENT TODAY */}
                <Panel
                  title="1. Students absent today"
                  subtitle={`Students marked absent on ${selectedAbsenteeDate || 'the selected date'}.`}
                  className="table-panel"
                >
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Student ID</th>
                          <th>Student name</th>
                          <th>Roll number</th>
                          <th>Class</th>
                          <th>Section</th>
                          <th>Subject</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {absentTodayRows.map((row, index) => (
                          <tr key={`${row[fields.studentId]}-${index}`}>
                            <td>{row[fields.studentId]}</td>
                            <td>
                              <strong>{row[fields.studentName] || 'Unknown'}</strong>
                            </td>
                            <td>{row[fields.roll] || '—'}</td>
                            <td>{row[fields.className] || '—'}</td>
                            <td>{row[fields.section] || '—'}</td>
                            <td>{row[fields.subject] || '—'}</td>
                            <td>
                              <span className="status-chip absent">
                                Absent
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {!absentTodayRows.length && (
                      <EmptyState>
                        No absent records found for this date.
                      </EmptyState>
                    )}
                  </div>
                </Panel>

                {/* 2. STUDENTS ABSENT REPEATEDLY */}
                <Panel
                  title="2. Students absent repeatedly"
                  subtitle={`Students with ${REPEATED_ABSENCE_LIMIT} or more absent attendance records.`}
                  className="table-panel"
                >
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Student ID</th>
                          <th>Student name</th>
                          <th>Roll number</th>
                          <th>Class</th>
                          <th>Section</th>
                          <th>Total absences</th>
                          <th>Latest absence</th>
                        </tr>
                      </thead>
                      <tbody>
                        {repeatedAbsentees.map(student => (
                          <tr key={student.id}>
                            <td>{student.id}</td>
                            <td><strong>{student.name}</strong></td>
                            <td>{student.roll}</td>
                            <td>{student.className}</td>
                            <td>{student.section}</td>
                            <td>
                              <span className="rate-chip low">
                                {student.absences}
                              </span>
                            </td>
                            <td>{student.latestDate || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {!repeatedAbsentees.length && (
                      <EmptyState>
                        No students have {REPEATED_ABSENCE_LIMIT} or more absences.
                      </EmptyState>
                    )}
                  </div>
                </Panel>

                {/* 3. STUDENTS WITH MOST ABSENCES */}
                <Panel
                  title="3. Students with the most absences"
                  subtitle="Top ten students ranked by total absent records."
                  className="table-panel"
                >
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Rank</th>
                          <th>Student ID</th>
                          <th>Student name</th>
                          <th>Roll number</th>
                          <th>Class</th>
                          <th>Absence count</th>
                          <th>Latest absence</th>
                        </tr>
                      </thead>
                      <tbody>
                        {mostAbsentStudents.map((student, index) => (
                          <tr key={student.id}>
                            <td>#{index + 1}</td>
                            <td>{student.id}</td>
                            <td><strong>{student.name}</strong></td>
                            <td>{student.roll}</td>
                            <td>{student.className}</td>
                            <td>
                              <span className="rate-chip low">
                                {student.absences}
                              </span>
                            </td>
                            <td>{student.latestDate || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {!mostAbsentStudents.length && (
                      <EmptyState>No absence records found.</EmptyState>
                    )}
                  </div>
                </Panel>

                {/* 4 AND 5. CLASS AND SUBJECT CHARTS */}
                <div className="charts">
                  <Panel
                    title="4. Absentees by class"
                    subtitle="Number of absent attendance records in each class."
                  >
                    {absenteesByClass.length ? (
                      <Plot
                        data={[{
                          x: absenteesByClass.map(x => x.className),
                          y: absenteesByClass.map(x => x.count),
                          type: 'bar',
                          marker: { color: '#D987B2' },
                          text: absenteesByClass.map(x => x.count),
                          textposition: 'outside',
                          cliponaxis: false
                        }]}
                        layout={{
                          ...chartLayout,
                          yaxis: {
                            ...chartLayout.yaxis,
                            title: 'Absent records'
                          }
                        }}
                        config={plotConfig}
                        style={{ width: '100%', height: 300 }}
                        useResizeHandler
                      />
                    ) : (
                      <EmptyState>No class absence data found.</EmptyState>
                    )}
                  </Panel>

                  <Panel
                    title="5. Absentees by subject"
                    subtitle="Subjects with the highest absence records."
                  >
                    {absenteesBySubject.length ? (
                      <Plot
                        data={[{
                          x: absenteesBySubject.map(x => x.subject),
                          y: absenteesBySubject.map(x => x.count),
                          type: 'bar',
                          marker: { color: '#9A86D8' },
                          text: absenteesBySubject.map(x => x.count),
                          textposition: 'outside',
                          cliponaxis: false
                        }]}
                        layout={{
                          ...chartLayout,
                          yaxis: {
                            ...chartLayout.yaxis,
                            title: 'Absent records'
                          }
                        }}
                        config={plotConfig}
                        style={{ width: '100%', height: 300 }}
                        useResizeHandler
                      />
                    ) : (
                      <EmptyState>No subject absence data found.</EmptyState>
                    )}
                  </Panel>
                </div>

                {/* 6. ABSENTEES BY DATE */}
                <Panel
                  title="6. Absentees by date"
                  subtitle="Daily absence trends across the selected filters."
                  className="table-panel"
                >
                  {absenteesByDate.length ? (
                    <Plot
                      data={[{
                        x: absenteesByDate.map(x => x.date),
                        y: absenteesByDate.map(x => x.count),
                        type: 'scatter',
                        mode: 'lines+markers',
                        line: { color: '#D987B2', width: 3 },
                        marker: { color: '#9A86D8', size: 8 },
                        fill: 'tozeroy',
                        fillcolor: 'rgba(217,135,178,0.13)'
                      }]}
                      layout={{
                        ...chartLayout,
                        xaxis: {
                          ...chartLayout.xaxis,
                          title: 'Attendance date'
                        },
                        yaxis: {
                          ...chartLayout.yaxis,
                          title: 'Absent records'
                        }
                      }}
                      config={plotConfig}
                      style={{ width: '100%', height: 330 }}
                      useResizeHandler
                    />
                  ) : (
                    <EmptyState>No date-wise absence data found.</EmptyState>
                  )}
                </Panel>

                {/* 7. STUDENT NAMES AND ROLL NUMBERS FOR FOLLOW-UP */}
                <Panel
                  title="7. Student names and roll numbers for follow-up"
                  subtitle={`Unique students absent on ${selectedAbsenteeDate || 'the selected date'}.`}
                  className="table-panel"
                >
                  <div className="history-toolbar">
                    <span>
                      {number(followUpStudents.length)} students to follow up
                    </span>

                    <button
                      className="primary-button"
                      onClick={downloadAbsenteeCSV}
                      disabled={!followUpStudents.length}
                    >
                      ↓ Export follow-up CSV
                    </button>
                  </div>

                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Student ID</th>
                          <th>Student name</th>
                          <th>Roll number</th>
                          <th>Class</th>
                          <th>Section</th>
                          <th>Absent subjects</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {followUpStudents.map(student => (
                          <tr key={student.id}>
                            <td>{student.id}</td>
                            <td><strong>{student.name}</strong></td>
                            <td>{student.roll}</td>
                            <td>{student.className}</td>
                            <td>{student.section}</td>
                            <td>{student.subjects}</td>
                            <td>
                              <button
                                className="table-action"
                                onClick={() => {
                                  setSelectedStudentId(student.id)
                                  setStudentSearch(student.name)
                                  setView('student')
                                }}
                              >
                                View profile →
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {!followUpStudents.length && (
                      <EmptyState>
                        No students require follow-up for this date.
                      </EmptyState>
                    )}
                  </div>
                </Panel>
              </>
            )}

            {/* ==================================
                FIFTH DASHBOARD: SUBJECT-WISE ANALYTICS
            ================================== */}
            {view === 'subject' && (
              <>
                {/* SUBJECT-WISE KPI CARDS */}
                <div className="kpis">
                  <KPI
                    label="TOTAL SUBJECTS"
                    value={number(subjectStats.totalSubjects)}
                    hint="Unique subjects"
                    icon="▥"
                    tone="pink"
                  />

                  <KPI
                    label="OVERALL ATTENDANCE"
                    value={percent(subjectStats.attendanceRate)}
                    hint="Present + Late"
                    icon="↗"
                    tone="purple"
                  />

                  <KPI
                    label="PRESENT RECORDS"
                    value={number(subjectStats.present)}
                    hint="Across all subjects"
                    icon="✓"
                    tone="green"
                  />

                  <KPI
                    label="ABSENT RECORDS"
                    value={number(subjectStats.absent)}
                    hint="Across all subjects"
                    icon="×"
                    tone="orange"
                  />

                  <KPI
                    label="LATE ARRIVALS"
                    value={number(subjectStats.late)}
                    hint="Across all subjects"
                    icon="◷"
                    tone="blue"
                  />

                  <KPI
                    label="TOTAL RECORDS"
                    value={number(subjectStats.total)}
                    hint="Filtered subject records"
                    icon="▤"
                    tone="pink"
                  />
                </div>

                {/* SUBJECT-WISE CHARTS */}
                <div className="charts">
                  <Panel
                    title="Attendance percentage by subject"
                    subtitle="Compare attendance performance across subjects."
                  >
                    {subjectSummary.length ? (
                      <Plot
                        data={[{
                          x: subjectSummary.map(x => x.subject),
                          y: subjectSummary.map(x => x.attendanceRate),
                          type: 'bar',
                          marker: { color: '#D987B2' },
                          text: subjectSummary.map(
                            x => percent(x.attendanceRate)
                          ),
                          textposition: 'outside',
                          cliponaxis: false
                        }]}
                        layout={{
                          ...chartLayout,
                          yaxis: {
                            ...chartLayout.yaxis,
                            title: 'Attendance %',
                            range: [0, 110]
                          }
                        }}
                        config={plotConfig}
                        style={{ width: '100%', height: 320 }}
                        useResizeHandler
                      />
                    ) : (
                      <EmptyState>No subject data found.</EmptyState>
                    )}
                  </Panel>

                  <Panel
                    title="Attendance status by subject"
                    subtitle="Compare present, absent and late records for each subject."
                  >
                    {subjectSummary.length ? (
                      <Plot
                        data={[
                          {
                            name: 'Present',
                            x: subjectSummary.map(x => x.subject),
                            y: subjectSummary.map(x => x.present),
                            type: 'bar',
                            marker: { color: '#71C7A5' }
                          },
                          {
                            name: 'Absent',
                            x: subjectSummary.map(x => x.subject),
                            y: subjectSummary.map(x => x.absent),
                            type: 'bar',
                            marker: { color: '#E99AB8' }
                          },
                          {
                            name: 'Late',
                            x: subjectSummary.map(x => x.subject),
                            y: subjectSummary.map(x => x.late),
                            type: 'bar',
                            marker: { color: '#F2C47D' }
                          }
                        ]}
                        layout={{
                          ...chartLayout,
                          barmode: 'group',
                          showlegend: true,
                          legend: { orientation: 'h', y: -0.25 },
                          yaxis: {
                            ...chartLayout.yaxis,
                            title: 'Attendance records'
                          }
                        }}
                        config={plotConfig}
                        style={{ width: '100%', height: 320 }}
                        useResizeHandler
                      />
                    ) : (
                      <EmptyState>No subject data found.</EmptyState>
                    )}
                  </Panel>

                  <Panel
                    title="Absence percentage by subject"
                    subtitle="Identify subjects with higher absence percentages."
                  >
                    {subjectSummary.length ? (
                      <Plot
                        data={[{
                          x: subjectSummary.map(x => x.subject),
                          y: subjectSummary.map(x => x.absenceRate),
                          type: 'bar',
                          marker: { color: '#9A86D8' },
                          text: subjectSummary.map(
                            x => percent(x.absenceRate)
                          ),
                          textposition: 'outside',
                          cliponaxis: false
                        }]}
                        layout={{
                          ...chartLayout,
                          yaxis: {
                            ...chartLayout.yaxis,
                            title: 'Absence %',
                            range: [0, 110]
                          }
                        }}
                        config={plotConfig}
                        style={{ width: '100%', height: 320 }}
                        useResizeHandler
                      />
                    ) : (
                      <EmptyState>No subject data found.</EmptyState>
                    )}
                  </Panel>
                </div>

                {/* SUBJECT-WISE SUMMARY TABLE */}
                <Panel
                  title="Subject-wise attendance summary"
                  subtitle="Detailed attendance statistics for every subject."
                  className="table-panel"
                >
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Subject</th>
                          <th>Students</th>
                          <th>Total records</th>
                          <th>Present</th>
                          <th>Absent</th>
                          <th>Late</th>
                          <th>Attendance %</th>
                          <th>Absence %</th>
                        </tr>
                      </thead>
                      <tbody>
                        {subjectSummary.map(item => (
                          <tr key={item.subject}>
                            <td><strong>{item.subject}</strong></td>
                            <td>{number(item.studentCount)}</td>
                            <td>{number(item.total)}</td>
                            <td>{number(item.present)}</td>
                            <td>{number(item.absent)}</td>
                            <td>{number(item.late)}</td>
                            <td>
                              <span className={`rate-chip ${rateClass(item.attendanceRate)}`}>
                                {percent(item.attendanceRate)}
                              </span>
                            </td>
                            <td>{percent(item.absenceRate)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {!subjectSummary.length && (
                      <EmptyState>
                        No subject attendance records found for the selected filters.
                      </EmptyState>
                    )}
                  </div>
                </Panel>
              </>
            )}

            {/* SIXTH DASHBOARD: TIME-BASED ANALYTICS */}
            {view === 'time' && (
              <>
                {/* TIME-BASED KPI CARDS */}
                <div className="kpis">
                  <KPI
                    label="DAILY AVG. ATTENDANCE"
                    value={percent(dailyAverage)}
                    hint={`${number(timeDailyTrend.length)} recorded dates`}
                    icon="◷"
                    tone="pink"
                  />

                  <KPI
                    label="WEEKLY AVG. ATTENDANCE"
                    value={percent(weeklyAverage)}
                    hint={`${number(weeklyTrend.length)} recorded weeks`}
                    icon="▦"
                    tone="purple"
                  />

                  <KPI
                    label="MONTHLY AVG. ATTENDANCE"
                    value={percent(monthlyAverage)}
                    hint={`${number(monthlyTrend.length)} recorded months`}
                    icon="▤"
                    tone="green"
                  />

                  <KPI
                    label="MONDAY ATTENDANCE"
                    value={percent(weekdaySummary[0]?.attendanceRate || 0)}
                    hint={`${number(weekdaySummary[0]?.total || 0)} records`}
                    icon="M"
                    tone="blue"
                  />

                  <KPI
                    label="TUESDAY ATTENDANCE"
                    value={percent(weekdaySummary[1]?.attendanceRate || 0)}
                    hint={`${number(weekdaySummary[1]?.total || 0)} records`}
                    icon="T"
                    tone="blue"
                  />

                  <KPI
                    label="WEDNESDAY ATTENDANCE"
                    value={percent(weekdaySummary[2]?.attendanceRate || 0)}
                    hint={`${number(weekdaySummary[2]?.total || 0)} records`}
                    icon="W"
                    tone="blue"
                  />

                  <KPI
                    label="THURSDAY ATTENDANCE"
                    value={percent(weekdaySummary[3]?.attendanceRate || 0)}
                    hint={`${number(weekdaySummary[3]?.total || 0)} records`}
                    icon="T"
                    tone="blue"
                  />

                  <KPI
                    label="FRIDAY ATTENDANCE"
                    value={percent(weekdaySummary[4]?.attendanceRate || 0)}
                    hint={`${number(weekdaySummary[4]?.total || 0)} records`}
                    icon="F"
                    tone="orange"
                  />

                  <KPI
                    label="ATTENDANCE MOVEMENT"
                    value={attendanceMovement.status}
                    hint={`${attendanceMovement.change > 0 ? '+' : ''}${number(attendanceMovement.change)} percentage points`}
                    icon={attendanceMovement.change >= 0 ? '↗' : '↘'}
                    tone={
                      attendanceMovement.status === 'Improved'
                        ? 'green'
                        : attendanceMovement.status === 'Declined'
                          ? 'orange'
                          : 'purple'
                    }
                  />
                </div>

                {/* ATTENDANCE MOVEMENT */}
                <section
                  className="panel"
                  style={{ marginBottom: '20px' }}
                >
                  <div className="section-title">
                    <div>
                      <h3>Attendance movement over the selected period</h3>

                      <p className="muted">
                        Compares the average daily attendance rate in the earlier half
                        with the later half of the selected date range. This is a
                        historical comparison, not a prediction.
                      </p>
                    </div>

                    <span
                      className={`rate-chip ${
                        attendanceMovement.status === 'Improved'
                          ? 'good'
                          : attendanceMovement.status === 'Declined'
                            ? 'low'
                            : 'medium'
                      }`}
                    >
                      {attendanceMovement.status}
                    </span>
                  </div>

                  <div className="kpis">
                    <KPI
                      label="EARLIER HALF AVERAGE"
                      value={percent(attendanceMovement.earlierAverage)}
                      hint="First half of recorded dates"
                      icon="◴"
                      tone="pink"
                    />

                    <KPI
                      label="LATER HALF AVERAGE"
                      value={percent(attendanceMovement.laterAverage)}
                      hint="Second half of recorded dates"
                      icon="◵"
                      tone="purple"
                    />

                    <KPI
                      label="CHANGE"
                      value={`${attendanceMovement.change > 0 ? '+' : ''}${number(attendanceMovement.change)} pp`}
                      hint="Later half minus earlier half"
                      icon="↕"
                      tone="blue"
                    />
                  </div>

                  {timeDailyTrend.length < 2 && (
                    <p className="muted">
                      At least two different attendance dates are needed to calculate movement.
                    </p>
                  )}
                </section>

                {/* TIME-BASED CHARTS */}
                <div className="charts">

                  {/* DAILY ATTENDANCE */}
                  <Panel
                    title="Daily attendance percentage"
                    subtitle="Attendance rate for each recorded date."
                  >
                    {timeDailyTrend.length ? (
                      <Plot
                        data={[
                          {
                            x: timeDailyTrend.map(item => item.date),
                            y: timeDailyTrend.map(item => item.attendanceRate),
                            type: 'scatter',
                            mode: 'lines+markers',
                            line: {
                              color: '#9A86D8',
                              width: 3
                            },
                            marker: {
                              size: 7,
                              color: '#D7B7EF'
                            },
                            fill: 'tozeroy',
                            fillcolor: 'rgba(215,183,239,0.16)'
                          }
                        ]}
                        layout={{
                          ...chartLayout,
                          xaxis: {
                            ...chartLayout.xaxis,
                            type: 'date',
                            title: 'Date'
                          },
                          yaxis: {
                            ...chartLayout.yaxis,
                            title: 'Attendance %',
                            range: [0, 100],
                            dtick: 20,
                            ticksuffix: '%'
                          }
                        }}
                        config={plotConfig}
                        style={{
                          width: '100%',
                          height: 300
                        }}
                        useResizeHandler
                      />
                    ) : (
                      <EmptyState>No daily attendance data found.</EmptyState>
                    )}
                  </Panel>

                  {/* WEEKLY ATTENDANCE */}
                  <Panel
                    title="Weekly attendance percentage"
                    subtitle="Attendance rate grouped by Monday-to-Sunday weeks."
                  >
                    {weeklyTrend.length ? (
                      <Plot
                        data={[
                          {
                            x: weeklyTrend.map(item => item.label),
                            y: weeklyTrend.map(item => item.attendanceRate),
                            type: 'scatter',
                            mode: 'lines+markers',
                            line: {
                              color: '#83CBB8',
                              width: 3
                            },
                            marker: {
                              size: 8,
                              color: '#83CBB8'
                            }
                          }
                        ]}
                        layout={{
                          ...chartLayout,
                          xaxis: {
                            ...chartLayout.xaxis,
                            type: 'category',
                            tickangle: -25,
                            title: 'Week'
                          },
                          yaxis: {
                            ...chartLayout.yaxis,
                            title: 'Attendance %',
                            range: [0, 100],
                            dtick: 20,
                            ticksuffix: '%'
                          }
                        }}
                        config={plotConfig}
                        style={{
                          width: '100%',
                          height: 300
                        }}
                        useResizeHandler
                      />
                    ) : (
                      <EmptyState>No weekly attendance data found.</EmptyState>
                    )}
                  </Panel>

                  {/* MONTHLY ATTENDANCE */}
                  <Panel
                    title="Monthly attendance percentage"
                    subtitle="Compare attendance rates month by month."
                  >
                    {monthlyTrend.length ? (
                      <Plot
                        data={[
                          {
                            x: monthlyTrend.map(item => item.label),
                            y: monthlyTrend.map(item => item.attendanceRate),
                            type: 'bar',
                            marker: {
                              color: '#D987B2'
                            },
                            text: monthlyTrend.map(item =>
                              percent(item.attendanceRate)
                            ),
                            textposition: 'outside',
                            cliponaxis: false
                          }
                        ]}
                        layout={{
                          ...chartLayout,
                          xaxis: {
                            ...chartLayout.xaxis,
                            type: 'category',
                            title: 'Month'
                          },
                          yaxis: {
                            ...chartLayout.yaxis,
                            title: 'Attendance %',
                            range: [0, 110],
                            dtick: 20,
                            ticksuffix: '%'
                          }
                        }}
                        config={plotConfig}
                        style={{
                          width: '100%',
                          height: 300
                        }}
                        useResizeHandler
                      />
                    ) : (
                      <EmptyState>No monthly attendance data found.</EmptyState>
                    )}
                  </Panel>

                  {/* DAY-WISE ABSENTEE PATTERNS */}
                  <Panel
                    title="Day-wise absentee patterns"
                    subtitle="Number of absent attendance records for each weekday."
                  >
                    {weekdaySummary.some(item => item.total > 0) ? (
                      <Plot
                        data={[
                          {
                            x: weekdaySummary.map(item => item.day),
                            y: weekdaySummary.map(item => item.absent),
                            type: 'bar',
                            marker: {
                              color: '#E99AB8'
                            },
                            text: weekdaySummary.map(item =>
                              number(item.absent)
                            ),
                            textposition: 'outside',
                            cliponaxis: false
                          }
                        ]}
                        layout={{
                          ...chartLayout,
                          xaxis: {
                            ...chartLayout.xaxis,
                            type: 'category',
                            title: 'Day of week',
                            categoryorder: 'array',
                            categoryarray: [
                              'Monday',
                              'Tuesday',
                              'Wednesday',
                              'Thursday',
                              'Friday',
                              'Saturday',
                              'Sunday'
                            ]
                          },
                          yaxis: {
                            ...chartLayout.yaxis,
                            title: 'Absent records',
                            rangemode: 'tozero',
                            dtick: Math.max(
                              1,
                              Math.ceil(
                                Math.max(
                                  ...weekdaySummary.map(item => item.absent),
                                  0
                                ) / 5
                              )
                            ),
                            tickformat: ',d'
                          },
                          margin: {
                            ...chartLayout.margin,
                            l: 65,
                            r: 25,
                            t: 35,
                            b: 60
                          }
                        }}
                        config={plotConfig}
                        style={{
                          width: '100%',
                          height: 300
                        }}
                        useResizeHandler
                      />
                    ) : (
                      <EmptyState>No weekday attendance data found.</EmptyState>
                    )}
                  </Panel>

                  {/* MONDAY TO FRIDAY ATTENDANCE */}
                  <Panel
                    title="Monday to Friday attendance"
                    subtitle="Compare attendance and absence percentages for each weekday."
                  >
                    {weekdaySummary
                      .filter(item =>
                        ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
                          .includes(item.day)
                      )
                      .some(item => item.total > 0) ? (
                      <Plot
                        data={[
                          {
                            name: 'Attendance %',

                            x: weekdaySummary
                              .filter(item =>
                                ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
                                  .includes(item.day)
                              )
                              .map(item => item.day),

                            y: weekdaySummary
                              .filter(item =>
                                ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
                                  .includes(item.day)
                              )
                              .map(item =>
                                Number(item.attendanceRate.toFixed(2))
                              ),

                            type: 'bar',

                            marker: {
                              color: '#83CBB8'
                            },

                            text: weekdaySummary
                              .filter(item =>
                                ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
                                  .includes(item.day)
                              )
                              .map(item => percent(item.attendanceRate)),

                            textposition: 'outside',

                            cliponaxis: false,

                            hovertemplate:
                              '<b>%{x}</b><br>Attendance: %{y:.2f}%<extra></extra>'
                          },

                          {
                            name: 'Absence %',

                            x: weekdaySummary
                              .filter(item =>
                                ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
                                  .includes(item.day)
                              )
                              .map(item => item.day),

                            y: weekdaySummary
                              .filter(item =>
                                ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
                                  .includes(item.day)
                              )
                              .map(item =>
                                Number(item.absenceRate.toFixed(2))
                              ),

                            type: 'bar',

                            marker: {
                              color: '#E99AB8'
                            },

                            text: weekdaySummary
                              .filter(item =>
                                ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
                                  .includes(item.day)
                              )
                              .map(item => percent(item.absenceRate)),

                            textposition: 'outside',

                            cliponaxis: false,

                            hovertemplate:
                              '<b>%{x}</b><br>Absence: %{y:.2f}%<extra></extra>'
                          }
                        ]}
                        layout={{
                          ...chartLayout,

                          barmode: 'group',

                          bargap: 0.3,

                          showlegend: true,

                          legend: {
                            orientation: 'h',
                            y: -0.25,
                            x: 0.5,
                            xanchor: 'center'
                          },

                          xaxis: {
                            ...chartLayout.xaxis,
                            type: 'category',
                            title: 'Day of week',
                            categoryorder: 'array',
                            categoryarray: [
                              'Monday',
                              'Tuesday',
                              'Wednesday',
                              'Thursday',
                              'Friday'
                            ],
                            tickangle: 0
                          },

                          yaxis: {
                            ...chartLayout.yaxis,
                            title: 'Percentage (%)',
                            range: [0, 110],
                            dtick: 20,
                            ticksuffix: '%',
                            rangemode: 'tozero'
                          },

                          margin: {
                            l: 60,
                            r: 25,
                            t: 45,
                            b: 85
                          }
                        }}
                        config={plotConfig}
                        style={{
                          width: '100%',
                          height: 350
                        }}
                        useResizeHandler
                      />
                    ) : (
                      <EmptyState>
                        No Monday-to-Friday attendance records found.
                      </EmptyState>
                    )}
                  </Panel>

                </div>

                {/* WEEKDAY ATTENDANCE SUMMARY TABLE */}
                <Panel
                  title="Weekday attendance summary"
                  subtitle="Present, absent, late and attendance percentages for Monday through Sunday."
                  className="table-panel"
                >
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Weekday</th>
                          <th>Total records</th>
                          <th>Present</th>
                          <th>Absent</th>
                          <th>Late</th>
                          <th>Attendance %</th>
                          <th>Absence %</th>
                        </tr>
                      </thead>

                      <tbody>
                        {weekdaySummary.map(item => (
                          <tr key={item.day}>
                            <td>
                              <strong>{item.day}</strong>
                            </td>

                            <td>{number(item.total)}</td>
                            <td>{number(item.present)}</td>
                            <td>{number(item.absent)}</td>
                            <td>{number(item.late)}</td>

                            <td>
                              <span
                                className={`rate-chip ${rateClass(item.attendanceRate)}`}
                              >
                                {percent(item.attendanceRate)}
                              </span>
                            </td>

                            <td>{percent(item.absenceRate)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {!timeFilteredRows.length && (
                      <EmptyState>
                      No attendance records found for the selected filters.
                      </EmptyState>
                    )}
                  </div>
                </Panel>
              </>
            )}

          </>
        )}

        <footer>
          Scholarly · React + FastAPI + Pandas + Plotly
          <br />
          Student Attendance Intelligence Platform
        </footer>
      </main>

      {/* FLOATING ASK AI CHATBOT (bottom-right, on every view) */}
      <AIChatbot
        api={API}
        datasetLoaded={Boolean(data)}
        filename={data?.filename}
      />
    </div>
  )
}

export default App