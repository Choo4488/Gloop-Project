# Device Sender (Raspberry Pi + Firestore)

โฟลเดอร์นี้เป็นฝั่งอุปกรณ์ (Raspberry Pi) สำหรับส่งสถานะ/คะแนนเข้า Firestore
รองรับทั้งโหมดจำลองและโหมดฮาร์ดแวร์จริง

## ความสามารถที่มีแล้ว

- ใช้ Firebase Admin SDK (service account หรือ ADC)
- อัปเดต heartbeat ของเครื่องเป็นระยะ
- เขียนข้อมูลแบบ atomic (Firestore transaction/batch)
- retry + exponential backoff เมื่อเน็ตมีปัญหา
- offline queue เก็บ operation แล้ว replay ตอนเน็ตกลับมา
- รองรับ 2 โหมด:
  - `DEVICE_MODE=mock` จำลองการใส่ขวด
  - `DEVICE_MODE=hardware` ต่อ GPIO + เรียก AI command ภายนอก

## Firestore ที่สคริปต์เขียน

- `machines/{machineId}`
  - `status`, `activeSessionId`, `updatedAt`, `lastHeartbeatAt`
- `sessions/{sessionId}`
  - `score`, `bottleCounts.*`, `lastBottleAt`, `status`, `endedAt`
- `sessionEvents/{eventId}`
  - `sessionId`, `type`, `bottleSize`, `scoreDelta`, `source`, `createdAt`

## ติดตั้ง

```bash
pip install -r requirements.txt
```

สร้างไฟล์ `.env` จาก `.env.example` แล้วแก้ค่าที่จำเป็น

## โหมดจำลอง (Mock)

```bash
python mock_sender.py
```

## โหมดฮาร์ดแวร์จริง

1. ตั้งค่าใน `.env`
- `DEVICE_MODE=hardware`
- `GPIO_BOTTLE_SENSOR_PIN`, `GPIO_SOLENOID_PIN`
- `SOLENOID_PULSE_SEC`
- `AI_INFERENCE_COMMAND`

2. รูปแบบผลลัพธ์จาก `AI_INFERENCE_COMMAND` (stdout ต้องเป็น JSON)

```json
{
  "accepted": true,
  "bottleSize": "small"
}
```

ตัวอย่าง command:

```bash
AI_INFERENCE_COMMAND=python ai_infer.py --image {image_path}
```

## หมายเหตุ

- ถ้าเน็ตล่ม operation จะถูกเก็บที่ `OFFLINE_QUEUE_PATH` แล้วส่งซ้ำอัตโนมัติ
- ห้าม commit service account key ขึ้น Git
- บน Raspberry Pi ควรตั้งให้รันเป็น systemd service
