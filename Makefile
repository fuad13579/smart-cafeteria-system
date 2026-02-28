up-infra:
	docker compose -f infra/docker-compose.yml --profile infra up -d

up-app:
	docker compose -f infra/docker-compose.yml --profile app up -d --build

up-all:
	docker compose -f infra/docker-compose.yml up -d --build

down:
	docker compose -f infra/docker-compose.yml down

ps:
	docker compose -f infra/docker-compose.yml ps

logs:
	docker compose -f infra/docker-compose.yml logs -f --tail=200

db-backup:
	./scripts/db-backup.sh

db-restore:
	./scripts/db-restore.sh $(FILE)

db-test:
	./database/run-db-tests.sh
