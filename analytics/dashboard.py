"""Private CloudWatch custom widget over daily aggregates, with no raw event data."""

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from html import escape
import os

import boto3
from botocore.config import Config


LESSONS = {
    "step-touch": "Step-touch", "salsa": "Salsa side basic", "house": "House groove",
    "disco": "Disco reaches", "merengue": "Merengue steps", "seated": "Seated groove", "all": "All lessons",
}
SOURCES = {"direct": "Direct / untagged", "google": "Google", "microsoft": "Microsoft", "reddit": "Reddit",
           "meta": "Meta", "chatgpt": "ChatGPT", "other": "Other"}
EVENTS = {"visit", "lesson_open", "session_start", "session_finish"}
DOCS = """# Movana anonymous activity

Shows the last 30 UTC calendar days, including today. No widget parameters are needed.
Visits count page loads, including repeats; they are not unique people. Sources are
coarse campaign labels, not stored referrers. There are no user or device identifiers.
Practice time comes from submitted session endings, so closed tabs and lost connections
can undercount. Offline use, opt-outs, ad blockers, throttling, and outages can omit counts.
Tests and bots can count. Daily aggregates have a 90-day expiry; AWS removes expired rows
asynchronously. This widget is available only to authorized AWS users.
Historical totals may include collection before the current consent gate was introduced.
"""
_dynamodb = None


def client():
    global _dynamodb
    if _dynamodb is None:
        _dynamodb = boto3.client("dynamodb", config=Config(
            connect_timeout=1, read_timeout=2, retries={"max_attempts": 0, "mode": "standard"}))
    return _dynamodb


def number(item, name):
    try:
        return max(0, int(item.get(name, {}).get("N", "0")))
    except (ValueError, TypeError, AttributeError):
        return 0


def table(caption, headers, rows):
    head = "".join(f"<th scope='col'>{escape(str(value))}</th>" for value in headers)
    body = "".join("<tr>" + "".join(f"<td>{escape(str(value))}</td>" for value in row) + "</tr>" for row in rows)
    return f"<table><caption>{escape(caption)}</caption><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table>"


def handler(event, context):
    enabled = os.environ.get("ANALYTICS_ENABLED") == "true"
    state = ("Collection enabled: new events require consent version 2."
             if enabled else "Collection paused: no new usage events are stored.")
    notice = f"<p class='note'><b>{state}</b> Historical totals may include earlier collection, tests and bots.</p>"
    # CloudWatch sends describe when its Get documentation button is used.
    if isinstance(event, dict) and "describe" in event:
        return {"markdown": f"**{state}**\n\n{DOCS}"}
    today = datetime.now(timezone.utc).date()
    first = today - timedelta(days=29)
    request = {
        "TableName": os.environ["TABLE_NAME"],
        "KeyConditionExpression": "#app = :app AND #key BETWEEN :first AND :last",
        "ExpressionAttributeNames": {"#app": "app", "#key": "key"},
        "ExpressionAttributeValues": {":app": {"S": "movana"}, ":first": {"S": f"{first}#"}, ":last": {"S": f"{today}#~"}},
        "Limit": 1000,
    }
    items = []
    try:
        # The bounded schema allows at most 750 rows in this 30-day window.
        for _ in range(3):
            result = client().query(**request)
            items.extend(result.get("Items", []))
            if not result.get("LastEvaluatedKey"):
                break
            request["ExclusiveStartKey"] = result["LastEvaluatedKey"]
        else:
            return notice + "<p>Statistics are temporarily unavailable. Try refreshing later.</p>"
    except Exception:
        return notice + "<p>Statistics are temporarily unavailable. Try refreshing later.</p>"

    totals = defaultdict(int)
    lessons = defaultdict(lambda: defaultdict(int))
    days = defaultdict(lambda: defaultdict(int))
    sources = defaultdict(int)
    for item in items:
        try:
            day, kind, lesson, source = item["key"]["S"].split("#")
            if not (str(first) <= day <= str(today)) or kind not in EVENTS or lesson not in LESSONS or source not in SOURCES:
                continue
            datetime.strptime(day, "%Y-%m-%d")
        except (KeyError, ValueError, TypeError, AttributeError):
            continue
        count = number(item, "count")
        totals[kind] += count
        days[day][kind] += count
        if kind == "visit":
            sources[source] += count
        else:
            lessons[lesson][kind] += count
        if kind == "session_finish":
            for values in (totals, days[day], lessons[lesson]):
                values["seconds"] += number(item, "seconds")
                values["completed"] += number(item, "completed")

    cards = [("Visits", f"{totals['visit']:,}"), ("Lesson opens", f"{totals['lesson_open']:,}"),
             ("Practice starts", f"{totals['session_start']:,}"), ("Completed sessions", f"{totals['completed']:,}"),
             ("Practice minutes", f"{totals['seconds'] / 60:,.1f}")]
    summary = "".join(f"<div class='card'><span>{label}</span><strong>{value}</strong></div>" for label, value in cards)
    lesson_rows = [(label, lessons[key]['lesson_open'], lessons[key]['session_start'], lessons[key]['session_finish'],
                    lessons[key]['completed'], f"{lessons[key]['seconds'] / 60:,.1f}")
                   for key, label in LESSONS.items() if key != "all" or key in lessons]
    daily_rows = []
    for offset in range(30):
        day = str(today - timedelta(days=offset))
        values = days[day]
        daily_rows.append((day, values['visit'], values['session_start'], values['session_finish'],
                           values['completed'], f"{values['seconds'] / 60:,.1f}"))
    return (
        "<style>.movana{font-family:system-ui,sans-serif;padding:8px}.movana .cards{display:flex;flex-wrap:wrap;gap:12px}"
        ".movana .card{min-width:120px;padding:14px;border:1px solid #8298a5;border-radius:12px}"
        ".movana strong{display:block;font-size:26px}.movana table{width:100%;margin-top:22px;border-collapse:collapse}"
        ".movana caption{text-align:left;font-weight:700;margin-bottom:8px}.movana td,.movana th{text-align:left;padding:7px;border-bottom:1px solid #8298a5}"
        ".movana .note{font-size:13px;line-height:1.5}</style><section class='movana'>"
        f"<h2>Movana activity</h2>{notice}<p>{first} to {today} · UTC · Last 30 days</p><div class='cards'>{summary}</div>"
        "<p class='note'>Anonymous counts, not unique people. Visits are page loads; repeat visits, tests, and bots can count. "
        "Offline use, opt-outs, ad blockers, closed tabs, lost connections, and throttling can omit counts. Practice time is submitted when a session ends. "
        "Sources are coarse campaign labels; referrers are not stored. No recordings or movement data are collected. "
        "Daily aggregates have a 90-day expiry; AWS removes expired rows asynchronously. Use the dashboard Refresh button to update.</p>"
        + table("Lesson usage", ("Lesson", "Opens", "Starts", "Ended", "Completed", "Minutes"), lesson_rows)
        + table("Visit sources", ("Source", "Visits"), [(label, sources[key]) for key, label in SOURCES.items()])
        + table("Daily activity", ("UTC day", "Visits", "Starts", "Ended", "Completed", "Minutes"), daily_rows)
        + "</section>"
    )
