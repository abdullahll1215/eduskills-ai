"""Shared, versioned IS study-plan catalog; never creates a database course."""
import json
from pathlib import Path

COURSES = json.loads((Path(__file__).resolve().parents[1] / 'data' / 'is_courses.json').read_text())['courses']
_BY_CODE = {course['code']: course for course in COURSES}


def course_title(number: str) -> str | None:
    course = _BY_CODE.get(number)
    return course['name_en'] if course else None
