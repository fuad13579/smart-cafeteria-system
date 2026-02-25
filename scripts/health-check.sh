#!/bin/bash

echo "---- SERVICE HEALTH ----"

services=(
  "http://localhost:8001/health"
  "http://localhost:8002/health"
  "http://localhost:8003/health"
  "http://localhost:8004/health"
  "http://localhost:8005/health"
  "http://localhost:8006/health"
)

for url in "${services[@]}"
do
  status=$(curl -s -o /dev/null -w "%{http_code}" $url)
  if [ "$status" = "200" ]; then
    echo "$url -> OK"
  else
    echo "$url -> FAIL ($status)"
  fi
done

echo ""
echo "---- DOCKER CONTAINERS ----"
docker compose -f infra/docker-compose.yml ps

echo ""
echo "---- RABBITMQ QUEUES ----"
curl -u guest:guest http://localhost:15672/api/queues 2>/dev/null | grep name
