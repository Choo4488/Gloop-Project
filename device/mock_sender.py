#!/usr/bin/env python3
"""
Bottle return sender for Raspberry Pi.

Supports:
- `DEVICE_MODE=mock` for simulation
- `DEVICE_MODE=hardware` for GPIO + external AI inference command

Features:
- Firebase Admin SDK (service account or ADC)
- Firestore heartbeat updates
- Atomic Firestore writes (transaction/batch)
- Retry with exponential backoff
- Offline operation queue (accepted/rejected/end_session)
"""

from __future__ import annotations

import json
import os
import random
import shlex
import subprocess
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional, Sequence

import firebase_admin
from dotenv import load_dotenv
from firebase_admin import credentials, firestore
from google.api_core.exceptions import (
    Aborted,
    DeadlineExceeded,
    InternalServerError,
    RetryError,
    ServiceUnavailable,
)
from google.cloud.firestore_v1 import Increment

BOTTLE_POINTS = {
    "small": 1,
    "medium": 2,
    "large": 3,
}

BOTTLE_SIZES: Sequence[str] = ("small", "medium", "large")
RETRYABLE_EXCEPTIONS = (
    ServiceUnavailable,
    DeadlineExceeded,
    InternalServerError,
    Aborted,
    RetryError,
    ConnectionError,
    OSError,
)


@dataclass
class Config:
    project_id: Optional[str]
    machine_id: str
    device_mode: str
    poll_interval_sec: float
    idle_timeout_sec: float
    heartbeat_interval_sec: float
    retry_max_attempts: int
    retry_base_sec: float
    retry_max_sec: float
    queue_path: Path
    capture_dir: Path
    ai_inference_command: str
    sensor_pin: int
    sensor_active_high: bool
    solenoid_pin: int
    solenoid_active_high: bool
    solenoid_pulse_sec: float
    mock_min_bottle_interval_sec: float
    mock_max_bottle_interval_sec: float
    mock_analyze_sec: float
    mock_solenoid_sec: float
    mock_accept_rate: float
    mock_size_weights: tuple[float, float, float]
    mock_max_accepted_per_session: int
    source_name: str


@dataclass
class Operation:
    kind: str
    session_id: str
    source: str
    bottle_size: Optional[str] = None
    score_delta: int = 0
    reason: Optional[str] = None
    created_at_ms: int = 0


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")


def log(message: str) -> None:
    print(f"[{utc_now()}] {message}", flush=True)


def parse_float(name: str, default: float) -> float:
    value = os.getenv(name)
    if value is None:
        return default
    return float(value)


def parse_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None:
        return default
    return int(value)


def parse_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def parse_weights(value: str) -> tuple[float, float, float]:
    raw = [part.strip() for part in value.split(",") if part.strip()]
    if len(raw) != 3:
        raise ValueError("MOCK_SIZE_WEIGHTS must contain exactly 3 comma-separated numbers")

    weights = tuple(float(part) for part in raw)
    if any(weight <= 0 for weight in weights):
        raise ValueError("MOCK_SIZE_WEIGHTS values must be greater than 0")

    return weights  # type: ignore[return-value]


def load_config() -> Config:
    env_path = Path(__file__).with_name(".env")
    load_dotenv(env_path if env_path.exists() else None)

    project_id = os.getenv("FIREBASE_PROJECT_ID")
    device_mode = os.getenv("DEVICE_MODE", "mock").strip().lower()
    if device_mode not in {"mock", "hardware"}:
        raise ValueError("DEVICE_MODE must be either 'mock' or 'hardware'")

    queue_path = Path(os.getenv("OFFLINE_QUEUE_PATH", str(Path(__file__).with_name("offline_queue.jsonl"))))
    capture_dir = Path(os.getenv("CAPTURE_DIR", str(Path(__file__).with_name("captures"))))

    config = Config(
        project_id=project_id,
        machine_id=os.getenv("MACHINE_ID", "machine-01"),
        device_mode=device_mode,
        poll_interval_sec=parse_float("POLL_INTERVAL_SEC", 0.5),
        idle_timeout_sec=parse_float("SESSION_IDLE_TIMEOUT_SEC", 5.0),
        heartbeat_interval_sec=parse_float("HEARTBEAT_INTERVAL_SEC", 3.0),
        retry_max_attempts=parse_int("RETRY_MAX_ATTEMPTS", 5),
        retry_base_sec=parse_float("RETRY_BASE_SEC", 0.5),
        retry_max_sec=parse_float("RETRY_MAX_SEC", 8.0),
        queue_path=queue_path,
        capture_dir=capture_dir,
        ai_inference_command=os.getenv("AI_INFERENCE_COMMAND", ""),
        sensor_pin=parse_int("GPIO_BOTTLE_SENSOR_PIN", 17),
        sensor_active_high=parse_bool("GPIO_SENSOR_ACTIVE_HIGH", True),
        solenoid_pin=parse_int("GPIO_SOLENOID_PIN", 27),
        solenoid_active_high=parse_bool("GPIO_SOLENOID_ACTIVE_HIGH", True),
        solenoid_pulse_sec=parse_float("SOLENOID_PULSE_SEC", 0.5),
        mock_min_bottle_interval_sec=parse_float("MOCK_MIN_BOTTLE_INTERVAL_SEC", 1.0),
        mock_max_bottle_interval_sec=parse_float("MOCK_MAX_BOTTLE_INTERVAL_SEC", 4.0),
        mock_analyze_sec=parse_float("MOCK_ANALYZE_SEC", 0.8),
        mock_solenoid_sec=parse_float("MOCK_SOLENOID_SEC", 0.5),
        mock_accept_rate=parse_float("MOCK_ACCEPT_RATE", 0.8),
        mock_size_weights=parse_weights(os.getenv("MOCK_SIZE_WEIGHTS", "0.45,0.35,0.20")),
        mock_max_accepted_per_session=parse_int("MOCK_MAX_ACCEPTED_PER_SESSION", 0),
        source_name=os.getenv("DEVICE_SOURCE_NAME", "pi-device"),
    )

    if config.poll_interval_sec <= 0:
        raise ValueError("POLL_INTERVAL_SEC must be > 0")
    if config.idle_timeout_sec <= 0:
        raise ValueError("SESSION_IDLE_TIMEOUT_SEC must be > 0")
    if config.heartbeat_interval_sec <= 0:
        raise ValueError("HEARTBEAT_INTERVAL_SEC must be > 0")
    if config.retry_max_attempts <= 0:
        raise ValueError("RETRY_MAX_ATTEMPTS must be > 0")
    if config.retry_base_sec <= 0 or config.retry_max_sec <= 0:
        raise ValueError("RETRY_BASE_SEC and RETRY_MAX_SEC must be > 0")
    if config.solenoid_pulse_sec <= 0:
        raise ValueError("SOLENOID_PULSE_SEC must be > 0")
    if config.mock_min_bottle_interval_sec <= 0 or config.mock_max_bottle_interval_sec <= 0:
        raise ValueError("Mock bottle interval values must be > 0")
    if config.mock_min_bottle_interval_sec > config.mock_max_bottle_interval_sec:
        raise ValueError("MOCK_MIN_BOTTLE_INTERVAL_SEC must be <= MOCK_MAX_BOTTLE_INTERVAL_SEC")
    if not (0 <= config.mock_accept_rate <= 1):
        raise ValueError("MOCK_ACCEPT_RATE must be between 0 and 1")

    config.queue_path.parent.mkdir(parents=True, exist_ok=True)
    config.capture_dir.mkdir(parents=True, exist_ok=True)
    return config


def retry_call(config: Config, action_name: str, fn: Callable[[], object]) -> object:
    attempt = 0
    while True:
        try:
            return fn()
        except RETRYABLE_EXCEPTIONS as error:
            attempt += 1
            if attempt >= config.retry_max_attempts:
                raise

            base = min(config.retry_max_sec, config.retry_base_sec * (2 ** (attempt - 1)))
            jitter = random.uniform(0.8, 1.2)
            sleep_sec = max(0.1, min(config.retry_max_sec, base * jitter))
            log(
                f"{action_name} failed ({type(error).__name__}): retry {attempt}/{config.retry_max_attempts} "
                f"in {sleep_sec:.2f}s"
            )
            time.sleep(sleep_sec)


class OfflineQueue:
    def __init__(self, path: Path):
        self.path = path

    def _read_all(self) -> list[dict]:
        if not self.path.exists():
            return []

        operations: list[dict] = []
        for line in self.path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                payload = json.loads(line)
                if isinstance(payload, dict):
                    operations.append(payload)
            except json.JSONDecodeError:
                continue
        return operations

    def _write_all(self, operations: list[dict]) -> None:
        if not operations:
            if self.path.exists():
                self.path.unlink()
            return

        content = "\n".join(json.dumps(item, ensure_ascii=True) for item in operations)
        self.path.write_text(content + "\n", encoding="utf-8")

    def enqueue(self, operation: Operation) -> None:
        current = self._read_all()
        current.append(asdict(operation))
        self._write_all(current)
        log(f"Queued offline operation: {operation.kind} (session={operation.session_id})")

    def flush(self, apply_operation: Callable[[Operation], bool]) -> None:
        current = self._read_all()
        if not current:
            return

        remaining: list[dict] = []
        for index, payload in enumerate(current):
            operation = Operation(
                kind=str(payload.get("kind", "")),
                session_id=str(payload.get("session_id", "")),
                source=str(payload.get("source", "offline-queue")),
                bottle_size=payload.get("bottle_size"),
                score_delta=int(payload.get("score_delta", 0)),
                reason=payload.get("reason"),
                created_at_ms=int(payload.get("created_at_ms", 0)),
            )

            try:
                applied = apply_operation(operation)
                if applied:
                    log(f"Replayed queued operation: {operation.kind} (session={operation.session_id})")
                else:
                    log(f"Dropped queued operation (not applicable): {operation.kind} (session={operation.session_id})")
            except RETRYABLE_EXCEPTIONS as error:
                log(
                    f"Queue flush paused ({type(error).__name__}); will retry later. "
                    f"remaining={len(current) - index}"
                )
                remaining.append(payload)
                remaining.extend(current[index + 1 :])
                break
            except Exception as error:  # pragma: no cover
                log(f"Dropped invalid queued operation: {operation.kind} (error={error})")

        self._write_all(remaining)


def machine_ref(db: firestore.Client, machine_id: str):
    return db.collection("machines").document(machine_id)


def session_ref(db: firestore.Client, session_id: str):
    return db.collection("sessions").document(session_id)


def init_firestore(config: Config) -> firestore.Client:
    if not firebase_admin._apps:
        credential_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
        options = {"projectId": config.project_id} if config.project_id else None

        if credential_path:
            path_obj = Path(credential_path)
            if not path_obj.exists():
                raise FileNotFoundError(
                    "GOOGLE_APPLICATION_CREDENTIALS does not exist. "
                    f"Expected file at: {path_obj}"
                )
            cred = credentials.Certificate(str(path_obj))
            firebase_admin.initialize_app(cred, options=options)
            log(f"Firebase initialized with service account: {path_obj}")
        else:
            firebase_admin.initialize_app(options=options)
            log("Firebase initialized with default application credentials")

    return firestore.client()


def ensure_machine_document(db: firestore.Client, config: Config) -> None:
    def run() -> None:
        ref = machine_ref(db, config.machine_id)
        snapshot = ref.get()
        if snapshot.exists:
            return
        ref.set(
            {
                "machineName": "Bottle Return Machine #1",
                "status": "OFFLINE",
                "activeSessionId": None,
                "updatedAt": firestore.SERVER_TIMESTAMP,
                "lastHeartbeatAt": firestore.SERVER_TIMESTAMP,
            },
            merge=True,
        )
        log(f"Created machine document: machines/{config.machine_id}")

    retry_call(config, "ensure_machine_document", run)


def send_heartbeat(db: firestore.Client, config: Config, status: Optional[str] = None, active_session_id: Optional[str] = None) -> None:
    def run() -> None:
        payload: dict = {
            "updatedAt": firestore.SERVER_TIMESTAMP,
            "lastHeartbeatAt": firestore.SERVER_TIMESTAMP,
        }
        if status is not None:
            payload["status"] = status
        if active_session_id is not None:
            payload["activeSessionId"] = active_session_id

        machine_ref(db, config.machine_id).set(payload, merge=True)

    retry_call(config, "send_heartbeat", run)


def set_machine_status(db: firestore.Client, config: Config, status: str, active_session_id: Optional[str]) -> None:
    send_heartbeat(db, config, status=status, active_session_id=active_session_id)


def get_machine_data(db: firestore.Client, config: Config) -> Optional[dict]:
    def run() -> Optional[dict]:
        snapshot = machine_ref(db, config.machine_id).get()
        if not snapshot.exists:
            return None
        return snapshot.to_dict() or {}

    result = retry_call(config, "get_machine_data", run)
    return result if isinstance(result, dict) else None


def get_session_data(db: firestore.Client, config: Config, session_id: str) -> Optional[dict]:
    def run() -> Optional[dict]:
        snapshot = session_ref(db, session_id).get()
        if not snapshot.exists:
            return None
        return snapshot.to_dict() or {}

    result = retry_call(config, "get_session_data", run)
    return result if isinstance(result, dict) else None


def _operation_created_at_ms() -> int:
    return int(time.time() * 1000)


def apply_operation(db: firestore.Client, config: Config, operation: Operation) -> bool:
    if operation.kind == "accepted":
        if operation.bottle_size not in BOTTLE_POINTS:
            return False
        return apply_accepted_bottle(
            db=db,
            config=config,
            session_id=operation.session_id,
            bottle_size=operation.bottle_size,
            score_delta=operation.score_delta if operation.score_delta > 0 else BOTTLE_POINTS[operation.bottle_size],
            source=operation.source,
        )

    if operation.kind == "rejected":
        return apply_rejected_bottle(
            db=db,
            config=config,
            session_id=operation.session_id,
            source=operation.source,
        )

    if operation.kind == "end_session":
        end_session_by_timeout(db=db, config=config, session_id=operation.session_id, reason=operation.reason or "IDLE_TIMEOUT")
        return True

    return False


def apply_accepted_bottle(
    db: firestore.Client,
    config: Config,
    session_id: str,
    bottle_size: str,
    score_delta: int,
    source: str,
) -> bool:
    session_document = session_ref(db, session_id)
    event_document = db.collection("sessionEvents").document()

    @firestore.transactional
    def run_transaction(transaction: firestore.Transaction) -> bool:
        snapshot = session_document.get(transaction=transaction)
        if not snapshot.exists:
            return False

        data = snapshot.to_dict() or {}
        if data.get("status") != "ACTIVE":
            return False

        transaction.update(
            session_document,
            {
                "score": Increment(score_delta),
                f"bottleCounts.{bottle_size}": Increment(1),
                "lastBottleAt": firestore.SERVER_TIMESTAMP,
            },
        )
        transaction.set(
            event_document,
            {
                "sessionId": session_id,
                "type": "ACCEPTED",
                "bottleSize": bottle_size,
                "scoreDelta": score_delta,
                "source": source,
                "createdAt": firestore.SERVER_TIMESTAMP,
            },
        )
        return True

    def run() -> bool:
        transaction = db.transaction()
        return bool(run_transaction(transaction))

    result = retry_call(config, "apply_accepted_bottle", run)
    return bool(result)


def apply_rejected_bottle(
    db: firestore.Client,
    config: Config,
    session_id: str,
    source: str,
) -> bool:
    session_document = session_ref(db, session_id)
    event_document = db.collection("sessionEvents").document()

    @firestore.transactional
    def run_transaction(transaction: firestore.Transaction) -> bool:
        snapshot = session_document.get(transaction=transaction)
        if not snapshot.exists:
            return False

        data = snapshot.to_dict() or {}
        if data.get("status") != "ACTIVE":
            return False

        transaction.set(
            event_document,
            {
                "sessionId": session_id,
                "type": "REJECTED",
                "bottleSize": None,
                "scoreDelta": 0,
                "source": source,
                "createdAt": firestore.SERVER_TIMESTAMP,
            },
        )
        return True

    def run() -> bool:
        transaction = db.transaction()
        return bool(run_transaction(transaction))

    result = retry_call(config, "apply_rejected_bottle", run)
    return bool(result)


def end_session_by_timeout(
    db: firestore.Client,
    config: Config,
    session_id: str,
    reason: str = "IDLE_TIMEOUT",
) -> None:
    def run() -> None:
        batch = db.batch()
        batch.set(
            session_ref(db, session_id),
            {
                "status": "ENDED",
                "endedAt": firestore.SERVER_TIMESTAMP,
                "endedReason": reason,
            },
            merge=True,
        )
        batch.set(
            machine_ref(db, config.machine_id),
            {
                "status": "SESSION_ENDED",
                "activeSessionId": None,
                "updatedAt": firestore.SERVER_TIMESTAMP,
                "lastHeartbeatAt": firestore.SERVER_TIMESTAMP,
            },
            merge=True,
        )
        batch.commit()

    retry_call(config, "end_session_by_timeout", run)
    log(f"Session ended ({reason}): {session_id}")


def sleep_with_tick(duration_sec: float, on_tick: Callable[[], None]) -> None:
    end = time.monotonic() + max(0.0, duration_sec)
    while True:
        remaining = end - time.monotonic()
        if remaining <= 0:
            return
        time.sleep(min(0.1, remaining))
        on_tick()


class RuntimeBase:
    def wait_for_bottle(self, timeout_sec: float, on_tick: Callable[[], None]) -> bool:
        raise NotImplementedError

    def inspect_bottle(self) -> tuple[bool, Optional[str]]:
        raise NotImplementedError

    def release_solenoid(self, duration_sec: float, on_tick: Callable[[], None]) -> None:
        raise NotImplementedError

    def close(self) -> None:
        return


class MockRuntime(RuntimeBase):
    def __init__(self, config: Config):
        self.config = config

    def wait_for_bottle(self, timeout_sec: float, on_tick: Callable[[], None]) -> bool:
        next_wait = random.uniform(
            self.config.mock_min_bottle_interval_sec,
            self.config.mock_max_bottle_interval_sec,
        )
        if next_wait >= timeout_sec:
            sleep_with_tick(timeout_sec, on_tick)
            return False

        sleep_with_tick(next_wait, on_tick)
        return True

    def inspect_bottle(self) -> tuple[bool, Optional[str]]:
        time.sleep(self.config.mock_analyze_sec)
        accepted = random.random() < self.config.mock_accept_rate
        if not accepted:
            return False, None

        bottle_size = random.choices(BOTTLE_SIZES, weights=self.config.mock_size_weights, k=1)[0]
        return True, bottle_size

    def release_solenoid(self, duration_sec: float, on_tick: Callable[[], None]) -> None:
        sleep_with_tick(max(duration_sec, self.config.mock_solenoid_sec), on_tick)


class HardwareRuntime(RuntimeBase):
    def __init__(self, config: Config):
        self.config = config
        try:
            import RPi.GPIO as gpio  # type: ignore
        except ImportError as error:
            raise RuntimeError(
                "DEVICE_MODE=hardware requires RPi.GPIO on Raspberry Pi. "
                "Install dependencies on the Pi and run there."
            ) from error

        self.gpio = gpio
        self.gpio.setwarnings(False)
        self.gpio.setmode(self.gpio.BCM)
        pull = self.gpio.PUD_DOWN if config.sensor_active_high else self.gpio.PUD_UP
        self.gpio.setup(config.sensor_pin, self.gpio.IN, pull_up_down=pull)
        self.gpio.setup(config.solenoid_pin, self.gpio.OUT)
        self._set_solenoid(False)

    def _set_solenoid(self, enabled: bool) -> None:
        level = self.gpio.HIGH if enabled == self.config.solenoid_active_high else self.gpio.LOW
        self.gpio.output(self.config.solenoid_pin, level)

    def _sensor_triggered(self) -> bool:
        raw = self.gpio.input(self.config.sensor_pin)
        return bool(raw) if self.config.sensor_active_high else not bool(raw)

    def wait_for_bottle(self, timeout_sec: float, on_tick: Callable[[], None]) -> bool:
        deadline = time.monotonic() + max(0.0, timeout_sec)
        while time.monotonic() < deadline:
            if self._sensor_triggered():
                return True
            time.sleep(0.05)
            on_tick()
        return False

    def _capture_image(self) -> Path:
        image_path = self.config.capture_dir / f"bottle_{int(time.time() * 1000)}.jpg"

        try:
            from picamera2 import Picamera2  # type: ignore

            camera = Picamera2()
            camera_config = camera.create_still_configuration()
            camera.configure(camera_config)
            camera.start()
            time.sleep(0.2)
            camera.capture_file(str(image_path))
            camera.close()
            return image_path
        except Exception:
            pass

        try:
            import cv2  # type: ignore

            capture = cv2.VideoCapture(0)
            ok, frame = capture.read()
            capture.release()
            if ok:
                cv2.imwrite(str(image_path), frame)
                return image_path
        except Exception:
            pass

        image_path.write_bytes(b"")
        return image_path

    def _run_ai_inference(self, image_path: Path) -> tuple[bool, Optional[str]]:
        if not self.config.ai_inference_command.strip():
            log("AI_INFERENCE_COMMAND is empty. Rejecting bottle by default in hardware mode.")
            return False, None

        args = []
        for token in shlex.split(self.config.ai_inference_command):
            args.append(token.replace("{image_path}", str(image_path)))

        completed = subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
        if completed.returncode != 0:
            log(f"AI command failed (exit={completed.returncode}): {completed.stderr.strip()}")
            return False, None

        stdout = completed.stdout.strip()
        if not stdout:
            log("AI command returned empty output")
            return False, None

        try:
            payload = json.loads(stdout)
        except json.JSONDecodeError:
            log(f"AI output is not valid JSON: {stdout}")
            return False, None

        accepted = bool(payload.get("accepted", False))
        bottle_size = payload.get("bottleSize")
        if bottle_size not in BOTTLE_POINTS:
            bottle_size = None
        return accepted, bottle_size

    def inspect_bottle(self) -> tuple[bool, Optional[str]]:
        image_path = self._capture_image()
        return self._run_ai_inference(image_path)

    def release_solenoid(self, duration_sec: float, on_tick: Callable[[], None]) -> None:
        self._set_solenoid(True)
        try:
            sleep_with_tick(max(0.1, duration_sec), on_tick)
        finally:
            self._set_solenoid(False)

    def close(self) -> None:
        try:
            self._set_solenoid(False)
        finally:
            self.gpio.cleanup()


def create_runtime(config: Config) -> RuntimeBase:
    if config.device_mode == "hardware":
        log("Starting runtime in HARDWARE mode")
        return HardwareRuntime(config)

    log("Starting runtime in MOCK mode")
    return MockRuntime(config)


class Maintenance:
    def __init__(self, db: firestore.Client, config: Config, queue: OfflineQueue):
        self.db = db
        self.config = config
        self.queue = queue
        self.last_heartbeat_monotonic = 0.0

    def tick(self) -> None:
        now = time.monotonic()
        if now - self.last_heartbeat_monotonic >= self.config.heartbeat_interval_sec:
            try:
                send_heartbeat(self.db, self.config)
                self.last_heartbeat_monotonic = now
            except RETRYABLE_EXCEPTIONS as error:
                log(f"Heartbeat update failed: {type(error).__name__}")

        self.queue.flush(lambda operation: apply_operation(self.db, self.config, operation))


def execute_or_queue(
    db: firestore.Client,
    config: Config,
    queue: OfflineQueue,
    operation: Operation,
) -> str:
    try:
        applied = apply_operation(db, config, operation)
        if not applied:
            return "skipped"
        return "applied"
    except RETRYABLE_EXCEPTIONS as error:
        log(f"Operation failed due to connectivity ({type(error).__name__}); queueing for retry")
        queue.enqueue(operation)
        return "queued"


def run_session_loop(
    db: firestore.Client,
    config: Config,
    runtime: RuntimeBase,
    queue: OfflineQueue,
    maintenance: Maintenance,
    session_id: str,
) -> None:
    log(f"Session started: {session_id}")
    set_machine_status(db, config, "WAITING_BOTTLE", session_id)
    maintenance.tick()

    accepted_count = 0
    last_accepted_at = time.monotonic()
    has_accepted_bottle = False

    while True:
        maintenance.tick()
        machine = get_machine_data(db, config)
        if not machine:
            log("Machine document missing while session loop is running")
            sleep_with_tick(config.poll_interval_sec, maintenance.tick)
            continue

        if machine.get("activeSessionId") != session_id:
            log(f"Stop loop: machine activeSessionId changed from {session_id}")
            return

        session_data = get_session_data(db, config, session_id)
        if not session_data:
            log(f"Stop loop: session not found ({session_id})")
            return
        if session_data.get("status") != "ACTIVE":
            log(f"Stop loop: session is not ACTIVE ({session_id})")
            return

        if has_accepted_bottle:
            idle_elapsed = time.monotonic() - last_accepted_at
            idle_remaining = config.idle_timeout_sec - idle_elapsed
            if idle_remaining <= 0:
                end_operation = Operation(
                    kind="end_session",
                    session_id=session_id,
                    source=config.source_name,
                    reason="IDLE_TIMEOUT",
                    created_at_ms=_operation_created_at_ms(),
                )
                result = execute_or_queue(db, config, queue, end_operation)
                if result == "queued":
                    log(f"Session end queued due to offline mode: {session_id}")
                return
            wait_timeout = idle_remaining
        else:
            # Before first accepted bottle, do not auto-end by idle timeout.
            wait_timeout = 60.0

        detected = runtime.wait_for_bottle(wait_timeout, maintenance.tick)
        if not detected:
            if has_accepted_bottle:
                end_operation = Operation(
                    kind="end_session",
                    session_id=session_id,
                    source=config.source_name,
                    reason="IDLE_TIMEOUT",
                    created_at_ms=_operation_created_at_ms(),
                )
                result = execute_or_queue(db, config, queue, end_operation)
                if result == "queued":
                    log(f"Session end queued due to offline mode: {session_id}")
                return
            continue

        set_machine_status(db, config, "ANALYZING", session_id)
        maintenance.tick()
        accepted, bottle_size = runtime.inspect_bottle()

        if accepted and bottle_size in BOTTLE_POINTS:
            score_delta = BOTTLE_POINTS[bottle_size]
            operation = Operation(
                kind="accepted",
                session_id=session_id,
                source=config.source_name,
                bottle_size=bottle_size,
                score_delta=score_delta,
                created_at_ms=_operation_created_at_ms(),
            )
            result = execute_or_queue(db, config, queue, operation)
            if result == "skipped":
                log(f"Stop loop: accepted operation not applicable ({session_id})")
                return

            set_machine_status(db, config, "ACCEPTED", session_id)
            runtime.release_solenoid(config.solenoid_pulse_sec, maintenance.tick)
            set_machine_status(db, config, "WAITING_BOTTLE", session_id)

            accepted_count += 1
            last_accepted_at = time.monotonic()
            has_accepted_bottle = True
            log(
                f"Accepted bottle: session={session_id}, size={bottle_size}, "
                f"score+={score_delta}, result={result}"
            )

            if (
                config.mock_max_accepted_per_session > 0
                and accepted_count >= config.mock_max_accepted_per_session
            ):
                sleep_with_tick(config.idle_timeout_sec, maintenance.tick)
                end_operation = Operation(
                    kind="end_session",
                    session_id=session_id,
                    source=config.source_name,
                    reason="MAX_ACCEPTED_REACHED",
                    created_at_ms=_operation_created_at_ms(),
                )
                execute_or_queue(db, config, queue, end_operation)
                return
        else:
            operation = Operation(
                kind="rejected",
                session_id=session_id,
                source=config.source_name,
                created_at_ms=_operation_created_at_ms(),
            )
            result = execute_or_queue(db, config, queue, operation)
            if result == "skipped":
                log(f"Stop loop: rejected operation not applicable ({session_id})")
                return

            set_machine_status(db, config, "REJECTED", session_id)
            sleep_with_tick(0.5, maintenance.tick)
            set_machine_status(db, config, "WAITING_BOTTLE", session_id)
            log(f"Rejected bottle: session={session_id}, result={result}")


def main() -> None:
    config = load_config()
    db = init_firestore(config)
    queue = OfflineQueue(config.queue_path)
    runtime = create_runtime(config)
    maintenance = Maintenance(db=db, config=config, queue=queue)

    ensure_machine_document(db, config)
    set_machine_status(db, config, "OFFLINE", None)
    log("Device sender started. Waiting for active session...")

    try:
        while True:
            maintenance.tick()
            machine = get_machine_data(db, config)
            if not machine:
                ensure_machine_document(db, config)
                sleep_with_tick(config.poll_interval_sec, maintenance.tick)
                continue

            active_session_id = machine.get("activeSessionId")
            if not active_session_id:
                sleep_with_tick(config.poll_interval_sec, maintenance.tick)
                continue

            try:
                run_session_loop(
                    db=db,
                    config=config,
                    runtime=runtime,
                    queue=queue,
                    maintenance=maintenance,
                    session_id=str(active_session_id),
                )
            except RETRYABLE_EXCEPTIONS as error:
                log(f"Session loop transient error: {type(error).__name__}")
                sleep_with_tick(1.0, maintenance.tick)
            except Exception as error:  # pragma: no cover - defensive runtime logging
                log(f"Session loop error: {error}")
                sleep_with_tick(1.0, maintenance.tick)
    finally:
        runtime.close()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log("Device sender stopped by user.")
