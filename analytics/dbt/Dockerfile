FROM python:3.12-slim
WORKDIR /dbt
COPY requirements.txt /tmp/requirements.txt
RUN pip install -q --disable-pip-version-check -r /tmp/requirements.txt
