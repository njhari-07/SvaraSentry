.PHONY: build up down logs test lint ml-up prod-up prod-down

build:
	docker compose build app

up:
	docker compose up --build app

down:
	docker compose --profile ml down

logs:
	docker compose logs --follow app

test:
	docker compose run --rm app python -m pytest

lint:
	docker compose run --rm app ruff check .

ml-up:
	docker compose stop app
	docker compose --profile ml up --build app-ml

prod-up:
	docker compose stop app
	docker compose -f compose.production.yaml up -d --build app-prod

prod-down:
	docker compose -f compose.production.yaml down
