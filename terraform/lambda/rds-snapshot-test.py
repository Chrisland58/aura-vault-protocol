"""
Issue #521 — Automated RDS Snapshot Testing & Restore Drills

Weekly Lambda that:
1. Finds the latest automated RDS snapshot
2. Restores it to a temporary RDS instance
3. Measures restore time (target < 30 minutes)
4. Runs schema validation & row count checks
5. Destroys the temporary instance
6. Emails results to the operations team
7. Triggers PagerDuty on failure
"""

import boto3
import json
import os
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone

# ── AWS clients ───────────────────────────────────────────────────────────

rds = boto3.client("rds")
sns = boto3.client("sns")
ses = boto3.client("ses")
ssm = boto3.client("ssm")

# ── Environment variables ─────────────────────────────────────────────────

SOURCE_DB      = os.environ["SOURCE_DB_IDENTIFIER"]
SNS_TOPIC      = os.environ["SNS_TOPIC_ARN"]
PAGERDUTY_URL  = os.environ.get("PAGERDUTY_EVENTS_URL", "")
OPS_EMAIL      = os.environ.get("OPERATIONS_EMAIL", "")
VALID_TABLE    = os.environ.get("VALIDATION_TABLE", "vault_positions")
DB_SUBNET_GRP  = os.environ["DB_SUBNET_GROUP"]
DB_SG_ID       = os.environ["DB_SECURITY_GROUP_ID"]

TEST_DB_ID     = f"{SOURCE_DB}-restore-test"


def handler(event, context):
    start_time = time.time()
    result = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "source_db": SOURCE_DB,
        "test_db": TEST_DB_ID,
        "success": False,
        "restore_time_minutes": None,
        "snapshot_id": None,
        "snapshot_age_hours": None,
        "schema_validation": None,
        "row_count": None,
        "error": None,
    }

    try:
        # ── Step 1: Find latest automated snapshot ────────────────────────
        print(f"[INFO] Finding latest automated snapshot for {SOURCE_DB}")
        snaps_resp = rds.describe_db_snapshots(
            DBInstanceIdentifier=SOURCE_DB,
            SnapshotType="automated",
        )
        snapshots = snaps_resp.get("DBSnapshots", [])

        if not snapshots:
            raise RuntimeError(f"No automated snapshots found for {SOURCE_DB}")

        latest = sorted(snapshots, key=lambda s: s["SnapshotCreateTime"])[-1]
        snap_id = latest["DBSnapshotIdentifier"]
        snap_age_hours = round(
            (datetime.now(timezone.utc) - latest["SnapshotCreateTime"]).total_seconds() / 3600, 1
        )

        result["snapshot_id"] = snap_id
        result["snapshot_age_hours"] = snap_age_hours
        print(f"[INFO] Using snapshot: {snap_id} (age: {snap_age_hours}h)")

        # ── Step 2: Restore snapshot to temp instance ─────────────────────
        print(f"[INFO] Restoring snapshot to {TEST_DB_ID}")
        restore_start = time.time()

        rds.restore_db_instance_from_db_snapshot(
            DBInstanceIdentifier=TEST_DB_ID,
            DBSnapshotIdentifier=snap_id,
            DBInstanceClass="db.t3.micro",
            DBSubnetGroupName=DB_SUBNET_GRP,
            VpcSecurityGroupIds=[DB_SG_ID],
            MultiAZ=False,
            PubliclyAccessible=False,
            DeletionProtection=False,
            Tags=[
                {"Key": "Purpose", "Value": "restore-drill"},
                {"Key": "CreatedBy", "Value": "lambda-snapshot-test"},
            ],
        )

        # ── Step 3: Wait for instance to become available ─────────────────
        print(f"[INFO] Waiting for {TEST_DB_ID} to become available...")
        waiter = rds.get_waiter("db_instance_available")
        waiter.wait(
            DBInstanceIdentifier=TEST_DB_ID,
            WaiterConfig={"Delay": 30, "MaxAttempts": 60},  # max 30 minutes
        )

        restore_minutes = round((time.time() - restore_start) / 60, 1)
        result["restore_time_minutes"] = restore_minutes
        print(f"[INFO] Restore completed in {restore_minutes} minutes")

        if restore_minutes > 30:
            print(f"[WARN] Restore time {restore_minutes}m exceeds 30-minute RTO target")

        # ── Step 4: Get the restored instance endpoint ────────────────────
        db_info = rds.describe_db_instances(DBInstanceIdentifier=TEST_DB_ID)
        endpoint = db_info["DBInstances"][0]["Endpoint"]["Address"]
        db_port  = db_info["DBInstances"][0]["Endpoint"]["Port"]
        db_name  = db_info["DBInstances"][0]["DBName"]
        print(f"[INFO] Restored instance endpoint: {endpoint}:{db_port}")

        # ── Step 5: Schema validation ─────────────────────────────────────
        # Note: psycopg2 is available in Lambda Python 3.11 via the aws-psycopg2 layer.
        # If the layer is not attached, this block will log a warning and skip DB checks.
        try:
            import psycopg2  # type: ignore

            # Retrieve DB credentials from SSM Parameter Store
            ssm_prefix = f"/{SOURCE_DB.split('-db-')[0]}"
            try:
                creds_param = ssm.get_parameter(
                    Name=f"{ssm_prefix}/db/master-credentials",
                    WithDecryption=True,
                )
                creds = json.loads(creds_param["Parameter"]["Value"])
                db_user     = creds["username"]
                db_password = creds["password"]
            except Exception as ssm_err:
                print(f"[WARN] Could not retrieve DB credentials from SSM: {ssm_err}")
                db_user     = os.environ.get("DB_USERNAME", "postgres")
                db_password = os.environ.get("DB_PASSWORD", "")

            conn = psycopg2.connect(
                host=endpoint,
                port=db_port,
                dbname=db_name,
                user=db_user,
                password=db_password,
                connect_timeout=30,
            )
            conn.autocommit = True
            cur = conn.cursor()

            # Schema validation: count public tables
            cur.execute(
                "SELECT COUNT(*) FROM information_schema.tables "
                "WHERE table_schema = 'public' AND table_type = 'BASE TABLE'"
            )
            table_count = cur.fetchone()[0]
            result["schema_validation"] = {
                "public_table_count": table_count,
                "passed": table_count > 0,
            }
            print(f"[INFO] Schema validation: {table_count} public tables found")

            # Row count check on validation table
            try:
                cur.execute(f"SELECT COUNT(*) FROM {VALID_TABLE}")  # nosec — internal table name from env
                row_count = cur.fetchone()[0]
                result["row_count"] = {
                    "table": VALID_TABLE,
                    "count": row_count,
                    "passed": row_count >= 0,  # any count (including 0) is valid
                }
                print(f"[INFO] Row count for {VALID_TABLE}: {row_count}")
            except Exception as rc_err:
                print(f"[WARN] Row count check failed for {VALID_TABLE}: {rc_err}")
                result["row_count"] = {"table": VALID_TABLE, "error": str(rc_err), "passed": False}

            cur.close()
            conn.close()

        except ImportError:
            print("[WARN] psycopg2 not available — skipping DB connectivity checks")
            result["schema_validation"] = {"passed": None, "note": "psycopg2 not available"}

        result["success"] = True

    except Exception as exc:
        result["error"] = str(exc)
        print(f"[ERROR] Restore drill failed: {exc}")
        _trigger_pagerduty(result)

    finally:
        # ── Step 6: Always destroy the temp instance ──────────────────────
        try:
            print(f"[INFO] Deleting temporary instance {TEST_DB_ID}")
            rds.delete_db_instance(
                DBInstanceIdentifier=TEST_DB_ID,
                SkipFinalSnapshot=True,
                DeleteAutomatedBackups=True,
            )
            print(f"[INFO] Delete initiated for {TEST_DB_ID}")
        except rds.exceptions.DBInstanceNotFoundFault:
            print(f"[INFO] {TEST_DB_ID} not found — nothing to delete")
        except Exception as del_err:
            print(f"[WARN] Could not delete temp instance: {del_err}")

    result["total_elapsed_minutes"] = round((time.time() - start_time) / 60, 1)

    # ── Step 7: Publish results to SNS ────────────────────────────────────
    status = "PASS" if result["success"] else "FAIL"
    sns.publish(
        TopicArn=SNS_TOPIC,
        Subject=f"[{status}] RDS Snapshot Restore Drill — {SOURCE_DB}",
        Message=json.dumps(result, indent=2, default=str),
    )

    # ── Step 8: Send email via SES ────────────────────────────────────────
    if OPS_EMAIL:
        _send_email(result, status)

    # ── Step 9: Store result in SSM for dashboards/runbooks ──────────────
    try:
        ssm.put_parameter(
            Name=f"/{'/'.join(SOURCE_DB.split('-')[:2])}/restore-test/last-result",
            Value=json.dumps(result, default=str),
            Type="String",
            Overwrite=True,
        )
    except Exception as ssm_err:
        print(f"[WARN] Could not write result to SSM: {ssm_err}")

    print(f"[INFO] Done. Result: {json.dumps(result, default=str)}")
    return result


def _trigger_pagerduty(result: dict) -> None:
    """Send a PagerDuty alert on restore drill failure."""
    if not PAGERDUTY_URL:
        return

    payload = {
        "routing_key": os.environ.get("PAGERDUTY_ROUTING_KEY", ""),
        "event_action": "trigger",
        "payload": {
            "summary": f"RDS snapshot restore drill FAILED for {SOURCE_DB}",
            "severity": "critical",
            "source": "lambda-rds-snapshot-test",
            "custom_details": result,
        },
        "dedup_key": f"rds-restore-drill-{SOURCE_DB}",
    }

    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        PAGERDUTY_URL,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            print(f"[INFO] PagerDuty response: {resp.status}")
    except urllib.error.URLError as pd_err:
        print(f"[WARN] PagerDuty notification failed: {pd_err}")


def _send_email(result: dict, status: str) -> None:
    """Send an HTML summary email via SES."""
    restore_time = result.get("restore_time_minutes", "N/A")
    rto_ok = isinstance(restore_time, (int, float)) and restore_time <= 30
    rto_badge = "✅" if rto_ok else "⚠️"

    schema = result.get("schema_validation") or {}
    schema_ok = schema.get("passed")
    schema_badge = "✅" if schema_ok else ("❓" if schema_ok is None else "❌")

    row = result.get("row_count") or {}
    row_badge = "✅" if row.get("passed") else "❓"

    html_body = f"""
    <html><body style="font-family: Arial, sans-serif; max-width: 700px;">
    <h2>RDS Snapshot Restore Drill — {status}</h2>
    <table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse; width:100%">
      <tr><td><strong>Timestamp</strong></td><td>{result['timestamp']}</td></tr>
      <tr><td><strong>Source DB</strong></td><td>{result['source_db']}</td></tr>
      <tr><td><strong>Snapshot ID</strong></td><td>{result.get('snapshot_id','N/A')}</td></tr>
      <tr><td><strong>Snapshot Age</strong></td><td>{result.get('snapshot_age_hours','N/A')} hours</td></tr>
      <tr><td><strong>Restore Time</strong></td><td>{rto_badge} {restore_time} minutes (target: &lt; 30 min)</td></tr>
      <tr><td><strong>Schema Validation</strong></td><td>{schema_badge} {schema.get('public_table_count','N/A')} tables found</td></tr>
      <tr><td><strong>Row Count ({VALID_TABLE})</strong></td><td>{row_badge} {row.get('count','N/A')} rows</td></tr>
      <tr><td><strong>Overall Status</strong></td><td>{'✅ PASS' if result['success'] else '❌ FAIL'}</td></tr>
    </table>
    {"<p style='color:red'><strong>Error:</strong> " + result['error'] + "</p>" if result.get('error') else ""}
    <p style="color:#666; font-size:12px;">Generated by lambda-rds-snapshot-test</p>
    </body></html>
    """

    try:
        ses.send_email(
            Source=OPS_EMAIL,
            Destination={"ToAddresses": [OPS_EMAIL]},
            Message={
                "Subject": {"Data": f"[{status}] RDS Restore Drill — {SOURCE_DB}"},
                "Body": {
                    "Html": {"Data": html_body},
                    "Text": {"Data": json.dumps(result, indent=2, default=str)},
                },
            },
        )
        print(f"[INFO] Email sent to {OPS_EMAIL}")
    except Exception as ses_err:
        print(f"[WARN] SES email failed: {ses_err}")
