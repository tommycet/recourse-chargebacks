"""Record the Recourse demo video using Playwright sync API."""
import time
import glob
import shutil
import os
from playwright.sync_api import sync_playwright

RECording_DIR = "/tmp/recourse_recording"
os.makedirs(RECording_DIR, exist_ok=True)

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    context = browser.new_context(
        viewport={"width": 1920, "height": 1080},
        record_video_dir=RECording_DIR,
        record_video_size={"width": 1920, "height": 1080},
    )
    page = context.new_page()

    # Navigate to our recording page
    page.goto("file:///root/recourse/demo-video/recording-page.html", wait_until="networkidle", timeout=30000)
    time.sleep(2)  # Let fonts load and initial render settle

    # The scroll controller in the HTML handles all scrolling automatically
    # We just need to wait long enough for the full timeline (85s) + buffer
    print(f"Recording started at {time.strftime('%H:%M:%S')}")
    print("Scroll controller is running... waiting 88 seconds")

    time.sleep(88)  # 85s timeline + 3s buffer

    print(f"Recording ended at {time.strftime('%H:%M:%S')}")

    # Close in order: page, context, browser
    page.close()
    time.sleep(1)
    context.close()
    time.sleep(1)
    browser.close()

# Find the recorded webm
webms = glob.glob(f"{RECording_DIR}/*.webm")
if webms:
    src = webms[0]
    dst = "/root/recourse/demo-video/partAB.webm"
    shutil.copy(src, dst)
    size = os.path.getsize(dst)
    print(f"Recorded: {dst} ({size} bytes)")
else:
    print("ERROR: No webm file found!")
    for f in os.listdir(RECording_DIR):
        print(f"  {f}")
