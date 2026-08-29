# Atalhos do dia a dia. `make ajuda` lista tudo.
.PHONY: ajuda instalar migrar seed api web testes lint limpar

VENV := backend/.venv
PY   := $(VENV)/bin/python

ajuda:
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

instalar: ## Cria o venv, instala backend e frontend
	python3 -m venv $(VENV)
	$(VENV)/bin/pip install -q --upgrade pip
	$(VENV)/bin/pip install -q -r backend/requirements.txt
	cd frontend && npm install

migrar: ## Aplica as migrations
	cd backend && ../$(PY) manage.py migrate

seed: ## Cria workspace, plano de contas e importa a planilha
	cd backend && ../$(PY) manage.py preparar_ambiente --planilha ../dados/entrada_e_saida.xlsx

api: ## Sobe o backend em :8000
	cd backend && ../$(PY) manage.py runserver

web: ## Sobe o frontend em :5173
	cd frontend && npm run dev

testes: ## Roda toda a suíte
	cd backend && ../$(PY) -m pytest
	cd backend && ../$(PY) manage.py test apps
	cd frontend && npm test

lint: ## Checagem de tipos do frontend e checks do Django
	cd backend && ../$(PY) manage.py check
	cd frontend && npm run lint

limpar: ## Remove banco local, caches e build
	rm -f backend/db.sqlite3
	find . -name __pycache__ -type d -exec rm -rf {} + 2>/dev/null || true
	rm -rf frontend/dist
