import uvicorn
from fastapi import FastAPI
import sys
import threading
import traceback
import time

def dump_threads():
    time.sleep(2)
    for thread_id, frame in sys._current_frames().items():
        print(f"\n--- Thread {thread_id} ---", flush=True)
        traceback.print_stack(frame, file=sys.stdout)
        sys.stdout.flush()
    with open("dump.log", "w") as f:
        for thread_id, frame in sys._current_frames().items():
            f.write(f"\n--- Thread {thread_id} ---\n")
            traceback.print_stack(frame, file=f)

threading.Thread(target=dump_threads, daemon=True).start()

app = FastAPI()

@app.get("/")
def read_root():
    return {"Hello": "World"}

if __name__ == "__main__":
    print("Starting uvicorn...", flush=True)
    with open("dump.log", "a") as f:
        f.write("Starting uvicorn...\n")
    try:
        uvicorn.run(app, host="0.0.0.0", port=8000)
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)
