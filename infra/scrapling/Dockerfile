# RUVO's fetch service (infra/scrapling/server.py) on Scrapling's image, which ships the browsers.
# Needs EGRESS_PROXY pointing at the egress guard; run it with init so browser processes are reaped.
FROM pyd4vinci/scrapling:0.4.15
WORKDIR /app
COPY server.py ./

ENV SCRAPLING_HOST=0.0.0.0
EXPOSE 8001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD ["/app/.venv/bin/python", "-c", "import os, urllib.request; urllib.request.urlopen(f\"http://127.0.0.1:{os.environ.get('SCRAPLING_PORT', '8001')}/health\", timeout=4)"]
# The venv's Python directly: "uv run" rebuilds the package at every start.
ENTRYPOINT ["/app/.venv/bin/python", "server.py"]
