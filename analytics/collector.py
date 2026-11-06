"""Collect daily counts only. Never log requests, event payloads, or exceptions."""

import base64
import binascii
from datetime import datetime, timedelta, timezone
import json
import os

import boto3
from botocore.config import Config


ORIGIN = "https://d2cxbgxgnz3xxl.cloudfront.net"
EVENTS = {"visit", "lesson_open", "session_start", "session_finish"}
LESSONS = {"all", "step-touch", "salsa", "house", "disco", "merengue", "seated"}
SOURCES = {"direct", "google", "microsoft", "reddit", "meta", "chatgpt", "other"}
_dynamodb = None


def client():
    global _dynamodb
    if _dynamodb is None:
        _dynamodb = boto3.client(
            "dynamodb",
            config=Config(connect_timeout=0.4, read_timeout=0.6,
                          retries={"max_attempts": 0, "mode": "standard"}),
        )
    return _dynamodb


def response(status):
    return {"statusCode": status, "headers": {"cache-control": "no-store"}, "body": ""}


def unique_object(pairs):
    result = {}
    for name, value in pairs:
        if name in result:
            raise ValueError("Duplicate field")
        result[name] = value
    return result


def payload(event):
    body = event.get("body", "")
    if not isinstance(body, str) or len(body) > 684:
        raise ValueError("Invalid body")
    raw = base64.b64decode(body, validate=True) if event.get("isBase64Encoded") else body.encode("utf-8")
    if len(raw) > 512:
        raise ValueError("Body too large")
    data = json.loads(raw.decode("utf-8"), object_pairs_hook=unique_object)
    if not isinstance(data, dict):
        raise ValueError("Expected object")
    kind = data.get("event")
    if not isinstance(kind, str) or kind not in EVENTS:
        raise ValueError("Invalid event")
    if type(data.get("consent")) is not int or data["consent"] != 2:
        raise ValueError("Current consent required")
    allowed = {"event", "lesson", "source", "consent"} if kind == "visit" else {"event", "lesson", "consent"}
    if kind == "session_finish":
        allowed |= {"seconds", "completed"}
    if data.keys() - allowed:
        raise ValueError("Unknown field")
    lesson = data.get("lesson", "all" if kind == "visit" else None)
    source = data.get("source", "direct")
    if not isinstance(lesson, str) or lesson not in LESSONS:
        raise ValueError("Invalid lesson")
    if not isinstance(source, str) or source not in SOURCES:
        raise ValueError("Invalid source")
    if kind == "visit" and lesson != "all":
        raise ValueError("Visit is not lesson-specific")
    if kind != "visit" and lesson == "all":
        raise ValueError("Lesson event needs a lesson")
    seconds, completed = 0, False
    if kind == "session_finish":
        seconds, completed = data.get("seconds"), data.get("completed")
        if type(seconds) is not int or not 0 <= seconds <= 600 or type(completed) is not bool:
            raise ValueError("Invalid finish")
    return kind, lesson, source, seconds, completed


def handler(event, context):
    # Fail closed, including requests from cached clients with older defaults.
    if os.environ.get("ANALYTICS_ENABLED") != "true":
        return response(204)
    # CloudFront OAC + AWS_IAM authentication is enforced by the function URL.
    if event.get("requestContext", {}).get("http", {}).get("method") != "POST":
        return response(405)
    headers = {name.lower(): value for name, value in (event.get("headers") or {}).items()}
    if headers.get("origin") not in (None, ORIGIN):
        return response(403)
    content_type = headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if content_type != "application/json":
        return response(415)
    try:
        kind, lesson, source, seconds, completed = payload(event)
    except (ValueError, TypeError, UnicodeError, binascii.Error, RecursionError):
        return response(400)
    day = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    try:
        client().update_item(
            TableName=os.environ["TABLE_NAME"],
            Key={"app": {"S": "movana"}, "key": {"S": f"{day.date()}#{kind}#{lesson}#{source}"}},
            UpdateExpression="SET #expires = :expires ADD #count :one, #seconds :seconds, #completed :completed",
            ExpressionAttributeNames={"#expires": "expires", "#count": "count", "#seconds": "seconds", "#completed": "completed"},
            ExpressionAttributeValues={
                ":expires": {"N": str(int((day + timedelta(days=90)).timestamp()))},
                ":one": {"N": "1"}, ":seconds": {"N": str(seconds)}, ":completed": {"N": str(int(completed))},
            },
        )
    except Exception:
        # ponytail: drop counts on throttling/outages; no retry queue or raw-event storage.
        pass
    return response(204)
