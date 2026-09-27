# Optional self-hosted Laya decider (Jev-wire-compatible /v1/systemone on :8000).
# CPU-only torch keeps the image small; the default pip index would pull CUDA wheels.
FROM python:3.12-slim

RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir "laya[serve]"

ENV LAYA_PRELOAD=1 \
    HF_HOME=/models

EXPOSE 8000
CMD ["laya-serve"]
