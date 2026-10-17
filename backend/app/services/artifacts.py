"""Artifact-informed behavioral markers (section 3.1).

Only structural/temporal metadata is analysed - never the technical content of the work (out of scope, 3.2).
Supported input: the output of
    git log --pretty=format:"%H|%an|%aI|%s"
or one ISO timestamp per line.
"""
from datetime import datetime, timedelta
from statistics import pstdev


def _parse_ts(value: str) -> datetime | None:
    value = value.strip()
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        try:
            dt = datetime.fromtimestamp(int(value))
        except (ValueError, OSError):
            return None
    return dt.replace(tzinfo=None) if dt.tzinfo is None else dt.astimezone().replace(tzinfo=None)


def parse_git_log(text: str) -> list[dict]:
    commits = []
    for line in (text or "").splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split("|")
        if len(parts) >= 3:
            ts = _parse_ts(parts[2])
            if ts:
                commits.append({"hash": parts[0][:10], "author": parts[1], "at": ts, "message": "|".join(parts[3:])[:120]})
                continue
        ts = _parse_ts(line)
        if ts:
            commits.append({"hash": "", "author": "", "at": ts, "message": ""})
    return sorted(commits, key=lambda c: c["at"])


def commit_indicators(commits: list[dict], due: datetime | None) -> dict:
    """Consistency, effort distribution and last-minute behavior."""
    if not commits:
        return {"commit_count": 0}
    times = [c["at"] for c in commits]
    days = sorted({t.date() for t in times})
    span_days = max(1, (times[-1].date() - times[0].date()).days + 1)
    gaps = [(b - a).total_seconds() / 3600 for a, b in zip(times, times[1:])]
    out = {
        "commit_count": len(commits),
        "active_days": len(days),
        "span_days": span_days,
        "first_commit": times[0].isoformat(),
        "last_commit": times[-1].isoformat(),
        # share of days in the period with at least one commit
        "consistency": round(len(days) / span_days, 2),
        "avg_hours_between_commits": round(sum(gaps) / len(gaps), 1) if gaps else None,
        "regularity_stddev_hours": round(pstdev(gaps), 1) if len(gaps) > 1 else None,
    }
    if due:
        last_minute = sum(1 for t in times if due - timedelta(hours=48) <= t <= due)
        out["last_minute_ratio"] = round(last_minute / len(times), 2)
        out["commits_after_due"] = sum(1 for t in times if t > due)
    return out


def submission_indicators(submitted_at: datetime, due: datetime | None) -> dict:
    if not due:
        return {"submitted_at": submitted_at.isoformat()}
    hours = (due - submitted_at).total_seconds() / 3600
    return {
        "submitted_at": submitted_at.isoformat(),
        "hours_before_due": round(hours, 1),
        "on_time": hours >= 0,
    }


def summarize(metrics_list: list[dict]) -> dict:
    """Aggregate behavioral indicators shown to the instructor (UC-03 step 2)."""
    commits = sum(m.get("commit_count", 0) for m in metrics_list)
    consistency = [m["consistency"] for m in metrics_list if m.get("consistency") is not None]
    last_minute = [m["last_minute_ratio"] for m in metrics_list if m.get("last_minute_ratio") is not None]
    on_time = [m["on_time"] for m in metrics_list if "on_time" in m]
    indicators = []
    if consistency:
        c = max(consistency)
        indicators.append(
            {"label": "Work consistency", "value": f"{round(c * 100)}% of days active",
             "signal": "positive" if c >= 0.4 else "warning"}
        )
    if last_minute:
        lm = max(last_minute)
        indicators.append(
            {"label": "Last-minute work", "value": f"{round(lm * 100)}% of commits in final 48h",
             "signal": "warning" if lm >= 0.5 else "positive"}
        )
    if on_time:
        ok = sum(on_time)
        indicators.append(
            {"label": "Punctuality", "value": f"{ok}/{len(on_time)} submissions on time",
             "signal": "positive" if ok == len(on_time) else "warning"}
        )
    return {"total_commits": commits, "indicators": indicators}
