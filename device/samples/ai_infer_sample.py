#!/usr/bin/env python3
"""
Sample AI inference command for hardware mode.

Usage:
  python ai_infer_sample.py --image path/to/image.jpg
"""

from __future__ import annotations

import argparse
import json
import random


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", required=True)
    _ = parser.parse_args()

    accepted = random.random() < 0.8
    bottle_size = random.choice(["small", "medium", "large"]) if accepted else None

    print(
        json.dumps(
            {
                "accepted": accepted,
                "bottleSize": bottle_size,
            }
        )
    )


if __name__ == "__main__":
    main()
