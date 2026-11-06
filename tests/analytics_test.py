"""Run with `python -m unittest discover -s tests -p '*_test.py'`; no AWS credentials needed."""

import base64
from datetime import datetime, timedelta, timezone
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import types
import unittest
from contextlib import redirect_stderr, redirect_stdout
from unittest.mock import Mock, patch


ROOT = Path(__file__).resolve().parents[1]


def load_module(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "analytics" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    fake_boto = types.ModuleType("boto3")
    fake_boto.client = Mock(side_effect=AssertionError("Tests must never access AWS"))
    fake_config = types.ModuleType("botocore.config")
    fake_config.Config = Mock()
    with patch.dict(sys.modules, {"boto3": fake_boto, "botocore": types.ModuleType("botocore"), "botocore.config": fake_config}):
        spec.loader.exec_module(module)
    return module


collector = load_module("collector")
dashboard = load_module("dashboard")


def request(data, **extra):
    if isinstance(data, dict):
        data = {"consent": 2, **data}
    return {"requestContext": {"http": {"method": "POST"}}, "headers": {"content-type": "application/json", "origin": collector.ORIGIN},
            "body": json.dumps(data), **extra}


class AnalyticsTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {"TABLE_NAME": "test-only", "ANALYTICS_ENABLED": "true"})
        self.environment.start()
        self.addCleanup(self.environment.stop)
        collector._dynamodb = Mock()
        dashboard._dynamodb = Mock()
        dashboard._dynamodb.query.return_value = {"Items": []}

    def test_collection_defaults_paused_without_creating_a_database_client(self):
        for enabled in (None, "false", "", "1", "TRUE"):
            with self.subTest(enabled=enabled), patch.dict(os.environ), patch.object(collector, "client") as database:
                if enabled is None:
                    os.environ.pop("ANALYTICS_ENABLED", None)
                else:
                    os.environ["ANALYTICS_ENABLED"] = enabled
                for body in ('{"event":"visit"}', '{"event":"visit","consent":2}', 'malformed'):
                    self.assertEqual(collector.handler(request({}, body=body), None)["statusCode"], 204)
                database.assert_not_called()
        collector._dynamodb.update_item.assert_not_called()

    def test_every_event_requires_current_integer_consent(self):
        examples = [{"event": "visit"}, {"event": "lesson_open", "lesson": "salsa"},
                    {"event": "session_start", "lesson": "salsa"},
                    {"event": "session_finish", "lesson": "salsa", "seconds": 10, "completed": False}]
        for data in examples:
            self.assertEqual(collector.handler(request({}, body=json.dumps(data)), None)["statusCode"], 400)
            for consent in (None, 1, True, False, 2.0, "2", [], {}):
                with self.subTest(event=data["event"], consent=consent):
                    self.assertEqual(collector.handler(request({**data, "consent": consent}), None)["statusCode"], 400)
        collector._dynamodb.update_item.assert_not_called()
        for data in examples:
            self.assertEqual(collector.handler(request({**data, "consent": 2}), None)["statusCode"], 204)
        self.assertEqual(collector._dynamodb.update_item.call_count, len(examples))

    def test_strict_payload_excludes_identifiers_and_unknown_fields(self):
        for name in ("id", "userId", "deviceId", "ip", "userAgent", "referrer", "timestamp", "score", "pose", "video", "audio"):
            with self.subTest(name=name):
                self.assertEqual(collector.handler(request({"event": "visit", name: "sensitive"}), None)["statusCode"], 400)
        for data in (["visit"], {"event": []}, {"event": "other"}, {"event": "visit", "source": "https://example.com/secret"},
                     {"event": "visit", "lesson": "salsa"}, {"event": "session_start", "lesson": "salsa", "source": "google"},
                     {"event": "lesson_open", "lesson": "unknown"}, {"event": "lesson_open", "lesson": "all"}, {"event": "lesson_open"}):
            with self.subTest(data=data):
                self.assertEqual(collector.handler(request(data), None)["statusCode"], 400)
        collector._dynamodb.update_item.assert_not_called()

    def test_body_origin_method_and_content_type_boundaries(self):
        cases = [({"body": '{"event":"visit","event":"visit"}'}, 400), ({"body": " " * 513}, 400),
                 ({"body": "é" * 257}, 400), ({"body": "{bad"}, 400), ({"body": "###", "isBase64Encoded": True}, 400),
                 ({"headers": {"origin": "https://evil.example", "content-type": "application/json"}}, 403),
                 ({"headers": {"content-type": "text/plain"}}, 415), ({"requestContext": {"http": {"method": "GET"}}}, 405)]
        for extra, expected in cases:
            with self.subTest(extra=extra):
                self.assertEqual(collector.handler(request({"event": "visit"}, **extra), None)["statusCode"], expected)
        collector._dynamodb.update_item.assert_not_called()

    def test_visit_writes_one_daily_aggregate_and_ttl_only(self):
        before = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        event = request({"event": "visit", "source": "reddit"})
        event["requestContext"]["http"].update(sourceIp="secret-ip", userAgent="secret-agent")
        event["headers"]["referer"] = "https://example.com/secret"
        self.assertEqual(collector.handler(event, None)["statusCode"], 204)
        call = collector._dynamodb.update_item.call_args.kwargs
        self.assertEqual(call["Key"], {"app": {"S": "movana"}, "key": {"S": f"{before.date()}#visit#all#reddit"}})
        self.assertEqual(call["ExpressionAttributeValues"][":expires"], {"N": str(int((before + timedelta(days=90)).timestamp()))})
        self.assertEqual(call["ExpressionAttributeValues"][":one"], {"N": "1"})
        self.assertNotIn("secret", json.dumps(call))
        self.assertEqual(set(call["ExpressionAttributeNames"].values()), {"expires", "count", "seconds", "completed"})

    def test_base64_and_content_type_parameter(self):
        body = base64.b64encode(b'{"event":"visit","consent":2}').decode()
        event = request({}, body=body, isBase64Encoded=True, headers={"Content-Type": "application/json; charset=UTF-8"})
        self.assertEqual(collector.handler(event, None)["statusCode"], 204)
        self.assertTrue(collector._dynamodb.update_item.call_args.kwargs["Key"]["key"]["S"].endswith("#visit#all#direct"))

    def test_finish_requires_bounded_integer_duration_and_boolean(self):
        valid = {"event": "session_finish", "lesson": "salsa", "seconds": 600, "completed": True}
        for seconds in (-1, 601, 1.5, True, "30", None):
            self.assertEqual(collector.handler(request({**valid, "seconds": seconds}), None)["statusCode"], 400)
        for completed in (1, "true", None):
            self.assertEqual(collector.handler(request({**valid, "completed": completed}), None)["statusCode"], 400)
        self.assertEqual(collector.handler(request(valid), None)["statusCode"], 204)
        values = collector._dynamodb.update_item.call_args.kwargs["ExpressionAttributeValues"]
        self.assertEqual(values[":seconds"], {"N": "600"})
        self.assertEqual(values[":completed"], {"N": "1"})
        self.assertEqual(collector.handler(request({**valid, "seconds": 0, "completed": False}), None)["statusCode"], 204)

    def test_storage_failure_drops_counts_without_logging(self):
        collector._dynamodb.update_item.side_effect = RuntimeError("secret detail")
        captured = io.StringIO()
        with redirect_stdout(captured), redirect_stderr(captured):
            self.assertEqual(collector.handler(request({"event": "visit"}), None)["statusCode"], 204)
        self.assertEqual(captured.getvalue(), "")

    def test_widget_documentation_has_no_database_read(self):
        self.assertIn("Collection enabled: new events require consent version 2.", dashboard.handler({"describe": False}, None)["markdown"])
        dashboard._dynamodb.query.assert_not_called()

    def test_widget_shows_paused_state_for_default_configuration(self):
        os.environ.pop("ANALYTICS_ENABLED", None)
        self.assertIn("Collection paused: no new usage events are stored.", dashboard.handler({"describe": True}, None)["markdown"])
        dashboard._dynamodb.query.assert_not_called()
        result = dashboard.handler({}, None)
        self.assertIn("Collection paused: no new usage events are stored.", result)
        self.assertIn("Historical totals may include earlier collection", result)

    def test_dashboard_aggregates_pagination_and_safe_output(self):
        day = datetime.now(timezone.utc).date()
        def row(kind, lesson, count, source="direct", seconds=0, completed=0):
            return {"key": {"S": f"{day}#{kind}#{lesson}#{source}"}, "count": {"N": str(count)},
                    "seconds": {"N": str(seconds)}, "completed": {"N": str(completed)}}
        dashboard._dynamodb.query.side_effect = [
            {"Items": [row("visit", "all", 7, source="google"), row("lesson_open", "salsa", 3)], "LastEvaluatedKey": {"key": {"S": "page"}}},
            {"Items": [row("session_start", "salsa", 2), row("session_finish", "salsa", 2, seconds=180, completed=1),
                       row("visit", "<script>alert(1)</script>", 99), {"key": {"S": "<script>bad</script>"}}]},
        ]
        result = dashboard.handler({"echo": "<script>attack</script>", "widgetContext": {"title": "<img src=x onerror=attack>"}}, None)
        self.assertIn("<span>Visits</span><strong>7</strong>", result)
        self.assertIn("<span>Completed sessions</span><strong>1</strong>", result)
        self.assertIn("<span>Practice minutes</span><strong>3.0</strong>", result)
        self.assertIn("<td>Salsa side basic</td><td>3</td><td>2</td><td>2</td><td>1</td><td>3.0</td>", result)
        self.assertNotIn("<script", result)
        self.assertNotIn("attack", result)
        self.assertIn("not unique people", result)
        self.assertIn("Collection enabled: new events require consent version 2.", result)
        first_call, next_call = dashboard._dynamodb.query.call_args_list
        self.assertEqual(first_call.kwargs["ExpressionAttributeValues"][":first"], {"S": f"{day - timedelta(days=29)}#"})
        self.assertIn("ExclusiveStartKey", next_call.kwargs)
        self.assertIn("&lt;script&gt;", dashboard.table("<script>", ["<b>"], [["<i>"]]))

    def test_dashboard_failure_does_not_reflect_error(self):
        dashboard._dynamodb.query.side_effect = RuntimeError("secret detail")
        result = dashboard.handler({}, None)
        self.assertIn("Statistics are temporarily unavailable. Try refreshing later.", result)
        self.assertIn("Collection enabled: new events require consent version 2.", result)
        self.assertNotIn("secret detail", result)


if __name__ == "__main__":
    unittest.main()
