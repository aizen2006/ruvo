# RUVO's document sandbox (docparse.py): scans a document from stdin and, when it is clean, parses it.
# The worker runs it once per document with no network, a read-only filesystem, and memory, CPU and process limits.
FROM python:3.14.8-slim-trixie AS docparse
RUN pip install --no-cache-dir pypdf==6.20.0 openpyxl==3.1.5 et-xmlfile==2.0.0 charset-normalizer==3.5.2 defusedxml==0.7.1
COPY docparse.py /app/docparse.py
# nobody: a document gets no user of its own, and no root.
USER 65534:65534
ENTRYPOINT ["python", "/app/docparse.py"]

# The sandbox suite, run inside the same image: docker build --target tests. Samples are made as the tests run.
FROM docparse AS tests
COPY tests /tests
ENTRYPOINT ["python", "-m", "unittest", "discover", "-s", "/tests", "-v"]

# The default target is the sandbox itself.
FROM docparse
