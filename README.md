# Casa de Leilões Verzel

![Python](https://img.shields.io/badge/Python-3.12-blue)
![FastAPI](https://img.shields.io/badge/FastAPI-Async-green)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-blue)
![React](https://img.shields.io/badge/React-18%20%2B%20TS-61dafb)
![Tests](https://img.shields.io/badge/Testes-94%20(81%20Pytest%20%2B%2013%20Vitest)-brightgreen)

- **Aplicação em produção (Frontend):** https://leilao-verzel.vercel.app
- **Documentação interativa da API (Swagger/OpenAPI):** https://leilao-verzel.onrender.com/docs

Implementação para o desafio técnico **Elite Dev na Verzel**. O sistema modela uma casa de leilões online onde o leiloeiro cataloga obras de arte reais via API pública (com contingência local), abre lotes com janela programada e acompanha liquidação e faturamento, enquanto licitantes depositam saldo em carteira, disputam lotes em tempo real por WebSocket, recebem comprovantes assinados e podem auditar publicamente a integridade criptográfica da cadeia de lances.

---

## Sumário

1. [Decisões de arquitetura e fluxo de engenharia](#1-decisões-de-arquitetura-e-fluxo-de-engenharia)
2. [Banco de dados (PostgreSQL + Alembic)](#2-banco-de-dados-postgresql--alembic)
3. [Backend (FastAPI + SQLAlchemy Async)](#3-backend-fastapi--sqlalchemy-async)
4. [Frontend (React 18 + TypeScript + Tailwind)](#4-frontend-react-18--typescript--tailwind)
5. [Cobertura de requisitos do desafio](#5-cobertura-de-requisitos-do-desafio)
6. [Como rodar o projeto (Docker Compose e Local)](#6-como-rodar-o-projeto-docker-compose-e-local)
7. [Dados iniciais (Seed) e contas de demonstração](#7-dados-iniciais-seed-e-contas-de-demonstração)
8. [Como testar a detecção de adulteração no banco (SQL Tampering)](#8-como-testar-a-detecção-de-adulteração-no-banco-sql-tampering)
9. [Suíte de testes automatizados (94 testes)](#9-suíte-de-testes-automatizados-94-testes)
10. [Onde e como usei IA (Relato transparente)](#10-onde-e-como-usei-ia-relato-transparente)

---

## 1. Decisões de arquitetura e fluxo de engenharia

Cinco problemas técnicos orientaram o desenho desde o início:

1. **Valores monetários em centavos inteiros (`BIGINT`):** Todo cálculo de lance, incremento e saldo trafega em centavos inteiros (`amount_cents`) no banco, na API e no estado do frontend, evitando erros de ponto flutuante e convertendo para `R$` apenas na formatação visual.
2. **Concorrência em lances simultâneos (`SELECT ... FOR UPDATE`):** Em `place_bid` (`backend/app/services/bidding.py`), o backend adquire lock pessimista na linha do lote e nas carteiras envolvidas em ordem determinística de `user_id` (`sorted(..., key=lambda u: str(u))`), impedindo double-spending e deadlocks cruzados entre lotes distintos. Em PostgreSQL, não há lock em memória encobrindo o `FOR UPDATE`; o `asyncio.Lock` auxiliar fica restrito ao dialeto SQLite usado apenas quando `TEST_DATABASE_URL` não está configurada localmente.
3. **Auditoria à prova de adulteração no banco (HMAC com chave externa + selo no lote):**
   - Cada lance armazena `current_hash` calculado com `HMAC-SHA256` com chave (`HMAC_SECRET_KEY` fora do banco) sobre `bid-hash:v2|...` e persiste `node_signature` (`HMAC-SHA256` sobre `bid-sig:v2|...|{current_hash}`). Assim, quem tem acesso direto ao SQL não consegue editar um lance, deletar o último ou recalcular um SHA-256 sem possuir `HMAC_SECRET_KEY`.
   - Cada lote persiste `integrity_seal` (`HMAC-SHA256` sobre `lot-seal:v2|lot_id|bid_count|head_hash|auctioneer_id|end_time|leader_user_id|current_bid_cents`), impedindo truncamento silencioso da cauda ou desvio de liquidação/janela sem detecção.
   - Qualquer violação detectada por `verify_lot_integrity` bloqueia em modo *fail-closed* novos lances (`409`), cancelamento (`409`) e liquidação (`LotIntegrityError`).
4. **Privacidade nas rotas públicas e controle de cadastro:** Rotas públicas (`GET /api/v1/lots`, `GET /api/v1/lots/{lot_id}`) e o canal `/ws/lots/{lot_id}` não expõem `user_id`, `leader_user_id`, `auctioneer_id`, `winner_user_id` ou `auctioneer_user_id`. Quando há usuário autenticado opcional (`get_optional_current_user`), a API devolve booleanos contextuais (`is_own_bid`, `is_user_leading`, `has_user_participated`). Além disso, `POST /api/v1/auth/register` aceita apenas papel `BIDDER` (`403` para `AUCTIONEER`).
5. **Resiliência da API externa de obras:** A fonte externa é a Open Access API do **Cleveland Museum of Art** com timeout configurável (`CLEVELAND_TIMEOUT_SECONDS=4`), até 3 tentativas com backoff exponencial + jitter, `CatalogCircuitBreaker` (abre após 3 falhas por 60s), cache persistente no PostgreSQL (`catalog_cache`, TTL de 10 min + leitura *stale*), snapshot imutável na criação do lote e fallback local com 6 obras curadas em SVG.

### Pipeline CI/CD (`.github/workflows/ci.yml`)

O workflow `CI Pipeline` dispara em `push` e `pull_request` para as branches configuradas e executa dois jobs:
- **Backend Tests:** Sobe um serviço real `postgres:16-alpine` com healthcheck (`pg_isready`), injeta `TEST_DATABASE_URL`, `DATABASE_URL`, `JWT_SECRET_KEY` e `HMAC_SECRET_KEY`, aplica `alembic upgrade head` em `backend/` e executa `python -m pytest backend/tests -v` diretamente contra o PostgreSQL 16.
- **Frontend Tests & Build:** Instala dependências via `npm --prefix frontend ci`, roda `npm --prefix frontend test` (Vitest) e executa `npm --prefix frontend run build` (`tsc -b && vite build`).

Na implantação em container (`backend/Dockerfile`), o comando de inicialização executa `alembic upgrade head && python -m app.seed && uvicorn app.main:app --host 0.0.0.0 --port 8000`. Em `ENVIRONMENT=production`, `Settings.validate_production_secrets()` falha na inicialização se `JWT_SECRET_KEY` ou `HMAC_SECRET_KEY` estiverem com os valores padrão de desenvolvimento (ou se `HMAC_SECRET_KEY` tiver menos de 32 caracteres).

### Identidade visual (`VerzelEmblem.tsx`)

O componente [VerzelEmblem.tsx](frontend/src/components/VerzelEmblem.tsx) combina traços orgânicos de brasão (`stroke-[#681417]` no claro / `dark:stroke-[#C5A059]` no escuro) com dois prismas geométricos facetados (`<polygon>` em bordô/dourado `#A32428`, `#BD2C31`, `#D4AF37` no modo claro e `#C5A059`, `#DFB86C`, `#E5C158` no modo escuro).

---

## 2. Banco de dados (PostgreSQL + Alembic)

O esquema é gerenciado por Alembic em [backend/alembic/versions/](backend/alembic/versions) com três revisões:
- `0001_initial_schema`: tabelas principais (`users`, `wallets`, `wallet_transactions`, `lots`, `bids`, `settlements`).
- `0002_add_catalog_cache`: criação da tabela `catalog_cache`.
- `0003_hmac_audit_seal_and_constraints`: adiciona `lots.integrity_seal` e `bids.node_signature`, ajusta default de `lots.head_hash` para `GENESIS_HASH`, garante `uq_bid_lot_sequence` e índice único em `bids.current_hash`, e executa `rechain_and_seal_legacy_data` (`backend/app/core/migration_helpers.py`) para reencadear lances legados com HMAC v2 e selar lotes existentes (como os lotes `101`, `103` e `104` de implantações anteriores).

Todos os timestamps usam `DateTime(timezone=True)` (`TIMESTAMPTZ`) gerados por `utc_now()` em [base.py](backend/app/models/base.py). `TimestampMixin` fornece `created_at`.

### 2.1. `users` ([user.py](backend/app/models/user.py))
- **Colunas:** `id` (`UUID`, PK), `name` (`String(120)`), `email` (`String(160)`, único e indexado), `password_hash` (`String(255)` com bcrypt), `role` (`String(20)`: `BIDDER` ou `AUCTIONEER`), `public_code` (`String(16)`, único e indexado, formato `LIC-XXXX` ou `LEI-XXXX`), `masked_name` (`String(80)`, ex.: `LIC-XXXX (N***s B.)`), `created_at` (`TIMESTAMPTZ`).

### 2.2. `wallets` ([wallet.py](backend/app/models/wallet.py))
- **Colunas:** `id` (`UUID`, PK), `user_id` (`FK users.id`, único, `CASCADE`), `total_balance_cents` (`BigInteger`, padrão `0`), `committed_balance_cents` (`BigInteger`, padrão `0`), `created_at` (`TIMESTAMPTZ`).
- **Constraints (`__table_args__`):**
  - `ck_wallet_total_positive`: `total_balance_cents >= 0`
  - `ck_wallet_committed_positive`: `committed_balance_cents >= 0`
  - `ck_wallet_balance_consistency`: `committed_balance_cents <= total_balance_cents`
- **Propriedade calculada:** `available_balance_cents = total_balance_cents - committed_balance_cents`.

### 2.3. `wallet_transactions` ([wallet.py](backend/app/models/wallet.py))
- **Colunas:** `id` (`UUID`, PK), `wallet_id` (`FK wallets.id`, `CASCADE`), `user_id` (`FK users.id`, `CASCADE`), `lot_id` (`FK lots.id`, anulável, `SET NULL`), `type` (`String(30)`), `amount_cents` (`BigInteger`), `balance_after_cents` (`BigInteger`), `committed_after_cents` (`BigInteger`), `description` (`String(255)`), `created_at` (`TIMESTAMPTZ`).
- **Tipos:** `DEPOSIT`, `BID_HOLD`, `BID_RELEASE`, `SETTLEMENT_DEBIT`, `SETTLEMENT_CREDIT`, `CANCEL_REFUND`.

### 2.4. `lots` ([lot.py](backend/app/models/lot.py))
- **Colunas:** `id` (`UUID`, PK), `lot_number` (`Integer`, único e indexado), `auctioneer_id` (`FK users.id`, `RESTRICT`), `external_artwork_id` (`String(64)`), `title` (`String(255)`), `artist` (`String(255)`), `date_display` (`String(120)`), `medium_display` (`String(255)`), `image_url` (`Text`), `attributes_json` (`JSON`), `starting_bid_cents` (`BigInteger`), `min_increment_cents` (`BigInteger`), `current_bid_cents` (`BigInteger`, anulável), `leader_user_id` (`FK users.id`, anulável, `SET NULL`), `leader_masked_name` (`String(80)`, anulável), `start_time` (`TIMESTAMPTZ`), `end_time` (`TIMESTAMPTZ`), `original_end_time` (`TIMESTAMPTZ`), `extension_count` (`Integer`), `status` (`String(20)`: `SCHEDULED`, `LIVE`, `ENDED`, `CANCELLED`), `bid_count` (`Integer`), `head_hash` (`String(64)`, padrão `GENESIS_HASH`), `integrity_seal` (`String(64)`), `cancelled_at` (`TIMESTAMPTZ`, anulável), `settled_at` (`TIMESTAMPTZ`, anulável), `created_at` (`TIMESTAMPTZ`).
- **Constraints:** `ck_lot_starting_bid_positive` (`starting_bid_cents > 0`), `ck_lot_min_increment_positive` (`min_increment_cents > 0`).

### 2.5. `bids` ([lot.py](backend/app/models/lot.py))
- **Colunas:** `id` (`UUID`, PK), `lot_id` (`FK lots.id`, `CASCADE`), `user_id` (`FK users.id`, `RESTRICT`), `bidder_masked_name` (`String(80)`), `sequence_number` (`Integer`), `amount_cents` (`BigInteger`), `previous_hash` (`String(64)`), `current_hash` (`String(64)`, único), `node_signature` (`String(64)`), `extension_triggered` (`Boolean`), `created_at` (`TIMESTAMPTZ`).
- **Constraints:** `uq_bid_lot_sequence` (`UniqueConstraint("lot_id", "sequence_number")`) e unicidade em `current_hash`.

### 2.6. `settlements` (ORM `WinningCertificate` em [lot.py](backend/app/models/lot.py))
- **Colunas:** `id` (`UUID`, PK), `receipt_code` (`String(32)`, único e indexado, ex.: `ARP-2026-104A9F`), `lot_id` (`FK lots.id`, único, `RESTRICT`), `winner_user_id` (`FK users.id`, `RESTRICT`), `winner_masked_name` (`String(80)`), `auctioneer_user_id` (`FK users.id`, `RESTRICT`), `final_amount_cents` (`BigInteger`), `final_bid_hash` (`String(64)`), `receipt_signature` (`String(64)`), `settled_at` (`TIMESTAMPTZ`).

### 2.7. `catalog_cache` ([lot.py](backend/app/models/lot.py))
- **Colunas:** `id` (`UUID`, PK), `cache_key` (`String(255)`, único e indexado), `query_text` (`String(255)`), `payload_json` (`JSON`), `created_at` (`TIMESTAMPTZ`), `expires_at` (`TIMESTAMPTZ`).

---

## 3. Backend (FastAPI + SQLAlchemy Async)

### 3.1. Criptografia, Cadeia HMAC e Selo do Lote (`backend/app/core/crypto.py` e `backend/app/services/audit.py`)
- `GENESIS_HASH`: `"0" * 64`.
- `format_utc_iso(dt)`: normaliza para UTC com precisão fixa de microssegundos (`%Y-%m-%dT%H:%M:%S.%fZ`).
- `generate_bidder_pseudonym(user_id, secret)`: `HMAC-SHA256` sobre `str(user_id)` formatado como `LICITANTE-XXXXXXXXXX`.
- `compute_bid_hash(...)`: `HMAC-SHA256` com chave `HMAC_SECRET_KEY` sobre `bid-hash:v2|{lot_id}|{sequence_number}|{pseudonym}|{amount_cents}|{created_at_iso}|{previous_hash}`.
- `compute_node_signature(...)`: `HMAC-SHA256` sobre `bid-sig:v2|{canonical_payload}|{current_hash}`, gravado na coluna `bids.node_signature` no momento do lance.
- `compute_lot_seal(...)` / `build_lot_seal(lot)`: `HMAC-SHA256` sobre `lot-seal:v2|{lot_id}|{bid_count}|{head_hash}|{auctioneer_id}|{end_time_iso}|{leader_user_id}|{current_bid_cents}`, gravado em `lots.integrity_seal`.
- `verify_bid_chain(...)` / `verify_lot_integrity(db, lot)`: valida `integrity_seal` do lote, ausência de gaps em `sequence_number`, encadeamento de `previous_hash`, `current_hash` recalculado com `hmac.compare_digest`, assinatura persistida `node_signature` por nó, `bid_count` e `head_hash`. A invalidação propaga em cascata a partir do primeiro nó corrompido.
- `generate_receipt_signature(...)` e `verify_receipt_signature(...)`: assinam e verificam `receipt:v2|{receipt_code}|{lot_id}|{winner_masked_name}|{final_amount_cents}|{final_bid_hash}|{settled_at_iso}` em tempo constante.

### 3.2. Autenticação, Privacidade e Rate Limiting (`backend/app/core/` e `backend/app/api/deps.py`)
- **Cadastro e JWT (`auth.py`, `security.py`):** Senhas com `bcrypt`; tokens JWT (`HS256`) com `sub`, `role`, `iat` e `exp`. `POST /api/v1/auth/register` força cadastro público exclusivamente como `BIDDER` e rejeita `AUCTIONEER` com `HTTP 403`.
- **Autorização (`deps.py`):** `get_optional_current_user` para leitura pública com contexto opcional; `get_current_user`, `require_bidder` e `require_auctioneer` para rotas protegidas.
- **Rate Limiting em memória por janela deslizante (`rate_limit.py`):** `10` tentativas inválidas de login em `900s` por par `IP + e-mail` e `30` lances por `60s` por usuário, respondendo `429 Too Many Requests` com `Retry-After`.
- **Mascaramento público (`privacy.py`):** `generate_public_code` e `mask_name` exibem identidades como `LIC-XXXX (N***s B.)` nas listagens e feeds sem expor UUID ou e-mail.

### 3.3. Motor de Lances, Anti-Sniping e Liquidação (`bidding.py`, `settlement.py`, `lots.py`)
- **Fluxo de `place_bid` (`backend/app/services/bidding.py`):**
  1. Verifica perfil `BIDDER` e carrega o lote sob `SELECT ... FOR UPDATE` (precedido por `asyncio.Lock` apenas em SQLite).
  2. Executa `verify_lot_integrity(db, lot)`; se comprometido, aborta com `HTTP 409 Conflict`.
  3. Valida status e janela: lote `SCHEDULED`, `ENDED` ou `CANCELLED` retorna `400`; líder tentando cobrir a si mesmo retorna `400`; valor menor que `starting_bid_cents` ou `current_bid_cents + min_increment_cents` retorna `400` (payload malformado ou `<= 0` retorna `422` via Pydantic).
  4. Executa `lock_wallets` em ordem crescente de `str(user_id)` com `with_for_update()` para carteira do licitante e do líder anterior; saldo insuficiente retorna `400`.
  5. Libera a caução do líder anterior (`BID_RELEASE`) e reserva o valor do novo líder (`BID_HOLD`).
  6. Aplica anti-sniping acumulativo: se faltarem até `120` segundos (`ANTI_SNIPING_WINDOW_SECONDS`), soma `120` segundos (`ANTI_SNIPING_EXTENSION_SECONDS`) a `end_time`, incrementa `extension_count` e marca `extension_triggered = True`.
  7. Persiste o `Bid` com `current_hash` e `node_signature`, atualiza `bid_count`, `head_hash` e `integrity_seal` do `Lot` e comita.
  8. Após o commit, transmite `NEW_BID` (e `LOT_EXTENDED` quando aplicável) sem UUIDs em `/ws/lots/{lot_id}` e envia notificação privada `OUTBID` em `/ws/notifications` ao líder anterior.
- **Liquidação (`settlement.py`) e Cancelamento (`lots.py`):**
  - `settle_lot` adquire lock no lote e verifica `verify_lot_integrity`. Em caso de violação, levanta `LotIntegrityError` sem debitar/creditar saldos nem emitir comprovante; o worker em background (`settlement_background_worker`, ciclo de `15s` com `skip_locked=True`) e `sync_lot_temporal_state` registram erro crítico em log sem derrubar a vitrine.
  - Em lotes íntegros com lance, bloqueia carteiras de vencedor e leiloeiro em ordem determinística, grava `SETTLEMENT_DEBIT` e `SETTLEMENT_CREDIT` e emite `WinningCertificate` (`ARP-YYYY-XXXXXX`) com `receipt_signature`. Em lotes sem lances, marca `ENDED` e transmite `LOT_SETTLED`.
  - `cancel_lot` exige dono do lote (`403` caso contrário), verifica integridade (`409` se violado ou já encerrado/cancelado), estorna o saldo comprometido do líder (`CANCEL_REFUND`), recalcula `integrity_seal` e transmite `LOT_CANCELLED`.

### 3.4. Catálogo Externo Resiliente (`backend/app/services/catalog.py`)
`search_catalog(query, skip, limit, db)` opera em quatro níveis:
1. Consulta `catalog_cache` no banco dentro do TTL de `10` minutos (`CACHE_TTL_MINUTES`).
2. Se `CatalogCircuitBreaker` permitir (`CLOSED` ou `HALF_OPEN`), chama `fetch_external_artworks` (Cleveland Museum of Art, `max_attempts=3` com backoff + jitter) e atualiza `catalog_cache`. Em `3` falhas consecutivas, o circuito abre por `60` segundos.
3. Em falha externa ou circuito aberto, retorna o cache expirado (`source = "cache_stale"`) com `notice`.
4. Sem cache disponível para a consulta, filtra `LOCAL_FALLBACK_ARTWORKS` (6 obras com SVGs locais em `frontend/public/artworks/`).

### 3.5. Endpoints REST e WebSocket (`backend/app/api/v1/` e `backend/app/main.py`)

| Método | Rota | Acesso | Função |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/auth/register` | Pública (`BIDDER` apenas; `403` se `AUCTIONEER`) | Cria conta e carteira zerada e retorna JWT |
| `POST` | `/api/v1/auth/login` | Pública (Rate limit: 10 falhas / 15 min) | Autentica credenciais e retorna JWT |
| `GET` | `/api/v1/auth/me` | Bearer JWT | Retorna dados do usuário autenticado |
| `GET` | `/api/v1/wallet` e `/api/v1/wallets/me` | `BIDDER` | Saldo total, comprometido e disponível |
| `POST` | `/api/v1/wallet/deposit` | `BIDDER` | Depósito simulado com `FOR UPDATE` (`DEPOSIT`) |
| `GET` | `/api/v1/wallet/transactions` | `BIDDER` | Extrato da carteira |
| `GET` | `/api/v1/catalog` | Pública | Busca obras no Cleveland Museum com fallback |
| `POST` | `/api/v1/lots` | `AUCTIONEER` | Publica lote com snapshot e `integrity_seal` |
| `GET` | `/api/v1/lots` | Pública (auth opcional para flags próprias) | Lista vitrine com `status`, `q` e sem UUIDs |
| `GET` | `/api/v1/lots/my-disputes` | `BIDDER` | Disputas agrupadas e contadores por status |
| `GET` | `/api/v1/lots/{lot_id}` | Pública (auth opcional para flags próprias) | Detalhes e lances sem expor UUIDs |
| `POST` | `/api/v1/lots/{lot_id}/cancel` | `AUCTIONEER` dono | Cancela lote íntegro com `CANCEL_REFUND` |
| `POST` | `/api/v1/lots/{lot_id}/bids` | `BIDDER` (Rate limit: 30 / min) | Registra lance atômico na cadeia HMAC |
| `GET` | `/api/v1/lots/{lot_id}/audit` | Pública | Auditoria completa dos nós e do selo do lote |
| `GET` | `/api/v1/receipts/{receipt_code}` | Pública | Consulta e validação HMAC do comprovante |
| `GET` | `/api/v1/me/bids-and-wins` | `BIDDER` | Histórico de participações e certificados |
| `GET` | `/api/v1/settlement/my-bids` | `BIDDER` | Alias de disputas do comprador |
| `GET` | `/api/v1/auctioneer/dashboard` | `AUCTIONEER` | Lotes do leiloeiro e faturamento liquidado |
| `GET` | `/` e `/health` | Pública | Metadados da API e healthcheck (`SELECT 1`) |
| `WS` | `/ws/lots/{lot_id}` (e `/api/v1/ws/lots/{lot_id}`) | Pública | Broadcast de `NEW_BID`, `LOT_EXTENDED`, `LOT_SETTLED`, `LOT_CANCELLED` |
| `WS` | `/ws/notifications?token=...` | Bearer JWT | Alertas privados `OUTBID` e `LOT_EXTENDED` |

---

## 4. Frontend (React 18 + TypeScript + Tailwind)

As páginas e componentes principais estão em `frontend/src/`:
- **Rotas (`App.tsx`):** `/` (`ShowcasePage`), `/login` (`LoginPage`, cadastro restrito a `BIDDER` sem seletor para `AUCTIONEER`), `/wallet` (`WalletPage`), `/my-bids` (`MyBidsPage`), `/auctioneer` (`AuctioneerDashboardPage`), `/lots/:id` (`LiveAuctionPage`), `/lots/:id/audit` e `/audit/:id` (`LotAuditPage`), `/receipts/:code` (`ReceiptPage`).
- **Contextos (`frontend/src/context/`):**
  - `AuthContext.tsx`: gerencia token JWT e sessão no `localStorage`, além de `quickSeedLogin` para alternar entre contas de demonstração na barra superior.
  - `WalletContext.tsx`: sincroniza saldo total, comprometido, disponível e transações.
  - `ThemeContext.tsx`: tema claro/escuro persistido em `verzel_theme`.
  - `NotificationContext.tsx`: conecta `/ws/notifications?token=...`, persiste notificações no `localStorage` e emite toasts (`OUTBID` / `LOT_EXTENDED`) com áudio discreto opcional.
- **Tempo real e áudio (`frontend/src/hooks/`):**
  - `useLotWebSocket.ts`: recarrega o lote quando muda o usuário logado (para atualizar `is_own_bid` e `is_user_leading` sem depender de `user_id` na resposta pública), conecta `/ws/lots/{lot_id}` e reconecta com backoff exponencial + jitter.
  - `useAuctionAudio.ts`: sintetiza tons na Web Audio API para lance confirmado e batida de encerramento, com botão de mudo persistido.
- **Auditoria e comprovantes (`LotAuditPage.tsx`, `ReceiptPage.tsx`):**
  - `LotAuditPage.tsx` exibe `genesis_hash`, selo do lote (`lot_seal` e `is_lot_seal_valid`), pseudônimo LGPD (`bidder_pseudonym`), `previous_hash`, `stored_current_hash`, `recomputed_hash` e assinatura HMAC persistida (`stored_signature` / `is_signature_valid`).
  - `ReceiptPage.tsx` valida publicamente a assinatura HMAC do comprovante `ARP-YYYY-XXXXXX`.

---

## 5. Cobertura de requisitos do desafio

| Requisito | Status | Implementação principal |
| :--- | :--- | :--- |
| Vitrine separando ativos, agendados e encerrados | Concluído | `ShowcasePage.tsx` + `GET /api/v1/lots` |
| Leiloeiro cataloga da API pública e cria lotes | Concluído | `AuctioneerDashboardPage.tsx` + `catalog.py` + `POST /api/v1/lots` |
| Acompanhamento de lotes e faturamento do leiloeiro | Concluído | `get_auctioneer_dashboard` (`settlement.py`) |
| Sala ao vivo com atualização em tempo real | Concluído | `LiveAuctionPage.tsx` + `useLotWebSocket.ts` + `websocket.py` |
| Carteira com saldo Total / Comprometido / Disponível | Concluído | `WalletPage.tsx` + `wallet.py` + constraints em `wallets` |
| Histórico de lances, vitórias e comprovante público | Concluído | `MyBidsPage.tsx` + `ReceiptPage.tsx` |
| Auditoria pública e detecção de adulteração/exclusão SQL | Concluído | `LotAuditPage.tsx` + `crypto.py` + `audit.py` + bloqueio *fail-closed* |
| Resiliência contra falha da API externa | Concluído | `catalog_cache` + retry/backoff + `CatalogCircuitBreaker` + fallback SVG |
| Regras de lance, concorrência e anti-sniping (+2 min) | Concluído | `place_bid` (`bidding.py`) + `FOR UPDATE` ordenado |
| Liquidação automática e lotes sem lances | Concluído | `settle_lot` + `settlement_background_worker` (15s) |
| Busca/filtro na vitrine, cancelamento com estorno, Dark Mode, Docker Compose e testes (opcionais) | Concluído | `lots.py`, `ThemeContext.tsx`, `docker-compose.yml`, CI PostgreSQL 16 |

---

## 6. Como rodar o projeto (Docker Compose e Local)

### Opção A: Docker Compose (Recomendado)

```bash
docker compose up --build
```

O Compose inicia:
1. `db`: PostgreSQL 16 (`leilao_verzel`) com healthcheck `pg_isready`.
2. `backend`: executa `alembic upgrade head`, roda `python -m app.seed` e sobe a API na porta `8000`.
3. `frontend`: sobe o Vite na porta `5173`.

- Frontend local: `http://localhost:5173`
- Docs API: `http://localhost:8000/docs`
- Healthcheck: `http://localhost:8000/health`

### Opção B: Execução Local

Configure as variáveis a partir de `.env.example` (`JWT_SECRET_KEY`, `HMAC_SECRET_KEY`, `DATABASE_URL`, `DATABASE_URL_SYNC` e opcionalmente `TEST_DATABASE_URL` para rodar os testes em PostgreSQL):

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate | Linux/Mac: source .venv/bin/activate
pip install -e ".[dev]"
alembic upgrade head
python -m app.seed
uvicorn app.main:app --reload --port 8000
```

```bash
cd frontend
npm install
npm run dev
```

---

## 7. Dados iniciais (Seed) e contas de demonstração

O script idempotente [backend/app/seed.py](backend/app/seed.py) cria 3 contas e **5 lotes** (`#101` agendado, `#102` ao vivo sem lances, `#103` ao vivo com 3 lances encadeados, `#104` encerrado e liquidado com comprovante `ARP-<ANO>-104A9F`, e `#105` cancelado). Na interface web, os botões de acesso rápido no topo alternam entre as três contas:

| Conta | Papel | E-mail | Senha | Saldo inicial no seed |
| :--- | :--- | :--- | :--- | :--- |
| **Helena Curadora** | `AUCTIONEER` | `curador@verzel.com.br` | `Verzel2026!` | Total `R$ 3.200,00` (crédito do Lote `#104`) |
| **Nicolas Brito** | `BIDDER` | `nicolas@verzel.com.br` | `Verzel2026!` | Depósito `R$ 15.000,00` -> Total `R$ 11.800,00`, Comprometido `R$ 2.800,00`, Disponível `R$ 9.000,00` |
| **Marina Silva** | `BIDDER` | `marina@verzel.com.br` | `Verzel2026!` | Total `R$ 12.000,00`, Disponível `R$ 12.000,00` |

---

## 8. Como testar a detecção de adulteração no banco (SQL Tampering)

1. Abra um lote com lances (ex.: Lote `#103`) na aba **Auditoria** (`/lots/{id}/audit`). A página exibirá o selo do lote válido (`is_lot_seal_valid: true`) e todos os lances como válidos (`is_signature_valid: true`).
2. Execute uma alteração direta no PostgreSQL (por exemplo via `docker exec -it leilao_verzel_db psql -U postgres -d leilao_verzel`):
   ```sql
   UPDATE bids SET amount_cents = 999999 WHERE sequence_number = 2;
   ```
   *(Cenários adicionais cobertos em `test_audit_tampering.py`: tentar forjar `SHA-256` sem chave na coluna `current_hash`, apagar o último lance ajustando `head_hash`/`bid_count`, ou alterar `lots.auctioneer_id` / `lots.end_time`.)*
3. Recarregue `/lots/{id}/audit` ou consulte `GET /api/v1/lots/{id}/audit`:
   - `is_intact` muda para `false` e `tampered_at_sequence` aponta o nó comprometido (`2`, invalidando em cascata o `2` e o `3`).
   - Se alguém tentar dar novo lance em `POST /api/v1/lots/{id}/bids` ou cancelar em `POST /api/v1/lots/{id}/cancel`, a API bloqueia em modo *fail-closed* com `409 Conflict`.

---

## 9. Suíte de testes automatizados (94 testes)

### 9.1. Backend: 81 testes com Pytest (`backend/tests/`)

- Quando `TEST_DATABASE_URL` está configurada (como no job `Backend Tests` do CI com `postgres:16-alpine`), toda a suíte roda contra PostgreSQL 16 usando os locks reais de linha (`SELECT ... FOR UPDATE`).
- Sem `TEST_DATABASE_URL`, a suíte usa SQLite assíncrono em memória e executa **80 testes**, marcando como *skip* apenas `test_cross_lot_concurrent_outbids_no_deadlock` (que exige suporte real a transações concorrentes em PostgreSQL).

Para rodar localmente:
```bash
python -m pytest backend/tests -v
```

Para rodar em PostgreSQL após aplicar migrações:
```bash
cd backend && alembic upgrade head && cd ..
TEST_DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/leilao_verzel python -m pytest backend/tests -v
```

Cobertura por arquivo (17 arquivos, 81 testes):
- `test_audit.py` (4): lote vazio, cadeia íntegra, adulteração detectada e rota pública.
- `test_audit_tampering.py` (5): pseudônimos HMAC, adulteração SQL no lance #2 com cascata, rejeição de cadeia SHA-256 sem chave, exclusão do último lance pega pelo `integrity_seal` e bloqueio *fail-closed* quando `auctioneer_id` ou `end_time` são alterados.
- `test_auth_wallet_catalog.py` (11): cadastro apenas `BIDDER` (`403` para `AUCTIONEER`), conflito de e-mail, login, `/me`, carteira/depósito/extrato e verificação de que rotas públicas de lote omitem UUIDs e calculam flags próprias.
- `test_bidding.py` (5): primeiro lance, superação com `BID_RELEASE` imediato, rejeições (`SCHEDULED`/`ENDED`/auto-superação/saldo/mínimo), anti-sniping e cancelamento com `CANCEL_REFUND`.
- `test_bidding_concurrency.py` (4): rajada concorrente, ordenação determinística em `lock_wallets`, unicidade de `(lot_id, sequence_number)` via `uq_bid_lot_sequence`, e `test_cross_lot_concurrent_outbids_no_deadlock` (PostgreSQL).
- `test_catalog.py` (5) e `test_catalog_resilience.py` (6): cache em PostgreSQL (`catalog_cache`, TTL 10 min), retry/backoff, `CatalogCircuitBreaker`, cache *stale*, fallback local e snapshot no lote mesmo sem `catalog_cache`.
- `test_crypto_and_privacy.py` (11): `public_code`, `mask_name`, HMAC-SHA256 da cadeia, `node_signature`, `compute_lot_seal`/`verify_lot_seal`, assinatura de recibo e falha rápida para segredos padrão em `production`.
- `test_health_and_root.py` (2): `/` e `/health`.
- `test_lots.py` (4): criação com snapshot e selo, permissões de leiloeiro/comprador, filtros e transições temporais.
- `test_migrations.py` (1): migração idempotente `rechain_and_seal_legacy_data` atualizando lotes legados (`101`, `103`, `104`).
- `test_models.py` (3): metadados ORM, `available_balance_cents` e inicialização de `User`.
- `test_my_disputes_api.py` (1): classificação e contadores de disputas.
- `test_notifications_websocket.py` (3): canal `/ws/notifications`, rejeição sem JWT e broadcast de `LOT_EXTENDED`.
- `test_rate_limiting.py` (5): janela deslizante, reset, headers de IP, limite de login (`429`) e limite de lances (`429`).
- `test_seed.py` (5): estados de ciclo de vida, idempotência, janela de 7 dias e fallback de imagens.
- `test_settlement_and_ws.py` (6): liquidação financeira + recibo, consulta pública, listagens de licitante e leiloeiro, broadcasts WebSocket e `settle_expired_lots`.

### 9.2. Frontend: 13 testes com Vitest (`frontend/src/tests/`)

```bash
npm --prefix frontend test -- --run
```

- `unit.test.ts` (7): `formatBrlCents`, `parseBrlToCents`, `calculateCountdown`, janela crítica e `truncateHash`.
- `disputes.test.ts` (4): filtragem de disputas por aba.
- `notifications.test.ts` (2): marcação de leitura e limpeza de alertas.

---

## 10. Onde e como usei IA (Relato transparente)

Usei assistentes de IA como acelerador para estruturar boilerplate repetitivo ao longo do projeto, mas a modelagem crítica e as correções posteriores às falhas levantadas em revisão técnica precisaram ser especificadas, auditadas e validadas diretamente no código:

### O que acelerei com IA
- Esqueleto inicial dos schemas Pydantic (`backend/app/schemas/`), interfaces TypeScript espelhadas (`frontend/src/types/api.ts`) e estrutura inicial de componentes Tailwind.
- Arquivos SVG estáticos de fallback em `frontend/public/artworks/` e geração inicial dos casos de teste unitário antes do refino das asserções reais.

### Problemas reais que ocorreram na primeira entrega e o que reescrevi depois

Na primeira versão entregue, parte das implementações geradas com apoio de IA tinha lacunas sérias de segurança, migração e alinhamento com o código:
1. **Cadeia de auditoria vulnerável a adulteração em banco:** Na implementação inicial, `compute_bid_hash` usava SHA-256 sem chave, `node_signature` era recalculada na leitura sem ser gravada no banco, e `auctioneer_id` / `end_time` ficavam fora de qualquer selo. Quem alterasse registros direto no banco conseguia recalcular os hashes sem detecção. Reescrevi o módulo em [crypto.py](backend/app/core/crypto.py) e [audit.py](backend/app/services/audit.py) para adotar `HMAC-SHA256` com chave externa (`HMAC_SECRET_KEY`), persistir `node_signature` na tabela `bids`, selar `integrity_seal` em `lots` (`lot_id`, `bid_count`, `head_hash`, `auctioneer_id`, `end_time`, `leader_user_id`, `current_bid_cents`) e bloquear em modo *fail-closed* novos lances, cancelamentos e liquidações quando a cadeia não fecha.
2. **Dados legados quebrados no deploy (lotes 101, 103 e 104):** Ao mudar o formato da cadeia sem migração de dados, lotes já existentes no banco em produção passaram a falhar na auditoria. Criei a migração [0003_hmac_audit_seal_and_constraints.py](backend/alembic/versions/0003_hmac_audit_seal_and_constraints.py) com [rechain_and_seal_legacy_data](backend/app/core/migration_helpers.py) executada no `upgrade` para recalcular a cadeia v2 e selar os lotes existentes de forma idempotente no startup.
3. **Vazamento de `user_id` em rotas públicas e cadastro aberto de leiloeiro:** O frontend inicialmente comparava `user_id` vindo das rotas públicas para saber quem liderava, e o cadastro público aceitava `AUCTIONEER`. Removi `user_id`, `leader_user_id`, `auctioneer_id`, `winner_user_id` e `auctioneer_user_id` das respostas públicas e eventos WebSocket de lote, substituindo por `is_own_bid`, `is_user_leading` e `has_user_participated` via autenticação opcional no backend, e travei `POST /api/v1/auth/register` exclusivamente para `BIDDER`.
4. **Testes apenas em SQLite e divergência de documentação:** A suíte dependia de SQLite e de um `asyncio.Lock` em memória na função de lance que mascarava o comportamento real de `SELECT ... FOR UPDATE` no PostgreSQL, além de o README antigo mencionar nomes de constraints, cache em memória e quantidades de testes desatualizadas em relação ao código. Restringi o lock em memória ao dialeto SQLite, configurei o CI para executar `alembic upgrade head` e toda a suíte Pytest diretamente no PostgreSQL 16 via `TEST_DATABASE_URL`, adicionei teste de concorrência cruzada entre lotes, unicidade no banco e teste de migração, e revisei toda a documentação (`README.md`, `.env.example`, `GLOSSARY.md`, `PRODUCT.md` e ADR) linha a linha contra os arquivos reais do repositório.

### Escopo deste conjunto final de ajustes

Após consolidar os primeiros commits de correção, o trabalho final de auditoria, segurança, concorrência PostgreSQL e documentação foi dividido em quatro commits atômicos na branch `fix/audit-security-postgres-ci`:
1. Persistência de HMAC por lance, selo de integridade do lote, bloqueio *fail-closed* e migração `0003`.
2. Remoção de UUIDs de usuários das rotas públicas/WebSocket e restrição de cadastro público para `BIDDER`.
3. Execução da suíte e migrações no PostgreSQL 16 do CI (`TEST_DATABASE_URL`) com novos testes de concorrência, unicidade e migração.
4. Revisão completa do `README.md`, arquivos `.env.example` e documentação de arquitetura contra o código real.
