# Casa de Leiloes Verzel

Sistema web para pregao online de obras de arte em tempo real, integrado ao acervo publico do Art Institute of Chicago. A aplicacao controla concorrencia de lances no banco de dados, reserva saldo comprometido de forma atomica, aplica prorrogacao anti-sniping nos minutos finais, liquida o lote no encerramento e expoe auditoria publica por cadeia de hashes.

## 1. Arquitetura e stack

- Back-end (`backend/`): Python 3.12+, FastAPI, SQLAlchemy 2.0 (async), Alembic, Pydantic v2, `httpx`, `PyJWT`, `bcrypt`, WebSockets nativos do FastAPI e Pytest.
- Banco de dados: PostgreSQL 16 (`leilao_verzel`). Valores monetarios sao gravados como inteiros em centavos (`BIGINT`) e datas utilizam UTC (`TIMESTAMPTZ`).
- Front-end (`frontend/`): React 18, Vite, TypeScript e Tailwind CSS, com suporte a tema claro (`#FAF9F6`) e escuro (`#121214`), fontes `Cormorant Garamond`, `Inter` e `JetBrains Mono`, e alinhamento numerico `tabular-nums`.
- Infraestrutura: `docker-compose.yml` para subir PostgreSQL (`db`), API FastAPI com migrations e seed automaticos (`backend`) e interface React (`frontend`).

## 2. Decisoes tecnicas principais

### 2.1. Valores em centavos e controle de concorrencia
Todos os calculos financeiros usam inteiros em centavos (`int` no Python e `BIGINT` no PostgreSQL) para evitar imprecisao de ponto flutuante.

Ao receber um lance em `POST /api/v1/lots/{lot_id}/bids`, o backend aplica `SELECT ... FOR UPDATE` no registro do lote e nas carteiras envolvidas (ordenadas por `user_id` crescente para evitar deadlock). Dentro da mesma transacao:
1. O valor antes retido do lider anterior e liberado (`BID_RELEASE`) e volta ao saldo disponivel.
2. O valor do novo lance passa para o saldo comprometido (`committed_balance_cents`) do novo lider (`BID_HOLD`).
3. Se restarem 120 segundos ou menos para o encerramento, a regra de anti-sniping ajusta `end_time` para `agora + 120s` e soma 1 em `extension_count`.

### 2.2. Consulta ao Art Institute of Chicago e contingencia local
A rota `GET /api/v1/catalog?q=...` consulta `https://api.artic.edu/api/v1/artworks/search` com timeout de 4 segundos. Em caso de timeout, erro HTTP (`5xx`) ou indisponibilidade de rede, o servico retorna a lista local `LOCAL_FALLBACK_ARTWORKS` definida em `backend/app/services/catalog.py`.

Quando o leiloeiro publica um lote (`POST /api/v1/lots`), os dados da obra (titulo, artista, data, tecnica, URL da imagem e atributos JSON) sao copiados para a tabela `lots`. Dessa forma, a vitrine, a sala ao vivo, os comprovantes e a auditoria funcionam mesmo se a API externa sair do ar depois.

### 2.3. Mascaramento de dados de licitantes
Rotas publicas, mensagens de WebSocket, recibos e logs de auditoria nao expoem nome completo nem e-mail de licitantes. Cada conta recebe um codigo publico deterministico (`LIC-XXXX` ou `LEI-XXXX`) e um identificador mascarado no padrao `LIC-XXXX (N***s B.)`.

### 2.4. Cadeia de hashes para auditoria de lances
Todo lote inicia com `head_hash = "GENESIS"` e `bid_count = 0`. A cada lance aceito, o sistema define `sequence_number = lot.bid_count + 1`, copia `previous_hash = lot.head_hash` e gera o `current_hash` via `HMAC-SHA256`:

`HMAC-SHA256(secret, "{lot_id}|{sequence_number}|{bidder_masked_name}|{amount_cents}|{created_at_iso}|{previous_hash}")`

O endpoint publico `GET /api/v1/lots/{lot_id}/audit` le os lances do lote no banco, recalcula cada hash desde `GENESIS`, confere a sequencia numerica e compara o ultimo elo com `lot.head_hash` e `lot.bid_count`. Se alguma linha sofrer `UPDATE`, `INSERT` ou `DELETE` direto via SQL, a verificacao retorna `is_chain_valid: false` e informa em `broken_at_sequence` o ponto exato da divergencia.

## 3. Como executar o projeto

### Opcao A: via Docker Compose

Na raiz do repositorio, execute:

```bash
docker compose up --build
```

Servicos expostos:
- PostgreSQL 16: `localhost:5432`
- API FastAPI (executa `alembic upgrade head` e `python -m app.seed` na subida): `http://localhost:8000` (documentacao OpenAPI em `http://localhost:8000/docs`)
- Interface React + Vite: `http://localhost:5173`

### Opcao B: execucao local sem Docker no backend e frontend

1. Suba o banco PostgreSQL na porta `5432`:
   ```bash
   docker compose up -d db
   ```

2. Configure e inicie o backend (`backend/`):
   ```bash
   cd backend
   pip install -r requirements.txt
   alembic upgrade head
   python -m app.seed
   uvicorn app.main:app --reload --port 8000
   ```

3. Instale as dependencias e inicie o frontend (`frontend/`):
   ```bash
   cd frontend
   npm install
   npm run dev
   ```

## 4. Contas e lotes criados pelo seed

O script `backend/app/seed.py` e idempotente. As tres contas abaixo tambem contam com botoes de acesso rapido (1 clique) no topo da interface e na tela `/login`:

| Perfil | Nome | E-mail | Senha | Papel |
| :--- | :--- | :--- | :--- | :--- |
| Leiloeiro | Helena Curadora | `curador@verzel.com.br` | `Verzel2026!` | `AUCTIONEER` |
| Licitante 1 | Nicolas Brito | `nicolas@verzel.com.br` | `Verzel2026!` | `BIDDER` |
| Licitante 2 | Marina Silva | `marina@verzel.com.br` | `Verzel2026!` | `BIDDER` |

Lotes iniciais disponiveis apos o seed:
- Lote #101 (`SCHEDULED`): *Nighthawks* (Edward Hopper), com inicio agendado no futuro.
- Lote #102 (`LIVE`, sem lances): *The Bedroom* (Vincent van Gogh), aberto para receber o primeiro lance.
- Lote #103 (`LIVE`, com disputa): *A Sunday on La Grande Jatte* (Georges Seurat), com 3 lances encadeados e reserva ativa no saldo comprometido do lider.
- Lote #104 (`ENDED`, liquidado): *Water Lilies* (Claude Monet), encerrado com transferencia financeira concluida e comprovante publico emitido (`ARP-`).
- Lote #105 (`CANCELLED`): *American Gothic* (Grant Wood), oculto na vitrine publica e listado no painel do leiloeiro.

## 5. Principais rotas da API e WebSockets

- `POST /api/v1/auth/register`, `POST /api/v1/auth/login` e `GET /api/v1/auth/me`
- `GET /api/v1/wallet`, `GET /api/v1/wallets/me`, `POST /api/v1/wallets/deposit` e `GET /api/v1/wallets/transactions`
- `GET /api/v1/catalog?q=...`
- `GET /api/v1/lots`, `POST /api/v1/lots`, `GET /api/v1/lots/{lot_id}` e `POST /api/v1/lots/{lot_id}/cancel`
- `POST /api/v1/lots/{lot_id}/bids`
- `GET /api/v1/lots/{lot_id}/audit`
- `GET /api/v1/receipts/{receipt_code}`
- `GET /api/v1/me/bids-and-wins`
- `GET /api/v1/auctioneer/dashboard`
- `WS /api/v1/ws/lots/{lot_id}` (tambem acessivel em `/ws/lots/{lot_id}`)

## 6. Como testar a deteccao de adulteracao no PostgreSQL

1. Abra `http://localhost:5173`, localize o Lote #103 (*A Sunday on La Grande Jatte*) e clique em `Auditoria SHA-256`.
2. Verifique que o status inicial indica `HISTORICO INTEGRO` para os 3 blocos (`GENESIS -> #1 -> #2 -> #3`).
3. Em um terminal, altere manualmente o valor do lance de sequencia `2` direto na tabela `bids`:
   ```bash
   docker exec -it leilao_verzel_db psql -U postgres -d leilao_verzel -c "UPDATE bids SET amount_cents = 999999 WHERE sequence_number = 2;"
   ```
4. Volte para a pagina de auditoria no navegador e clique em `Reexecutar Auditoria Agora`.
5. O verificador acusara quebra na sequencia `#2` (`is_chain_valid: false`) e exibira a diferenca entre o hash gravado no banco e o hash recalculado.

## 7. Execucao dos testes automatizados

Para rodar a suite do backend (44 testes com Pytest):
```bash
python -m pytest backend/tests -v
```

Para rodar os testes unitarios do frontend (formatacao em centavos, cronometro, mascara de licitante e reconciliacao do extrato):
```bash
cd frontend
npm test
```
