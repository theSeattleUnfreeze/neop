FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY neopd ./neopd
COPY engines ./engines

ENV NEOP_NETWORK=testnet4
ENV NEOP_DATADIR=/data
ENV NEOP_BIND=0.0.0.0
ENV NEOP_PORT=18334

EXPOSE 18334
VOLUME ["/data"]

CMD ["python", "-m", "neopd"]
